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

    # Forbidden characters for Windows file/folder names
    WINDOWS_FORBIDDEN = set('<>:"/\\|?*')
    MAX_PATH_LEN = 260

    # ----------------------------
    #  Проверка отдельного сегмента (имени папки/файла)
    # ----------------------------
    def is_valid_path_segment(self, segment: str) -> (bool, str):
        """
        Проверяет, что сегмент пути (имя папки/файла) валиден для Windows.
        Возвращает (True, "OK") или (False, "Причина").
        """
        if segment is None:
            return False, "Пустой сегмент"

        if segment == "":
            return False, "Пустой сегмент (дублирование слэшей)"

        # Нельзя, чтобы сегмент оканчивался пробелом или точкой
        if segment.endswith(" ") or segment.endswith("."):
            return False, f"Сегмент не должен заканчиваться пробелом или точкой: '{segment}'"

        # Нельзя содержать запрещённые символы
        for ch in segment:
            if ch in self.WINDOWS_FORBIDDEN:
                return False, f"Недопустимый символ '{ch}' в сегменте '{segment}'"

        # Также избегаем зарезервированных имён как "CON", "PRN" и т.д.
        # (обработка регистронезависимая)
        reserved = {"CON","PRN","AUX","NUL"}
        reserved.update({f"COM{i}" for i in range(1,10)})
        reserved.update({f"LPT{i}" for i in range(1,10)})
        if segment.upper() in reserved:
            return False, f"Зарезервированное имя: '{segment}'"

        return True, "OK"

    # ----------------------------
    #  Проверка полного пути Windows
    # ----------------------------
    def validate_windows_path(self, full_path: str) -> (bool, str):
        """
        Проверяет полный путь (после нормализации).
        Возвращает (True, "OK") или (False, "Причина").
        """
        if not full_path:
            return False, "Путь пустой"

        # Нормализуем путь (убираем лишние слеши, точки и т.д.)
        norm = os.path.normpath(full_path)

        # Проверка длины
        if len(norm) > self.MAX_PATH_LEN:
            return False, f"Полный путь слишком длинный ({len(norm)} > {self.MAX_PATH_LEN})"

        # Проверим абсолютный путь вида "C:\..."
        drive, rest = os.path.splitdrive(norm)
        if not drive:
            return False, "Путь должен быть абсолютным (например, C:\\...)"
        if not re.match(r'^[A-Za-z]:$', drive):
            return False, f"Неверный диск/драйв: '{drive}'"

        # Разбиваем сегменты после диска
        # rest может начинаться с разделителя, уберём ведущий slash перед split
        rest = rest.lstrip(os.sep)
        parts = rest.split(os.sep) if rest else []

        for part in parts:
            valid, msg = self.is_valid_path_segment(part)
            if not valid:
                return False, msg

        return True, "OK"

    # ----------------------------
    #  Обработка входного пути (без агрессивной очистки)
    # ----------------------------
    def process_output_path(self, path):
        """
        Нормализует путь, подставляет output_dir для относительных путей,
        и валидирует его. НЕ удаляет символы внутри сегментов.
        Возвращает нормализованный абсолютный путь или None, если путь неверный.
        """
        try:
            # Поддержка шаблонов даты/strftime — если пользователь использует %Y и т.п.
            try:
                dated_path = datetime.now().strftime(path)
            except Exception:
                # Если форматирование упало — используем исходную строку
                dated_path = path

            if not dated_path:
                return None

            # Заменяем / на os.sep для нормализации
            dated_path = dated_path.replace("/", os.sep).replace("\\", os.sep)

            # Если путь абсолютный (с диском)
            if os.path.isabs(dated_path):
                norm = os.path.normpath(dated_path)

                # Валидируем
                valid, msg = self.validate_windows_path(norm)
                if not valid:
                    print(f"[OreX] Invalid output path: {msg}. Path: '{path}' -> normalized: '{norm}'")
                    return None

                return norm

            # Относительный путь — приклеиваем к output_dir
            else:
                combined = os.path.normpath(os.path.join(self.output_dir, dated_path))

                valid, msg = self.validate_windows_path(combined)
                if not valid:
                    print(f"[OreX] Invalid combined output path: {msg}. Combined: '{combined}'")
                    return None

                return combined

        except Exception as e:
            print(f"[OreX] Path processing error: {str(e)}")
            return None

    # ----------------------------
    #  Вспомогательная логика для имен файлов
    # ----------------------------
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
                # если каталог ещё не создан — existing_files будет пуст
                try:
                    existing_files = [f for f in os.listdir(base_path) 
                                   if f.startswith(os.path.basename(base_name))]
                except FileNotFoundError:
                    existing_files = []
                last_num = max([int(f.split(self.filename_separator)[-1].split('.')[0]) for f in existing_files
                             if f.split(self.filename_separator)[-1].split('.')[0].isdigit()], default=0)
                self.counters[counter_key] = last_num + 1
            
            filename = f"{base_name}{self.filename_separator}{self.counters[counter_key]:0{self.counter_digits}d}.{extension}"
            return os.path.join(base_path, filename), self.counters[counter_key]

    # ----------------------------
    #  Основная функция сохранения (без изменения логики остального)
    # ----------------------------
    def save_image(self, output_path, create_processed_folder, create_current_date_folder, images, 
                 filename_prefix_1, filename_prefix_2, filename_prefix_3, filename_separator, 
                 embed_workflow, prompt=None, extra_pnginfo=None, unique_id=None):
        
        self.filename_separator = filename_separator
        full_paths = []
        
        # Обработка пути назначения
        if output_path:
            processed_path = self.process_output_path(output_path)
            if not processed_path:
                # По договорённости: при некорректном пути — НЕ сохраняем и возвращаем пустой путь
                print("[OreX] Invalid output path specified — saving cancelled.")
                return (images, "")
        else:
            # Если путь не задан — используем дефолтную директорию
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
            # При ошибке создания папки — не продолжаем молча; возвращаем пустой путь
            return (images, "")

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
