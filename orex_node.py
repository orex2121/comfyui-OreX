import requests
import base64
import io
from urllib.request import urlretrieve
from urllib.parse import urlparse
from PIL import Image, ImageSequence, ImageOps
import os
import time
import torch
import numpy as np
import folder_paths

class IoNet:
    def __init__(self):
        pass
    
    # Входные типы данных
    @classmethod
    def INPUT_TYPES(s):        
        return {

            # required - обязательные входные данные
            "required": {                               
                "API": ("STRING", {"default":"you api"}),

                # Список моделей
                "model_choice": (
                    [
                    "deepseek-ai/DeepSeek-R1", 
                    "Qwen/QwQ-32B",
                    "meta-llama/Llama-3.2-90B-Vision-Instruct",
                    "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
                    "meta-llama/Llama-3.3-70B-Instruct",
                    "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
                    "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
                    "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
                    "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
                    "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B",
                    "microsoft/phi-4",
                    "mistralai/Mistral-Large-Instruct-2411",
                    "neuralmagic/Llama-3.1-Nemotron-70B-Instruct-HF-FP8-dynamic",
                    "google/gemma-2-9b-it",
                    "nvidia/AceMath-7B-Instruct",
                    "CohereForAI/aya-expanse-32b",
                    "Qwen/Qwen2.5-Coder-32B-Instruct",
                    "THUDM/glm-4-9b-chat",
                    "CohereForAI/c4ai-command-r-plus-08-2024",
                    "tiiuae/Falcon3-10B-Instruct",
                    "NovaSky-AI/Sky-T1-32B",
                    "bespokelabs/Bespoke-Stratos-32B",
                    "netease-youdao/Confucius-o1-14B",
                    "Qwen/Qwen2.5-1.5B-Instruct",
                    "mistralai/Ministral-8B-Instruct-2410",
                    "openbmb/MiniCPM3-4B",
                    "jinaai/ReaderLM-v2",
                    "ibm-granite/granite-3.1-8b-instruct",
                    "microsoft/Phi-3.5-mini-instruct",
                    "ozone-ai/0x-lite",
                    "mixedbread-ai/mxbai-embed-large-v1"
                    ], 
                    {"default": "deepseek-ai/DeepSeek-R1"},
                ),
                
                "query": ("STRING", {"default":"Hello", "multiline": True}),
                "system_query": ("STRING", {"default":"You are a helpful assistant.", "multiline": True})
            },
        }
 
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
 
    # Указывает имя функции, которая будет выполняться узлом
    FUNCTION = "chat_function"
 
    # Если бы она была раскомментирована и установлена в True,
    # это означало бы, что узел является конечным узлом в графе ComfyUI и не имеет выходных данных
    #OUTPUT_NODE = False
 
    # Категория OreX и подкатегория LLM
    CATEGORY = "🤫OreX/LLM"
 
    # Определяет функцию test, которая будет выполняться узлом. 
    # self - это ссылка на экземпляр узла
    def chat_function(self, query, system_query, API, model_choice):        

        # Создаём запрос к ai.io.net и отправляем его
        url = "https://api.intelligence.io.solutions/api/v1/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + API
        }
        data = {
            "model": model_choice,
            "messages": [
                {
                    "role": "system",
                    "content": system_query
                },
                {
                    "role": "user",
                    "content": query
                }
            ]
        }
        response = requests.post(url, headers=headers, json=data)
        data = response.json()

        # Получаем нужную переменную с ответом из json файла
        modified_text = data['choices'][0]['message']['content']

        # Удаляем блок размышлений, если он присутствует
        if "</think>\n\n" in modified_text:
            modified_text = modified_text.split('</think>\n\n')[1]

        return (modified_text,)
 
#-----------------------------------------------------------------------------
class IoNetVisionUrl:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(s):        
        return {
            "required": {                               
                
                "API": ("STRING", {"default":"you api"}),
                # Список моделей
                "model_choice": (
                    ["meta-llama/Llama-3.2-90B-Vision-Instruct", "Qwen/Qwen2-VL-7B-Instruct"], 
                    {"default": "meta-llama/Llama-3.2-90B-Vision-Instruct"},
                ),
                "image_url": ("STRING", {"default":"https://avatars.mds.yandex.net/i?id=3848e688d775559261a72fa96ef0f511ffc38ff0-9181622-images-thumbs&n=13"}),
                "query": ("STRING", {"default":"Describe the image.", "multiline": True}),
                "system_query": ("STRING", {"default":"You are a helpful assistant.", "multiline": True})
            },
        }
 
    RETURN_TYPES = ("STRING", "IMAGE",)
    RETURN_NAMES = ("text", "image",)
 
    FUNCTION = "vision_url_function"

    CATEGORY = "🤫OreX/LLM"

    # Чат по запросу и изображения с url
    def vision_url_function(self, query, system_query, API, model_choice, image_url):
        # Load the image using load_image_url
        image_tensor = self.load_image_url(image_url)

        url = "https://api.intelligence.io.solutions/api/v1/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + API
        }

        data = {
            "model": model_choice,
            "messages": [
                {
                    "role": "system",
                    "content": system_query
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": query},
                        {"type": "image_url", "image_url": {"url": image_url}}
                    ]
                }
            ]
        }

        response = requests.post(url, headers=headers, json=data)
        data = response.json()

        # Получаем нужную переменную с ответом из json файла
        modified_text = data['choices'][0]['message']['content']

        # Удаляем блок размышлений, если он присутствует
        if "</think>\n\n" in modified_text:
            modified_text = modified_text.split('</think>\n\n')[1]

        try:
            print(response.json())  # Parse JSON response
        except requests.exceptions.JSONDecodeError:
            print("Error: Unable to parse response. Raw response:", response.text)

        return(modified_text, image_tensor)
    
    # Функция выводит изображение по url
    def load_image_url(self, image_url):
        now = int(time.time())
        u = urlparse(image_url)

        output_path = os.path.join("temp", "faceless")
        if not os.path.exists(output_path):
            os.makedirs(output_path)
        output_filename = os.path.join(output_path, f"{now}_{os.path.basename(u.path)}")
        urlretrieve(image_url, output_filename)

        img = Image.open(output_filename)
        images = []
        for i in ImageSequence.Iterator(img):
            i = ImageOps.exif_transpose(i)
            if i.mode == 'I':
                i = i.point(lambda i: i * (1 / 255))
            image = i.convert("RGB")
            image = np.array(image).astype(np.float32) / 255.0
            image = torch.from_numpy(image)[None,]
            images.append(image)
        if len(images) > 1:
            output_image = torch.cat(images, dim=0)
        else:
            output_image = images[0]
        return output_image
    
    #-----------------------------------------------------------------------------
class IoNetVision:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(s):        
        return {
            "required": {                               
                "base64": ("STRING", {"forceInput": True}),
                "API": ("STRING", {"default":"you api"}),
                # Список моделей
                "model_choice": (
                    ["meta-llama/Llama-3.2-90B-Vision-Instruct", "Qwen/Qwen2-VL-7B-Instruct"], 
                    {"default": "meta-llama/Llama-3.2-90B-Vision-Instruct"},
                ),
                "query": ("STRING", {"default":"Describe the image.", "multiline": True}),
                "system_query": ("STRING", {"default":"You are a helpful assistant.", "multiline": True})
            },
        }
 
    RETURN_TYPES = ("STRING", )
    RETURN_NAMES = ("text",)
 
    FUNCTION = "vision_function"

    CATEGORY = "🤫OreX/LLM"

    def vision_function(self, query, system_query, API, model_choice, base64):

        url = "https://api.intelligence.io.solutions/api/v1/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + API
        }

        data = {
            "model": model_choice,
            "messages": [
                {
                    "role": "system",
                    "content": system_query
                },
                {
                    "role": "user",
                    "content": [
                    {"type": "text", "text": query},
                    {"type": "image", "image": base64} 
                ]
                }
            ]
        }

        response = requests.post(url, headers=headers, json=data)
        data = response.json()

        # Получаем нужную переменную с ответом из json файла
        modified_text = data['choices'][0]['message']['content']

        # Удаляем блок размышлений, если он присутствует
        if "</think>\n\n" in modified_text:
            modified_text = modified_text.split('</think>\n\n')[1]

        try:
            print(response.json())  # Parse JSON response
        except requests.exceptions.JSONDecodeError:
            print("Error: Unable to parse response. Raw response:", response.text)

        return(modified_text,)
