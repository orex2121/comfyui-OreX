import os
import torch
import numpy as np
from PIL import Image, ImageOps
import folder_paths
import fnmatch

class OreXImageLoadBatchSize:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder_path": ("STRING", {"default": "", "placeholder": "Путь к папке"}),
                "file_pattern": ("STRING", {"default": "*", "placeholder": "Шаблон имен (например *upscale*.png)"}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 1000}),
                "start_index": ("INT", {"default": 0, "min": 0}),
                
                # --- Красивый цветной переключатель ---
                "file_name_without_extension": ("BOOLEAN", {"default": True, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff})
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "INT")
    RETURN_NAMES = ("image", "filename", "folder_path", "number_of_files")
    FUNCTION = "load_batch"
    OUTPUT_NODE = True
    OUTPUT_IS_LIST = (True, True, False, False)
    CATEGORY = "🤫OreX/Image"

    def load_batch(self, folder_path, file_pattern, batch_size, start_index, file_name_without_extension, seed):
        # Безопасная проверка существования директории без аварийной остановки графа
        if not folder_path or not os.path.isdir(folder_path):
            print(f"[OreX Batch] Предупреждение: Папка не найдена или путь пуст: '{folder_path}'")
            empty_tensor = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return ([empty_tensor], [""], folder_path, 0)

        image_extensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif']
        try:
            all_files = os.listdir(folder_path)
            file_list = sorted([
                f for f in all_files
                if (os.path.splitext(f)[1].lower() in image_extensions and 
                    fnmatch.fnmatch(f.lower(), file_pattern.lower()))
            ])
        except Exception as e:
            print(f"[OreX Batch] Ошибка чтения папки: {str(e)}")
            empty_tensor = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return ([empty_tensor], [""], folder_path, 0)

        total_files = len(file_list)
        if total_files == 0:
            print(f"[OreX Batch] В папке не найдено подходящих изображений по шаблону: {file_pattern}")
            empty_tensor = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return ([empty_tensor], [""], folder_path, 0)
        
        if start_index >= total_files:
            start_index = max(0, total_files - 1)
        
        end_index = min(start_index + batch_size, total_files)
        selected_files = file_list[start_index:end_index]

        images = []
        filenames = []
        
        for filename in selected_files:
            file_path = os.path.join(folder_path, filename)
            if not os.path.exists(file_path):
                continue
                
            try:
                # Безопасное чтение PIL без утечек дескрипторов файлов
                with Image.open(file_path) as open_img:
                    img = ImageOps.exif_transpose(open_img).convert("RGB")
                    img.load()
                
                img_array = np.array(img).astype(np.float32) / 255.0
                img_tensor = torch.from_numpy(img_array).unsqueeze(0)
                
                images.append(img_tensor)
                name = os.path.splitext(filename)[0] if file_name_without_extension else filename
                filenames.append(name)

            except Exception as e:
                print(f"[OreX Batch Error] Ошибка загрузки {filename}: {str(e)}")

        if not images:
            empty_tensor = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return ([empty_tensor], [""], folder_path, 0)

        return (images, filenames, folder_path, total_count if 'total_count' in locals() else total_files)

NODE_CLASS_MAPPINGS = {
    "orex Load Image Batch Size": OreXImageLoadBatchSize
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex Load Image Batch Size": "📦 Load Image Batch Size (OreX)"
}

__all__ = ['NODE_CLASS_MAPPINGS']