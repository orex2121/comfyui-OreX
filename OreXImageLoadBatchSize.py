import os
import torch
import numpy as np
from PIL import Image
import folder_paths
import fnmatch

class OreXImageLoadBatchSize:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder_path": ("STRING", {"default": "", "placeholder": "Путь к папке"}),
                "file_pattern": ("STRING", {"default": "*", "placeholder": "Шаблон имен (например *upscale*.png)"}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 1000}),  # Переименовано batch_count → batch_size
                "start_index": ("INT", {"default": 0, "min": 0}),
                "file_name_without_extension": ("BOOLEAN", {"default": True, "label_on": "Yes", "label_off": "No"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff})
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "INT")
    RETURN_NAMES = ("image", "filename", "folder_path", "number_of_files")
    FUNCTION = "load_batch"
    OUTPUT_NODE = True
    OUTPUT_IS_LIST = (True, True, False, False)
    CATEGORY = "🤫OreX/Image"

    def load_batch(self, folder_path, file_pattern, batch_size, start_index, file_name_without_extension, seed):  # Аргумент переименован
        if not os.path.isdir(folder_path):
            raise ValueError(f"Папка не найдена: {folder_path}")

        image_extensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp']
        try:
            all_files = os.listdir(folder_path)
            file_list = sorted([
                f for f in all_files
                if (os.path.splitext(f)[1].lower() in image_extensions and 
                    fnmatch.fnmatch(f.lower(), file_pattern.lower()))
            ])
        except Exception as e:
            raise ValueError(f"Ошибка чтения папки: {str(e)}")

        total_files = len(file_list)
        
        if start_index >= total_files:
            start_index = max(0, total_files - 1)
        
        end_index = min(start_index + batch_size, total_files)  # Используем batch_size
        selected_files = file_list[start_index:end_index]

        images = []
        filenames = []
        
        for filename in selected_files:
            try:
                file_path = os.path.join(folder_path, filename)
                img = Image.open(file_path).convert("RGB")
                
                img_array = np.array(img).astype(np.float32) / 255.0
                img_tensor = torch.from_numpy(img_array).unsqueeze(0)
                
                images.append(img_tensor)
                name = os.path.splitext(filename)[0] if file_name_without_extension else filename
                filenames.append(name)

            except Exception as e:
                print(f"[OreX Batch Error] Ошибка загрузки {filename}: {str(e)}")

        if not images:
            empty_tensor = torch.zeros((0, 512, 512, 3))
            return ([empty_tensor], [""], folder_path, 0)

        return (images, filenames, folder_path, len(images))

NODE_CLASS_MAPPINGS = {
    "orex Load Image Batch Size": OreXImageLoadBatchSize  # Обновленное имя
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex Load Image Batch Size": "📦 Load Image Batch Size (OreX)"  # Обновленное имя
}

__all__ = ['NODE_CLASS_MAPPINGS']