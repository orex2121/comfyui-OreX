import os
import json
import numpy as np
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

    def get_available_filename(self, base_path, base_name, extension, is_empty_name=False):
        if is_empty_name:
            counter = self.empty_name_counter
            self.empty_name_counter += 1
            filename = f"{self.filename_separator}{counter:04d}.{extension}"
            return os.path.join(base_path, filename).replace('/', '\\'), counter
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
            
            filename = f"{base_name}{self.filename_separator}{self.counters[counter_key]:04d}.{extension}"
            return os.path.join(base_path, filename).replace('/', '\\'), self.counters[counter_key]

    def save_image(self, output_path, create_processed_folder, create_current_date_folder, images, 
                 filename_prefix_1, filename_prefix_2, filename_prefix_3, filename_separator, 
                 embed_workflow, prompt=None, extra_pnginfo=None, unique_id=None):
        
        self.filename_separator = filename_separator
        full_paths = []
        current_date = datetime.now().strftime("%Y-%m-%d")
        
        # Обработка output_path
        if "%" in output_path:
            try:
                date_folder = datetime.now().strftime(output_path)
                base_dir = os.path.join(self.output_dir, date_folder).replace('/', '\\')
                
                if create_processed_folder:
                    base_dir = os.path.join(base_dir, "Processed").replace('/', '\\')
                
                if create_current_date_folder:
                    save_dir = os.path.join(base_dir, current_date).replace('/', '\\')
                else:
                    save_dir = base_dir
                    
            except:
                base_dir = self.output_dir
                if create_processed_folder:
                    base_dir = os.path.join(base_dir, "Processed").replace('/', '\\')
                if create_current_date_folder:
                    save_dir = os.path.join(base_dir, current_date).replace('/', '\\')
                else:
                    save_dir = base_dir
        else:
            base_dir = self.output_dir
            if output_path.strip():
                base_dir = os.path.join(base_dir, output_path).replace('/', '\\')
            
            if create_processed_folder:
                base_dir = os.path.join(base_dir, "Processed").replace('/', '\\')
            
            if create_current_date_folder:
                save_dir = os.path.join(base_dir, current_date).replace('/', '\\')
            else:
                save_dir = base_dir
        
        os.makedirs(save_dir, exist_ok=True)

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

                img = Image.fromarray(np.clip(255. * image.cpu().numpy(), 0, 255).astype(np.uint8))
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
                print(f"[OreX Error] Failed to save image: {str(e)}")
                full_paths.append("")

        return (images, full_paths[0] if full_paths else "")

NODE_CLASS_MAPPINGS = {
    "orex Save Image": OreXImageSave
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex Save Image": "💾 Save Image (OreX)"
}

__all__ = ['NODE_CLASS_MAPPINGS']