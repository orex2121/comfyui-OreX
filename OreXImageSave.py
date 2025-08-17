import os
import json
import numpy as np
import re
from datetime import datetime
from PIL import Image
from PIL.PngImagePlugin import PngInfo
import folder_paths
from collections import defaultdict

class OreXImageSave:
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self.counters = defaultdict(int)
        self.empty_name_counter = 1
        self.counter_digits = 4
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "output_path": ("STRING", {"default": ""}),
                "create_processed_folder": ("BOOLEAN", {"default": False, "label_on": "Yes", "label_off": "No"}),
                "create_current_date_folder": ("BOOLEAN", {"default": True, "label_on": "Yes", "label_off": "No"}),
                "images": ("IMAGE",),
                "filename_prefix_1": ("STRING", {"default": "Image"}),
                "filename_prefix_2": ("STRING", {"default": ""}),
                "filename_prefix_3": ("STRING", {"default": ""}),
                "filename_separator": ("STRING", {"default": "_"}),
                "embed_workflow": ("BOOLEAN", {"default": True, "label_on": "Yes", "label_off": "No"}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "saved_path")
    FUNCTION = "save_image"
    OUTPUT_NODE = True
    CATEGORY = "🤫OreX/Image"

    def sanitize_path_segment(self, segment):
        """Очистка сегментов пути без создания подчеркиваний"""
        if not segment:
            return None
            
        # Удаляем все недопустимые символы (включая подчеркивания)
        segment = re.sub(r'[^а-яА-ЯёЁa-zA-Z0-9\-\. ]', '', segment)
        segment = segment.strip()
        
        # Игнорируем сегменты, которые стали пустыми или содержат только точки/дефисы
        if not segment or all(c in '.-' for c in segment):
            return None
            
        return segment

    def process_output_path(self, path):
        """Обработка пути с полным удалением недопустимых сегментов"""
        try:
            # Применяем шаблоны даты
            dated_path = datetime.now().strftime(path)
            
            # Для абсолютных путей
            if os.path.isabs(dated_path):
                drive, rest = os.path.splitdrive(dated_path)
                parts = [p for p in rest.split(os.sep) if p]
                
                # Очищаем и фильтруем сегменты
                clean_parts = []
                for part in parts:
                    cleaned = self.sanitize_path_segment(part)
                    if cleaned:
                        clean_parts.append(cleaned)
                
                # Собираем путь, сохраняя структуру
                if clean_parts:
                    return os.path.normpath(drive + os.sep + os.path.join(*clean_parts))
                return None
                
            # Для относительных путей
            else:
                clean_path = []
                for seg in dated_path.replace('/', '\\').split('\\'):
                    clean_seg = self.sanitize_path_segment(seg)
                    if clean_seg:
                        clean_path.append(clean_seg)
                
                if clean_path:
                    return os.path.normpath(os.path.join(self.output_dir, *clean_path))
                return None
                
        except Exception as e:
            print(f"[OreX] Path processing error: {str(e)}")
            return None

    def get_available_filename(self, base_path, base_name, extension, is_empty_name=False):
        if is_empty_name:
            counter = self.empty_name_counter
            self.empty_name_counter += 1
            filename = f"{self.filename_separator}{counter:0{self.counter_digits}d}.{extension}"
            return os.path.join(base_path, filename), counter
        else:
            counter_key = os.path.basename(base_name)
            if counter_key in self.counters:
                self.counters[counter_key] += 1
            else:
                existing_files = [f for f in os.listdir(base_path) 
                               if f.startswith(os.path.basename(base_name))]
                last_num = max([int(f.split('_')[-1].split('.')[0]) for f in existing_files 
                             if f.split('_')[-1].split('.')[0].isdigit()], default=0)
                self.counters[counter_key] = last_num + 1
            
            filename = f"{base_name}{self.filename_separator}{self.counters[counter_key]:0{self.counter_digits}d}.{extension}"
            return os.path.join(base_path, filename), self.counters[counter_key]

    def save_image(self, output_path, create_processed_folder, create_current_date_folder, images, 
                 filename_prefix_1, filename_prefix_2, filename_prefix_3, filename_separator, 
                 embed_workflow, prompt=None, extra_pnginfo=None, unique_id=None):
        
        self.filename_separator = filename_separator
        full_paths = []
        
        # Обработка пути назначения
        processed_path = self.process_output_path(output_path) if output_path else self.output_dir
        
        if not processed_path:
            print("[OreX] Invalid path specified, using default output directory")
            processed_path = self.output_dir
        
        # Создаем структуру каталогов
        try:
            if create_processed_folder:
                processed_path = os.path.join(processed_path, "Processed")
            
            if create_current_date_folder:
                current_date = datetime.now().strftime("%Y-%m-%d")
                save_dir = os.path.join(processed_path, current_date)
            else:
                save_dir = processed_path
            
            os.makedirs(save_dir, exist_ok=True)
                
        except Exception as e:
            print(f"[OreX] Directory creation failed: {str(e)}")
            save_dir = self.output_dir

        # Сохранение изображений
        for image in images:
            try:
                is_empty_name = not (filename_prefix_1 or filename_prefix_2 or filename_prefix_3)
                
                if is_empty_name:
                    base_filename = ""
                    filepath, _ = self.get_available_filename(save_dir, base_filename, "png", is_empty_name=True)
                else:
                    filename_parts = [p for p in [filename_prefix_1, filename_prefix_2, filename_prefix_3] if p]
                    base_filename = filename_separator.join(filename_parts)
                    filepath, _ = self.get_available_filename(save_dir, base_filename, "png")

                # Конвертация и сохранение изображения
                img_array = np.clip(255. * image.cpu().numpy(), 0, 255).astype(np.uint8)
                img = Image.fromarray(img_array)
                
                if embed_workflow:
                    metadata = PngInfo()
                    if prompt: metadata.add_text("prompt", json.dumps(prompt))
                    if extra_pnginfo: 
                        for x in extra_pnginfo:
                            metadata.add_text(x, json.dumps(extra_pnginfo[x]))
                    img.save(filepath, pnginfo=metadata, compress_level=4)
                else:
                    img.save(filepath, compress_level=4)

                full_paths.append(filepath)

            except Exception as e:
                print(f"[OreX] Image save failed: {str(e)}")
                full_paths.append("")

        return (images, full_paths[0] if full_paths else "")

NODE_CLASS_MAPPINGS = {
    "OreX Image Save": OreXImageSave
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "OreX Image Save": "💾 OreX Image Save"
}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']