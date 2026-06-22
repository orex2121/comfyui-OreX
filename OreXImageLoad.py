import os
import hashlib
import numpy as np
import torch
from PIL import Image, ImageSequence, ImageOps
import folder_paths
import node_helpers

class OreXImageLoad:
    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        files = folder_paths.filter_files_content_types(files, ["image"])
        return {"required":
                    {"image": (sorted(files), {"image_upload": True})},
                }

    CATEGORY = "🤫OreX/Image"

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "filename", "width", "height")
    FUNCTION = "load_image"

    def load_image(self, image):
        # image - это строка с именем файла из INPUT_TYPES
        image_path = folder_paths.get_annotated_filepath(image)

        # Извлечение имени файла без расширения
        filename, _ = os.path.splitext(os.path.basename(image_path))

        img = node_helpers.pillow(Image.open, image_path)

        output_images = []
        output_masks = []
        w, h = 0, 0

        excluded_formats = ['MPO']

        for i in ImageSequence.Iterator(img):
            i = node_helpers.pillow(ImageOps.exif_transpose, i)

            if i.mode == 'I':
                # Исправлено перекрытие переменной в lambda
                i = i.point(lambda p: p * (1 / 255))
            
            # Используем новое имя переменной, чтобы не перезаписывать аргумент `image`
            rgb_image = i.convert("RGB")

            if len(output_images) == 0:
                w = rgb_image.size[0]
                h = rgb_image.size[1]

            if rgb_image.size[0] != w or rgb_image.size[1] != h:
                continue

            # Конвертация в тензор
            image_tensor = np.array(rgb_image).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_tensor)[None,]
            
            # Обработка маски
            if 'A' in i.getbands():
                mask = np.array(i.getchannel('A')).astype(np.float32) / 255.0
                mask = 1. - torch.from_numpy(mask)
            elif i.mode == 'P' and 'transparency' in i.info:
                mask = np.array(i.convert('RGBA').getchannel('A')).astype(np.float32) / 255.0
                mask = 1. - torch.from_numpy(mask)
            else:
                # ОПТИМИЗАЦИЯ: Создаем пустую маску реального разрешения вместо 64x64
                mask = torch.zeros((h, w), dtype=torch.float32, device="cpu")
                
            output_images.append(image_tensor)
            output_masks.append(mask.unsqueeze(0))

        if len(output_images) > 1 and img.format not in excluded_formats:
            output_image = torch.cat(output_images, dim=0)
            output_mask = torch.cat(output_masks, dim=0)
        else:
            output_image = output_images[0]
            output_mask = output_masks[0]

        return (output_image, output_mask, filename, w, h)

    @classmethod
    def IS_CHANGED(s, image):
        image_path = folder_paths.get_annotated_filepath(image)
        m = hashlib.sha256()
        
        # ОПТИМИЗАЦИЯ: Чтение по чанкам предотвращает нехватку RAM при больших файлах
        with open(image_path, 'rb') as f:
            while chunk := f.read(8192):
                m.update(chunk)
                
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(s, image):
        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file: {}".format(image)
        return True


NODE_CLASS_MAPPINGS = {
    "orex Load Image": OreXImageLoad
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex Load Image": "🖼️ Load Image (OreX)"
}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']