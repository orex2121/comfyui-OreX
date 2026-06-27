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

try:
    import comfy.model_management as mm
except ImportError:
    mm = None

DEFAULT_LLM = "SELECT A MODEL"

# --- ПРЕДКОМПИЛЯЦИЯ REGEX ДЛЯ СКОРОСТИ ---
CLEAN_PATTERNS = [
    re.compile(r'<\|?channel\|?>.*?<\|?channel\|?>', flags=re.DOTALL | re.IGNORECASE),
    re.compile(r'<(thinking|think|reasoning)>.*?</\1>', flags=re.DOTALL | re.IGNORECASE),
    re.compile(r'^.*?</(thinking|think|reasoning)>', flags=re.DOTALL | re.IGNORECASE),
    re.compile(r'^.*?(?:<channel\|>|</channel>)', flags=re.DOTALL | re.IGNORECASE),
    re.compile(r'<\|?channel\|?>.*$', flags=re.DOTALL | re.IGNORECASE),
    re.compile(r'<(thinking|think|reasoning)>.*$', flags=re.IGNORECASE),
    re.compile(r'\[Thinking.*?\]', flags=re.DOTALL | re.IGNORECASE)
]

def load_presets():
    current_dir = os.path.dirname(os.path.realpath(__file__))
    json_path = os.path.join(current_dir, "OreX_Preset_LMStudio_Ollama.json")
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
        print(f"[Ollama Nodes] Error loading presets: {e}")
        
    return presets

PRESETS_DICT = load_presets()
PRESET_NAMES = list(PRESETS_DICT.keys())

def fetch_available_models(default_model):
    models = []
    host = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    if not host.startswith("http"):
        host = f"http://{host}"
    
    try:
        proxy_handler = urllib.request.ProxyHandler({})
        opener = urllib.request.build_opener(proxy_handler)

        req = urllib.request.Request(f"{host}/api/tags")
        with opener.open(req, timeout=1.5) as response:
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

def api_call_ollama(endpoint, payload, timeout_seconds):
    host = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    if not host.startswith("http"):
        host = f"http://{host}"
    
    url = f"{host}/api/{endpoint}"
    
    try:
        proxy_handler = urllib.request.ProxyHandler({})
        opener = urllib.request.build_opener(proxy_handler)

        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
        with opener.open(req, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode('utf-8'))
            
    except urllib.error.HTTPError as e:
        try:
            error_data = json.loads(e.read().decode('utf-8'))
            error_msg = error_data.get("error", str(error_data))
        except Exception:
            error_msg = e.read().decode('utf-8')
        raise Exception(f"HTTP Error {e.code}: {error_msg}")
    except urllib.error.URLError as e:
        raise Exception(f"Connection failed: {e}")

def _clean_reasoning_content(content):
    if not content: return ""
    text = content
    for pattern in CLEAN_PATTERNS:
        text = pattern.sub('', text)
    return '\n'.join(line for line in text.splitlines() if line.strip()).strip()

def get_full_b64(pil_img):
    buffered = io.BytesIO()
    pil_img.save(buffered, format="JPEG")
    return base64.b64encode(buffered.getvalue()).decode('utf-8')

def resize_to_target_megapixels(pil_image, target_megapixels=0.7):
    target_pixels = target_megapixels * 1000000
    current_pixels = pil_image.width * pil_image.height
    if current_pixels > target_pixels:
        scale_factor = (target_pixels / current_pixels) ** 0.5
        resampling_filter = getattr(Image.Resampling, 'LANCZOS', Image.LANCZOS)
        return pil_image.resize((int(pil_image.width * scale_factor), int(pil_image.height * scale_factor)), resampling_filter)
    return pil_image

class OreXOllama:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text_input": ("STRING", {"multiline": True, "default": ""}),
                "system_prompt": ("STRING", {"default": ""}),
                "system_preset": (PRESET_NAMES, ),
                "model_key": (fetch_available_models(DEFAULT_LLM), ),
                "include_reasoning": ("BOOLEAN", {"default": False, "label_on": "🟢 Thinking ON", "label_off": "🔴 Thinking OFF"}),
                "auto_unload_model": ("BOOLEAN", {"default": True, "label_on": "🟢 Auto Unload ON", "label_off": "🔴 Auto Unload OFF"}),
                "unload_delay": ("INT", {"default": 0, "min": 0, "max": 3600, "step": 1}),
                "clean_vram_before": ("BOOLEAN", {"default": False, "label_on": "🟢 Clean VRAM ON", "label_off": "🔴 Clean VRAM OFF"}),
                "seed": ("INT", {"default": 777, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "image": ("IMAGE",),
                "context_length": ("INT", {"default": 4096, "min": 0, "max": 131072, "step": 256}),
                "max_tokens": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff, "step": 256}),
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
            if k != "image": 
                m.update(str(v).encode())
        if kwargs.get("image") is not None:
            img_mean = float(np.mean(kwargs["image"].numpy()))
            m.update(str(img_mean).encode())
        return m.hexdigest()

    def process_input(self, text_input, system_prompt, system_preset, model_key, include_reasoning, auto_unload_model, unload_delay, clean_vram_before, seed, image=None, context_length=4096, max_tokens=1024, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1):
        
        user_max_tokens = max_tokens
        if user_max_tokens > 0:
            user_max_tokens = int(max(256, round(user_max_tokens / 256.0) * 256))

        is_include_reasoning = include_reasoning if isinstance(include_reasoning, bool) else str(include_reasoning).upper() in ["TRUE", "ON"]

        if not is_include_reasoning or user_max_tokens == 0:
            api_max_tokens = -1
        else:
            api_max_tokens = user_max_tokens

        is_auto_unload = auto_unload_model if isinstance(auto_unload_model, bool) else str(auto_unload_model).upper() in ["TRUE", "ON"]
        use_gen_params = generation_parameters if isinstance(generation_parameters, bool) else str(generation_parameters).upper() in ["TRUE", "ON"]
        is_clean_vram = clean_vram_before if isinstance(clean_vram_before, bool) else str(clean_vram_before).upper() in ["TRUE", "ON"]

        if is_clean_vram and mm is not None:
            print("[Ollama Nodes] 🧹 Unloading ComfyUI models to free VRAM before Ollama inference...")
            mm.unload_all_models()
            mm.soft_empty_cache()

        if model_key == "SELECT A MODEL" or not model_key:
            return ("Error: Please select a model from the list.", json.dumps({"error": "No model selected"}))

        has_image = image is not None
        has_text = text_input is not None and text_input.strip() != ""

        if not has_image and not has_text:
            return ("No inputs provided.", json.dumps({"error": "No inputs provided."}))

        preset_value = PRESETS_DICT.get(system_preset, "")
        final_system_prompt = f"{system_prompt.strip()}\n{preset_value.strip()}".strip()
        
        safe_seed = int(seed) & 0xFFFFFFFF

        request_log = {
            "model": model_key, "system_prompt": final_system_prompt,
            "user_input": text_input if has_text else "[Empty/Image only]", "has_image": has_image,
            "parameters": {"seed": safe_seed}
        }
        
        options = {"seed": safe_seed}
        
        # ИСПРАВЛЕНИЕ: Если api_max_tokens <= 0 (например -1), мы вообще не передаем num_predict
        if api_max_tokens > 0:
            options["num_predict"] = api_max_tokens
            request_log["parameters"]["num_predict"] = api_max_tokens
        else:
            request_log["parameters"]["num_predict"] = "Auto (Unlimited)"
        
        if use_gen_params:
            options.update({
                "temperature": temperature,
                "top_p": top_p,
                "top_k": top_k,
                "repeat_penalty": repeat_penalty
            })
            if context_length > 0:
                options["num_ctx"] = context_length

            request_log["parameters"].update({
                "num_ctx": context_length if context_length > 0 else "Auto (Ollama Default)", 
                "temperature": temperature, 
                "top_p": top_p, 
                "top_k": top_k, 
                "repeat_penalty": repeat_penalty
            })

        try:
            payload = {
                "model": model_key, "messages": [], "stream": False, "options": options
            }

            if is_auto_unload and unload_delay == 0: 
                payload["keep_alive"] = 0
            elif unload_delay > 0: 
                payload["keep_alive"] = unload_delay

            if final_system_prompt:
                payload["messages"].append({"role": "system", "content": final_system_prompt})

            fallback_text = "Describe this image in detail." if has_image else " "
            user_msg = {"role": "user", "content": text_input.strip() if has_text else fallback_text}

            if has_image:
                img_tensor = image[0].cpu().numpy() if hasattr(image[0], 'cpu') else np.array(image[0])
                img_np = np.clip(255. * img_tensor, 0, 255).astype(np.uint8)
                
                pil_image = resize_to_target_megapixels(Image.fromarray(img_np), 0.7)
                user_msg["images"] = [get_full_b64(pil_image)]
                
            payload["messages"].append(user_msg)

            result = api_call_ollama("chat", payload, timeout_seconds=300)
            final_content = result.get("message", {}).get("content", "")

            if not is_include_reasoning:
                cleaned_content = _clean_reasoning_content(final_content)
                if not cleaned_content.strip() and final_content.strip():
                    final_content = final_content + "\n\n[Внимание: модель сгенерировала только размышления без основного ответа]"
                else:
                    final_content = cleaned_content

            if is_auto_unload and unload_delay == 0 and "keep_alive" not in payload:
                 api_call_ollama("generate", {"model": model_key, "keep_alive": 0}, timeout_seconds=5)

            return (final_content, json.dumps(request_log, indent=2, ensure_ascii=False))
            
        except Exception as e:
            return (f"Ollama error: {str(e)}", json.dumps(request_log, indent=2, ensure_ascii=False))

NODE_CLASS_MAPPINGS = {"OreXOllama": OreXOllama}
NODE_DISPLAY_NAME_MAPPINGS = {"OreXOllama": "🦙 Ollama (OreX)"}
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]