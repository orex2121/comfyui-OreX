import os
import math
import torch
import numpy as np
import platform
from PIL import Image, ImageDraw, ImageFont, ImageOps

def tensor2pil(image):
    # Берем первый элемент батча [0], чтобы избежать ошибок .squeeze() при батчах > 1
    img_np = image[0].cpu().numpy()
    return Image.fromarray(np.clip(255. * img_np, 0, 255).astype(np.uint8))

def pil2tensor(image):
    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)

class OrexImageMerging:

    @classmethod
    def INPUT_TYPES(s):
        my_dir = os.path.dirname(os.path.realpath(__file__))
        font_dir = os.path.join(my_dir, "fonts")
        
        file_list = []
        if os.path.exists(font_dir):
            file_list = [f for f in os.listdir(font_dir) if os.path.isfile(os.path.join(font_dir, f)) and f.lower().endswith(".ttf")]
        if not file_list:
            file_list = ["default"]

        impact_font = next((f for f in file_list if f.lower() == "impact.ttf"), None)
        if impact_font:
            file_list.remove(impact_font)
            file_list.insert(0, impact_font)

        colors = ["white", "black", "crimson", "coral", "gold", "emerald", "teal", "cyan", "azure", "indigo", "violet", "fuchsia", "rose", "slate"]
        merging_modes = ["horizontal", "vertical", "grid 2", "grid 3", "grid 4", "grid 2 + 1", "grid 3 + 1"]
        upscale_methods = ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"]

        required_inputs = {
            "text": ("STRING", {"multiline": True, "default": "Caption 1\nCaption 2"}),
            
            # ### ---> НАСТРОЙКА ЛИМИТА (1 из 3) <--- ###
            # Чтобы увеличить максимальное количество картинок, поменяйте "max": 20 на ваше число (например, "max": 50)
            "image_number": ("INT", {"default": 2, "min": 2, "max": 20}),
            
            "merging_mode": (merging_modes, {"default": "horizontal"}),
            
            # ### ---> НАСТРОЙКА ЛИМИТА (2 из 3) <--- ###
            # Здесь "max" тоже нужно поменять на то же самое ваше число (например, "max": 50)
            "main_resolution_image": ("INT", {"default": 1, "min": 1, "max": 20}),
            
            "footer_height": ("FLOAT", {"default": 5.0, "min": 0.0, "max": 100.0, "step": 0.1}),
            "font_name": (file_list,),
            "font_size": ("FLOAT", {"default": 4.0, "min": 0.0, "max": 100.0, "step": 0.1}),
            "mode": (colors,),
            "border_thickness": ("FLOAT", {"default": 2.0, "min": 0.0, "max": 100.0, "step": 0.1}),
            "upscale_method": (upscale_methods, {"default": "lanczos"}),
            "megapixels": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 0.1}),
        }

        optional_inputs = {}
        # ### ---> НАСТРОЙКА ЛИМИТА (3 из 3) <--- ###
        # Поменяйте цифру 21 на ваше (Максимальное число + 1). 
        # Например, если вы выбрали макс. количество 50, напишите здесь range(1, 51)
        for i in range(1, 21):
            optional_inputs[f"image{i}"] = ("IMAGE",)

        return {
            "required": required_inputs,
            "optional": optional_inputs
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT",)
    RETURN_NAMES = ("image", "width", "height",)
    FUNCTION = "merge_images"
    CATEGORY = "OreX-nodes/Image Merging"
    
    def merge_images(self, text, image_number, merging_mode, main_resolution_image,
                     footer_height, font_name, font_size, mode, border_thickness,
                     upscale_method, megapixels, **kwargs):

        color_map = {
            "white": ("#FFFFFF", "#000000"), "black": ("#000000", "#FFFFFF"),
            "crimson": ("#DC143C", "#FFFFFF"), "coral": ("#FF7F50", "#000000"),
            "gold": ("#FFD700", "#000000"), "emerald": ("#50C878", "#000000"),
            "teal": ("#008080", "#FFFFFF"), "cyan": ("#00FFFF", "#000000"),
            "azure": ("#F0FFFF", "#000000"), "indigo": ("#4B0082", "#FFFFFF"),
            "violet": ("#EE82EE", "#000000"), "fuchsia": ("#FF00FF", "#FFFFFF"),
            "rose": ("#FF007F", "#FFFFFF"), "slate": ("#708090", "#FFFFFF")
        }
        bg_color, fg_color = color_map.get(mode, ("#FFFFFF", "#000000"))

        all_images = []
        for i in range(1, image_number + 1):
            img_tensor = kwargs.get(f"image{i}")
            if img_tensor is not None:
                all_images.append(img_tensor)
                
        valid_images = [tensor2pil(img) for img in all_images]
        
        if not valid_images:
            empty_img = Image.new('RGB', (512, 512), bg_color)
            return (pil2tensor(empty_img), 512, 512)

        main_idx = main_resolution_image - 1
        if main_idx < 0 or main_idx >= len(valid_images):
            main_idx = 0
            
        base_w, base_h = valid_images[main_idx].width, valid_images[main_idx].height
        texts_list = text.split('\n')

        def get_layout(b_w, b_h):
            a_footer = int(b_h * (footer_height / 100.0))
            a_font = int(b_h * (font_size / 100.0))
            b_size = int(b_h * (border_thickness / 100.0))
            b_thick_total = b_size * 2
            
            def get_f_h(idx):
                caption = texts_list[idx].strip() if idx < len(texts_list) else ""
                return a_footer if caption else 0

            dims = []
            for i, img in enumerate(valid_images):
                new_w, new_h = img.width, img.height
                if merging_mode == "horizontal":
                    new_h = b_h
                    new_w = int(round(img.width * (b_h / img.height)))
                elif merging_mode == "vertical":
                    new_w = b_w
                    new_h = int(round(img.height * (b_w / img.width)))
                elif merging_mode.startswith("grid"):
                    target_area = b_w * b_h
                    if merging_mode == "grid 2 + 1":
                        if main_idx in [0, 1] and i == 2: target_area *= 2
                        elif main_idx == 2 and i in [0, 1]: target_area /= 2
                    elif merging_mode == "grid 3 + 1":
                        if main_idx in [0, 1, 2] and i == 3: target_area *= 3
                        elif main_idx == 3 and i in [0, 1, 2]: target_area /= 3

                    current_area = img.width * img.height
                    if current_area > 0:
                        scale = math.sqrt(target_area / current_area)
                        new_w = int(round(img.width * scale))
                        new_h = int(round(img.height * scale))
                dims.append((new_w, new_h))

            if merging_mode == "grid 2 + 1" and len(dims) >= 3:
                left_h = dims[0][1] + get_f_h(0) + b_thick_total + dims[1][1] + get_f_h(1) + b_thick_total
                img2_h = max(1, left_h - get_f_h(2) - b_thick_total)
                orig_w, orig_h = valid_images[2].width, valid_images[2].height
                dims[2] = (max(1, int(round(orig_w * (img2_h / orig_h)))), img2_h)
            elif merging_mode == "grid 3 + 1" and len(dims) >= 4:
                left_h = sum(dims[j][1] + get_f_h(j) + b_thick_total for j in range(3))
                img3_h = max(1, left_h - get_f_h(3) - b_thick_total)
                orig_w, orig_h = valid_images[3].width, valid_images[3].height
                dims[3] = (max(1, int(round(orig_w * (img3_h / orig_h)))), img3_h)

            processed_dims = []
            for i, (w, h) in enumerate(dims):
                processed_dims.append((w + b_thick_total, h + get_f_h(i) + b_thick_total))

            fw, fh = 0, 0
            if merging_mode == "horizontal":
                fw = sum(w for w, h in processed_dims)
                fh = max(h for w, h in processed_dims) if processed_dims else 0
            elif merging_mode == "vertical":
                fw = max(w for w, h in processed_dims) if processed_dims else 0
                fh = sum(h for w, h in processed_dims)
            elif merging_mode in ["grid 2", "grid 3", "grid 4"]:
                cols = int(merging_mode.split(" ")[1])
                rows = math.ceil(len(processed_dims) / cols)
                cell_w = max(w for w, h in processed_dims) if processed_dims else 0
                cell_h = max(h for w, h in processed_dims) if processed_dims else 0
                fw = cols * cell_w
                fh = rows * cell_h
            elif merging_mode == "grid 2 + 1":
                if len(processed_dims) >= 3:
                    col1_w = max(processed_dims[0][0], processed_dims[1][0])
                    fw = col1_w + processed_dims[2][0]
                    fh = max(processed_dims[0][1] + processed_dims[1][1], processed_dims[2][1])
                else:
                    fw, fh = processed_dims[0] if processed_dims else (0, 0)
            elif merging_mode == "grid 3 + 1":
                if len(processed_dims) >= 4:
                    col1_w = max(processed_dims[0][0], processed_dims[1][0], processed_dims[2][0])
                    fw = col1_w + processed_dims[3][0]
                    fh = max(processed_dims[0][1] + processed_dims[1][1] + processed_dims[2][1], processed_dims[3][1])
                else:
                    fw, fh = processed_dims[0] if processed_dims else (0, 0)

            return dims, fw, fh, a_footer, a_font, b_size

        new_dims, final_w, final_h, actual_footer_height, actual_font_size, border_size = get_layout(base_w, base_h)

        if megapixels > 0.0 and final_w > 0 and final_h > 0:
            current_pixels = final_w * final_h
            target_pixels = megapixels * 1_000_000
            scale_factor = math.sqrt(target_pixels / current_pixels)
            base_w = max(1, int(round(base_w * scale_factor)))
            base_h = max(1, int(round(base_h * scale_factor)))
            new_dims, final_w, final_h, actual_footer_height, actual_font_size, border_size = get_layout(base_w, base_h)

        resample_map = {
            "nearest-exact": Image.Resampling.NEAREST, "bilinear": Image.Resampling.BILINEAR,
            "area": Image.Resampling.BOX, "bicubic": Image.Resampling.BICUBIC,
            "lanczos": Image.Resampling.LANCZOS
        }
        resampler = resample_map.get(upscale_method, Image.Resampling.LANCZOS)

        resized_images = []
        for i, img in enumerate(valid_images):
            new_w, new_h = new_dims[i]
            if (new_w, new_h) != (img.width, img.height) and new_w > 0 and new_h > 0:
                resized_images.append(img.resize((new_w, new_h), resampler))
            else:
                resized_images.append(img)

        font = None
        if actual_font_size > 0:
            if font_name != "default":
                font_path = os.path.join(os.path.dirname(os.path.realpath(__file__)), "fonts", font_name)
                try:
                    font = ImageFont.truetype(font_path, actual_font_size)
                except:
                    pass
            
            if font is None:
                try:
                    sys_os = platform.system()
                    if sys_os == "Windows":
                        font = ImageFont.truetype("arial.ttf", actual_font_size)
                    elif sys_os == "Darwin":
                        font = ImageFont.truetype("Arial.ttf", actual_font_size)
                    else:
                        font = ImageFont.truetype("DejaVuSans.ttf", actual_font_size)
                except:
                    font = ImageFont.load_default()
        else:
            font = ImageFont.load_default()

        processed_images = []
        for i, img in enumerate(resized_images):
            caption = texts_list[i].strip() if i < len(texts_list) else ""
            
            if actual_footer_height > 0 and caption:
                footer = Image.new("RGB", (img.width, actual_footer_height), bg_color)
                draw = ImageDraw.Draw(footer)
                bbox = draw.multiline_textbbox((0, 0), caption, font=font, align="center")
                tx = (footer.width - (bbox[2] - bbox[0])) / 2
                ty = (footer.height - (bbox[3] - bbox[1])) / 2
                draw.multiline_text((tx, ty), caption, fill=fg_color, font=font, align="center")
                
                combined = Image.new("RGB", (img.width, img.height + actual_footer_height), bg_color)
                combined.paste(img, (0, 0))
                combined.paste(footer, (0, img.height))
                img = combined

            if border_size > 0:
                img = ImageOps.expand(img, border=border_size, fill=bg_color)
                
            processed_images.append(img)

        final_img = Image.new("RGB", (final_w, final_h), bg_color)

        if merging_mode == "horizontal":
            x_offset = 0
            for img in processed_images:
                final_img.paste(img, (x_offset, 0))
                x_offset += img.width

        elif merging_mode == "vertical":
            y_offset = 0
            for img in processed_images:
                final_img.paste(img, (0, y_offset))
                y_offset += img.height

        elif merging_mode in ["grid 2", "grid 3", "grid 4"]:
            cols = int(merging_mode.split(" ")[1])
            cell_w = max(img.width for img in processed_images)
            cell_h = max(img.height for img in processed_images)
            for i, img in enumerate(processed_images):
                x_offset = (i % cols) * cell_w + (cell_w - img.width) // 2
                y_offset = (i // cols) * cell_h + (cell_h - img.height) // 2
                final_img.paste(img, (x_offset, y_offset))

        elif merging_mode == "grid 2 + 1":
            if len(processed_images) >= 3:
                img0, img1, img2 = processed_images[0], processed_images[1], processed_images[2]
                col1_width = max(img0.width, img1.width)
                
                x0, x1 = (col1_width - img0.width) // 2, (col1_width - img1.width) // 2
                final_img.paste(img0, (x0, 0))
                final_img.paste(img1, (x1, img0.height))
                
                y2 = max(0, ((img0.height + img1.height) - img2.height) // 2)
                final_img.paste(img2, (col1_width, y2))
            else:
                final_img = processed_images[0]

        elif merging_mode == "grid 3 + 1":
            if len(processed_images) >= 4:
                img0, img1, img2, img3 = processed_images[0], processed_images[1], processed_images[2], processed_images[3]
                col1_width = max(img0.width, img1.width, img2.width)
                
                x0, x1, x2 = (col1_width - img0.width) // 2, (col1_width - img1.width) // 2, (col1_width - img2.width) // 2
                final_img.paste(img0, (x0, 0))
                final_img.paste(img1, (x1, img0.height))
                final_img.paste(img2, (x2, img0.height + img1.height))
                
                y3 = max(0, ((img0.height + img1.height + img2.height) - img3.height) // 2)
                final_img.paste(img3, (col1_width, y3))
            else:
                final_img = processed_images[0]

        return (pil2tensor(final_img), final_img.width, final_img.height,)

NODE_CLASS_MAPPINGS = {
    "OrexImageMerging": OrexImageMerging
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "OrexImageMerging": "Orex Image Merging"
}