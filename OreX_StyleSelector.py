import os
import json
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

@server.PromptServer.instance.routes.get("/orex/styles")
async def get_styles(request):
    name = request.query.get("name", "my_styles")
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

@server.PromptServer.instance.routes.get("/orex/image")
async def get_image(request):
    img_name = request.query.get("img", "")
    img_path = os.path.join(STYLES_DIR, "samples", img_name)
    if os.path.exists(img_path):
        return web.FileResponse(img_path)
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

    def execute(self, styles, batch_mode=False, select_styles="", positive='', negative='', prompt=None, unique_id=None):
        positive = positive if positive is not None else ""
        negative = negative if negative is not None else ""
        
        values = []
        all_styles = {}
        
        file = os.path.join(STYLES_DIR, f"{styles}.json")
        if os.path.exists(file):
            with open(file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            for d in data:
                all_styles[d['name']] = d

        if isinstance(select_styles, str):
            values = [s.strip() for s in select_styles.split(',') if s.strip()]
        elif isinstance(select_styles, list):
            values = select_styles
        else:
            values = []

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