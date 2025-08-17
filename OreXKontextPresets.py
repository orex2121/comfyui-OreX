# -*- coding: utf-8 -*-
import os
import json
import hashlib

MY_CATEGORY = "🤫OreX/LLM"

# ========= Paths =========

def _base_dir():
    return os.path.dirname(os.path.abspath(__file__))

def _config_path():
    return os.path.join(_base_dir(), "OreXKontextPresets.json")

def _manual_json_path():
    return os.path.join(_base_dir(), "OreXKontextPresetsManual.json")

# ========= Load JSON =========

def _load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default
    return default

def _load_config():
    return _load_json(_config_path(), {
        "start_instruction": "",
        "end_instruction": "",
        "presets": {}
    })

def _load_manual_presets():
    path = _manual_json_path()
    return _load_json(path, {"presets": {}}).get("presets", {})

def _load_manual_prompt_text():
    data = _load_manual_presets()
    lines = []
    for key, item in data.items():
        title = key.strip()
        comment = item.get("comment", "").strip()
        system = item.get("system", "").strip()
        if title:
            lines.append(title)
        if comment:
            lines.append(comment)
        if system:
            lines.append(system)
        lines.append("")  # пустая строка между блоками
    return "\n".join(lines).strip()

# ========= Main Node =========

class KontextPresetsOrex(object):
    NODE_COLOR = "#B8FF5A"
    WEB_COLOR = "#B8FF5A"

    @classmethod
    def INPUT_TYPES(cls):
        cfg = _load_config()
        preset_keys = list(cfg.get("presets", {}).keys()) or ["(no presets)"]
        manual_presets = list(_load_manual_presets().keys()) or ["(no manual presets)"]

        return {
            "required": {
                "start_instruction": ("STRING", {
                    "default": cfg.get("start_instruction", ""),
                    "multiline": True
                }),
                "manual_prompt": ("STRING", {
                    "default": "",
                    "multiline": True
                }),
                "image_description_enabled": ("BOOLEAN", {
                    "default": True,
                    "label_on": "Image description ON",
                    "label_off": "Image description OFF"
                }),
                "image_description": ("STRING", {
                    "forceInput": True,
                    "optional": True
                }),
                "Enable_Preset": ("BOOLEAN", {
                    "default": True,
                    "label_on": "ON",
                    "label_off": "OFF"
                }),
                "preset": (preset_keys, {
                    "default": preset_keys[0],
                }),
                "Manual_Preset": ("BOOLEAN", {
                    "default": False,
                    "label_on": "ON",
                    "label_off": "OFF"
                }),
                "manual_preset": (manual_presets, {
                    "default": manual_presets[0],
                }),
                "end_instruction": ("STRING", {
                    "default": cfg.get("end_instruction", ""),
                    "multiline": True
                }),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("text prompt", "manual prompt from file")
    FUNCTION = "build_prompt"
    CATEGORY = MY_CATEGORY

    def _resolve_preset_text(self, preset_name: str) -> str:
        cfg = _load_config()
        data = cfg.get("presets", {}).get(preset_name)
        return data.get("system", "") if data else ""

    def _resolve_manual_preset_text(self, preset_name: str) -> str:
        data = _load_manual_presets().get(preset_name)
        return data.get("system", "") if data else ""

    def _apply_image_substitution(self, text: str, image_desc: str, enabled: bool) -> str:
        if not text:
            return ""
        if "*image*" in text:
            if enabled and image_desc.strip():
                return text.replace("*image*", image_desc.strip())
        return text

    def build_prompt(self,
                     start_instruction: str,
                     manual_prompt: str,
                     image_description_enabled: bool,
                     image_description: str,
                     Enable_Preset: bool,
                     preset: str,
                     Manual_Preset: bool,
                     manual_preset: str,
                     end_instruction: str):

        parts = []

        if start_instruction.strip():
            parts.append(start_instruction.strip())

        manual_cleaned = self._apply_image_substitution(manual_prompt.strip(), image_description, image_description_enabled)
        if manual_cleaned:
            parts.append(manual_cleaned)

        if Enable_Preset:
            preset_text = self._resolve_preset_text(preset)
            substituted = self._apply_image_substitution(preset_text, image_description, image_description_enabled)
            if substituted.strip():
                parts.append(substituted.strip())

        if Manual_Preset:
            manual_text = self._resolve_manual_preset_text(manual_preset)
            substituted = self._apply_image_substitution(manual_text, image_description, image_description_enabled)
            if substituted.strip():
                parts.append(substituted.strip())

        if end_instruction.strip():
            parts.append(end_instruction.strip())

        final = " ".join(parts).strip()
        manual_text_file = _load_manual_prompt_text()
        return (final, manual_text_file)

    def is_changed(self,
                   start_instruction,
                   manual_prompt,
                   image_description_enabled,
                   image_description,
                   Enable_Preset,
                   preset,
                   Manual_Preset,
                   manual_preset,
                   end_instruction):
        hasher = hashlib.md5()
        u = lambda x: ("" if x is None else str(x)).encode("utf-8")

        cfg = _load_config()

        hasher.update(u(start_instruction))
        hasher.update(u(manual_prompt))
        hasher.update(u(image_description_enabled))
        hasher.update(u(image_description))
        hasher.update(u(Enable_Preset))
        hasher.update(u(preset))
        hasher.update(u(Manual_Preset))
        hasher.update(u(manual_preset))
        hasher.update(u(end_instruction))

        hasher.update(u(cfg.get("start_instruction", "")))
        hasher.update(u(cfg.get("end_instruction", "")))

        data = cfg.get("presets", {}).get(preset, {})
        hasher.update(u(data.get("system", "")))

        manual_data = _load_manual_presets().get(manual_preset, {})
        hasher.update(u(manual_data.get("system", "")))

        return hasher.hexdigest()

# ========= Register =========

NODE_CLASS_MAPPINGS = {
    "KontextPresetsOrex": KontextPresetsOrex,
    "flux-kontext-orexnodes": KontextPresetsOrex,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KontextPresetsOrex": "📆 Kontext Presets (OreX)",
    "flux-kontext-orexnodes": "Flux Kontext (OreXNodes)",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]