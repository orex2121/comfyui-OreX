import os
import json
import csv
import torch
import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from datetime import datetime
import folder_paths

def log_node_info(node, msg):
    print(f"[{node}] {msg}")

def log_node_warn(node, msg):
    print(f"[{node}] WARNING: {msg}")

class OreX_TextSave:
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = 'output'

    @classmethod
    def INPUT_TYPES(s):
        input_types = {}
        input_types['required'] = {
            "activate": ("BOOLEAN", {"default": True, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
            "text": ("STRING", {"default": "", "forceInput": True}),
            "output_file_path": ("STRING", {"multiline": False, "default": ""}),
            "file_name": ("STRING", {"multiline": False, "default": ""}),
            "separator": ("STRING", {"multiline": False, "default": ""}),
            "file_postfix": ("STRING", {"multiline": False, "default": ""}),
            "use_counter": ("BOOLEAN", {"default": False, "label_on": "🟢 ENABLED", "label_off": "🔴 DISABLED"}),
            "file_extension": (["txt", "csv", "json"],),
            "overwrite": ("BOOLEAN", {"default": True}),
            "image_format": (["png", "jpg", "jpeg", "webp", "bmp", "tiff"], {"default": "png"}),
            "jpg_quality": ("INT", {"default": 90, "min": 1, "max": 100, "step": 1}),
            "webp_quality": ("INT", {"default": 90, "min": 1, "max": 100, "step": 1}),
            "optimize_png": ("BOOLEAN", {"default": False, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
            "creat_processed_folder": ("BOOLEAN", {"default": False, "label_on": "🟢 ON", "label_off": "🔴 OFF"}),
        }
        input_types['optional'] = {
            "image": ("IMAGE",),
        }
        return input_types

    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("text", 'image',)

    FUNCTION = "save_text"
    OUTPUT_NODE = True
    CATEGORY = "EasyUse/Logic"

    def save_image(self, images, filename_prefix='', extension='png', quality=100, optimize_png=False, prompt=None,
                   extra_pnginfo=None, delimiter='_', filename_number_start='true', number_padding=4,
                   overwrite_mode='prefix_as_filename', output_path='', show_history='true', show_previews='true',
                   embed_workflow='true', lossless_webp=False):
        results = list()
        for image in images:
            i = 255. * image.cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))

            if extension == 'webp':
                img_exif = img.getexif()
                workflow_metadata = ''
                prompt_str = ''
                if prompt is not None:
                    prompt_str = json.dumps(prompt)
                    img_exif[0x010f] = "Prompt:" + prompt_str
                if extra_pnginfo is not None:
                    for x in extra_pnginfo:
                        workflow_metadata += json.dumps(extra_pnginfo[x])
                img_exif[0x010e] = "Workflow:" + workflow_metadata
                exif_data = img_exif.tobytes()
            else:
                metadata = PngInfo()
                if embed_workflow == 'true':
                    if prompt is not None:
                        metadata.add_text("prompt", json.dumps(prompt))
                    if extra_pnginfo is not None:
                        for x in extra_pnginfo:
                            metadata.add_text(x, json.dumps(extra_pnginfo[x]))
                exif_data = metadata

            file = f"{filename_prefix}.{extension}"

            try:
                output_file = os.path.abspath(os.path.join(output_path, file))
                if extension in ["jpg", "jpeg"]:
                    img.save(output_file, quality=quality, optimize=True)
                elif extension == 'webp':
                    img.save(output_file, quality=quality, lossless=lossless_webp, exif=exif_data)
                elif extension == 'png':
                    img.save(output_file, pnginfo=exif_data, optimize=optimize_png)
                elif extension == 'bmp':
                    img.save(output_file)
                elif extension == 'tiff':
                    img.save(output_file, quality=quality, optimize=True)
                else:
                    img.save(output_file, pnginfo=exif_data, optimize=True)

            except OSError as e:
                print(e)
            except Exception as e:
                print(e)

    def save_text(self, activate, text, output_file_path, file_name, separator, file_postfix, use_counter, file_extension, overwrite, image_format, jpg_quality, webp_quality, optimize_png, creat_processed_folder, image=None, prompt=None, extra_pnginfo=None):
        result = {"result": (text, image)}

        if not activate:
            return result

        if isinstance(file_name, list):
            file_name = file_name[0]

        clean_output_path = output_file_path.strip()
        if not clean_output_path:
            clean_output_path = self.output_dir

        if not os.path.isabs(clean_output_path):
            clean_output_path = os.path.join(self.output_dir, clean_output_path)

        # Добавляем папку processed, если включена опция
        if creat_processed_folder:
            clean_output_path = os.path.join(clean_output_path, "processed")

        # Создаем директорию только после формирования окончательного пути
        if not os.path.exists(clean_output_path):
            os.makedirs(clean_output_path, exist_ok=True)

        f_name = file_name.strip()
        f_post = file_postfix.strip()
        
        if not f_name and not f_post:
            base_name = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
        elif not f_name and f_post:
            base_name = f_post
        elif f_name and not f_post:
            base_name = f_name
        else:
            base_name = f"{f_name}{separator}{f_post}"

        final_name = base_name
        if use_counter:
            counter = 1
            while True:
                final_name = f"{base_name}{separator}{counter}"
                test_path = os.path.join(clean_output_path, f"{final_name}.{file_extension}")
                if not os.path.exists(test_path):
                    break
                counter += 1

        filepath = os.path.join(clean_output_path, f"{final_name}.{file_extension}")

        if overwrite:
            file_mode = "w"
        else:
            file_mode = "a"

        log_node_info("OreX_TextSave", f"Saving text to {filepath}")

        if file_extension == "csv":
            text_list = [i.strip() for i in text.split("\n")]
            with open(filepath, file_mode, newline="", encoding='utf-8') as csv_file:
                csv_writer = csv.writer(csv_file)
                for line in text_list:
                    csv_writer.writerow([line])
        elif file_extension == "json":
            with open(filepath, file_mode, encoding='utf-8') as json_file:
                try:
                    parsed_json = json.loads(text)
                    json.dump(parsed_json, json_file, indent=4, ensure_ascii=False)
                except json.JSONDecodeError:
                    if overwrite:
                        json.dump({"text": text}, json_file, indent=4, ensure_ascii=False)
                    else:
                        json_file.write(text + "\n")
        else:
            with open(filepath, file_mode, newline="", encoding='utf-8') as text_file:
                text_file.write(text)

        if image is not None:
            imagepath = final_name 
            
            img_quality = 100
            if image_format in ["jpg", "jpeg"]:
                img_quality = jpg_quality
            elif image_format == "webp":
                img_quality = webp_quality

            images = []
            images.append(image)
            images = torch.cat(images, dim=0)
            
            self.save_image(
                images=images, 
                filename_prefix=imagepath, 
                extension=image_format, 
                quality=img_quality, 
                optimize_png=optimize_png,
                prompt=prompt, 
                extra_pnginfo=extra_pnginfo, 
                output_path=clean_output_path, 
                delimiter='_'
            )
            
            log_node_info("OreX_TextSave", f"Saving Image to {os.path.join(clean_output_path, imagepath + '.' + image_format)}")

        return result