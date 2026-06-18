import os
import torch
import numpy as np
from PIL import Image, ImageOps
import fnmatch
import re

# Функция для естественной сортировки (1, 2, 10, а не 1, 10, 2)
def natural_sort_key(s):
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s)]

class OreXImageLoadBatchSize:
    def __init__(self):
        # Инициализируем кэш для фиксации списка файлов
        self.file_list_cache = {}

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder_path": ("STRING", {"default": "", "placeholder": "Путь к папке"}),
                "file_pattern": ("STRING", {"default": "*", "placeholder": "Шаблон имен (например *upscale*.png)"}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 1000}),
                "start_index": ("INT", {"default": 0, "min": 0}),
                "label": ("STRING", {"default": "BatchSize 001"}), # Добавлен label для заморозки сессии
                
                # Убраны label_on и label_off, так как базовый парсер ComfyUI может из-за них упасть
                "file_name_without_extension": ("BOOLEAN", {"default": True}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff})
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "INT")
    RETURN_NAMES = ("image", "filename", "folder_path", "number_of_files")
    FUNCTION = "load_batch"
    OUTPUT_NODE = True
    OUTPUT_IS_LIST = (True, True, False, False)
    CATEGORY = "🤫OreX/Image"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Заставляем узел обновляться при смене сида
        return str(kwargs.get('seed', 0))

    # Добавлен параметр label и **kwargs чтобы поглотить seed и скрытые системные параметры, если они прилетят
    def load_batch(self, folder_path, file_pattern, batch_size, start_index, label, file_name_without_extension, **kwargs):
        
        # Функция-помощник для возврата пустого результата, чтобы не дублировать код
        def empty_result():
            empty_tensor = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return ([empty_tensor], [""], folder_path if folder_path else "", 0)

        # Безопасная проверка существования директории
        if not folder_path or not os.path.isdir(folder_path):
            print(f"[OreX Batch] Предупреждение: Папка не найдена или путь пуст: '{folder_path}'")
            return empty_result()

        # Уникальный ключ для кэша, чтобы заморозить список файлов для этой сессии
        cache_key = f"{folder_path}_{file_pattern}_{label}"

        # Если списка для этого label еще нет, формируем его один раз
        if cache_key not in self.file_list_cache:
            image_extensions = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'} # Использование множества (set) быстрее для поиска
            
            try:
                # os.listdir по умолчанию НЕ читает вложенные папки
                all_files = os.listdir(folder_path)
                # Фильтрация файлов
                valid_files = [
                    f for f in all_files
                    if (os.path.splitext(f)[1].lower() in image_extensions and 
                        fnmatch.fnmatch(f.lower(), file_pattern.lower()))
                ]
                # ЕСТЕСТВЕННАЯ сортировка (исправляет баг, когда 10.png идет перед 2.png)
                file_list = sorted(valid_files, key=natural_sort_key)
                
                # Замораживаем список
                self.file_list_cache[cache_key] = file_list
                print(f"[OreX Batch] Locked batch '{label}': loaded {len(file_list)} starting images.")
                
            except Exception as e:
                print(f"[OreX Batch] Ошибка чтения папки: {str(e)}")
                return empty_result()

        # Берем замороженный список файлов
        file_list = self.file_list_cache[cache_key]
        total_files = len(file_list)
        
        if total_files == 0:
            print(f"[OreX Batch] В папке не найдено подходящих изображений по шаблону: {file_pattern}")
            return empty_result()
        
        if start_index >= total_files:
            start_index = max(0, total_files - 1)
        
        end_index = min(start_index + batch_size, total_files)
        selected_files = file_list[start_index:end_index]

        images = []
        filenames = []
        
        for filename in selected_files:
            file_path = os.path.join(folder_path, filename)
            if not os.path.exists(file_path):
                print(f"[OreX Batch] Предупреждение: Файл пропал с диска: {file_path}")
                continue
                
            try:
                # Безопасное чтение PIL без утечек дескрипторов файлов
                with Image.open(file_path) as open_img:
                    img = ImageOps.exif_transpose(open_img).convert("RGB")
                    # Нет необходимости вызывать img.load() внутри with, 
                    # так как мы сразу конвертируем его в numpy массив ниже.
                
                img_array = np.array(img).astype(np.float32) / 255.0
                img_tensor = torch.from_numpy(img_array).unsqueeze(0)
                
                images.append(img_tensor)
                name = os.path.splitext(filename)[0] if file_name_without_extension else filename
                filenames.append(name)

            except Exception as e:
                print(f"[OreX Batch Error] Ошибка загрузки {filename}: {str(e)}")

        if not images:
            return empty_result()

        # Возвращаем списки, так как OUTPUT_IS_LIST = (True, True, ...)
        return (images, filenames, folder_path, total_files)

NODE_CLASS_MAPPINGS = {
    "orex Load Image Batch Size": OreXImageLoadBatchSize
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex Load Image Batch Size": "📦 Load Image Batch Size (OreX)"
}