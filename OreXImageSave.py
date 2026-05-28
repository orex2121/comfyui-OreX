# -*- coding: utf-8 -*-
import os
import json
import numpy as np
import re
import subprocess
import sys
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
        # Определяем папку расширения для поиска bin/ папки
        self.node_dir = os.path.dirname(os.path.realpath(__file__))
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "output_path": ("STRING", {"default": ""}),
                "create_current_date_folder": ("BOOLEAN", {"default": True, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
                "create_processed_folder": ("BOOLEAN", {"default": False, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
                "images": ("IMAGE",),
                "filename_prefix_1": ("STRING", {"default": "Image"}),
                "filename_prefix_2": ("STRING", {"default": ""}),
                "filename_prefix_3": ("STRING", {"default": ""}),
                "filename_separator": ("STRING", {"default": "_"}),
                
                # --- Переключатель режима именования ---
                "use_counter": ("BOOLEAN", {"default": True, "label_on": "Index Counter ENABLED 🟢", "label_off": "Time (Seconds) ENABLED 🔴"}),
                
                "embed_workflow": ("BOOLEAN", {"default": True, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
                
                # --- Настройки форматов ---
                "image_format": (["png", "jpg", "webp"], {"default": "png"}),
                
                # ИЗМЕНЕНО: Добавлен label для красивого отображения "Quality (JPG / WebP)" на слайдере
                "quality_jpg_webp": ("INT", {"default": 90, "min": 50, "max": 100, "step": 1, "display": "slider", "label": "Quality (JPG / WebP)"}),
                
                # --- Компактная оптимизация PNG ---
                "optimize_png": ("BOOLEAN", {"default": False, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
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

    WINDOWS_FORBIDDEN = set('<>:"/\\|?*')
    MAX_PATH_LEN = 260

    def is_valid_path_segment(self, segment: str) -> (bool, str):
        if segment is None: return False, "Пустой сегмент"
        if segment == "": return False, "Пустой сегмент (дублирование слэшей)"
        if segment.endswith(" ") or segment.endswith("."): return False, f"Сегмент не должен заканчиваться пробелом или точкой: '{segment}'"
        for ch in segment:
            if ch in self.WINDOWS_FORBIDDEN: return False, f"Недопустимый символ '{ch}' в сегменте '{segment}'"
        reserved = {"CON","PRN","AUX","NUL"}
        reserved.update({f"COM{i}" for i in range(1,10)})
        reserved.update({f"LPT{i}" for i in range(1,10)})
        if segment.upper() in reserved: return False, f"Зарезервированное имя: '{segment}'"
        return True, "OK"

    def validate_windows_path(self, full_path: str) -> (bool, str):
        if not full_path: return False, "Путь пустой"
        norm = os.path.normpath(full_path)
        if len(norm) > self.MAX_PATH_LEN: return False, f"Полный путь слишком длинный ({len(norm)} > {self.MAX_PATH_LEN})"
        drive, rest = os.path.splitdrive(norm)
        if not drive: return False, "Путь должен быть абсолютным (например, C:\\...)"
        if not re.match(r'^[A-Za-z]:$', drive): return False, f"Неверный диск/драйв: '{drive}'"
        rest = rest.lstrip(os.sep)
        parts = rest.split(os.sep) if rest else []
        for part in parts:
            valid, msg = self.is_valid_path_segment(part)
            if not valid: return False, msg
        return True, "OK"

    def process_output_path(self, path):
        try:
            try: dated_path = datetime.now().strftime(path)
            except Exception: dated_path = path
            if not dated_path: return None
            dated_path = dated_path.replace("/", os.sep).replace("\\", os.sep)
            if os.path.isabs(dated_path):
                norm = os.path.normpath(dated_path)
                valid, msg = self.validate_windows_path(norm)
                if not valid: return None
                return norm
            else:
                combined = os.path.normpath(os.path.join(self.output_dir, dated_path))
                valid, msg = self.validate_windows_path(combined)
                if not valid: return None
                return combined
        except Exception as e:
            print(f"[OreX] Path processing error: {str(e)}")
            return None

    def get_available_filename(self, base_path, base_name, extension, use_counter=True, is_empty_name=False):
        if not use_counter:
            if is_empty_name: filename = f"image.{extension}"
            else: filename = f"{base_name}.{extension}"
            full_path = os.path.join(base_path, filename)
            if not os.path.exists(full_path): return full_path, 0
            current_time_str = datetime.now().strftime("%H%M%S")
            if is_empty_name: filename = f"image{self.filename_separator}{current_time_str}.{extension}"
            else: filename = f"{base_name}{self.filename_separator}{current_time_str}.{extension}"
            full_path = os.path.join(base_path, filename)
            sub_idx = 1
            while os.path.exists(full_path):
                if is_empty_name: filename = f"image{self.filename_separator}{current_time_str}_{sub_idx}.{extension}"
                else: filename = f"{base_name}{self.filename_separator}{current_time_str}_{sub_idx}.{extension}"
                full_path = os.path.join(base_path, filename)
                sub_idx += 1
            return full_path, 0

        if is_empty_name:
            while True:
                counter = self.empty_name_counter
                self.empty_name_counter += 1
                filename = f"{self.filename_separator}{counter:0{self.counter_digits}d}.{extension}"
                full_path = os.path.join(base_path, filename)
                if not os.path.exists(full_path): return full_path, counter
        else:
            counter_key = os.path.basename(base_name)
            if counter_key in self.counters: self.counters[counter_key] += 1
            else:
                try: existing_files = [f for f in os.listdir(base_path) if f.startswith(os.path.basename(base_name))]
                except FileNotFoundError: existing_files = []
                last_num = max([int(f.split(self.filename_separator)[-1].split('.')[0]) for f in existing_files
                             if f.split(self.filename_separator)[-1].split('.')[0].isdigit()], default=0)
                self.counters[counter_key] = last_num + 1
            while True:
                filename = f"{base_name}{self.filename_separator}{self.counters[counter_key]:0{self.counter_digits}d}.{extension}"
                full_path = os.path.join(base_path, filename)
                if not os.path.exists(full_path): return full_path, self.counters[counter_key]
                self.counters[counter_key] += 1

    def create_comfyui_workflow_json(self, prompt, extra_pnginfo):
        try:
            if extra_pnginfo and 'workflow' in extra_pnginfo:
                workflow_data = extra_pnginfo['workflow']
                if 'prompt' not in workflow_data: workflow_data['prompt'] = prompt
                return workflow_data
            return {"id": str(hash(str(prompt)))[:36] if prompt else "0", "prompt": prompt, "extra_info": "Generated by OreX Save Image"}
        except Exception as e:
            print(f"[OreX] Failed to create workflow JSON: {str(e)}")
            return {"prompt": prompt or {}}

    def save_workflow_json_file(self, image_path, workflow_data):
        try:
            json_path = os.path.splitext(image_path)[0] + ".json"
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(workflow_data, f, ensure_ascii=False, indent=2)
            return json_path
        except Exception as e:
            print(f"[OreX] Failed to save workflow JSON: {str(e)}")
            return ""

    def run_png_optimization(self, filepath):
        is_windows = sys.platform.startswith('win')
        pq_name = "pngquant.exe" if is_windows else "pngquant"
        ox_name = "oxipng.exe" if is_windows else "oxipng"
        pngquant_exe = os.path.join(self.node_dir, "bin", "pngquant", pq_name)
        if not os.path.exists(pngquant_exe): pngquant_exe = "pngquant"
        oxipng_exe = os.path.join(self.node_dir, "bin", "oxipng", ox_name)
        if not os.path.exists(oxipng_exe): oxipng_exe = "oxipng"
        quality_str = "80-98"
        try:
            cmd_quant = [pngquant_exe, '--force', '--ext', '.png', '--quality', quality_str, filepath]
            subprocess.run(cmd_quant, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
            cmd_oxi = [oxipng_exe, '-o', '4', '--strip', 'safe', filepath]
            subprocess.run(cmd_oxi, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        except FileNotFoundError: print(f"\n[OreX] ERROR: Optimization tools not found in bin/ folder!")
        except subprocess.CalledProcessError as e:
            if e.returncode in [98, 99]:
                try:
                    cmd_oxi = [oxipng_exe, '-o', '4', '--strip', 'safe', filepath]
                    subprocess.run(cmd_oxi, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
                except: pass
        except Exception as e: print(f"\n[OreX] Unexpected error during optimization: {str(e)}")

    def save_image(self, output_path, create_current_date_folder, create_processed_folder, images, 
                   filename_prefix_1, filename_prefix_2, filename_prefix_3, filename_separator, 
                   use_counter, embed_workflow, image_format, quality_jpg_webp, optimize_png,
                   prompt=None, extra_pnginfo=None, unique_id=None):
        
        self.filename_separator = filename_separator
        full_paths = []
        
        if output_path:
            processed_path = self.process_output_path(output_path)
            if not processed_path: return (images, "")
        else:
            processed_path = self.output_dir

        try:
            if create_current_date_folder:
                current_date = datetime.now().strftime("%Y-%m-%d")
                processed_path = os.path.join(processed_path, current_date)
            if create_processed_folder:
                processed_path = os.path.join(processed_path, "Processed")
            save_dir = processed_path
            os.makedirs(save_dir, exist_ok=True)
        except Exception as e:
            print(f"[OreX] Directory creation failed: {str(e)}")
            return (images, "")

        for image in images:
            try:
                is_empty_name = not (filename_prefix_1 or filename_prefix_2 or filename_prefix_3)
                if is_empty_name:
                    filepath, _ = self.get_available_filename(save_dir, "", image_format, use_counter=use_counter, is_empty_name=True)
                else:
                    filename_parts = [p for p in [filename_prefix_1, filename_prefix_2, filename_prefix_3] if p]
                    base_filename = filename_separator.join(filename_parts)
                    filepath, _ = self.get_available_filename(save_dir, base_filename, image_format, use_counter=use_counter)

                img_array = np.clip(255. * image.cpu().numpy(), 0, 255).astype(np.uint8)
                img = Image.fromarray(img_array)
                
                if image_format == "png":
                    if embed_workflow:
                        metadata = PngInfo()
                        if prompt: metadata.add_text("prompt", json.dumps(prompt))
                        if extra_pnginfo: 
                            for x in extra_pnginfo: metadata.add_text(x, json.dumps(extra_pnginfo[x]))
                        img.save(filepath, pnginfo=metadata, compress_level=4)
                    else:
                        img.save(filepath, compress_level=4)
                    if optimize_png:
                        self.run_png_optimization(filepath)
                        if embed_workflow and (prompt or extra_pnginfo):
                            self.save_workflow_json_file(filepath, self.create_comfyui_workflow_json(prompt, extra_pnginfo))
                        
                elif image_format == "jpg":
                    if img.mode in ('RGBA', 'P'): img = img.convert('RGB')
                    img.save(filepath, quality=quality_jpg_webp, optimize=True)
                    if embed_workflow and (prompt or extra_pnginfo):
                        self.save_workflow_json_file(filepath, self.create_comfyui_workflow_json(prompt, extra_pnginfo))
                        
                elif image_format == "webp":
                    img.save(filepath, quality=quality_jpg_webp, method=4)
                    if embed_workflow and (prompt or extra_pnginfo):
                        self.save_workflow_json_file(filepath, self.create_comfyui_workflow_json(prompt, extra_pnginfo))

                full_paths.append(filepath)
                del img_array
                del img
            except Exception as e:
                print(f"[OreX] Image save failed: {str(e)}")
                full_paths.append("")

        return (images, full_paths[0] if full_paths else "")

NODE_CLASS_MAPPINGS = {"OreX Image Save": OreXImageSave}
NODE_DISPLAY_NAME_MAPPINGS = {"OreX Image Save": "💾 OreX Image Save"}
WEB_DIRECTORY = "./js"
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']