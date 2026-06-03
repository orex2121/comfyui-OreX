# -*- coding: utf-8 -*-
import base64
import numpy as np
from PIL import Image
import os
import io
import json
import hashlib
import random
import urllib.request
import urllib.error
import urllib.parse
import re

# Импортируем SDK, так как он корректно работает с внутренними каналами LM Studio при выгрузке
try:
    import lmstudio as lms
except ImportError:
    lms = None

# Default models to use
DEFAULT_LLM = "SELECT A MODEL"

# --- SYSTEM PRESETS LOADER ---
def load_presets():
    current_dir = os.path.dirname(os.path.realpath(__file__))
    json_path = os.path.join(current_dir, "OreX_LMStudio.json")
    presets = {"None": ""}
    
    if not os.path.exists(json_path):
        default_data = [
            {"name": "None", "prompt": ""},
            {"name": "Детальный анализ", "prompt": "Твоя задача — максимально подробно и детально проанализировать запрос или изображение. Опиши все мелкие детали, контекст и возможные скрытые смыслы."},
            {"name": "Краткий ответ", "prompt": "Отвечай максимально коротко и по делу, без лишних вступлений и рассуждений. Только суть."}
        ]
        try:
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(default_data, f, ensure_ascii=False, indent=4)
        except Exception as e:
            print(f"[LMStudio Nodes] Could not create default presets file: {e}")
            
    try:
        if os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for item in data:
                    if "name" in item and "prompt" in item:
                        presets[item["name"]] = item["prompt"]
    except Exception as e:
        print(f"[LMStudio Nodes] Error loading presets from JSON: {e}")
        
    return presets

PRESETS_DICT = load_presets()
PRESET_NAMES = list(PRESETS_DICT.keys())

def fetch_available_models(default_model):
    """Fetches available models from LM Studio API."""
    models = []
    host = os.environ.get("LMSTUDIO_URL", "http://127.0.0.1:1234")
    if not host.startswith("http"):
        host = f"http://{host}"
    
    endpoint = f"{host}/v1/models"
    
    try:
        req = urllib.request.Request(endpoint)
        with urllib.request.urlopen(req, timeout=4.0) as response:
            data = json.loads(response.read().decode('utf-8'))
            for m in data.get("data", []):
                m_id = m.get("id")
                if m_id and m_id not in models:
                    models.append(m_id)
    except Exception:
        pass
        
    if default_model in models:
        models.remove(default_model)
    models.insert(0, default_model)
    return models

def check_lmstudio_connection():
    host = os.environ.get("LMSTUDIO_URL", "http://127.0.0.1:1234")
    if not host.startswith("http"):
        host = f"http://{host}"
    try:
        req = urllib.request.Request(f"{host}/v1/models")
        with urllib.request.urlopen(req, timeout=3.0) as response:
            pass
    except Exception as e:
        raise Exception(f"Cannot connect to LM Studio. Make sure the server is running on port 1234. (Error: {e})")

def api_call_lmstudio(endpoint, payload, timeout_seconds):
    host = os.environ.get("LMSTUDIO_URL", "http://127.0.0.1:1234")
    if not host.startswith("http"):
        host = f"http://{host}"
    
    url = f"{host}/v1/{endpoint}"
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.URLError as e:
        raise Exception(f"LM Studio API request failed: {e}")

def unload_lmstudio_model(model_key):
    """Выгружает модель из VRAM используя SDK или совместимые эндпоинты LM Studio."""
    print(f"[LMStudio Nodes] ⏳ Attempting to auto-unload model: {model_key}...")
    
    # 1. Попытка выгрузки через официальный SDK (самый надежный способ)
    if lms is not None:
        try:
            with lms.Client() as client:
                model = client.llm.model(model_key)
                model.unload()
            print("[LMStudio Nodes] 🟢 Model unloaded successfully via LM Studio SDK")
            return
        except Exception as e:
            print(f"[LMStudio Nodes] ⚠️ SDK unload attempt failed: {e}. Trying REST API fallback...")
    else:
        print("[LMStudio Nodes] ⚠️ 'lmstudio' SDK is not installed. Run 'pip install lmstudio' for best auto-unload support. Trying REST API fallback...")

    # 2. Резервный вариант через REST API (очищен от косячных эндпоинтов, выдающих ошибки)
    host = os.environ.get("LMSTUDIO_URL", "http://127.0.0.1:1234")
    if not host.startswith("http"):
        host = f"http://{host}"
        
    endpoints_to_try = [
        # Успешный метод из лога (только с instance_id)
        (f"{host}/api/v1/models/unload", "POST", json.dumps({"instance_id": model_key}).encode('utf-8'))
    ]
    
    success = False
    for url, method, data in endpoints_to_try:
        try:
            headers = {'Content-Type': 'application/json'} if data else {}
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=2.0) as response:
                status_code = response.getcode()
                response_body = response.read().decode('utf-8')
                
                is_error = False
                try:
                    body_json = json.loads(response_body)
                    if "error" in body_json:
                        is_error = True
                except:
                    if "error" in response_body.lower() or "unexpected endpoint" in response_body.lower():
                        is_error = True
                        
                if is_error:
                    continue
                    
                if status_code in [200, 204]:
                    print(f"[LMStudio Nodes] 🟢 Model unloaded successfully via REST {method} {url}")
                    success = True
                    break
        except Exception:
            continue
            
    if not success:
        print(f"[LMStudio Nodes] 🔴 Warning: Could not automatically unload model {model_key}. Check LM Studio logs.")

def _clean_reasoning_content(content):
    """Безопасная очистка скрытых размышлений моделей класса DeepSeek R1."""
    if not content:
        return ""
    text = content
    text = re.sub(r'<\|?channel\|?>.*?<\|?channel\|?>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<(thinking|think|reasoning)>.*?</\1>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'^.*?</(thinking|think|reasoning)>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'^.*?(?:<channel\|>|</channel>)', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<\|?channel\|?>.*$', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<(thinking|think|reasoning)>.*$', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'\[Thinking.*?\]', '', text, flags=re.DOTALL | re.IGNORECASE)
    return '\n'.join(line for line in text.splitlines() if line.strip()).strip()

def get_full_b64(pil_img):
    buffered = io.BytesIO()
    pil_img.save(buffered, format="JPEG")
    return base64.b64encode(buffered.getvalue()).decode('utf-8')

def get_b64_preview(pil_img):
    img_str = get_full_b64(pil_img)
    return f"{img_str[:10]}...{img_str[-10:]}" if len(img_str) > 23 else img_str

def resize_to_target_megapixels(pil_image, target_megapixels=0.7, debug=False):
    target_pixels = target_megapixels * 1000000
    current_pixels = pil_image.width * pil_image.height
    if current_pixels > target_pixels:
        scale_factor = (target_pixels / current_pixels) ** 0.5
        resampling_filter = getattr(Image, 'Resampling', Image).LANCZOS
        return pil_image.resize((int(pil_image.width * scale_factor), int(pil_image.height * scale_factor)), resampling_filter)
    return pil_image

# --- NODES IMPLEMENTATION ---

class OreXLMStudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text_input": ("STRING", {"multiline": True, "default": ""}),
                "system_prompt": ("STRING", {"default": ""}),
                "system_preset": (PRESET_NAMES, ),
                "model_key": (fetch_available_models(DEFAULT_LLM), ),
                "include_reasoning": ("BOOLEAN", {"default": False, "label_on": "🟢 Thinking ENABLED", "label_off": "🔴 Thinking DISABLED"}),
                "auto_unload": ("BOOLEAN", {"default": True, "label_on": "🟢 Auto Unload ON", "label_off": "🔴 Auto Unload OFF"}),
                "seed": ("INT", {"default": 777, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "image": ("IMAGE",),
                "context_length": ("INT", {"default": 4096, "min": 256, "max": 131072, "step": 256}),
                "max_tokens": ("INT", {"default": 1024, "min": 1, "max": 4096}),
                "generation_parameters": ("BOOLEAN", {"default": False, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0}),
                "top_k": ("INT", {"default": 40, "min": 0, "max": 100}),
                "top_p": ("FLOAT", {"default": 0.95, "min": 0.0, "max": 1.0, "step": 0.05}),
                "repeat_penalty": ("FLOAT", {"default": 1.1, "min": 0.0, "max": 2.0, "step": 0.05}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("Generated Text", "Request_lmstudio")
    FUNCTION = "process_input"
    CATEGORY = "🤫OreX/LLM"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        m = hashlib.sha256()
        for k, v in kwargs.items():
            if k != "image": m.update(str(v).encode())
        if kwargs.get("image") is not None:
            m.update(str(kwargs["image"].shape).encode())
        return m.hexdigest()

    def process_input(self, text_input, system_prompt, system_preset, model_key, include_reasoning, auto_unload, seed, image=None, context_length=4096, max_tokens=1024, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1):
        timeout_seconds = 300
        use_gen_params = generation_parameters if isinstance(generation_parameters, bool) else str(generation_parameters).upper() in ["TRUE", "ON"]
        
        if model_key == "SELECT A MODEL" or not model_key:
            return ("Error: Please select a model from the list.", json.dumps({"error": "No model selected"}))

        check_lmstudio_connection()
        has_image = image is not None
        has_text = text_input is not None and text_input.strip() != ""

        if not has_image and not has_text:
            msg = "No inputs provided."
            return (msg, json.dumps({"error": msg}))

        random.seed(seed)
        preset_value = PRESETS_DICT.get(system_preset, "")
        final_system_prompt = system_prompt
        if preset_value.strip():
            final_system_prompt = f"{system_prompt.strip()}\n{preset_value.strip()}".strip()

        request_log = {
            "model": model_key, "system_prompt": final_system_prompt,
            "user_input": text_input if has_text else "[Empty/Image only]", "has_image": has_image,
            "parameters": {"max_tokens": max_tokens, "seed": seed}
        }
        
        # Конфигурация параметров для OpenAI-совместимого API LM Studio
        options = {"max_tokens": max_tokens, "seed": seed}
        if use_gen_params:
            options.update({
                "temperature": temperature,
                "top_p": top_p,
                "frequency_penalty": repeat_penalty
            })
            request_log["parameters"].update({
                "context_length": context_length, "temperature": temperature, "top_p": top_p, "top_k": top_k, "repeat_penalty": repeat_penalty
            })

        try:
            payload = {
                "model": model_key, "messages": [], "stream": False
            }
            payload.update(options)

            if final_system_prompt:
                payload["messages"].append({"role": "system", "content": final_system_prompt})

            # Формирование контента пользователя (поддержка текста и Vision структуры)
            if has_image:
                pil_image = resize_to_target_megapixels(Image.fromarray(np.uint8(image[0]*255)), 0.7)
                b64_data = get_full_b64(pil_image)
                request_log["image_data"] = f"data:image/jpeg;base64,{get_b64_preview(pil_image)}"
                
                content_list = []
                if has_text:
                    content_list.append({"type": "text", "text": text_input})
                content_list.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64_data}"}})
                user_msg = {"role": "user", "content": content_list}
            else:
                user_msg = {"role": "user", "content": text_input}
                
            payload["messages"].append(user_msg)

            result = api_call_lmstudio("chat/completions", payload, timeout_seconds)
            final_content = result.get("choices", [{}])[0].get("message", {}).get("content", "")

            if not include_reasoning:
                final_content = _clean_reasoning_content(final_content)

            # Сохраняем результат в переменную
            res_tuple = (final_content, json.dumps(request_log, indent=2, ensure_ascii=False))
            
        except Exception as e:
            # В случае ошибки также сохраняем результат
            res_tuple = (f"LM Studio error: {str(e)}", json.dumps(request_log, indent=2, ensure_ascii=False))
            
        # Гарантированно выполняем авто-выгрузку ДО возвращения (return)
        if auto_unload:
            unload_lmstudio_model(model_key)
            
        # Возвращаем закешированный результат
        return res_tuple


# ========= REGISTRATION (ОСТАВЛЯЕМ СТРОГО ОДИН Базовый УЗЕЛ) =========

NODE_CLASS_MAPPINGS = {
    "OreXLMStudio": OreXLMStudio
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "OreXLMStudio": "🤖 LMStudio (OreX)"
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]