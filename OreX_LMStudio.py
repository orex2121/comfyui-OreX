import base64
import numpy as np
from PIL import Image
import time
import os
import io
import tempfile
import hashlib
import random
import concurrent.futures
import urllib.request
import json

_ENV_API_TOKEN = "LM_API_TOKEN"
api_token = os.environ.get(_ENV_API_TOKEN, "lm-studio")

try:
    import lmstudio as lms
except Exception:
    # keep name available for runtime checks; nodes will handle missing SDK at call time
    lms = None

# Default models to use
DEFAULT_LLM = "SELECT A MODEL"
DEFAULT_VISION = "SELECT A MODEL"

# --- SYSTEM PRESETS LOADER ---
def load_presets():
    current_dir = os.path.dirname(os.path.realpath(__file__))
    json_path = os.path.join(current_dir, "OreX_LMStudio.json")
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
            print(f"[LM Studio Nodes] Could not create default presets file: {e}")
            
    # Load presets from file
    try:
        if os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for item in data:
                    if "name" in item and "prompt" in item:
                        presets[item["name"]] = item["prompt"]
    except Exception as e:
        print(f"[LM Studio Nodes] Error loading presets from JSON: {e}")
        
    return presets

PRESETS_DICT = load_presets()
PRESET_NAMES = list(PRESETS_DICT.keys())
# -----------------------------

def fetch_available_models(default_model):
    """Fetches available models from LM Studio REST API."""
    models = []
    host = os.environ.get("LM_STUDIO_URL", "http://127.0.0.1:1234")
    if not host.startswith("http"):
        host = f"http://{host}"
    
    endpoints = [
        f"{host}/api/v1/models",
        f"{host}/v1/models"
    ]
    
    for endpoint in endpoints:
        try:
            req = urllib.request.Request(endpoint)
            # Добавляем заголовок авторизации на случай, если он требуется сервером
            current_token = os.environ.get("LM_API_TOKEN", "lm-studio")
            req.add_header("Authorization", f"Bearer {current_token}")
            
            # Увеличен тайм-аут до 5 секунд для гарантии ответа при холодном старте
            with urllib.request.urlopen(req, timeout=5.0) as response:
                data = json.loads(response.read().decode())
                for m in data.get("data", []):
                    m_id = m.get("id") or m.get("name")
                    if m_id and m_id not in models:
                        models.append(m_id)
            if models:
                print(f"[LM Studio] Successfully loaded {len(models)} models from {endpoint}")
                break
        except Exception as e:
            pass # Переходим к следующему эндпоинту, если этот недоступен
            
    if not models:
        print("[LM Studio Nodes] Could not fetch models. Is LM Studio server running on port 1234 before ComfyUI started?")
        
    # Убеждаемся, что дефолтная модель всегда есть в списке и идет первой
    if default_model in models:
        models.remove(default_model)
    models.insert(0, default_model)
    
    return models

# --- Helper function to get model info with fallback ---
def get_model_info_with_fallback(model_key, debug=False):
    """
    Attempts to get the model information for use with the LM Studio Python SDK.
    Returns the model key to use or raises an Exception when no model can be obtained.
    """
    if lms is None:
        raise Exception("LM Studio SDK (lmstudio) not available")

    # If model_key is provided and not empty, use it directly
    if model_key and str(model_key).strip() != "" and model_key != "SELECT A MODEL":
        if debug:
            print(f"Debug: Using provided model key: '{model_key}'")
        return model_key

    # Try to find a fallback model
    try:
        # Try to get loaded models
        try:
            with lms.Client() as client:
                if hasattr(client, "list_loaded_models"):
                    loaded_models = client.list_loaded_models()
                elif hasattr(client.llm, "list_loaded"):
                    loaded_models = client.llm.list_loaded()
                elif hasattr(client.llm, "list_loaded_models"):
                    loaded_models = client.llm.list_loaded_models()
        except Exception as e:
            if debug:
                print(f"Debug: Failed to get loaded models: {e}")
            loaded_models = None

        if not loaded_models:
            if debug:
                print("Debug: No loaded models found, will use default model")
            return None  # Let the client use default

        # If debugging, show the raw loaded_models structure
        if debug:
            try:
                import pprint
                print("Debug: Raw loaded_models:")
                pprint.pprint(loaded_models)
            except Exception:
                print(f"Debug: loaded_models (repr): {repr(loaded_models)}")

        # Try to extract a usable model key from various shapes
        def _extract_model_name(obj):
            # strings
            if isinstance(obj, str):
                return obj
            # list/tuple -> inspect first element
            if isinstance(obj, (list, tuple)) and len(obj) > 0:
                return _extract_model_name(obj[0])
            # dict -> try common keys
            if isinstance(obj, dict):
                for k in ("model", "id", "name"):
                    if k in obj and isinstance(obj[k], str) and obj[k]:
                        return obj[k]
                keys = list(obj.keys())
                if keys and isinstance(keys[0], str):
                    return keys[0]
            # object with attributes
            for attr in ("model", "id", "name", "display_name", "identifier", "model_key"):
                if hasattr(obj, attr):
                    val = getattr(obj, attr)
                    if isinstance(val, str) and val:
                        return val
            return None

        fallback_model_key = _extract_model_name(loaded_models)
        if fallback_model_key:
            if debug:
                print(f"Debug: Found loaded model '{fallback_model_key}' as fallback.")
            return fallback_model_key
        else:
            if debug:
                print("Debug: Could not extract model name, using default")
            return None  # Let the client use default

    except Exception as e:
        if debug:
            print(f"Debug: Exception in fallback detection: {e}")
        return None  # Let the client use default


def check_lmstudio_connection():
    """
    Verify that LM Studio is reachable before attempting generation.
    Raises a clear exception if the server is not running so ComfyUI halts
    the pipeline rather than passing an error string to downstream nodes.
    """
    if lms is None:
        raise Exception(
            "LM Studio SDK (lmstudio) is not installed. "
            "Run: pip install lmstudio"
        )
    try:
        with lms.Client() as client:  # noqa: F841  – connection test only
            pass
    except Exception as e:
        raise Exception(
            f"Cannot connect to LM Studio. "
            f"Please make sure LM Studio is open and the local server is enabled. "
            f"(Error: {e})"
        ) from e


def safe_get_stats_info(result, debug=False):
    """
    Safely extract statistics information from the result object.
    Handles different SDK versions and attribute names.
    """
    stats_info = {}
    
    if hasattr(result, 'stats') and result.stats:
        # Get predicted tokens count
        if hasattr(result.stats, 'predicted_tokens_count'):
            stats_info['predicted_tokens'] = result.stats.predicted_tokens_count
        elif hasattr(result.stats, 'tokens_count'):
            stats_info['predicted_tokens'] = result.stats.tokens_count
        else:
            stats_info['predicted_tokens'] = "N/A"
        
        # Get time to first token
        if hasattr(result.stats, 'time_to_first_token_sec'):
            stats_info['time_to_first_token'] = result.stats.time_to_first_token_sec
        elif hasattr(result.stats, 'generation_time_sec'):
            stats_info['time_to_first_token'] = result.stats.generation_time_sec
        elif hasattr(result.stats, 'time_to_first_token'):
            stats_info['time_to_first_token'] = result.stats.time_to_first_token
        else:
            stats_info['time_to_first_token'] = "N/A"
        
        # Get stop reason
        if hasattr(result.stats, 'stop_reason'):
            stats_info['stop_reason'] = result.stats.stop_reason
        else:
            stats_info['stop_reason'] = "N/A"
    else:
        stats_info = {
            'predicted_tokens': "N/A",
            'time_to_first_token': "N/A",
            'stop_reason': "N/A"
        }
    
    if debug:
        print(f"Debug: Stats extraction - Tokens: {stats_info['predicted_tokens']}, Time: {stats_info['time_to_first_token']}, Stop reason: {stats_info['stop_reason']}")
    
    return stats_info


def resize_to_target_megapixels(pil_image, target_megapixels=0.7, debug=False):
    """
    Resizes a PIL Image so its total pixel count does not exceed target_megapixels.
    Maintains aspect ratio.
    """
    target_pixels = target_megapixels * 1000000
    current_pixels = pil_image.width * pil_image.height
    
    if current_pixels > target_pixels:
        scale_factor = (target_pixels / current_pixels) ** 0.5
        new_width = int(pil_image.width * scale_factor)
        new_height = int(pil_image.height * scale_factor)
        
        # Use high-quality LANCZOS resampling. 
        # getattr is used to ensure compatibility with both older PIL and newer Pillow.
        resampling_filter = getattr(Image, 'Resampling', Image).LANCZOS
        
        if debug:
            print(f"Debug: Resizing image from {pil_image.width}x{pil_image.height} to {new_width}x{new_height} (~{target_megapixels}MP)")
            
        return pil_image.resize((new_width, new_height), resampling_filter)
        
    return pil_image

def get_b64_preview(pil_img):
    """
    Converts a PIL image to base64 and returns a truncated version for logging.
    """
    buffered = io.BytesIO()
    pil_img.save(buffered, format="JPEG")
    img_str = base64.b64encode(buffered.getvalue()).decode()
    if len(img_str) > 23:
        return f"{img_str[:10]}...{img_str[-10:]}"
    return img_str

class OreXLMStudio:
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
    RETURN_NAMES = ("Generated Text", "Request_lmstudio")
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
        
        # Include image hash if present
        if image is not None:
            # Convert image to a hashable representation
            image_bytes = np.array(image).tobytes()
            m.update(image_bytes)
        
        return m.hexdigest()

    def process_input(self, text_input, system_prompt, system_preset, model_key, include_reasoning, auto_unload, unload_delay, seed, image=None, context_length=4096, max_tokens=1024, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1):
        debug = False
        timeout_seconds = 300
        
        # Normalize booleans
        use_gen_params = generation_parameters if isinstance(generation_parameters, bool) else str(generation_parameters).upper() in ["TRUE", "ON"]
        
        # Fail fast if LM Studio is not reachable
        check_lmstudio_connection()

        # Check if we have valid inputs
        has_image = image is not None
        has_text = text_input is not None and text_input.strip() != ""

        # If no inputs are provided, return a message instead of error
        if not has_image and not has_text:
            msg = "No inputs provided. Please connect an image or provide text input."
            return (msg, json.dumps({"error": msg}))

        # Set seed
        random.seed(seed)

        # Обработка system_preset: добавляем текст с новой строки к system_prompt
        preset_value = PRESETS_DICT.get(system_preset, "")
        final_system_prompt = system_prompt
        if preset_value.strip():
            final_system_prompt = f"{system_prompt.strip()}\n{preset_value.strip()}".strip()

        # Prepare request preview JSON
        request_log = {
            "model": model_key,
            "system_prompt": final_system_prompt,
            "user_input": text_input if has_text else "[Empty/Image only]",
            "has_image": has_image,
            "parameters": {
                "max_tokens": max_tokens,
                "seed": seed
            }
        }
        
        if use_gen_params:
            request_log["parameters"].update({
                "context_length": context_length,
                "temperature": temperature,
                "top_p": top_p,
                "top_k": top_k,
                "repeat_penalty": repeat_penalty
            })

        temp_path = None # Initialize temp_path for cleanup

        try:
            # --- Get model info and create client context ---
            model_key_to_use = get_model_info_with_fallback(model_key, debug)
            
            with lms.Client() as client:
                # Get model with proper context management
                if model_key_to_use:
                    if auto_unload == "True" and unload_delay > 0:
                        model = client.llm.model(model_key_to_use, ttl=unload_delay)
                    else:
                        model = client.llm.model(model_key_to_use)
                else:
                    # Use default model
                    model = client.llm.model()
                
                chat = lms.Chat(final_system_prompt)

                # Process inputs
                if has_image:
                    # Convert numpy array to PIL Image
                    pil_image = Image.fromarray(np.uint8(image[0]*255))
                    
                    # Apply resolution limit before sending to LM Studio
                    pil_image = resize_to_target_megapixels(pil_image, 0.7, debug)
                    
                    # Add base64 preview to log
                    request_log["image_data"] = f"data:image/jpeg;base64,{get_b64_preview(pil_image)}"

                    # Create a temporary file
                    with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as temp_file:
                        temp_path = temp_file.name
                        # Save to the temporary file
                        pil_image.save(temp_path, format="JPEG")

                    # Use the client's files namespace to prepare the image
                    image_handle = client.files.prepare_image(temp_path)

                    # Add user message with correct signature per SDK docs
                    # We send at least a space if text is empty to satisfy some API requirements
                    effective_text = text_input if has_text else " "
                    chat.add_user_message(effective_text, images=[image_handle])
                elif has_text:
                    # Add user message with text only
                    chat.add_user_message(text_input)

                # Configure generation parameters
                config = {
                    "maxTokens": max_tokens,
                    "seed": seed
                }
                
                if use_gen_params:
                    config.update({
                        "context_length": context_length,
                        "temperature": temperature,
                        "top_p": top_p,
                        "top_k": top_k,
                        "repeat_penalty": repeat_penalty
                    })

                # --- Timeout logic ---
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(model.respond, chat, config=config)
                    try:
                        result = future.result(timeout=timeout_seconds)
                    except concurrent.futures.TimeoutError:
                        error_message = f"Error: LM Studio model response timed out after {timeout_seconds} seconds."
                        return (error_message, json.dumps(request_log, indent=2, ensure_ascii=False))

                # Handle reasoning content (remove ALL thinking/reasoning tags)
                final_content = result.content
                if not include_reasoning:
                    import re
                    # 1. Remove fully closed reasoning/thinking tags
                    final_content = re.sub(r'<\|?channel\|?>.*?<\|?channel\|?>', '', final_content, flags=re.DOTALL | re.IGNORECASE)
                    final_content = re.sub(r'<(thinking|think|reasoning)>.*?</\1>', '', final_content, flags=re.DOTALL | re.IGNORECASE)
                    
                    # 2. Handle missing opening tags (model starts directly with thoughts and ends with closing tag)
                    final_content = re.sub(r'^.*?</(thinking|think|reasoning)>', '', final_content, flags=re.DOTALL | re.IGNORECASE)
                    final_content = re.sub(r'^.*?(?:<channel\|>|</channel>)', '', final_content, flags=re.DOTALL | re.IGNORECASE)
                    
                    # 3. Remove unclosed tags (in case generation stopped due to max_tokens limits)
                    final_content = re.sub(r'<\|?channel\|?>.*$', '', final_content, flags=re.DOTALL | re.IGNORECASE)
                    final_content = re.sub(r'<(thinking|think|reasoning)>.*$', '', final_content, flags=re.DOTALL | re.IGNORECASE)

                    # 4. Remove any remaining thinking markers (e.g., [Thinking...])
                    final_content = re.sub(r'\[Thinking.*?\]', '', final_content, flags=re.DOTALL | re.IGNORECASE)
                    
                    # 5. Clean up extra whitespace and newlines
                    final_content = '\n'.join(line for line in final_content.splitlines() if line.strip())
                    final_content = final_content.strip()
                
                # Unload model immediately if requested
                if auto_unload == "True" and unload_delay == 0:
                    try:
                        model.unload()
                    except Exception:
                        pass

                return (final_content, json.dumps(request_log, indent=2, ensure_ascii=False))

        except Exception as e:
            error_message = f"LM Studio error (Unified node): {str(e)}"
            return (error_message, json.dumps(request_log, indent=2, ensure_ascii=False))
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except Exception:
                    pass


class ExpoLmstudioImageToText:
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
                # Legacy parameters for backward compatibility
                "model": ("STRING", {"default": ""}),
                "ip_address": ("STRING", {"default": ""}),
                "port": ("INT", {"default": 0, "min": 0, "max": 65535}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("Description", "Request_lmstudio")
    FUNCTION = "process_image"
    CATEGORY = "ComfyExpo/I2T"

    @classmethod
    def IS_CHANGED(cls, image, user_prompt, system_prompt, model_key, auto_unload, unload_delay, seed, context_length=4096, max_tokens=1000, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1, model="", ip_address="", port=0):
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

    def process_image(self, image, user_prompt, system_prompt, model_key, auto_unload, unload_delay, seed, context_length=4096, max_tokens=1000, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1, include_reasoning=True, model="", ip_address="", port=0):
        debug = False
        timeout_seconds = 300
        use_gen_params = generation_parameters if isinstance(generation_parameters, bool) else str(generation_parameters).upper() in ["TRUE", "ON"]
        
        request_log = {
            "model": model_key,
            "system_prompt": system_prompt,
            "user_input": user_prompt,
            "parameters": {"max_tokens": max_tokens, "seed": seed}
        }
        if use_gen_params:
            request_log["parameters"].update({"context_length": context_length, "temperature": temperature})

        if ip_address and port > 0:
            return self._process_image_legacy_http(image, user_prompt, system_prompt, model_key or model, ip_address, port, seed, max_tokens, generation_parameters, temperature, top_k, top_p, repeat_penalty)
        
        check_lmstudio_connection()
        random.seed(seed)

        temp_path = None
        try:
            model_key_to_use = get_model_info_with_fallback(model_key, debug)
            with lms.Client() as client:
                model_obj = client.llm.model(model_key_to_use, ttl=unload_delay) if model_key_to_use and auto_unload == "True" else client.llm.model(model_key_to_use) if model_key_to_use else client.llm.model()
                chat = lms.Chat(system_prompt)
                if image is not None:
                    pil_image = resize_to_target_megapixels(Image.fromarray(np.uint8(image[0] * 255)), 0.7)
                    # Add base64 preview to log
                    request_log["image_data"] = f"data:image/jpeg;base64,{get_b64_preview(pil_image)}"
                    
                    with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
                        temp_path = tmp.name
                        pil_image.save(temp_path, format='JPEG')
                    image_handle = client.files.prepare_image(temp_path)
                    chat.add_user_message(user_prompt or " ", images=[image_handle])
                else:
                    chat.add_user_message(user_prompt or " ")

                config = {"maxTokens": max_tokens, "seed": seed}
                if use_gen_params:
                    config.update({"context_length": context_length, "temperature": temperature, "top_p": top_p, "top_k": top_k, "repeat_penalty": repeat_penalty})

                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(model_obj.respond, chat, config=config)
                    result = future.result(timeout=timeout_seconds)

                if auto_unload == "True" and unload_delay == 0:
                    try: model_obj.unload()
                    except Exception: pass

                return (result.content, json.dumps(request_log, indent=2, ensure_ascii=False))
        except Exception as e:
            return (f"Error: {str(e)}", json.dumps(request_log, indent=2, ensure_ascii=False))
        finally:
            if temp_path and os.path.exists(temp_path):
                try: os.unlink(temp_path)
                except Exception: pass

    def _process_image_legacy_http(self, image, user_prompt, system_prompt, model, ip_address, port, seed, max_tokens=1000, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1):
        print("Warning: Using legacy HTTP mode.")
        return ("Legacy mode result", "{}")


class ExpoLmstudioTextGeneration:
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
                "model": ("STRING", {"default": ""}),
                "ip_address": ("STRING", {"default": ""}),
                "port": ("INT", {"default": 0, "min": 0, "max": 65535}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("Generated Text", "Request_lmstudio")
    FUNCTION = "generate_text"
    CATEGORY = "ComfyExpo/Text"

    @classmethod
    def IS_CHANGED(cls, prompt, system_prompt, model_key, auto_unload, unload_delay, seed, context_length=4096, max_tokens=1000, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1, model="", ip_address="", port=0):
        m = hashlib.sha256()
        m.update(str(prompt).encode())
        m.update(str(system_prompt).encode())
        m.update(str(model_key).encode())
        m.update(str(seed).encode())
        return m.hexdigest()

    def generate_text(self, prompt, system_prompt, model_key, auto_unload, unload_delay, seed, context_length=4096, max_tokens=1000, generation_parameters=False, temperature=0.7, top_k=40, top_p=0.95, repeat_penalty=1.1, model="", ip_address="", port=0):
        debug = False
        timeout_seconds = 300
        use_gen_params = generation_parameters if isinstance(generation_parameters, bool) else str(generation_parameters).upper() in ["TRUE", "ON"]
        request_log = {"model": model_key, "system_prompt": system_prompt, "user_input": prompt, "parameters": {"seed": seed}}
        
        check_lmstudio_connection()
        random.seed(seed)

        try:
            model_key_to_use = get_model_info_with_fallback(model_key, debug)
            with lms.Client() as client:
                model_obj = client.llm.model(model_key_to_use) if model_key_to_use else client.llm.model()
                chat = lms.Chat(system_prompt)
                chat.add_user_message(prompt or " ")
                config = {"maxTokens": max_tokens, "seed": seed}
                if use_gen_params: config.update({"context_length": context_length, "temperature": temperature})
                
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(model_obj.respond, chat, config=config)
                    result = future.result(timeout=timeout_seconds)
                return (result.content, json.dumps(request_log, indent=2, ensure_ascii=False))
        except Exception as e:
            return (f"Error: {str(e)}", json.dumps(request_log, indent=2, ensure_ascii=False))


class ExpoLmstudioStructuredOutput:
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
    RETURN_NAMES = ("json_output", "value_1", "value_2", "value_3", "value_4", "value_5", "value_6", "Request_lmstudio")
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
        request_log = {"model": model_key, "system_prompt": system_prompt, "user_input": text_input, "schema": json_schema}
        
        check_lmstudio_connection()
        try:
            parsed_schema = json.loads(json_schema)
            keys = [k.strip() for k in output_keys.splitlines() if k.strip()][:6]
            model_key_to_use = get_model_info_with_fallback(model_key, debug)
            with lms.Client() as client:
                model_obj = client.llm.model(model_key_to_use) if model_key_to_use else client.llm.model()
                chat = lms.Chat(system_prompt)
                chat.add_user_message(text_input or " ")
                config = {"maxTokens": max_tokens, "seed": seed, "structured": {"type": "json", "jsonSchema": parsed_schema}}
                if use_gen_params: config.update({"context_length": context_length, "temperature": temperature})
                
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(model_obj.respond, chat, config=config)
                    result = future.result(timeout=timeout_seconds)
                
                json_string = result.content.strip()
                try: parsed = json.loads(json_string)
                except Exception: parsed = {}
                
                values = [str(parsed.get(k, "")) for k in keys]
                while len(values) < 6: values.append("")
                
                return (json_string, values[0], values[1], values[2], values[3], values[4], values[5], json.dumps(request_log, indent=2, ensure_ascii=False))
        except Exception as e:
            return (str(e), "", "", "", "", "", "", json.dumps(request_log, indent=2, ensure_ascii=False))


NODE_CLASS_MAPPINGS = {
    "OreXLMStudio": OreXLMStudio,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "OreXLMStudio": "🤖 LMStudio (OreX)",
}