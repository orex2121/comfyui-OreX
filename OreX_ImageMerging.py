import os
import math
import torch
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

def tensor2pil(image):
    return Image.fromarray(np.clip(255. * image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

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

        # Ищем impact.ttf и делаем его первым в списке (по умолчанию)
        impact_font = next((f for f in file_list if f.lower() == "impact.ttf"), None)
        if impact_font:
            file_list.remove(impact_font)
            file_list.insert(0, impact_font)

        colors = ["white", "black", "crimson", "coral", "gold", "emerald", "teal", "cyan", "azure", "indigo", "violet", "fuchsia", "rose", "slate"]
        merging_modes = ["horizontal", "vertical", "grid 2", "grid 3", "grid 4", "grid 2 + 1", "grid 3 + 1"]
        upscale_methods = ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"]

        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": "Caption 1\nCaption 2"}),
                "image_number": ("INT", {"default": 2, "min": 2, "max": 999}),
                "merging_mode": (merging_modes, {"default": "horizontal"}),
                "main_resolution_image": ("INT", {"default": 1, "min": 1, "max": 999}),
                "footer_height": ("FLOAT", {"default": 5.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "font_name": (file_list,),
                "font_size": ("FLOAT", {"default": 4.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "mode": (colors,),
                "border_thickness": ("INT", {"default": 20, "min": 0, "max": 1024}),
                "upscale_method": (upscale_methods, {"default": "lanczos"}),
                "megapixels": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 0.1}),
            },
            "optional": {
                "image1": ("IMAGE",),
                "image2": ("IMAGE",),
            }
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

        actual_footer_height = int(base_h * (footer_height / 100.0))
        actual_font_size = int(base_h * (font_size / 100.0))

        resample_map = {
            "nearest-exact": Image.Resampling.NEAREST,
            "bilinear": Image.Resampling.BILINEAR,
            "area": Image.Resampling.BOX,
            "bicubic": Image.Resampling.BICUBIC,
            "lanczos": Image.Resampling.LANCZOS
        }
        resampler = resample_map.get(upscale_method, Image.Resampling.LANCZOS)

        # Подготовка данных о тексте для расчета точных высот рамок
        texts_list = text.split('\n')
        def get_footer_h(idx):
            caption = texts_list[idx].strip() if idx < len(texts_list) else ""
            return actual_footer_height if caption else 0

        b_thick = border_thickness * 2 if border_thickness > 0 else 0

        # 5. Ресайз: Базовый проход
        new_dims = []
        for i, img in enumerate(valid_images):
            new_w, new_h = img.width, img.height
            
            if merging_mode == "horizontal":
                new_h = base_h
                new_w = int(round(img.width * (base_h / img.height)))
            elif merging_mode == "vertical":
                new_w = base_w
                new_h = int(round(img.height * (base_w / img.width)))
            elif merging_mode.startswith("grid"):
                target_area = base_w * base_h
                
                if merging_mode == "grid 2 + 1":
                    if main_idx in [0, 1]:
                        if i == 2: target_area = (base_w * base_h) * 2
                    elif main_idx == 2:
                        if i in [0, 1]: target_area = (base_w * base_h) / 2
                elif merging_mode == "grid 3 + 1":
                    if main_idx in [0, 1, 2]:
                        if i == 3: target_area = (base_w * base_h) * 3
                    elif main_idx == 3:
                        if i in [0, 1, 2]: target_area = (base_w * base_h) / 3

                current_area = img.width * img.height
                if current_area > 0:
                    scale = math.sqrt(target_area / current_area)
                    new_w = int(round(img.width * scale))
                    new_h = int(round(img.height * scale))

            new_dims.append((new_w, new_h))

        # 5.1 Точная корректировка "+1" изображения для идеального выравнивания
        if merging_mode == "grid 2 + 1" and len(new_dims) >= 3:
            h0 = new_dims[0][1] + get_footer_h(0) + b_thick
            h1 = new_dims[1][1] + get_footer_h(1) + b_thick
            total_left_h = h0 + h1
            
            # Вычисляем нужную чистую высоту для правого изображения
            img2_new_h = max(1, total_left_h - get_footer_h(2) - b_thick)
            orig_w, orig_h = valid_images[2].width, valid_images[2].height
            
            # Подгоняем ширину, строго сохраняя пропорции
            img2_new_w = max(1, int(round(orig_w * (img2_new_h / orig_h))))
            new_dims[2] = (img2_new_w, img2_new_h)
            
        elif merging_mode == "grid 3 + 1" and len(new_dims) >= 4:
            h0 = new_dims[0][1] + get_footer_h(0) + b_thick
            h1 = new_dims[1][1] + get_footer_h(1) + b_thick
            h2 = new_dims[2][1] + get_footer_h(2) + b_thick
            total_left_h = h0 + h1 + h2
            
            img3_new_h = max(1, total_left_h - get_footer_h(3) - b_thick)
            orig_w, orig_h = valid_images[3].width, valid_images[3].height
            
            img3_new_w = max(1, int(round(orig_w * (img3_new_h / orig_h))))
            new_dims[3] = (img3_new_w, img3_new_h)

        # 5.2 Применяем вычисленные размеры
        resized_images = []
        for i, img in enumerate(valid_images):
            new_w, new_h = new_dims[i]
            if (new_w, new_h) != (img.width, img.height) and new_w > 0 and new_h > 0:
                resized_img = img.resize((new_w, new_h), resampler)
            else:
                resized_img = img
            resized_images.append(resized_img)

        # 6. Добавление текста и рамок
        font_path = os.path.join(os.path.dirname(os.path.realpath(__file__)), "fonts", font_name)
        try:
            if actual_font_size > 0:
                font = ImageFont.truetype(font_path, actual_font_size)
            else:
                font = ImageFont.load_default()
        except:
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

            if border_thickness > 0:
                img = ImageOps.expand(img, border=border_thickness, fill=bg_color)
                
            processed_images.append(img)

        # 7. Стратегии склейки (с центрированием элементов)
        if merging_mode == "horizontal":
            total_w = sum(img.width for img in processed_images)
            max_h = max(img.height for img in processed_images)
            final_img = Image.new("RGB", (total_w, max_h), bg_color)
            x_offset = 0
            for img in processed_images:
                final_img.paste(img, (x_offset, 0))
                x_offset += img.width

        elif merging_mode == "vertical":
            max_w = max(img.width for img in processed_images)
            total_h = sum(img.height for img in processed_images)
            final_img = Image.new("RGB", (max_w, total_h), bg_color)
            y_offset = 0
            for img in processed_images:
                final_img.paste(img, (0, y_offset))
                y_offset += img.height

        elif merging_mode in ["grid 2", "grid 3", "grid 4"]:
            cols = int(merging_mode.split(" ")[1])
            rows = math.ceil(len(processed_images) / cols)
            cell_w = max(img.width for img in processed_images)
            cell_h = max(img.height for img in processed_images)
            final_img = Image.new("RGB", (cols * cell_w, rows * cell_h), bg_color)
            for i, img in enumerate(processed_images):
                x_offset = (i % cols) * cell_w + (cell_w - img.width) // 2
                y_offset = (i // cols) * cell_h + (cell_h - img.height) // 2
                final_img.paste(img, (x_offset, y_offset))

        elif merging_mode == "grid 2 + 1":
            if len(processed_images) >= 3:
                img0, img1, img2 = processed_images[0], processed_images[1], processed_images[2]
                col1_width = max(img0.width, img1.width)
                final_img = Image.new("RGB", (col1_width + img2.width, max(img0.height + img1.height, img2.height)), bg_color)
                
                # Центрируем левый столбец
                x0 = (col1_width - img0.width) // 2
                x1 = (col1_width - img1.width) // 2
                
                final_img.paste(img0, (x0, 0))
                final_img.paste(img1, (x1, img0.height))
                
                # Центрируем правое изображение (хотя оно теперь идеально совпадает по высоте)
                y2 = max(0, ((img0.height + img1.height) - img2.height) // 2)
                final_img.paste(img2, (col1_width, y2))
            else:
                final_img = processed_images[0]

        elif merging_mode == "grid 3 + 1":
            if len(processed_images) >= 4:
                img0, img1, img2, img3 = processed_images[0], processed_images[1], processed_images[2], processed_images[3]
                col1_width = max(img0.width, img1.width, img2.width)
                final_img = Image.new("RGB", (col1_width + img3.width, max(img0.height + img1.height + img2.height, img3.height)), bg_color)
                
                x0 = (col1_width - img0.width) // 2
                x1 = (col1_width - img1.width) // 2
                x2 = (col1_width - img2.width) // 2
                
                final_img.paste(img0, (x0, 0))
                final_img.paste(img1, (x1, img0.height))
                final_img.paste(img2, (x2, img0.height + img1.height))
                
                y3 = max(0, ((img0.height + img1.height + img2.height) - img3.height) // 2)
                final_img.paste(img3, (col1_width, y3))
            else:
                final_img = processed_images[0]

        # 8. Megapixel Scaling Precision
        if megapixels > 0.0:
            current_pixels = final_img.width * final_img.height
            target_pixels = megapixels * 1_000_000
            if current_pixels > 0:
                scale_factor = math.sqrt(target_pixels / current_pixels)
                new_w = round(final_img.width * scale_factor)
                new_h = round(final_img.height * scale_factor)
                if new_w > 0 and new_h > 0:
                    final_img = final_img.resize((new_w, new_h), resampler)

        return (pil2tensor(final_img), final_img.width, final_img.height,)