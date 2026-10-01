import json
import os
import sys
import tempfile
import uuid

from aiohttp import web

import server


FAVORITES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "OreX_StringSelector_v2.json")
VALID_PROMPT_TYPES = {"prompt", "style", "edit", "llm"}
PROMPT_TYPE_ORDER = ("prompt", "style", "edit", "llm")


def _load_favorites():
    if not os.path.isfile(FAVORITES_PATH):
        return []
    try:
        with open(FAVORITES_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    return [favorite for item in data if (favorite := _normalize_favorite(item)) is not None]


def _normalize_favorite(value):
    if not isinstance(value, dict):
        return None
    favorite_id = value.get("id")
    prompt_type = value.get("type", "prompt")
    if prompt_type not in VALID_PROMPT_TYPES:
        prompt_type = "prompt"
    name = str(value.get("name", ""))
    prompt = str(value.get("prompt", ""))
    if not isinstance(favorite_id, str) or not favorite_id:
        favorite_id = uuid.uuid5(uuid.NAMESPACE_URL, f"orex-string-selector-v2:{prompt_type}:{name}:{prompt}").hex
    if len(favorite_id) > 200:
        return None
    return {
        "id": favorite_id,
        "name": name,
        "prompt": prompt,
        "type": prompt_type,
    }


def _save_favorites(favorites):
    normalized = [favorite for item in favorites if (favorite := _normalize_favorite(item)) is not None]
    favorites = [
        favorite
        for prompt_type in PROMPT_TYPE_ORDER
        for favorite in normalized
        if favorite["type"] == prompt_type
    ]
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=os.path.dirname(FAVORITES_PATH),
            prefix=".system_prompt.",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_path = temp_file.name
            json.dump(favorites, temp_file, indent=4, ensure_ascii=False)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.replace(temp_path, FAVORITES_PATH)
    except OSError:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        raise


@server.PromptServer.instance.routes.get("/orex/string-selector-v2/favorites")
async def get_string_selector_favorites(request):
    return web.json_response(_load_favorites())


@server.PromptServer.instance.routes.get("/orex/string-selector-v2/backup")
async def download_string_selector_backup(request):
    if not os.path.isfile(FAVORITES_PATH):
        return web.json_response({"error": "OreX_StringSelector_v2.json not found"}, status=404)
    return web.FileResponse(
        FAVORITES_PATH,
        headers={"Content-Disposition": 'attachment; filename="OreX_StringSelector_v2.json"'},
    )


@server.PromptServer.instance.routes.post("/orex/string-selector-v2/favorite")
async def update_string_selector_favorite(request):
    payload = await request.json()
    favorite = _normalize_favorite(payload.get("entry"))
    if favorite is None:
        return web.json_response({"error": "Invalid favorite entry"}, status=400)

    favorites = _load_favorites()
    favorite_ids = {
        item.get("id") for item in favorites
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    action = payload.get("action")

    if action == "remove":
        favorites = [item for item in favorites if not isinstance(item, dict) or item.get("id") != favorite["id"]]
        is_favorite = False
    elif action == "add":
        if favorite["id"] in favorite_ids:
            favorites = [favorite if isinstance(item, dict) and item.get("id") == favorite["id"] else item for item in favorites]
        else:
            favorites.append(favorite)
        is_favorite = True
    else:
        return web.json_response({"error": "Invalid action"}, status=400)

    try:
        _save_favorites(favorites)
    except OSError as error:
        return web.json_response({"error": str(error)}, status=500)
    return web.json_response({"success": True, "favorite": is_favorite})


@server.PromptServer.instance.routes.post("/orex/string-selector-v2/reorder")
async def reorder_string_selector_favorite(request):
    payload = await request.json()
    favorite_id = payload.get("id")
    before_id = payload.get("before_id")
    if not isinstance(favorite_id, str) or not isinstance(before_id, str):
        return web.json_response({"error": "Invalid reorder request"}, status=400)

    favorites = _load_favorites()
    source_index = next((index for index, item in enumerate(favorites) if item["id"] == favorite_id), None)
    target = next((item for item in favorites if item["id"] == before_id), None)
    if source_index is None or target is None:
        return web.json_response({"error": "Prompt not found"}, status=404)

    moved = favorites[source_index]
    if moved["type"] != target["type"]:
        return web.json_response({"error": "Prompts must have the same type"}, status=400)
    if favorite_id != before_id:
        favorites.pop(source_index)
        target_index = next(index for index, item in enumerate(favorites) if item["id"] == before_id)
        favorites.insert(target_index, moved)

    try:
        _save_favorites(favorites)
    except OSError as error:
        return web.json_response({"error": str(error)}, status=500)
    return web.json_response({"success": True, "favorites": _load_favorites()})


class OreXStringSelectorV2:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt_names": ("STRING", {"multiline": True, "default": "Prompt 1"}),
                "prompt": ("STRING", {"multiline": True, "default": ""}),
                "prompts_json": ("STRING", {"multiline": True, "default": '[""]'}),
                "select": ("INT", {"min": 1, "max": sys.maxsize, "step": 1, "default": 1}),
                "selection_state": ("STRING", {"default": "{}"}),
            },
            "optional": {
                "text_before": ("STRING", {"forceInput": True}),
                "text_after": ("STRING", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("String", "String Batch")
    OUTPUT_IS_LIST = (False, True)
    FUNCTION = "select_prompt"
    CATEGORY = "OreX"

    def select_prompt(self, prompt_names, prompt, prompts_json, select, selection_state="{}", text_before="", text_after=""):
        if not prompt_names.strip():
            selected = self._join_prompt(text_before, "", text_after)
            return (selected, [])

        names = prompt_names.split("\n")
        try:
            prompts = json.loads(prompts_json)
        except (TypeError, json.JSONDecodeError):
            prompts = []

        if not isinstance(prompts, list):
            prompts = []
        prompts = [str(item) for item in prompts]

        count = len(names)
        prompts.extend([""] * (count - len(prompts)))
        prompts = prompts[:count]
        selected = self._join_prompt(text_before, str(prompt), text_after)
        batch = [self._join_prompt(text_before, item, text_after) for item in prompts]

        return (selected, batch)

    @staticmethod
    def _join_prompt(text_before, prompt, text_after):
        return " ".join(str(part) for part in (text_before, prompt, text_after) if part)
