import requests
import base64
import io
import torch
import numpy as np
from PIL import Image

class IoNetVision:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "API": ("STRING", {"default": "your_api_key"}),
                "model_choice": (
                    ["meta-llama/Llama-3.2-90B-Vision-Instruct", "Qwen/Qwen2-VL-7B-Instruct"],
                    {"default": "meta-llama/Llama-3.2-90B-Vision-Instruct"},
                ),
                "image": ("IMAGE",),
                "query": ("STRING", {"default": "Describe the image.", "multiline": True}),
                "system_query": ("STRING", {"default": "You are a helpful assistant.", "multiline": True})
            },
        }

    RETURN_TYPES = ("STRING", "IMAGE",)
    RETURN_NAMES = ("text", "image",)
    FUNCTION = "process"
    CATEGORY = "🤫OreX/LLM"

    def process(self, API, model_choice, image, query, system_query):
        try:
            i = 255. * image[0].cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
            
            buffered = io.BytesIO()
            img.save(buffered, format="PNG")
            base64_image = base64.b64encode(buffered.getvalue()).decode('utf-8')

            response = requests.post(
                "https://api.intelligence.io.solutions/api/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {API}"
                },
                json={
                    "model": model_choice,
                    "messages": [
                        {"role": "system", "content": system_query},
                        {"role": "user", "content": [
                            {"type": "text", "text": query},
                            {"type": "image_url", "image_url": {
                                "url": f"data:image/png;base64,{base64_image}"
                            }}
                        ]}
                    ]
                }
            )
            response.raise_for_status()
            data = response.json()
            text = data['choices'][0]['message']['content']
            if "</think>\n\n" in text:
                text = text.split('</think>\n\n')[1]
            return (text, image)
            
        except Exception as e:
            return (f"Error: {str(e)}", image)

NODE_CLASS_MAPPINGS = {
    "IoNetVision": IoNetVision
}

__all__ = ['NODE_CLASS_MAPPINGS']