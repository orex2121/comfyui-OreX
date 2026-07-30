# -*- coding: utf-8 -*-
import os
import json
import numpy as np
import subprocess
import sys
from datetime import datetime
from PIL import Image
from PIL.PngImagePlugin import PngInfo
import folder_paths
from collections import defaultdict
import re

class OreXImageSave:
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self.counters = defaultdict(int)
        self.empty_name_counter = 1
        self.counter_digits = 4
        self.node_dir = os.path.dirname(os.path.realpath(__file__))
        self.is_windows = sys.platform.startswith('win')
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "active": ("BOOLEAN", {"default": True, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
                "output_path": ("STRING", {"default": ""}),
                "create_current_date_folder": ("BOOLEAN", {"default": True, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
                "create_processed_folder": ("BOOLEAN", {"default": False, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
                "images": ("IMAGE",),
                "filename_prefix_1": ("STRING", {"default": "Image"}),
                "filename_prefix_2": ("STRING", {"default": ""}),
                "filename_prefix_3": ("STRING", {"default": ""}),
                "filename_separator": ("STRING", {"default": "_"}),
                "use_counter": ("BOOLEAN", {"default": True, "label_on": "Index Counter ENABLED 🟢", "label_off": "Time (Seconds) ENABLED 🔴"}),
                "embed_workflow": ("BOOLEAN", {"default": True, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
                "image_format": (["png", "jpg", "webp"], {"default": "png"}),
                "jpg_quality": ("INT", {"default": 90, "min": 50, "max": 100, "step": 1, "display": "slider", "label": "JPG Quality"}),
                "webp_quality": ("INT", {"default": 90, "min": 50, "max": 100, "step": 1, "display": "slider", "label": "WebP Quality"}),
                "optimize_png": ("BOOLEAN", {"default": False, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO", "unique_id": "UNIQUE_ID"},
        }

    # Обновленные выходы: добавилась строка filename_text
    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("images", "saved_path", "filename_text")
    FUNCTION = "save_image"
    OUTPUT_NODE = True
    CATEGORY = "🤫OreX/Image"

    WINDOWS_FORBIDDEN = set('<>:"|?*') # Убраны слеши, они нужны для путей
    MAX_PATH_LEN = 260

    def validate_path(self, full_path: str) -> bool:
        if not full_path: return False
        norm = os.path.normpath(full_path)
        
        if self.is_windows:
            if len(norm) > self.MAX_PATH_LEN: return False
            drive, tail = os.path.splitdrive(norm)
            if any(ch in self.WINDOWS_FORBIDDEN for ch in tail): return False
        return True

    def process_output_path(self, path):
        try:
            dated_path = datetime.now().strftime(path)
        except Exception:
            dated_path = path
            
        if not dated_path: return None
        
        dated_path = os.path.normpath(dated_path)
        if os.path.isabs(dated_path):
            combined = dated_path
        else:
            combined = os.path.join(self.output_dir, dated_path)
            
        if not self.validate_path(combined):
            print(f"[OreX] Invalid path format: {combined}")
            return None
        return combined

    def parse_date_variables(self, text: str) -> str:
        """Парсит строку на наличие переменной %date:FORMAT% и заменяет её на текущее время"""
        if not text:
            return text
            
        pattern = re.compile(r"%date:(.*?)%")
        
        def replace_format(match):
            fmt = match.group(1)
            # Конвертируем привычные маски в маски strftime
            fmt = fmt.replace("yyyy", "%Y").replace("yy", "%y")
            fmt = fmt.replace("MM", "%m").replace("dd", "%d")
            # Поддерживаем как hh, так и HH для часов
            fmt = fmt.replace("hh", "%H").replace("HH", "%H") 
            fmt = fmt.replace("mm", "%M").replace("ss", "%S")
            
            try:
                return datetime.now().strftime(fmt)
            except Exception as e:
                print(f"[OreX] Date formatting error for format '{fmt}': {e}")
                return "DateError"
                
        return pattern.sub(replace_format, text)

    def get_available_filename(self, base_path, base_name, extension, use_counter=True, is_empty_name=False):
        if not use_counter:
            timestamp = datetime.now().strftime("%H%M%S")
            name_part = "image" if is_empty_name else base_name
            
            # Пробуем без суффикса если не пустое имя
            if not is_empty_name:
                filename = f"{name_part}.{extension}"
                full_path = os.path.join(base_path, filename)
                if not os.path.exists(full_path): return full_path, 0
                
            # Добавляем таймстемп
            filename = f"{name_part}{self.filename_separator}{timestamp}.{extension}"
            full_path = os.path.join(base_path, filename)
            
            sub_idx = 1
            while os.path.exists(full_path):
                filename = f"{name_part}{self.filename_separator}{timestamp}_{sub_idx}.{extension}"
                full_path = os.path.join(base_path, filename)
                sub_idx += 1
            return full_path, 0

        # Режим счетчика
        if is_empty_name:
            counter_key = "_empty_"
            counter = self.empty_name_counter
        else:
            counter_key = os.path.basename(base_name)
            if counter_key not in self.counters:
                pattern = re.compile(rf"^{re.escape(base_name)}{re.escape(self.filename_separator)}(\d+)\.{extension}$")
                highest = 0
                try:
                    for f in os.scandir(base_path):
                        if f.is_file():
                            match = pattern.match(f.name)
                            if match:
                                num_str = match.group(1)
                                # Игнорируем таймстемпы (6 цифр), берем только реальные счетчики
                                if len(num_str) < 6:
                                    highest = max(highest, int(num_str))
                except FileNotFoundError:
                    pass
                self.counters[counter_key] = highest + 1
            counter = self.counters[counter_key]

        while True:
            if is_empty_name:
                filename = f"{self.filename_separator}{counter:0{self.counter_digits}d}.{extension}"
            else:
                filename = f"{base_name}{self.filename_separator}{counter:0{self.counter_digits}d}.{extension}"
                
            full_path = os.path.join(base_path, filename)
            if not os.path.exists(full_path):
                if is_empty_name:
                    self.empty_name_counter = counter + 1
                else:
                    self.counters[counter_key] = counter + 1
                return full_path, counter
            counter += 1

    def create_comfyui_workflow_json(self, prompt, extra_pnginfo):
        try:
            if extra_pnginfo and 'workflow' in extra_pnginfo:
                workflow_data = extra_pnginfo['workflow'].copy()
                if 'prompt' not in workflow_data: 
                    workflow_data['prompt'] = prompt
                return workflow_data
            return {"id": str(hash(str(prompt)))[:36] if prompt else "0", "prompt": prompt, "extra_info": "Generated by OreX"}
        except Exception as e:
            print(f"[OreX] Failed to create workflow JSON: {e}")
            return {"prompt": prompt or {}}

    def save_workflow_json_file(self, image_path, workflow_data):
        try:
            json_path = os.path.splitext(image_path)[0] + ".json"
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(workflow_data, f, ensure_ascii=False, indent=2)
            return json_path
        except Exception as e:
            print(f"[OreX] Failed to save workflow JSON: {e}")
            return ""

    def run_png_optimization(self, filepath):
        pq_name = "pngquant.exe" if self.is_windows else "pngquant"
        ox_name = "oxipng.exe" if self.is_windows else "oxipng"
        
        pngquant_exe = os.path.join(self.node_dir, "bin", "pngquant", pq_name)
        oxipng_exe = os.path.join(self.node_dir, "bin", "oxipng", ox_name)
        
        if not os.path.exists(pngquant_exe): pngquant_exe = pq_name
        if not os.path.exists(oxipng_exe): oxipng_exe = ox_name

        try:
            cmd_quant = [pngquant_exe, '--force', '--ext', '.png', '--quality', "80-98", filepath]
            subprocess.run(cmd_quant, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
            
            cmd_oxi = [oxipng_exe, '-o', '4', '--strip', 'safe', filepath]
            subprocess.run(cmd_oxi, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        except subprocess.TimeoutExpired:
            print(f"\n[OreX] Warning: Optimization timeout for {filepath}")
        except FileNotFoundError:
            print(f"\n[OreX] ERROR: Optimization tools (pngquant/oxipng) not found!")
        except subprocess.CalledProcessError as e:
            if e.returncode in [98, 99]:
                try:
                    subprocess.run(cmd_oxi, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
                except Exception:
                    pass
            else:
                print(f"\n[OreX] Optimization error code {e.returncode} for {filepath}")

    def save_image(self, active, output_path, create_current_date_folder, create_processed_folder, images, 
                   filename_prefix_1, filename_prefix_2, filename_prefix_3, filename_separator, 
                   use_counter, embed_workflow, image_format, jpg_quality, webp_quality, optimize_png,
                   prompt=None, extra_pnginfo=None, unique_id=None):
        
        if not active:
            return {"ui": {"images": []}, "result": (images, "", "")}
            
        self.filename_separator = filename_separator
        full_paths = []
        ui_images = []
        
        processed_path = self.process_output_path(output_path) if output_path else self.output_dir
        if not processed_path: 
            return {"ui": {"images": []}, "result": (images, "", "")}

        if create_current_date_folder:
            processed_path = os.path.join(processed_path, datetime.now().strftime("%Y-%m-%d"))
        if create_processed_folder:
            processed_path = os.path.join(processed_path, "Processed")

        try:
            os.makedirs(processed_path, exist_ok=True)
        except Exception as e:
            print(f"[OreX] Directory creation failed: {e}")
            return {"ui": {"images": []}, "result": (images, "", "")}

        img_arrays = np.clip(255. * images.cpu().numpy(), 0, 255).astype(np.uint8)

        # Парсим переменные даты ОДИН раз для всего батча изображений, 
        # чтобы у всех картинок в батче было одинаковое время в названии
        p1 = self.parse_date_variables(filename_prefix_1)
        p2 = self.parse_date_variables(filename_prefix_2)
        p3 = self.parse_date_variables(filename_prefix_3)

        for img_array in img_arrays:
            try:
                is_empty_name = not any([p1, p2, p3])
                
                if is_empty_name:
                    filepath, _ = self.get_available_filename(processed_path, "", image_format, use_counter, True)
                else:
                    parts = [p for p in [p1, p2, p3] if p]
                    base_filename = filename_separator.join(parts)
                    filepath, _ = self.get_available_filename(processed_path, base_filename, image_format, use_counter)

                img = Image.fromarray(img_array)
                should_save_json = embed_workflow and (prompt or extra_pnginfo)
                
                if image_format == "png":
                    metadata = PngInfo()
                    if embed_workflow:
                        if prompt: metadata.add_text("prompt", json.dumps(prompt))
                        if extra_pnginfo: 
                            for x in extra_pnginfo: metadata.add_text(x, json.dumps(extra_pnginfo[x]))
                            
                    img.save(filepath, pnginfo=metadata, compress_level=4, optimize=False)
                    
                    if optimize_png:
                        self.run_png_optimization(filepath)
                        if should_save_json:
                            self.save_workflow_json_file(filepath, self.create_comfyui_workflow_json(prompt, extra_pnginfo))
                            
                elif image_format in ["jpg", "jpeg"]:
                    if img.mode in ('RGBA', 'P'): img = img.convert('RGB')
                    img.save(filepath, quality=jpg_quality, optimize=True)
                    if should_save_json:
                        self.save_workflow_json_file(filepath, self.create_comfyui_workflow_json(prompt, extra_pnginfo))
                        
                elif image_format == "webp":
                    img.save(filepath, quality=webp_quality, method=4)
                    if should_save_json:
                        self.save_workflow_json_file(filepath, self.create_comfyui_workflow_json(prompt, extra_pnginfo))

                full_paths.append(filepath)
                
                try:
                    rel_path = os.path.relpath(filepath, self.output_dir)
                    if rel_path.startswith(".."):
                        subfolder_path = "" 
                    else:
                        subfolder_path = os.path.dirname(rel_path).replace("\\", "/")
                except ValueError:
                    subfolder_path = ""

                ui_images.append({
                    "filename": os.path.basename(filepath),
                    "subfolder": subfolder_path,
                    "type": self.type
                })

            except Exception as e:
                print(f"[OreX] Image save failed: {e}")
                full_paths.append("")
                
        filename_no_ext = ""
        if full_paths and full_paths[0]:
            # Получаем базовое имя и отсекаем расширение
            filename_no_ext = os.path.splitext(os.path.basename(full_paths[0]))[0]

        return {
            "ui": {"images": ui_images},
            # Возвращаем три результата, как описано в RETURN_TYPES
            "result": (images, full_paths[0] if full_paths else "", filename_no_ext)
        }

NODE_CLASS_MAPPINGS = {"OreX Image Save": OreXImageSave}
NODE_DISPLAY_NAME_MAPPINGS = {"OreX Image Save": "💾 OreX Image Save"}
WEB_DIRECTORY = "./js"
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']