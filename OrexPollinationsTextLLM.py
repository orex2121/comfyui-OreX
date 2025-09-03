# -*- coding: utf-8 -*-
import os
import sys
import json
import numpy as np
import torch
from PIL import Image
import requests
import base64
from urllib.parse import quote, unquote
import io
import folder_paths

# ---------- Функция загрузки alias-ов из JSON ----------

def extract_aliases_with_image_marker(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        alias_counts = {}
        sortable_entries = []

        # Подсчет ключей
        for model in data:
            aliases = model.get("aliases")
            alias = aliases[0] if isinstance(aliases, list) and aliases else None
            name = model.get("name")
            key = (alias or name or "").strip()
            if not key:
                continue
            alias_counts[key] = alias_counts.get(key, 0) + 1

        for model in data:
            aliases = model.get("aliases")
            alias = aliases[0] if isinstance(aliases, list) and aliases else None
            name = model.get("name")
            input_modalities = model.get("input_modalities", [])

            key = alias if alias else name
            if not key:
                continue

            has_image = "image" in input_modalities
            is_duplicate = alias_counts.get(key, 0) > 1

            if is_duplicate and name:
                base_display_name = f"{key} - {name}"
            else:
                base_display_name = key

            sortable_entries.append((key.lower(), name.lower(), base_display_name, has_image, key))

        sortable_entries.sort(key=lambda x: (x[0], x[1]))

        aliases = []
        alias_lookup_map = {}

        for _, _, display_name, has_image, key in sortable_entries:
            final_display_name = f"🖼️ {display_name}" if has_image else display_name
            aliases.append(final_display_name)
            alias_lookup_map[final_display_name] = key

        return aliases, alias_lookup_map

    except Exception as e:
        print(f"[WARNING] Failed to load aliases from {path}: {e}")
        return [], {}

# ---------- Загрузка system_prompt.json ----------

def load_system_prompts(path):
    """
    Возвращает (choices, lookup) для выпадающего списка пресетов.
    choices: список имён (name) + "(none)" первым элементом.
    lookup:  name -> prompt
    """
    choices = ["(none)"]
    lookup = {"(none)": ""}

    try:
        if not os.path.exists(path):
            return choices, lookup

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, list):
            return choices, lookup

        for item in data:
            name = (item.get("name") or "").strip()
            prompt = (item.get("prompt") or "").rstrip()
            if not name:
                continue
            if name in lookup:
                continue
            choices.append(name)
            lookup[name] = prompt

        return choices, lookup

    except Exception as e:
        print(f"[WARNING] Failed to load system_prompt.json from {path}: {e}")
        return choices, lookup

# ---------- Константы ----------

_base_dir = os.path.dirname(__file__)
json_path_models = os.path.join(_base_dir, "polination_text_llm.json")
json_path_sys = os.path.join(_base_dir, "system_prompt.json")

TEXT_GENERATION_MODELS, ALIAS_LOOKUP = extract_aliases_with_image_marker(json_path_models)
SYSTEM_PRESET_CHOICES, SYSTEM_PRESET_LOOKUP = load_system_prompts(json_path_sys)

# ---------- Узел: Текстовая генерация ----------

class PollinationsTextGenOrex:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True, "placeholder": "Enter your text prompt..."}),
                "system_prompt": ("STRING", {"multiline": True, "placeholder": "System behavior prompt (optional)", "default": ""}),
                # Новый переключатель над system_preset
                "llm_enabled": ("BOOLEAN", {"default": True, "tooltip": "LLM ON/OFF — disable to output only user prompt"}),
                "system_preset": (tuple(SYSTEM_PRESET_CHOICES), {"default": SYSTEM_PRESET_CHOICES[0]}),
                "image_switch": ("BOOLEAN", {"default": True, "tooltip": "Enable or disable image input"}),
                "model": (TEXT_GENERATION_MODELS, {"default": TEXT_GENERATION_MODELS[0] if TEXT_GENERATION_MODELS else "openai"}),
                "max_tokens": ("INT", {"default": 512, "min": 0, "max": 32768, "tooltip": "0 - disabled"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "image": ("IMAGE",),
                "private": ("BOOLEAN", {"default": True, "tooltip": "Keep the generation private"})
            }
        }

    RETURN_TYPES = ("STRING", "STRING",)
    RETURN_NAMES = ("generated_text", "debug",)
    FUNCTION = "generate_text"
    CATEGORY = "🤫OreX/LLM"

    def generate_text(self, prompt, system_prompt, llm_enabled, system_preset, image_switch, model, max_tokens, seed, image=None, private=True):
        try:
            # Если LLM выключён: вернуть только пользовательский prompt, без отправки
            if not llm_enabled:
                debug_info = "LLM disabled: bypassed API call. Output is the raw user prompt."
                return (prompt, debug_info)

            # --- Сборка merged_text (LLM ON) ---
            try:
                max_tokens = int(max_tokens)
            except Exception:
                max_tokens = 0

            system_prompt = (system_prompt or "").strip()
            preset_text = SYSTEM_PRESET_LOOKUP.get(system_preset, "").strip()

            # system_prompt + token_limit_line подряд (без переноса)
            header = ""
            if system_prompt:
                header += system_prompt + " "

            if max_tokens > 0:
                token_limit_line = f"Ответ уложи в {max_tokens} токенов."
                header += token_limit_line

            # если есть preset_text, добавляем его на новой строке
            if preset_text:
                header += "\n" + preset_text

            # затем двоеточие и переход на новую строку + сам prompt
            merged_text = f"{header}:\n{prompt}"

            alias = ALIAS_LOOKUP.get(model, model)
            is_image_model = model.startswith("🖼️") and image is not None and image_switch

            debug_info = ""

            if is_image_model:
                # Подготовка изображения
                pil_image = self._tensor_to_pil(image)
                buffered = io.BytesIO()
                pil_image.save(buffered, format="PNG")
                img_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")

                messages = [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": merged_text},
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}}
                        ]
                    }
                ]

                payload = {
                    "model": alias,
                    "messages": messages,
                    "seed": seed,
                    "private": str(private).lower()
                }

                headers = {"Content-Type": "application/json"}
                response = requests.post("https://text.pollinations.ai/", json=payload, headers=headers)

                debug_info = "Payload:\n" + json.dumps(payload, ensure_ascii=False, indent=2) + "\n\nMerged text:\n" + merged_text

            else:
                param_str = f"model={quote(alias)}&seed={seed}&private={str(private).lower()}"
                url = f"https://text.pollinations.ai/{quote(merged_text)}?{param_str}"
                response = requests.get(url)

                debug_info = "URL:\n" + url + "\n\nMerged text:\n" + merged_text

            if response.status_code == 200:
                return (response.text, debug_info)
            else:
                return (f"Error: {response.status_code} | {response.text}", debug_info)

        except Exception as e:
            return (f"Text generation failed: {str(e)}", f"Exception: {e}")

    def _tensor_to_pil(self, image_tensor):
        image_np = image_tensor[0].cpu().numpy()
        image_np = (image_np * 255).astype(np.uint8)
        return Image.fromarray(image_np)

# ---------- Регистрация узлов ----------

NODE_CLASS_MAPPINGS = {
    "PollinationsTextGenOrex": PollinationsTextGenOrex
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PollinationsTextGenOrex": "Pollinations Text Gen 📝 (Orex)",
}
