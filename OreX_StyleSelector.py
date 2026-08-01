import os
import json
import tempfile
import server
from aiohttp import web

# Определяем пути к папке со стилями
NODE_DIR = os.path.dirname(os.path.abspath(__file__))
STYLES_DIR = os.path.join(NODE_DIR, "styles")

# ==========================================
# БЛОК API РОУТОВ И ИНИЦИАЛИЗАЦИИ
# ==========================================

# Создаем пустой favorite.json при старте сервера, если его нет.
fav_path = os.path.join(STYLES_DIR, "favorite.json")
if not os.path.exists(fav_path):
    with open(fav_path, "w", encoding="utf-8") as f:
        json.dump([], f)


def _is_safe_file_component(value):
    return (
        isinstance(value, str)
        and bool(value)
        and value not in {".", ".."}
        and "/" not in value
        and "\\" not in value
    )


def _load_style_file(style_set):
    if not _is_safe_file_component(style_set):
        return []
    file_path = os.path.join(STYLES_DIR, f"{style_set}.json")
    if not os.path.isfile(file_path):
        return []
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def _parse_selected_styles(current_style_set, select_styles):
    """Return [{"set": JSON basename, "name": style name}, ...]."""
    if isinstance(select_styles, list):
        raw_values = select_styles
    elif isinstance(select_styles, str):
        raw_values = None
        stripped = select_styles.strip()
        if stripped.startswith("["):
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, list):
                    raw_values = parsed
            except json.JSONDecodeError:
                pass
        if raw_values is None:
            raw_values = [value.strip() for value in select_styles.split(",") if value.strip()]
    else:
        raw_values = []

    result = []
    for value in raw_values:
        if isinstance(value, dict):
            style_set = value.get("set", current_style_set)
            name = value.get("name", "")
        else:
            style_set = current_style_set
            name = str(value).strip()
        if _is_safe_file_component(style_set) and isinstance(name, str) and name:
            selected = {"set": style_set, "name": name}
            item_index = value.get("index") if isinstance(value, dict) else None
            if isinstance(item_index, int) and not isinstance(item_index, bool) and item_index >= 0:
                selected["index"] = item_index
            result.append(selected)
    return result


def _resolve_selected_styles(current_style_set, select_styles):
    cache = {}
    resolved = []
    for selected in _parse_selected_styles(current_style_set, select_styles):
        style_set = selected["set"]
        if style_set not in cache:
            try:
                cache[style_set] = _load_style_file(style_set)
            except (OSError, json.JSONDecodeError):
                cache[style_set] = []
        data = cache[style_set]
        item_index = selected.get("index")
        if (
            isinstance(item_index, int)
            and 0 <= item_index < len(data)
            and isinstance(data[item_index], dict)
            and data[item_index].get("name") == selected["name"]
        ):
            resolved.append(data[item_index])
            continue
        style_data = next(
            (item for item in data if isinstance(item, dict) and item.get("name") == selected["name"]),
            None,
        )
        if style_data is not None:
            resolved.append(style_data)
    return resolved


@server.PromptServer.instance.routes.get("/orex/styles")
async def get_styles(request):
    name = request.query.get("name", "my_styles")
    if not _is_safe_file_component(name):
        return web.json_response([], status=400)
    file_path = os.path.join(STYLES_DIR, f"{name}.json")
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return web.json_response(data)
        except json.JSONDecodeError as e:
            print(f"[OreX StyleSelector] Ошибка чтения JSON в {name}.json: {e}")
            return web.json_response([])
    return web.json_response([])


@server.PromptServer.instance.routes.post("/orex/style")
async def update_style(request):
    payload = await request.json()
    style_set = payload.get("style_set", "")
    if not _is_safe_file_component(style_set):
        return web.json_response({"error": "Invalid style file"}, status=400)

    file_path = os.path.join(STYLES_DIR, f"{style_set}.json")
    if not os.path.isfile(file_path):
        return web.json_response({"error": "Style file not found"}, status=404)

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            styles_data = json.load(f)
    except (OSError, json.JSONDecodeError) as error:
        return web.json_response({"error": str(error)}, status=500)

    if not isinstance(styles_data, list) or not styles_data:
        return web.json_response({"error": "Style file is empty"}, status=400)

    try:
        original_index = int(payload.get("original_index"))
        requested_position = int(payload.get("position"))
    except (TypeError, ValueError):
        return web.json_response({"error": "Invalid position"}, status=400)

    original_name = payload.get("original_name", "")
    expected_style = payload.get("expected_style")
    if isinstance(expected_style, dict):
        if not 0 <= original_index < len(styles_data) or styles_data[original_index] != expected_style:
            matching_indexes = [
                index for index, item in enumerate(styles_data)
                if item == expected_style
            ]
            if len(matching_indexes) != 1:
                return web.json_response({"error": "Style entry changed or was not found"}, status=409)
            original_index = matching_indexes[0]
    elif (
        not 0 <= original_index < len(styles_data)
        or not isinstance(styles_data[original_index], dict)
        or styles_data[original_index].get("name") != original_name
    ):
        matching_indexes = [
            index for index, item in enumerate(styles_data)
            if isinstance(item, dict) and item.get("name") == original_name
        ]
        if len(matching_indexes) != 1:
            return web.json_response({"error": "Style entry changed or was not found"}, status=409)
        original_index = matching_indexes[0]

    edited = payload.get("style", {})
    if not isinstance(edited, dict) or not isinstance(edited.get("name"), str) or not edited["name"].strip():
        return web.json_response({"error": "Name is required"}, status=400)

    thumbnail = edited.get("thumbnail", "")
    if not (
        isinstance(thumbnail, str)
        or isinstance(thumbnail, list) and all(isinstance(item, str) for item in thumbnail)
    ):
        return web.json_response({"error": "Invalid thumbnail"}, status=400)

    updated_style = dict(styles_data.pop(original_index))
    updated_style.update({
        "name": edited["name"].strip(),
        "name_cn": str(edited.get("name_cn", "")),
        "thumbnail": thumbnail,
        "prompt": str(edited.get("prompt", "")),
        "negative_prompt": str(edited.get("negative_prompt", "")),
    })

    new_index = min(max(requested_position - 1, 0), len(styles_data))
    styles_data.insert(new_index, updated_style)

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=STYLES_DIR,
            prefix=f".{style_set}.",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_path = temp_file.name
            json.dump(styles_data, temp_file, indent=4, ensure_ascii=False)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.replace(temp_path, file_path)
    except OSError as error:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        return web.json_response({"error": str(error)}, status=500)

    return web.json_response({
        "success": True,
        "style": updated_style,
        "position": new_index + 1,
    })


@server.PromptServer.instance.routes.get("/orex/image")
async def get_image(request):
    img_name = request.query.get("img", "")
    style_set = request.query.get("style_set", "")

    # Имя JSON и имя изображения должны быть одиночными компонентами пути.
    if (
        not style_set
        or not img_name
        or style_set in {".", ".."}
        or img_name in {".", ".."}
        or "/" in style_set
        or "\\" in style_set
        or "/" in img_name
        or "\\" in img_name
    ):
        return web.Response(status=400)

    samples_dir = os.path.join(STYLES_DIR, "samples")
    img_path = os.path.join(samples_dir, style_set, img_name)
    if os.path.exists(img_path):
        return web.FileResponse(img_path)

    # favorite.json содержит копии стилей из разных наборов. Сам JSON не
    # изменяем: для избранного ищем превью в подпапках исходных наборов.
    if style_set == "favorite" and os.path.isdir(samples_dir):
        for folder_name in os.listdir(samples_dir):
            candidate = os.path.join(samples_dir, folder_name, img_name)
            if os.path.isdir(os.path.join(samples_dir, folder_name)) and os.path.exists(candidate):
                return web.FileResponse(candidate)

    return web.Response(status=404)

@server.PromptServer.instance.routes.post("/orex/favorite")
async def toggle_favorite(request):
    data = await request.json()
    style_obj = data.get("style", {})
    action = data.get("action", "add") # "add" или "remove"
    
    if not style_obj or "name" not in style_obj:
        return web.json_response({"error": "Invalid data"}, status=400)
        
    favorites = []
    if os.path.exists(fav_path):
        try:
            with open(fav_path, "r", encoding="utf-8") as f:
                favorites = json.load(f)
        except json.JSONDecodeError:
            favorites = []
            
    if action == "add":
        if not any(s.get("name") == style_obj["name"] for s in favorites):
            favorites.append(style_obj)
    elif action == "remove":
        favorites = [s for s in favorites if s.get("name") != style_obj["name"]]
        
    with open(fav_path, "w", encoding="utf-8") as f:
        json.dump(favorites, f, indent=4, ensure_ascii=False)
        
    return web.json_response({"success": True})

# ==========================================
# ОСНОВНОЙ КЛАСС УЗЛА
# ==========================================

class OrexStyleSelector:
    @classmethod
    def INPUT_TYPES(cls):
        styles = []
        if os.path.exists(STYLES_DIR):
            for file_name in os.listdir(STYLES_DIR):
                if file_name.endswith(".json"):
                    styles.append(file_name.split(".")[0])
        
        if not styles:
            styles = ["my_styles"]

        return {
            "required": {
                "styles": (styles, {"default": styles[0] if styles else ""}),
                "batch_mode": ("BOOLEAN", {"default": False, "label_on": "Batch ON", "label_off": "Batch OFF"}),
                "select_styles": ("STRING", {"default": ""}),
                "preview_scale": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.01}),
            },
            "optional": {
                "positive": ("STRING", {"forceInput": True}),
                "negative": ("STRING", {"forceInput": True}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("positive", "negative", "file_name")
    OUTPUT_IS_LIST = (True, True, True) 
    FUNCTION = "execute"
    CATEGORY = "OreX/Prompt"

    def execute(self, styles, batch_mode=False, select_styles="", preview_scale=1.0, positive='', negative='', prompt=None, unique_id=None):
        positive = positive if positive is not None else ""
        negative = negative if negative is not None else ""

        resolved_styles = _resolve_selected_styles(styles, select_styles)
        values = list(range(len(resolved_styles)))
        all_styles = {index: style_data for index, style_data in enumerate(resolved_styles)}

        if not batch_mode:
            positive_prompt = ''
            negative_prompt = negative
            file_names_collected = []
            has_prompt = False
            
            if len(values) == 0:
                positive_prompt = positive
                negative_prompt = negative
            else:
                for val in values:
                    if val not in all_styles:
                        continue
                    
                    style_data = all_styles[val]

                    # --- Извлечение имени файла из thumbnail ---
                    if 'thumbnail' in style_data:
                        thumb_val = style_data['thumbnail']
                        thumb_str = ""
                        if isinstance(thumb_val, list) and len(thumb_val) > 0:
                            thumb_str = thumb_val[0]
                        elif isinstance(thumb_val, str):
                            thumb_str = thumb_val
                        
                        if thumb_str:
                            base_name = os.path.basename(thumb_str)
                            name_without_ext, _ = os.path.splitext(base_name)
                            if name_without_ext:
                                file_names_collected.append(name_without_ext)
                    # ---------------------------------------------
                    
                    if 'prompt' in style_data:
                        if "{prompt}" in style_data['prompt'] and not has_prompt:
                            positive_prompt = style_data['prompt'].replace('{prompt}', positive)
                            has_prompt = True
                        elif "{prompt}" in style_data['prompt']:
                            positive_prompt += ', ' + style_data['prompt'].replace(', {prompt}', '').replace('{prompt}', '')
                        else:
                            if positive_prompt == '':
                                positive_prompt = style_data['prompt']
                            else:
                                positive_prompt += ', ' + style_data['prompt']
                    
                    if 'negative_prompt' in style_data:
                        if negative_prompt:
                            negative_prompt += ', ' + style_data['negative_prompt']
                        else:
                            negative_prompt = style_data['negative_prompt']

                if not has_prompt and positive:
                    if positive_prompt:
                        positive_prompt = positive + ", " + positive_prompt
                    else:
                        positive_prompt = positive

            if not positive_prompt or not positive_prompt.strip():
                positive_prompt = " "
            if not negative_prompt or not negative_prompt.strip():
                negative_prompt = " "
                
            file_name_str = "_".join(file_names_collected) if file_names_collected else " "

            return ([positive_prompt], [negative_prompt], [file_name_str])

        else:
            if len(values) == 0:
                p = positive if positive.strip() else " "
                n = negative if negative.strip() else " "
                return ([p], [n], [" "])
            
            pos_list = []
            neg_list = []
            file_name_list = []
            
            for val in values:
                if val not in all_styles:
                    continue
                
                style_data = all_styles[val]
                p_prompt = ''
                has_p = False
                
                # --- Извлечение имени файла из thumbnail ---
                thumb_name = " "
                if 'thumbnail' in style_data:
                    thumb_val = style_data['thumbnail']
                    thumb_str = ""
                    if isinstance(thumb_val, list) and len(thumb_val) > 0:
                        thumb_str = thumb_val[0]
                    elif isinstance(thumb_val, str):
                        thumb_str = thumb_val
                    
                    if thumb_str:
                        base_name = os.path.basename(thumb_str)
                        name_without_ext, _ = os.path.splitext(base_name)
                        if name_without_ext:
                            thumb_name = name_without_ext
                file_name_list.append(thumb_name)
                # ---------------------------------------------
                
                if 'prompt' in style_data:
                    if "{prompt}" in style_data['prompt']:
                        p_prompt = style_data['prompt'].replace('{prompt}', positive)
                        has_p = True
                    else:
                        p_prompt = style_data['prompt']
                        
                if not has_p and positive:
                    if p_prompt:
                        p_prompt = positive + ", " + p_prompt
                    else:
                        p_prompt = positive
                    
                if not p_prompt or not p_prompt.strip():
                    p_prompt = " "
                    
                n_prompt = negative
                if 'negative_prompt' in style_data:
                    if n_prompt:
                        n_prompt += ', ' + style_data['negative_prompt']
                    else:
                        n_prompt = style_data['negative_prompt']
                        
                if not n_prompt or not n_prompt.strip():
                    n_prompt = " "
                    
                pos_list.append(p_prompt)
                neg_list.append(n_prompt)
                
            if not pos_list:
                pos_list = [positive if positive.strip() else " "]
                neg_list = [negative if negative.strip() else " "]
                file_name_list = [" "]
                
            return (pos_list, neg_list, file_name_list)