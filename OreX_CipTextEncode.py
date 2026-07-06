from nodes import CLIPTextEncode

# === ОБХОД ВАЛИДАЦИИ COMFYUI ===
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

class OreX_CipTextEncode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "dynamicPrompts": True, "tooltip": "Main prompt text."}),
                "clip": ("CLIP", {"tooltip": "The CLIP model used for encoding the text."}),
            },
            "optional": FlexibleOptionalInputType()
        }

    RETURN_TYPES = ("CONDITIONING", "STRING")
    RETURN_NAMES = ("CONDITIONING", "PROMPT")
    FUNCTION = "encode"
    CATEGORY = "🤫OreX/Conditioning"

    def encode(self, clip, text, **kwargs):
        dynamic_strings = []
        
        string_keys = [k for k in kwargs.keys() if k.startswith("string")]
        string_keys.sort(key=lambda x: int(x.replace("string", "")) if x.replace("string", "").isdigit() else 999)
        
        for key in string_keys:
            val = kwargs.get(key)
            if val and isinstance(val, str) and val.strip() != "":
                dynamic_strings.append(val.strip())

        if dynamic_strings:
            final_prompt = ", ".join(dynamic_strings + [text.strip()])
        else:
            final_prompt = text

        cond, = CLIPTextEncode().encode(clip, final_prompt)
        
        return (cond, final_prompt)

NODE_CLASS_MAPPINGS = {
    "orex Cip Text Encode": OreX_CipTextEncode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex Cip Text Encode": "CLIP Text Encode (OreX)"
}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']