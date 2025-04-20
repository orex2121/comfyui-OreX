import os
import torch
from PIL import Image
import numpy as np
import folder_paths

class OreXImageLoad:
    def __init__(self):
        self.output_dir = folder_paths.get_input_directory()
        self.type = "input"

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
            },
            "optional": {
                "allow_RGBA_output": ("BOOLEAN", {"default": False, "label_on": "Yes", "label_off": "No"}),
                "file_name_without_extension": ("BOOLEAN", {"default": True, "label_on": "Yes", "label_off": "No"}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("image", "mask", "filename")
    FUNCTION = "load_image"
    CATEGORY = "🤫OreX/Image"

    def load_image(self, image, allow_RGBA_output=False, file_name_without_extension=True):
        image_path = folder_paths.get_annotated_filepath(image)
        
        if file_name_without_extension:
            filename = os.path.splitext(os.path.basename(image_path))[0]
        else:
            filename = os.path.basename(image_path)

        img = Image.open(image_path)
        if not allow_RGBA_output:
            img = img.convert("RGB")
        
        image_array = np.array(img).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_array)[None,]

        mask = None
        if allow_RGBA_output and img.mode == "RGBA":
            mask = image_array[:, :, 3]
            mask = torch.from_numpy(mask).float()

        return (image_tensor, mask, filename)

NODE_CLASS_MAPPINGS = {
    "orex Load Image": OreXImageLoad
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex Load Image": "🖼️ Load Image (OreX)"
}

__all__ = ['NODE_CLASS_MAPPINGS']