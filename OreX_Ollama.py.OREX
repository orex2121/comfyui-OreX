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

# Default models to use
DEFAULT_LLM = "SELECT A MODEL"
DEFAULT_VISION = "SELECT A MODEL"

# --- SYSTEM PRESETS LOADER ---
def load_presets():
    current_dir = os.path.dirname(os.path.realpath(__file__))
    json_path = os.path.join(current_dir, "OreX_Ollama.json")
    presets = {"None": ""}
    
    # Create default file if it doesn't exist
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
            
    # Load presets from file
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
# -----------------------------

def fetch_available_models(default_model):
    """Fetches available models from Ollama API."""
    models = []
    host = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    if not host.startswith("http"):
        host = f"http://{host}"
    
    endpoint = f"{host}/api/tags"
    
    try:
        req = urllib.request.Request(endpoint)
        # Timeout 5 sec for cold boot
        with urllib.request.urlopen(req, timeout=5.0) as response:
            data = json.loads(response.read().decode('utf-8'))
            for m in data.get("models", []):
                m_id = m.get("name")
                if m_id and m_id not in models:
                    models.append(m_id)
        if models:
            print(f"[Ollama] Successfully loaded {len(models)} models from {endpoint}")
    except Exception as e:
        print(f"[Ollama Nodes] Could not fetch models from {endpoint}. Is Ollama server running?")
        
    # Ensure default model is in the list and at the top
    if default_model in models:
        models.remove(default_model)
    models.insert(0, default_model)
    
    return models

def check_ollama_connection():
    """
    Verify that Ollama is reachable before attempting generation.
    """
    host = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    if not host.startswith("http"):
        host = f"http://{host}"
    
    try:
        req = urllib.request.Request(f"{host}/api/tags")
        with urllib.request.urlopen(req, timeout=3.0) as response:
            pass
    except Exception as e:
        raise Exception(
            f"Cannot connect to Ollama. "
            f"Please make sure Ollama is open and the local server is enabled. "
            f"(Error: {e})"
        ) from e


def api_call_ollama(endpoint, payload, timeout_seconds):
    """Make an API call to Ollama."""
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
    """Unloads the model from Ollama immediately by sending keep_alive=0."""
    try:
        payload = {
            "model": model_key,
            "keep_alive": 0
        }
        api_call_ollama("generate", payload, 5.0)
    except Exception as e:
        print(f"Warning: Failed to unload Ollama model: {e}")

def get_full_b64(pil_img):
    """Converts a PIL image to base64 for API requests."""
    buffered = io.BytesIO()
    pil_img.save(buffered, format="JPEG")
    return base64.b64encode(buffered.getvalue()).decode('utf-8')

def get_b64_preview(pil_img):
    """Converts a PIL image to base64 and returns a truncated version for logging."""
    img_str = get_full_b64(pil_img)
    if len(img_str) > 23:
        return f"{img_str[:10]}...{img_str[-10:]}"
    return img_str

def resize_to_target_megapixels(pil_image, target_megapixels=0.7, debug=False):
    """Resizes a PIL Image so its total pixel count does not exceed target_megapixels."""
    target_pixels = target_megapixels * 1000000
    current_pixels = pil_image.width * pil_image.height
    
    if current_pixels > target_pixels:
        scale_factor = (target_pixels / current_pixels) ** 0.5
        new_width = int(pil_image.width * scale_factor)
        new_height = int(pil_image.height * scale_factor)
        
        resampling_filter = getattr(Image, 'Resampling', Image).LANCZOS
        
        if debug:
            print(f"Debug: Resizing image from {pil_image.width}x{pil_image.height} to {new_width}x{new_height} (~{target_megapixels}MP)")
            
        return pil_image.resize((new_width, new_height), resampling_filter)
        
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
                "include_reasoning": ("BOOLEAN", {"default": False, "label_on": "Thinking ENABLED 🟢", "label_off": "Thinking DISABLED 🔴"}),
                "auto_unload": (["True", "False"], {"default": "True"}),
                "unload_delay": ("INT", {"default": 0, "min": 0, "max": 3600, "step": 1}),
                "seed": ("INT", {"default": 777, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "image": ("IMAGE",),
                "context_length": ("INT", {"default": 4096, "min": 256, "max": 131072, "step": 256}),
                "max_tokens": ("INT", {"default": 1024, "min": 1, "max": 4096}),
                "generation_parameters": ("BOOLEAN", {"default": False, "label_on": "ON 🟢", "label_off": "OFF 🔴"}),
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
    def IS_CHANGED(cls, text_input, system_prompt, system_preset, model_key, include_reasoning, auto_unload, unload_delay, seed, image=None, context_length=4096, max_tokens=1024, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1):
        m = hashlib.sha256()
        
        m.update(str(text_input).encode())
        m.update(str(system_prompt).encode())
        m.update(str(system_preset).encode())
        m.update(str(model_key).encode())
        m.update(str(include_reasoning).encode())
        m.update(str(auto_unload).encode())
        m.update(str(unload_delay).encode())
        m.update(str(seed).encode())
        m.update(str(context_length).encode())
        m.update(str(max_tokens).encode())
        m.update(str(generation_parameters).encode())
        m.update(str(temperature).encode())
        m.update(str(top_k).encode())
        m.update(str(top_p).encode())
        m.update(str(repeat_penalty).encode())
        
        if image is not None:
            image_bytes = np.array(image).tobytes()
            m.update(image_bytes)
        
        return m.hexdigest()

    def process_input(self, text_input, system_prompt, system_preset, model_key, include_reasoning, auto_unload, unload_delay, seed, image=None, context_length=4096, max_tokens=1024, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1):
        debug = False
        timeout_seconds = 300
        
        use_gen_params = generation_parameters if isinstance(generation_parameters, bool) else str(generation_parameters).upper() in ["TRUE", "ON"]
        
        if model_key == "SELECT A MODEL" or not model_key:
            return ("Error: Please select a model from the list.", json.dumps({"error": "No model selected"}))

        check_ollama_connection()

        has_image = image is not None
        has_text = text_input is not None and text_input.strip() != ""

        if not has_image and not has_text:
            msg = "No inputs provided. Please connect an image or provide text input."
            return (msg, json.dumps({"error": msg}))

        random.seed(seed)

        preset_value = PRESETS_DICT.get(system_preset, "")
        final_system_prompt = system_prompt
        if preset_value.strip():
            final_system_prompt = f"{system_prompt.strip()}\n{preset_value.strip()}".strip()

        request_log = {
            "model": model_key,
            "system_prompt": final_system_prompt,
            "user_input": text_input if has_text else "[Empty/Image only]",
            "has_image": has_image,
            "parameters": {
                "num_predict": max_tokens,
                "seed": seed
            }
        }
        
        if use_gen_params:
            request_log["parameters"].update({
                "num_ctx": context_length,
                "temperature": temperature,
                "top_p": top_p,
                "top_k": top_k,
                "repeat_penalty": repeat_penalty
            })

        try:
            # Build Ollama payload
            payload = {
                "model": model_key,
                "messages": [],
                "stream": False,
                "options": request_log["parameters"]
            }

            # Handle keep_alive parameter for unload
            if auto_unload == "True" and unload_delay == 0:
                payload["keep_alive"] = 0
            elif unload_delay > 0:
                payload["keep_alive"] = unload_delay

            # System prompt
            if final_system_prompt:
                payload["messages"].append({"role": "system", "content": final_system_prompt})

            # User prompt and image
            effective_text = text_input if has_text else " "
            user_msg = {"role": "user", "content": effective_text}

            if has_image:
                pil_image = Image.fromarray(np.uint8(image[0]*255))
                pil_image = resize_to_target_megapixels(pil_image, 0.7, debug)
                
                # Attach to API payload
                user_msg["images"] = [get_full_b64(pil_image)]
                # Attach short preview to logs
                request_log["image_data"] = f"data:image/jpeg;base64,{get_b64_preview(pil_image)}"
                
            payload["messages"].append(user_msg)

            if debug:
                print(f"Debug: Sending request to Ollama...")

            # Make API Call
            result = api_call_ollama("chat", payload, timeout_seconds)
            final_content = result.get("message", {}).get("content", "")

            # Log stats if debugging
            if debug:
                eval_count = result.get("eval_count", "N/A")
                eval_duration = result.get("eval_duration", 0)
                eval_sec = eval_duration / 1e9 if eval_duration else "N/A"
                print(f"Debug: [Ollama] tokens={eval_count}, time={eval_sec}s, reason={result.get('done_reason')}")

            # Handle reasoning content (remove ALL thinking/reasoning tags)
            if not include_reasoning:
                import re
                final_content = re.sub(r'<\|?channel\|?>.*?<\|?channel\|?>', '', final_content, flags=re.DOTALL | re.IGNORECASE)
                final_content = re.sub(r'<(thinking|think|reasoning)>.*?</\1>', '', final_content, flags=re.DOTALL | re.IGNORECASE)
                
                final_content = re.sub(r'^.*?</(thinking|think|reasoning)>', '', final_content, flags=re.DOTALL | re.IGNORECASE)
                final_content = re.sub(r'^.*?(?:<channel\|>|</channel>)', '', final_content, flags=re.DOTALL | re.IGNORECASE)
                
                final_content = re.sub(r'<\|?channel\|?>.*$', '', final_content, flags=re.DOTALL | re.IGNORECASE)
                final_content = re.sub(r'<(thinking|think|reasoning)>.*$', '', final_content, flags=re.DOTALL | re.IGNORECASE)

                final_content = re.sub(r'\[Thinking.*?\]', '', final_content, flags=re.DOTALL | re.IGNORECASE)
                
                final_content = '\n'.join(line for line in final_content.splitlines() if line.strip())
                final_content = final_content.strip()
            
            # Ollama handles keep_alive internally based on the request, but if we need manual fallback:
            if auto_unload == "True" and unload_delay == 0 and "keep_alive" not in payload:
                unload_model(model_key)

            return (final_content, json.dumps(request_log, indent=2, ensure_ascii=False))

        except Exception as e:
            error_message = f"Ollama error (Unified node): {str(e)}"
            return (error_message, json.dumps(request_log, indent=2, ensure_ascii=False))


class ExpoOllamaImageToText:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "user_prompt": ("STRING", {"default": "Describe this image in detail"}),
                "system_prompt": ("STRING", {"default": "This is a chat between a user and an assistant. The assistant is an expert in describing images, with detail and accuracy"}),
                "model_key": (fetch_available_models(DEFAULT_VISION), ),
                "auto_unload": (["True", "False"], {"default": "True"}),
                "unload_delay": ("INT", {"default": 0, "min": 0, "max": 3600, "step": 1}),
                "seed": ("INT", {"default": 777, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "context_length": ("INT", {"default": 4096, "min": 256, "max": 131072, "step": 256}),
                "max_tokens": ("INT", {"default": 1000, "min": 1, "max": 4096}),
                "generation_parameters": ("BOOLEAN", {"default": False, "label_on": "ON 🟢", "label_off": "OFF 🔴"}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0}),
                "top_k": ("INT", {"default": 40, "min": 0, "max": 100}),
                "top_p": ("FLOAT", {"default": 0.95, "min": 0.0, "max": 1.0, "step": 0.05}),
                "repeat_penalty": ("FLOAT", {"default": 1.1, "min": 0.0, "max": 2.0, "step": 0.05}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("Description", "Request_ollama")
    FUNCTION = "process_image"
    CATEGORY = "ComfyExpo/I2T"

    @classmethod
    def IS_CHANGED(cls, image, user_prompt, system_prompt, model_key, auto_unload, unload_delay, seed, context_length=4096, max_tokens=1000, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1):
        m = hashlib.sha256()
        m.update(str(user_prompt).encode())
        m.update(str(system_prompt).encode())
        m.update(str(model_key).encode())
        m.update(str(auto_unload).encode())
        m.update(str(unload_delay).encode())
        m.update(str(seed).encode())
        m.update(str(context_length).encode())
        m.update(str(max_tokens).encode())
        m.update(str(generation_parameters).encode())
        m.update(str(temperature).encode())
        m.update(str(top_k).encode())
        m.update(str(top_p).encode())
        m.update(str(repeat_penalty).encode())
        if image is not None:
            m.update(np.array(image).tobytes())
        return m.hexdigest()

    def process_image(self, image, user_prompt, system_prompt, model_key, auto_unload, unload_delay, seed, context_length=4096, max_tokens=1000, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1):
        debug = False
        timeout_seconds = 300
        use_gen_params = generation_parameters if isinstance(generation_parameters, bool) else str(generation_parameters).upper() in ["TRUE", "ON"]
        
        if model_key == "SELECT A MODEL" or not model_key:
            return ("Error: Please select a model from the list.", json.dumps({"error": "No model selected"}))
            
        request_log = {
            "model": model_key,
            "system_prompt": system_prompt,
            "user_input": user_prompt,
            "parameters": {"num_predict": max_tokens, "seed": seed}
        }
        if use_gen_params:
            request_log["parameters"].update({"num_ctx": context_length, "temperature": temperature, "top_k": top_k, "top_p": top_p, "repeat_penalty": repeat_penalty})

        check_ollama_connection()
        random.seed(seed)

        try:
            payload = {
                "model": model_key,
                "messages": [],
                "stream": False,
                "options": request_log["parameters"]
            }

            if auto_unload == "True" and unload_delay == 0:
                payload["keep_alive"] = 0
            elif unload_delay > 0:
                payload["keep_alive"] = unload_delay

            if system_prompt:
                payload["messages"].append({"role": "system", "content": system_prompt})

            user_msg = {"role": "user", "content": user_prompt or " "}

            if image is not None:
                pil_image = resize_to_target_megapixels(Image.fromarray(np.uint8(image[0] * 255)), 0.7)
                request_log["image_data"] = f"data:image/jpeg;base64,{get_b64_preview(pil_image)}"
                user_msg["images"] = [get_full_b64(pil_image)]

            payload["messages"].append(user_msg)

            result = api_call_ollama("chat", payload, timeout_seconds)
            final_content = result.get("message", {}).get("content", "")
            
            return (final_content, json.dumps(request_log, indent=2, ensure_ascii=False))

        except Exception as e:
            return (f"Error: {str(e)}", json.dumps(request_log, indent=2, ensure_ascii=False))


class ExpoOllamaTextGeneration:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"default": "Generate a creative story:"}),
                "system_prompt": ("STRING", {"default": "You are a helpful AI assistant."}),
                "model_key": (fetch_available_models(DEFAULT_LLM), ),
                "auto_unload": (["True", "False"], {"default": "True"}),
                "unload_delay": ("INT", {"default": 0, "min": 0, "max": 3600, "step": 1}),
                "seed": ("INT", {"default": 777, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "context_length": ("INT", {"default": 4096, "min": 256, "max": 131072, "step": 256}),
                "max_tokens": ("INT", {"default": 1000, "min": 1, "max": 4096}),
                "generation_parameters": ("BOOLEAN", {"default": False, "label_on": "ON 🟢", "label_off": "OFF 🔴"}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0}),
                "top_k": ("INT", {"default": 40, "min": 0, "max": 100}),
                "top_p": ("FLOAT", {"default": 0.95, "min": 0.0, "max": 1.0, "step": 0.05}),
                "repeat_penalty": ("FLOAT", {"default": 1.1, "min": 0.0, "max": 2.0, "step": 0.05}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("Generated Text", "Request_ollama")
    FUNCTION = "generate_text"
    CATEGORY = "ComfyExpo/Text"

    @classmethod
    def IS_CHANGED(cls, prompt, system_prompt, model_key, auto_unload, unload_delay, seed, context_length=4096, max_tokens=1000, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1):
        m = hashlib.sha256()
        m.update(str(prompt).encode())
        m.update(str(system_prompt).encode())
        m.update(str(model_key).encode())
        m.update(str(seed).encode())
        return m.hexdigest()

    def generate_text(self, prompt, system_prompt, model_key, auto_unload, unload_delay, seed, context_length=4096, max_tokens=1000, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1):
        debug = False
        timeout_seconds = 300
        use_gen_params = generation_parameters if isinstance(generation_parameters, bool) else str(generation_parameters).upper() in ["TRUE", "ON"]
        
        if model_key == "SELECT A MODEL" or not model_key:
            return ("Error: Please select a model from the list.", json.dumps({"error": "No model selected"}))

        request_log = {"model": model_key, "system_prompt": system_prompt, "user_input": prompt, "parameters": {"num_predict": max_tokens, "seed": seed}}
        if use_gen_params:
            request_log["parameters"].update({"num_ctx": context_length, "temperature": temperature, "top_k": top_k, "top_p": top_p, "repeat_penalty": repeat_penalty})

        check_ollama_connection()
        random.seed(seed)

        try:
            payload = {
                "model": model_key,
                "messages": [],
                "stream": False,
                "options": request_log["parameters"]
            }

            if auto_unload == "True" and unload_delay == 0:
                payload["keep_alive"] = 0
            elif unload_delay > 0:
                payload["keep_alive"] = unload_delay

            if system_prompt:
                payload["messages"].append({"role": "system", "content": system_prompt})

            payload["messages"].append({"role": "user", "content": prompt or " "})

            result = api_call_ollama("chat", payload, timeout_seconds)
            final_content = result.get("message", {}).get("content", "")

            return (final_content, json.dumps(request_log, indent=2, ensure_ascii=False))

        except Exception as e:
            return (f"Error: {str(e)}", json.dumps(request_log, indent=2, ensure_ascii=False))


class ExpoOllamaStructuredOutput:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text_input": ("STRING", {"multiline": True, "default": "Describe the image."}),
                "json_schema": ("STRING", {"multiline": True, "default": '{"type": "object", "properties": {"subject": {"type": "string"}}}'}),
                "output_keys": ("STRING", {"multiline": True, "default": "subject"}),
                "system_prompt": ("STRING", {"default": "You are a helpful AI assistant. Always respond with valid JSON."}),
                "model_key": (fetch_available_models(DEFAULT_LLM), ),
                "auto_unload": (["True", "False"], {"default": "True"}),
                "unload_delay": ("INT", {"default": 0, "min": 0, "max": 3600, "step": 1}),
                "seed": ("INT", {"default": 777, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "image": ("IMAGE",),
                "context_length": ("INT", {"default": 4096, "min": 256, "max": 131072, "step": 256}),
                "max_tokens": ("INT", {"default": 1000, "min": 1, "max": 4096}),
                "generation_parameters": ("BOOLEAN", {"default": False, "label_on": "ON 🟢", "label_off": "OFF 🔴"}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0}),
                "top_k": ("INT", {"default": 40, "min": 0, "max": 100}),
                "top_p": ("FLOAT", {"default": 0.95, "min": 0.0, "max": 1.0, "step": 0.05}),
                "repeat_penalty": ("FLOAT", {"default": 1.1, "min": 0.0, "max": 2.0, "step": 0.05}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("json_output", "value_1", "value_2", "value_3", "value_4", "value_5", "value_6", "Request_ollama")
    FUNCTION = "generate_structured"
    CATEGORY = "ComfyExpo/LMStudio"

    @classmethod
    def IS_CHANGED(cls, text_input, json_schema, output_keys, system_prompt, model_key, auto_unload, unload_delay, seed, image=None, context_length=4096, max_tokens=1000, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1):
        m = hashlib.sha256()
        m.update(str(text_input).encode())
        return m.hexdigest()

    def generate_structured(self, text_input, json_schema, output_keys, system_prompt, model_key, auto_unload, unload_delay, seed, image=None, context_length=4096, max_tokens=1000, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1):
        debug = False
        timeout_seconds = 300
        use_gen_params = generation_parameters if isinstance(generation_parameters, bool) else str(generation_parameters).upper() in ["TRUE", "ON"]
        
        if model_key == "SELECT A MODEL" or not model_key:
            return ("Error: Please select a model from the list.", "", "", "", "", "", "", json.dumps({"error": "No model selected"}))

        request_log = {"model": model_key, "system_prompt": system_prompt, "user_input": text_input, "schema": json_schema, "parameters": {"num_predict": max_tokens, "seed": seed}}
        if use_gen_params:
            request_log["parameters"].update({"num_ctx": context_length, "temperature": temperature, "top_k": top_k, "top_p": top_p, "repeat_penalty": repeat_penalty})
        
        check_ollama_connection()
        try:
            parsed_schema = json.loads(json_schema)
            keys = [k.strip() for k in output_keys.splitlines() if k.strip()][:6]

            payload = {
                "model": model_key,
                "messages": [],
                "stream": False,
                "format": parsed_schema, # Ollama supports passing the full schema object
                "options": request_log["parameters"]
            }

            if auto_unload == "True" and unload_delay == 0:
                payload["keep_alive"] = 0
            elif unload_delay > 0:
                payload["keep_alive"] = unload_delay

            if system_prompt:
                payload["messages"].append({"role": "system", "content": system_prompt})

            user_msg = {"role": "user", "content": text_input or " "}

            if image is not None:
                pil_image = resize_to_target_megapixels(Image.fromarray(np.uint8(image[0] * 255)), 0.7)
                request_log["image_data"] = f"data:image/jpeg;base64,{get_b64_preview(pil_image)}"
                user_msg["images"] = [get_full_b64(pil_image)]

            payload["messages"].append(user_msg)

            result = api_call_ollama("chat", payload, timeout_seconds)
            json_string = result.get("message", {}).get("content", "").strip()
            
            try: 
                parsed = json.loads(json_string)
            except Exception: 
                parsed = {}
            
            values = [str(parsed.get(k, "")) for k in keys]
            while len(values) < 6: values.append("")
            
            return (json_string, values[0], values[1], values[2], values[3], values[4], values[5], json.dumps(request_log, indent=2, ensure_ascii=False))

        except Exception as e:
            return (str(e), "", "", "", "", "", "", json.dumps(request_log, indent=2, ensure_ascii=False))


NODE_CLASS_MAPPINGS = {
    "OreXOllama": OreXOllama,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "OreXOllama": "🦙 Ollama (OreX)",
}