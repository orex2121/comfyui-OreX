import os
import torch
import numpy as np
from PIL import Image, ImageOps
from collections import defaultdict
import folder_paths
from pathlib import Path

class OreXImageLoadBatch:
    def __init__(self):
        self.current_indices = defaultdict(int)
        self.image_paths_cache = {}
        # Кэш времени изменения (dir_mtime_cache) удален, так как мы фиксируем список файлов навсегда для каждого label

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
                
                # --- Красивый цветной переключатель ---
                "allow_rgba_output": ("BOOLEAN", {"default": False, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "filename", "folder_path", "number_of_files", "current_index")
    FUNCTION = "load_batch_images"
    CATEGORY = "🤫OreX/Image"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        if kwargs['mode'] == 'incremental_image':
            return float("NaN")
        return str(kwargs['seed'])

    def sanitize_path(self, path):
        """Очистка и обработка пути"""
        if not path:
            return folder_paths.get_input_directory()
        
        if not os.path.isabs(path):
            return os.path.join(folder_paths.get_input_directory(), path)
        
        return os.path.normpath(path)

    def load_images_from_path(self, path, pattern):
        """Загрузка изображений (без вложенных папок)"""
        allowed_extensions = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif', '.gif'}
        
        if pattern == '*':
            pattern = '*.*'
            
        p = Path(path)
        image_paths = []
        
        try:
            # Используем glob вместо rglob (Исключает поиск во вложенных папках)
            for file_path in p.glob(pattern):
                # Проверяем, что это файл, а не папка с именем, содержащим точку
                if file_path.is_file() and file_path.suffix.lower() in allowed_extensions:
                    image_paths.append(str(file_path.resolve()))
        except Exception as e:
            print(f"[OreX] Path search error: {str(e)}")
            return []
        
        return sorted(image_paths)

    def _load_and_process_image(self, image_path):
        """Вспомогательная функция для безопасной загрузки картинки"""
        try:
            with Image.open(image_path) as open_img:
                image = ImageOps.exif_transpose(open_img)
                image.load() # Выкачиваем в память
            filename = os.path.splitext(os.path.basename(image_path))[0]
            return image, filename
        except Exception as e:
            print(f"[OreX] Error loading image {image_path}: {str(e)}")
            return None, None

    def get_image_by_id(self, image_paths, index):
        if not image_paths or index < 0 or index >= len(image_paths):
            return None, None
        
        image_path = image_paths[index]
        if not os.path.exists(image_path):
            print(f"[OreX] ERROR: File vanished from disk: {image_path}")
            return None, None
            
        return self._load_and_process_image(image_path)

    def get_next_image(self, image_paths, label):
        if not image_paths:
            return None, None, 0
        
        current_index = self.current_indices[label] % len(image_paths)
        
        attempts = 0
        image_path = image_paths[current_index]
        
        # Защита от зависания, если удалена часть файлов
        while not os.path.exists(image_path) and attempts < len(image_paths):
            print(f"[OreX] File missed: {image_path}. Trying next index.")
            current_index = (current_index + 1) % len(image_paths)
            image_path = image_paths[current_index]
            attempts += 1
            
        if not os.path.exists(image_path):
            return None, None, current_index
        
        image, filename = self._load_and_process_image(image_path)
        
        # Обновляем индекс для следующего вызова
        self.current_indices[label] = (current_index + 1) % len(image_paths)
        
        return image, filename, current_index

    def pil2tensor(self, image):
        """Конвертация (Стандарт ComfyUI)"""
        image_np = np.array(image).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_np)
        if len(image_tensor.shape) == 3: # H, W, C
            image_tensor = image_tensor.unsqueeze(0) # 1, H, W, C
        return image_tensor

    def load_batch_images(self, folder_path, file_pattern, start_index, seed, mode, label, allow_rgba_output):
        processed_path = self.sanitize_path(folder_path)
        
        if not os.path.exists(processed_path):
            print(f"[OreX] Path does not exist: {processed_path}")
            return (torch.zeros((1, 64, 64, 3)), "", processed_path, 0, 0) # Безопасный возврат пустого тензора
        
        # Кэш теперь жестко привязан к label (названию батча).
        cache_key = f"{processed_path}_{file_pattern}_{label}"
        
        # Инвалидация кэша по изменению папки (mtime) УБРАНА.
        # Если списка для этого label еще нет в памяти, мы формируем его ТОЛЬКО ОДИН РАЗ.
        # Это полностью защищает от подхватывания новых файлов во время работы очереди ("снежного кома").
        if cache_key not in self.image_paths_cache:
            self.image_paths_cache[cache_key] = self.load_images_from_path(processed_path, file_pattern)
            print(f"[OreX] Locked batch '{label}': loaded {len(self.image_paths_cache[cache_key])} starting images.")
        
        image_paths = self.image_paths_cache[cache_key]
        total_count = len(image_paths)
        
        if total_count == 0:
            print(f"[OreX] No valid images found in path: {processed_path}")
            return (torch.zeros((1, 64, 64, 3)), "", processed_path, 0, 0)
        
        if start_index >= total_count:
            start_index = 0
            print(f"[OreX] Warning: start_index out of range. Reset to 0.")
        
        if mode == "single_image":
            image, filename = self.get_image_by_id(image_paths, start_index)
            current_index = start_index
        elif mode == "incremental_image":
            if label not in self.current_indices:
                self.current_indices[label] = start_index
            image, filename, current_index = self.get_next_image(image_paths, label)
        else:
            return (torch.zeros((1, 64, 64, 3)), "", processed_path, total_count, 0)
        
        if image is None:
            return (torch.zeros((1, 64, 64, 3)), "", processed_path, total_count, current_index)
        
        # ГАРАНТИЯ КОНСИСТЕНТНОСТИ КАНАЛОВ (Крайне важно для ComfyUI)
        if allow_rgba_output:
            if image.mode != 'RGBA':
                image = image.convert('RGBA')
        else:
            if image.mode != 'RGB':
                image = image.convert('RGB')
        
        image_tensor = self.pil2tensor(image)
        return (image_tensor, filename, processed_path, total_count, current_index)

NODE_CLASS_MAPPINGS = {
    "OreX Image Load Batch": OreXImageLoadBatch
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "OreX Image Load Batch": "🖼️ OreX Image Load Batch"
}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']