# -*- coding: utf-8 -*-
import os
import json
import urllib.request
import urllib.error
import sys

# Trying to import SDK for the most reliable unloading
try:
    import lmstudio as lms
except ImportError:
    lms = None


class LMStudioSuppressor:
    """
    Тимчасовий перехоплювач виводу.
    Пропускає лише системні принти ноди та повністю блокує внутрішній спам SDK.
    """
    def __init__(self, original_stdout):
        self.original_stdout = original_stdout

    def write(self, message):
        # Якщо це наше повідомлення або звичайне перенесення рядка — пускаємо в консоль
        if "[LMStudio Unload Node]" in message or message == "\n":
            self.original_stdout.write(message)
        # Зелений спам SDK відкидаємо, ComfyUI при цьому не чіпаємо, бо перехоплення працює локально
        elif "[INFO]" in message or "websocket" in message.lower() or "HTTP Request" in message:
            pass
        else:
            # Про всяк випадок пропускаємо інші корисні повідомлення
            self.original_stdout.write(message)

    def flush(self):
        self.original_stdout.flush()


def fetch_currently_loaded_models():
    """
    Requests the internal LM Studio API to get a list of models
    that are ACTUALLY loaded into RAM / VRAM at the moment.
    """
    host = os.environ.get("LMSTUDIO_URL", "http://127.0.0.1:1234")
    if not host.startswith("http"):
        host = f"http://{host}"
    
    endpoint = f"{host}/api/v1/models"
    loaded_models = []
    
    try:
        req = urllib.request.Request(endpoint)
        with urllib.request.urlopen(req, timeout=2.5) as response:
            data = json.loads(response.read().decode('utf-8'))
            
            # LM Studio v1 API specification: response returns a dict {"models": [...]}
            if isinstance(data, dict) and "models" in data:
                for model_info in data["models"]:
                    # Each model contains a list of running instances 'loaded_instances'
                    loaded_instances = model_info.get("loaded_instances", [])
                    if isinstance(loaded_instances, list):
                        for instance in loaded_instances:
                            if isinstance(instance, dict):
                                # Save parent model name for informative ComfyUI logging
                                instance["parent_model_id"] = model_info.get("id", "unknown")
                                loaded_models.append(instance)
                                
            # Fallback parsing in case of backward compatibility with v0 or pure OpenAI format
            elif isinstance(data, dict) and "data" in data:
                for item in data["data"]:
                    if isinstance(item, dict):
                        loaded_models.append(item)
            elif isinstance(data, list):
                for item in data:
                    if isinstance(item, dict):
                        state = item.get("state") or item.get("status")
                        if not state or str(state).lower() in ["loaded", "active", "running"]:
                            loaded_models.append(item)
                            
    except Exception as e:
        print(f"[LMStudio Unload Node] ⚠️ Error querying endpoint {endpoint}: {e}")
        
    return loaded_models

def get_last_active_model(loaded_items):
    """
    Analyzes the list of loaded models and determines the one
    that processed the request last (the most active one).
    """
    if not loaded_items:
        return None
        
    time_keys = ['last_used', 'lastUsed', 'last_accessed', 'lastAccessed', 'last_used_at', 'lastUsedAt', 'timestamp']
    best_item = None
    max_time = -1.0
    
    for item in loaded_items:
        if item.get('is_active') is True or item.get('active') is True:
            return item.get("id") or item.get("instance_id") or item.get("modelKey") or item.get("model_key")
            
        for tk in time_keys:
            val = item.get(tk)
            if val is not None:
                try:
                    val_float = float(val)
                    if val_float > max_time:
                        max_time = val_float
                        best_item = item
                except ValueError:
                    pass
                        
    if best_item:
        return best_item.get("id") or best_item.get("instance_id") or best_item.get("modelKey") or best_item.get("model_key")
        
    last_item = loaded_items[-1]
    return last_item.get("id") or last_item.get("instance_id") or last_item.get("modelKey") or last_item.get("model_key")

def trigger_unload_model(model_key):
    """Unloads a specific model from VRAM via SDK or REST API."""
    if not model_key:
        print("[LMStudio Unload Node] ⚠️ Empty model key provided. Skipping call.")
        return False
        
    print(f"[LMStudio Unload Node] ⏳ Sending unload command for: {model_key}...")
    
    # 1. Attempting via official SDK
    if lms is not None:
        # Зберігаємо оригінальний вивід консолі
        old_stdout = sys.stdout
        try:
            # Вмикаємо глушник виключно для блоку SDK
            sys.stdout = LMStudioSuppressor(old_stdout)
            
            with lms.Client() as client:
                model = client.llm.model(model_key)
                model.unload()
                
            # Повертаємо консоль до норми
            sys.stdout = old_stdout
            print(f"[LMStudio Unload Node] 🟢 Model {model_key} successfully unloaded via SDK.")
            return True
        except Exception as e:
            # На випадок помилки обов'язково повертаємо оригінальний stdout
            sys.stdout = old_stdout
            print(f"[LMStudio Unload Node] ⚠️ SDK error for {model_key}: {e}. Trying REST API...")
            
    # 2. Fallback via REST API v1
    host = os.environ.get("LMSTUDIO_URL", "http://127.0.0.1:1234")
    if not host.startswith("http"):
        host = f"http://{host}"
        
    url = f"{host}/api/v1/models/unload"
    payload = json.dumps({"instance_id": model_key}).encode('utf-8')
    
    try:
        req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'}, method="POST")
        with urllib.request.urlopen(req, timeout=4.0) as response:
            if response.getcode() in [200, 204]:
                print(f"[LMStudio Unload Node] 🟢 Model {model_key} successfully unloaded via REST API.")
                return True
    except Exception as e:
        print(f"[LMStudio Unload Node] 🔴 Failed to unload {model_key} via REST: {e}")
    return False


class OreXLMStudioUnloadTrigger:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "any_input": ("*", {"default": None}),
                "unload_all_active": ("BOOLEAN", {"default": True, "label_on": "🟢 ALL Models", "label_off": "🔴 Active Only"}),
            },
            "optional": {
                "specific_model_key": ("STRING", {"default": ""}), 
            }
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("output",)
    FUNCTION = "unload_and_pass"
    CATEGORY = "🤫OreX/LLM"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def unload_and_pass(self, any_input, unload_all_active, specific_model_key=""):
        print("[LMStudio Unload Node] 🚀 Unload trigger activated.")
        
        loaded_items = fetch_currently_loaded_models()
        models_to_unload = []
        
        if specific_model_key.strip():
            models_to_unload.append(specific_model_key.strip())
        else:
            if unload_all_active:
                for item in loaded_items:
                    m_id = item.get("id") or item.get("instance_id") or item.get("modelKey") or item.get("model_key")
                    parent_name = item.get("parent_model_id", "Unknown")
                    if m_id and m_id not in models_to_unload:
                        models_to_unload.append(m_id)
                        print(f"[LMStudio Unload Node] -> Active VRAM instance: {parent_name} [ID: {m_id}]")
                print(f"[LMStudio Unload Node] Mode: ALL Models. Active VRAM instances detected: {len(models_to_unload)}")
            else:
                active_id = get_last_active_model(loaded_items)
                if active_id:
                    models_to_unload.append(active_id)
                    print(f"[LMStudio Unload Node] Mode: Active Only. Last active model detected: {active_id}")
                else:
                    print("[LMStudio Unload Node] Mode: Active Only. No active loaded models found.")
        
        if not models_to_unload:
            print("[LMStudio Unload Node] ⚠️ Model unload list is empty. No active processes found in VRAM.")
        else:
            for model in models_to_unload:
                trigger_unload_model(model)
                
        print("[LMStudio Unload Node] ✅ Memory cleanup completed.")
        return (any_input,)


NODE_CLASS_MAPPINGS = {
    "orex LMStudio Unload": OreXLMStudioUnloadTrigger
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex LMStudio Unload": "♻️ LMStudio Unload (OreX)"
}