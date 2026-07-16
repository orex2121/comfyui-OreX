import os
import json
import folder_paths
import hashlib
import asyncio
import urllib.parse
from nodes import LoraLoader
from server import PromptServer
from aiohttp import web
import aiohttp

# === ХИТРЫЙ ОБХОД ВАЛИДАЦИИ COMFYUI ===
class AnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False

any_type = AnyType("*")

class FlexibleOptionalInputType(dict):
    def __contains__(self, key):
        return True
    def __getitem__(self, key):
        return (any_type,)
# =======================================

# === API РОУТ ДЛЯ ПОКАЗА ЛОКАЛЬНЫХ ПРЕВЬЮ ===
@PromptServer.instance.routes.get("/orex/view_preview")
async def view_preview(request):
    lora_name = request.query.get("name")
    if not lora_name:
        return web.Response(status=404)
    
    lora_path = folder_paths.get_full_path("loras", lora_name)
    if not lora_path:
        return web.Response(status=404)
        
    base_path = os.path.splitext(lora_path)[0]
    preview_exts = [".png", ".jpg", ".jpeg", ".webp", ".gif"]
    
    # Ищем любую сохраненную картинку с подходящим расширением
    for ext in preview_exts:
        file_path = base_path + ".orex.preview" + ext
        if os.path.exists(file_path):
            return web.FileResponse(file_path)
            
    return web.Response(status=404)

# === API РОУТ ДЛЯ ЧТЕНИЯ И ЗАГРУЗКИ ТРИГГЕРОВ И ПРЕВЬЮ ===
@PromptServer.instance.routes.get("/orex/lora_info")
async def get_lora_info(request):
    lora_name = request.query.get("name")
    if not lora_name:
        return web.json_response({"trigger_words": [], "images": []})

    lora_path = folder_paths.get_full_path("loras", lora_name)
    if not lora_path or not os.path.exists(lora_path):
        return web.json_response({"trigger_words": [], "images": []})

    trigger_words_set = set()
    images_data = []
    base_path = os.path.splitext(lora_path)[0]

    # Рекурсивный обход данных для поиска "trainedWords"
    def recursive_search(data):
        if isinstance(data, dict):
            for k, v in data.items():
                k_lower = k.lower()
                if k_lower in ["trainedwords", "trigger_words", "triggerwords"]:
                    if isinstance(v, list):
                        for item in v:
                            if isinstance(item, str) and item.strip():
                                trigger_words_set.add(item.strip())
                    elif isinstance(v, str) and v.strip():
                        trigger_words_set.add(v.strip())
                recursive_search(v)
        elif isinstance(data, list):
            for item in data:
                recursive_search(item)

    # Умная функция для поиска ВСЕХ картинок и их метаданных
    def extract_images_data(data):
        images_list = []
        if not isinstance(data, dict):
            return images_list
            
        # 1. Проверяем формат Civitai API (массив images)
        if "images" in data and isinstance(data["images"], list):
            for img in data["images"]:
                if isinstance(img, dict) and "url" in img:
                    url = img["url"]
                    # Пропускаем видео
                    if isinstance(url, str) and img.get("type") != "video" and not url.lower().endswith((".mp4", ".webm", ".avi")):
                        meta = img.get("meta", {}) or {}
                        images_list.append({"url": url, "meta": meta})
                        
        # 2. Запасные варианты для форматов других менеджеров (если массив пуст)
        if not images_list:
            for key in ["image", "preview_url", "cover_url"]:
                if key in data and isinstance(data[key], str):
                    url = data[key]
                    if not url.lower().endswith((".mp4", ".webm", ".avi")):
                        images_list.append({"url": url, "meta": {}})
                        break
                        
        # 3. Рекурсивный поиск для вложенных структур
        if not images_list:
            for value in data.values():
                if isinstance(value, dict):
                    res = extract_images_data(value)
                    if res: return res
                elif isinstance(value, list):
                    for item in value:
                        res = extract_images_data(item)
                        if res: return res
                        
        return images_list

    # Проверяем кэш
    orex_file = base_path + ".orex.json"
    has_orex_cache = os.path.exists(orex_file)

    search_sources = [
        orex_file,
        base_path + ".civitai.info",
        base_path + ".metadata.json",
        lora_path + ".rgthree-info.json",
        base_path + ".json",
        lora_path
    ]

    # ШАГ 1: ЛОКАЛЬНЫЙ ПОИСК
    for path in search_sources:
        if not os.path.exists(path):
            continue
        
        try:
            if path.endswith(".safetensors"):
                with open(path, "rb") as f:
                    header_size = int.from_bytes(f.read(8), "little")
                    if 0 < header_size < 100000000:
                        header_json = f.read(header_size).decode("utf-8")
                        header = json.loads(header_json)
                        if "__metadata__" in header:
                            meta = header["__metadata__"]
                            recursive_search(meta)
            else:
                with open(path, "r", encoding="utf-8") as f:
                    info_data = json.load(f)
                    recursive_search(info_data)
                    if not images_data:
                        images_data = extract_images_data(info_data)
        except Exception as e:
            print(f"[OreX Lora Loader] Ошибка чтения {path}: {e}")
        
        if trigger_words_set and images_data:
            break

    # ШАГ 2: ОБРАЩЕНИЕ К CIVITAI API
    if not has_orex_cache and (not trigger_words_set or not images_data):
        print(f"[OreX Lora Loader] Данные не полные. Обращение к Civitai для: {lora_name}")
        try:
            def calculate_hash():
                hasher = hashlib.sha256()
                with open(lora_path, 'rb') as f:
                    while chunk := f.read(8192 * 1024):
                        hasher.update(chunk)
                return hasher.hexdigest().upper()

            file_hash = await asyncio.to_thread(calculate_hash)

            api_url = f"https://civitai.com/api/v1/model-versions/by-hash/{file_hash}"
            async with aiohttp.ClientSession() as session:
                async with session.get(api_url) as response:
                    if response.status == 200:
                        civitai_data = await response.json()
                        
                        with open(orex_file, "w", encoding="utf-8") as f:
                            json.dump(civitai_data, f, indent=4)
                        
                        recursive_search(civitai_data)
                        if not images_data:
                            images_data = extract_images_data(civitai_data)
                        print(f"[OreX Lora Loader] Данные скачаны и сохранены в {orex_file}")
                    else:
                        print(f"[OreX Lora Loader] Civitai API не нашел лору (Статус: {response.status})")

        except Exception as e:
            print(f"[OreX Lora Loader] Ошибка при работе с Civitai API: {e}")

    # ШАГ 3: ЛОКАЛЬНОЕ СОХРАНЕНИЕ ПЕРВОЙ КАРТИНКИ (ОБЛОЖКИ)
    local_preview_path = None
    preview_exts = [".png", ".jpg", ".jpeg", ".webp", ".gif"]
    
    for ext in preview_exts:
        if os.path.exists(base_path + ".orex.preview" + ext):
            local_preview_path = base_path + ".orex.preview" + ext
            break
            
    if images_data and not local_preview_path and images_data[0]["url"].startswith("http"):
        first_url = images_data[0]["url"]
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(first_url) as img_response:
                    if img_response.status == 200:
                        img_data = await img_response.read()
                        
                        ext = ".png"
                        url_lower = first_url.lower()
                        if ".jpg" in url_lower or ".jpeg" in url_lower: ext = ".jpeg"
                        elif ".webp" in url_lower: ext = ".webp"
                        elif ".gif" in url_lower: ext = ".gif"
                        
                        local_preview_path = base_path + ".orex.preview" + ext
                        
                        def save_image():
                            with open(local_preview_path, "wb") as f:
                                f.write(img_data)
                        await asyncio.to_thread(save_image)
        except Exception as e:
            print(f"[OreX Lora Loader] Ошибка скачивания превью: {e}")

    # Подменяем URL только для ПЕРВОЙ картинки, остальные грузим из сети
    if images_data and local_preview_path:
        safe_name = urllib.parse.quote(lora_name)
        images_data[0]["url"] = f"/orex/view_preview?name={safe_name}"

    return web.json_response({
        "trigger_words": list(trigger_words_set),
        "images": images_data # Отдаем массив картинок с метой
    })
# =======================================

class OreX_LoraLoader:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
            },
            "optional": FlexibleOptionalInputType()
        }

    CATEGORY = "🤫OreX/Loaders"
    RETURN_TYPES = ("MODEL", "CLIP", "STRING", "STRING")
    RETURN_NAMES = ("MODEL", "CLIP", "Trigger Words", "Lora Names")
    FUNCTION = "load_loras"

    # --- ВАЛИДАЦИЯ --- (Останавливает генерацию и выдает стандартную ошибку ComfyUI (красная рамка), если файла нет)
    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        missing = []
        for key, value in kwargs.items():
            if key.startswith('lora_') and isinstance(value, dict):
                # Пропускаем отключенные лоры
                if not value.get('on', True): 
                    continue
                
                lora_name = value.get('lora')
                if lora_name and lora_name != "None":
                    lora_path = folder_paths.get_full_path("loras", lora_name)
                    if not lora_path or not os.path.exists(lora_path):
                        missing.append(lora_name)
        
        if missing:
            return f"Отсутствуют следующие Лоры: {', '.join(missing)}"
            
        return True

    def load_loras(self, model, clip, **kwargs):
        final_trigger_words = []
        final_lora_names = []
        lora_loader = LoraLoader()
        model_lora = model
        clip_lora = clip

        for key, value in sorted(kwargs.items()):
            if key.startswith('lora_') and isinstance(value, dict):
                if not value.get('on', True): continue
                
                lora_name = value.get('lora')
                if not lora_name or lora_name == "None": continue

                strength_model = float(value.get('strength', 1.0))
                strength_clip = float(value.get('strengthTwo', strength_model))
                
                trigger_words = value.get('trigger_words', '')
                tw_on = value.get('tw_on', True) 

                lora_path = folder_paths.get_full_path("loras", lora_name)
                
                if lora_path and os.path.exists(lora_path):
                    model_lora, clip_lora = lora_loader.load_lora(model_lora, clip_lora, lora_name, strength_model, strength_clip)
                    
                    base_name = os.path.splitext(os.path.basename(lora_name))[0]
                    final_lora_names.append(base_name)
                    
                    if tw_on and trigger_words and trigger_words.strip() and trigger_words not in ["No words (click to add)", "⏳ Loading..."]:
                        final_trigger_words.append(trigger_words.strip())

        return (model_lora, clip_lora, ", ".join(final_trigger_words), " + ".join(final_lora_names))

NODE_CLASS_MAPPINGS = {
    "orex Lora Loader": OreX_LoraLoader
}