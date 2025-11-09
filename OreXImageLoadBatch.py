import os
import glob
import json
import numpy as np
import torch
from PIL import Image, ImageOps
from collections import defaultdict
import folder_paths
from datetime import datetime

class OreXImageLoadBatch:
    def __init__(self):
        self.current_indices = defaultdict(int)
        self.image_paths_cache = {}

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode": (["single_image", "incremental_image"], {"default": "incremental_image"}),
                "folder_path": ("STRING", {"default": ""}),
                "file_pattern": ("STRING", {"default": "*"}),
                "start_index": ("INT", {"default": 0, "min": 0, "max": 150000, "step": 1}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
                "label": ("STRING", {"default": "Batch 001"}),
                "allow_rgba_output": ("BOOLEAN", {"default": False, "label_on": "Yes", "label_off": "No"}),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "filename", "folder_path", "number_of_files", "current_index")
    FUNCTION = "load_batch_images"
    CATEGORY = "🤫OreX/Image"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Для incremental_image — всегда возвращаем NaN, чтобы не кэшировать
        if kwargs['mode'] == 'incremental_image':
            return float("NaN")
        # Для single_image — возвращаем seed
        return str(kwargs['seed'])

    def sanitize_path(self, path):
        """Очистка и обработка пути"""
        if not path:
            return folder_paths.get_input_directory()
        
        # Если путь относительный, объединяем с директорией ввода
        if not os.path.isabs(path):
            return os.path.join(folder_paths.get_input_directory(), path)
        
        return path

    def load_images_from_path(self, path, pattern):
        """Загрузка изображений из указанного пути"""
        allowed_extensions = ('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif', '.gif')
        
        if pattern == '*':
            pattern = '*.*'
        
        image_paths = []
        search_pattern = os.path.join(glob.escape(path), pattern)
        
        for file_path in glob.glob(search_pattern, recursive=True):
            if file_path.lower().endswith(allowed_extensions):
                abs_path = os.path.abspath(file_path)
                image_paths.append(abs_path)
        
        return sorted(image_paths)

    def get_image_by_id(self, image_paths, index):
        """Получение изображения по индексу"""
        if not image_paths or index < 0 or index >= len(image_paths):
            return None, None
        
        try:
            image_path = image_paths[index]
            image = Image.open(image_path)
            image = ImageOps.exif_transpose(image)
            filename = os.path.splitext(os.path.basename(image_path))[0]  # Без расширения
            return image, filename
        except Exception as e:
            print(f"[OreX] Error loading image {image_paths[index]}: {str(e)}")
            return None, None

    def get_next_image(self, image_paths, label):
        """Получение следующего изображения в режиме инкремента"""
        if not image_paths:
            return None, None, 0
        
        current_index = self.current_indices[label]
        
        if current_index >= len(image_paths):
            current_index = 0
        
        try:
            image_path = image_paths[current_index]
            image = Image.open(image_path)
            image = ImageOps.exif_transpose(image)
            filename = os.path.splitext(os.path.basename(image_path))[0]  # Без расширения
            
            # Увеличиваем счетчик для следующего вызова
            next_index = current_index + 1
            if next_index >= len(image_paths):
                next_index = 0
            self.current_indices[label] = next_index
            
            # Возвращаем текущий индекс (не следующий)
            return image, filename, current_index
        except Exception as e:
            print(f"[OreX] Error loading next image {image_paths[current_index]}: {str(e)}")
            return None, None, current_index

    def pil2tensor(self, image):
        """Конвертация PIL изображения в torch.Tensor"""
        image_np = np.array(image).astype(np.float32) / 255.0
        if len(image_np.shape) == 3:
            image_tensor = np.expand_dims(image_np, axis=0)
        else:
            image_tensor = image_np
        return torch.from_numpy(image_tensor)

    def load_batch_images(self, folder_path, file_pattern, start_index, seed, mode, label, allow_rgba_output):
        # Обработка пути
        processed_path = self.sanitize_path(folder_path)
        
        if not os.path.exists(processed_path):
            print(f"[OreX] Path does not exist: {processed_path}")
            return (None, "", processed_path, 0, 0)
        
        # Загрузка изображений
        cache_key = f"{processed_path}_{file_pattern}"
        if cache_key not in self.image_paths_cache:
            self.image_paths_cache[cache_key] = self.load_images_from_path(processed_path, file_pattern)
        
        image_paths = self.image_paths_cache[cache_key]
        total_count = len(image_paths)
        
        if not image_paths:
            print(f"[OreX] No valid images found in path: {processed_path} with pattern: {file_pattern}")
            return (None, "", processed_path, 0, 0)
        
        # Проверяем, что start_index не превышает количество файлов
        if start_index >= total_count:
            start_index = 0
            print(f"[OreX] Warning: start_index is out of range. Reset to 0.")
        
        # Загрузка изображения в зависимости от режима
        if mode == "single_image":
            image, filename = self.get_image_by_id(image_paths, start_index)
            current_index = start_index
        elif mode == "incremental_image":
            # Устанавливаем индекс на start_index при первом вызове
            if label not in self.current_indices:
                self.current_indices[label] = start_index
            image, filename, current_index = self.get_next_image(image_paths, label)
        else:
            print(f"[OreX] Invalid mode: {mode}")
            return (None, "", processed_path, 0, 0)
        
        if image is None:
            print(f"[OreX] Failed to load image in mode: {mode}")
            return (None, "", processed_path, 0, 0)
        
        # Обработка RGBA
        if not allow_rgba_output and image.mode in ('RGBA', 'LA'):
            image = image.convert('RGB')
        
        # Конвертация в torch.Tensor
        image_tensor = self.pil2tensor(image)
        
        return (image_tensor, filename, processed_path, total_count, current_index)


NODE_CLASS_MAPPINGS = {
    "OreX Image Load Batch": OreXImageLoadBatch
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "OreX Image Load Batch": "🖼️ OreX Image Load Batch"
}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']