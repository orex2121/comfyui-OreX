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
import re

# Default models to use
DEFAULT_LLM = "SELECT A MODEL"
DEFAULT_VISION = "SELECT A MODEL"

# --- SYSTEM PRESETS LOADER ---
def load_presets():
    current_dir = os.path.dirname(os.path.realpath(__file__))
    json_path = os.path.join(current_dir, "OreX_Ollama.json")
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
            print(f"[Ollama Nodes] Could not create default presets file: {e}")
            
    try:
        if os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for item in data:
                    if "name" in item and "prompt" in item:
                        presets[item["name"]] = item["prompt"]
    except Exception as e:
        print(f"[Ollama Nodes] Error loading presets from JSON: {e}")
        
    return presets

PRESETS_DICT = load_presets()
PRESET_NAMES = list(PRESETS_DICT.keys())

def fetch_available_models(default_model):
    """Fetches available models from Ollama API."""
    models = []
    host = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    if not host.startswith("http"):
        host = f"http://{host}"
    
    endpoint = f"{host}/api/tags"
    
    try:
        req = urllib.request.Request(endpoint)
        with urllib.request.urlopen(req, timeout=4.0) as response:
            data = json.loads(response.read().decode('utf-8'))
            for m in data.get("models", []):
                m_id = m.get("name")
                if m_id and m_id not in models:
                    models.append(m_id)
    except Exception:
        pass
        
    if default_model in models:
        models.remove(default_model)
    models.insert(0, default_model)
    return models

def check_ollama_connection():
    host = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    if not host.startswith("http"):
        host = f"http://{host}"
    try:
        req = urllib.request.Request(f"{host}/api/tags")
        with urllib.request.urlopen(req, timeout=3.0) as response:
            pass
    except Exception as e:
        raise Exception(f"Cannot connect to Ollama. Make sure the server is running on port 11434. (Error: {e})")

def api_call_ollama(endpoint, payload, timeout_seconds):
    host = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    if not host.startswith("http"):
        host = f"http://{host}"
    
    url = f"{host}/api/{endpoint}"
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.URLError as e:
        raise Exception(f"Ollama API request failed: {e}")

def unload_model(model_key):
    try:
        payload = {"model": model_key, "keep_alive": 0}
        api_call_ollama("generate", payload, 5.0)
    except Exception as e:
        print(f"Warning: Failed to unload Ollama model: {e}")

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

class OreXOllama:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text_input": ("STRING", {"multiline": True, "default": ""}),
                "system_prompt": ("STRING", {"default": ""}),
                "system_preset": (PRESET_NAMES, ),
                "model_key": (fetch_available_models(DEFAULT_LLM), ),
                "include_reasoning": ("BOOLEAN", {"default": False, "label_on": "🟢 Thinking ENABLED", "label_off": "🔴 Thinking DISABLED"}),
                "auto_unload": (["True", "False"], {"default": "True"}),
                "unload_delay": ("INT", {"default": 0, "min": 0, "max": 3600, "step": 1}),
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
    RETURN_NAMES = ("Generated Text", "Request_ollama")
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

    def process_input(self, text_input, system_prompt, system_preset, model_key, include_reasoning, auto_unload, unload_delay, seed, image=None, context_length=4096, max_tokens=1024, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1):
        timeout_seconds = 300
        use_gen_params = generation_parameters if isinstance(generation_parameters, bool) else str(generation_parameters).upper() in ["TRUE", "ON"]
        
        if model_key == "SELECT A MODEL" or not model_key:
            return ("Error: Please select a model from the list.", json.dumps({"error": "No model selected"}))

        check_ollama_connection()
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
            "parameters": {"num_predict": max_tokens, "seed": seed}
        }
        if use_gen_params:
            request_log["parameters"].update({"num_ctx": context_length, "temperature": temperature, "top_p": top_p, "top_k": top_k, "repeat_penalty": repeat_penalty})

        try:
            payload = {
                "model": model_key, "messages": [], "stream": False, "options": request_log["parameters"]
            }

            if auto_unload == "True" and unload_delay == 0: payload["keep_alive"] = 0
            elif unload_delay > 0: payload["keep_alive"] = unload_delay

            if final_system_prompt:
                payload["messages"].append({"role": "system", "content": final_system_prompt})

            effective_text = text_input if has_text else " "
            user_msg = {"role": "user", "content": effective_text}

            if has_image:
                pil_image = resize_to_target_megapixels(Image.fromarray(np.uint8(image[0]*255)), 0.7)
                user_msg["images"] = [get_full_b64(pil_image)]
                request_log["image_data"] = f"data:image/jpeg;base64,{get_b64_preview(pil_image)}"
                
            payload["messages"].append(user_msg)

            result = api_call_ollama("chat", payload, timeout_seconds)
            final_content = result.get("message", {}).get("content", "")

            if not include_reasoning:
                final_content = _clean_reasoning_content(final_content)

            if auto_unload == "True" and unload_delay == 0 and "keep_alive" not in payload:
                unload_model(model_key)

            return (final_content, json.dumps(request_log, indent=2, ensure_ascii=False))
        except Exception as e:
            return (f"Ollama error: {str(e)}", json.dumps(request_log, indent=2, ensure_ascii=False))


# ========= REGISTRATION (ОСТАВЛЯЕМ СТРОГО ОДИН БАЗОВЫЙ УЗЕЛ) =========

NODE_CLASS_MAPPINGS = {
    "OreXOllama": OreXOllama
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "OreXOllama": "🦙 Ollama (OreX)"
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]