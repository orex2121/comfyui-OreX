import torch
import numpy as np
from PIL import Image
import folder_paths
import os
import random
import string
import torch.nn.functional as F

class OreXCrop:
    """
    A professional ComfyUI node for interactive high-precision cropping.
    Provides a canvas-based interface for visual selection.
    Inputs are now percentages (0-100).
    """
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",),
                "crop_left": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "crop_right": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "crop_top": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "crop_bottom": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 0.1}),
            },
            "optional": {
                "width": ("INT", {"default": 512, "min": 0, "max": 16384, "step": 1}),
                "height": ("INT", {"default": 512, "min": 0, "max": 16384, "step": 1}),
                "multiplicity": ("INT", {"default": 16, "min": 1, "max": 64, "step": 1}),
                "resolution (MP)": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 0.01}),
                "upscale_method": (["nearest-exact", "bilinear", "area", "bicubic", "lanczos"], {"default": "bicubic"}),
                "aspect_ratio": ("STRING", {"default": "Custom"}),
                "ratio_lock": ("BOOLEAN", {"default": False, "label_on": "🟢 ENABLED", "label_off": "🔴 DISABLED"}),
                "mask": ("MASK",),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "width", "height")
    FUNCTION = "execute_crop"
    CATEGORY = "image/process"
    OUTPUT_NODE = True

    def execute_crop(self, image: torch.Tensor, crop_left: float, crop_right: float, crop_top: float, crop_bottom: float, 
                     width: int = 512, height: int = 512, multiplicity: int = 16, **kwargs):
        
        upscale_method = kwargs.get("upscale_method", "bicubic")
        mask = kwargs.get("mask", None)

        batch_size, h, w, channels = image.shape
        
        # 1. Convert percentages to pixels
        left_px = int(crop_left / 100.0 * w)
        right_px_from_edge = int(crop_right / 100.0 * w)
        top_px = int(crop_top / 100.0 * h)
        bottom_px_from_edge = int(crop_bottom / 100.0 * h)

        left = max(0, min(w - 1, left_px))
        right = max(left + 1, w - right_px_from_edge)
        top = max(0, min(h - 1, top_px))
        bottom = max(top + 1, h - bottom_px_from_edge)
        
        # 2. Slice image tensor
        cropped_image = image[:, top:bottom, left:right, :]
        current_h, current_w = cropped_image.shape[1], cropped_image.shape[2]
        
        # --- ИНТЕЛЛЕКТУАЛЬНЫЙ РАСЧЕТ ИТОГОВОГО РАЗРЕШЕНИЯ ---
        mult = max(1, int(multiplicity))
        res = kwargs.get("resolution (MP)", 0.0)

        if res > 0 and current_h > 0:
            # Если заданы мегапиксели, пересчитываем строго по ним с сохранением пропорций
            target_area = res * 1000000.0
            ratio = current_w / current_h
            target_w = (target_area * ratio) ** 0.5
            target_h = (target_area / ratio) ** 0.5
        else:
            # Используем виджеты из UI
            target_w = float(width)
            target_h = float(height)
            
            # ЗАЩИТА ОТ ДЕФОРМАЦИИ ПРИ ПЕРВОМ ЗАПУСКЕ
            # Сравниваем реальные пропорции вырезанного куска с тем, что пришло от устаревших виджетов
            if current_h > 0 and target_h > 0:
                actual_ratio = current_w / current_h
                widget_ratio = target_w / target_h
                
                # Если разница пропорций больше 2%, значит UI прислал старые данные от прошлого изображения
                if abs(actual_ratio - widget_ratio) > 0.02:
                    target_w = float(current_w)
                    target_h = float(current_h)

        # Применяем кратность (multiplicity)
        final_width = max(mult, round(target_w / mult) * mult)
        final_height = max(mult, round(target_h / mult) * mult)
        
        # 3. Handle Mask
        if mask is not None:
            cropped_mask = mask[:, top:bottom, left:right]
            if cropped_mask.shape[1] != final_height or cropped_mask.shape[2] != final_width:
                mask_nchw = cropped_mask.unsqueeze(1)
                resized_mask_nchw = F.interpolate(mask_nchw, size=(final_height, final_width), mode='bilinear', align_corners=False)
                cropped_mask = resized_mask_nchw.squeeze(1)
        else:
            cropped_mask = torch.ones((batch_size, final_height, final_width), dtype=torch.float32, device=image.device)
        
        # 4. Resize Image to Target Dimensions
        if current_h != final_height or current_w != final_width:
            target_size = (final_height, final_width)
            
            mode_map = {
                "nearest-exact": "nearest",
                "bilinear": "bilinear",
                "bicubic": "bicubic",
                "area": "area"
            }
            
            pt_mode = mode_map.get(upscale_method, "bilinear")
            
            if upscale_method == "lanczos":
                resized_images = []
                image_cpu = cropped_image.cpu()
                for i in range(batch_size):
                    img_nhwc = image_cpu[i]
                    img_hwc_np = (img_nhwc.numpy() * 255.0).astype(np.uint8)
                    pil_img = Image.fromarray(img_hwc_np)
                    resized_pil = pil_img.resize((final_width, final_height), Image.Resampling.LANCZOS)
                    resized_np = np.array(resized_pil).astype(np.float32) / 255.0
                    resized_images.append(torch.from_numpy(resized_np))
                
                cropped_image = torch.stack(resized_images, dim=0).to(image.device)
            else:
                img_nchw = cropped_image.permute(0, 3, 1, 2)
                align_corners = None if pt_mode == "area" else False
                resized_nchw = F.interpolate(img_nchw, size=target_size, mode=pt_mode, align_corners=align_corners)
                cropped_image = resized_nchw.permute(0, 2, 3, 1)

        # 5. Generate Preview Image
        preview_results = []
        preview_tensor = image[0]
        preview_array = 255. * preview_tensor.cpu().numpy()
        preview_img = Image.fromarray(np.clip(preview_array, 0, 255).astype(np.uint8))
        
        MAX_PREVIEW_SIZE = 1024
        preview_scale = 1.0
        if preview_img.width > MAX_PREVIEW_SIZE or preview_img.height > MAX_PREVIEW_SIZE:
            preview_scale = MAX_PREVIEW_SIZE / max(preview_img.width, preview_img.height)
            new_size = (int(preview_img.width * preview_scale), int(preview_img.height * preview_scale))
            preview_img = preview_img.resize(new_size, Image.Resampling.BILINEAR)
        
        # 6. Save temp preview
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            "orex_crop_preview", folder_paths.get_temp_directory()
        )
        
        random_suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=5))
        preview_filename = f"{filename}_{counter:05}_{random_suffix}.png"
        preview_path = os.path.join(full_output_folder, preview_filename)
        
        preview_img.save(preview_path)
        preview_results.append({
            "filename": preview_filename,
            "subfolder": subfolder,
            "type": "temp"
        })

        return {
            "ui": {
                "images": preview_results,
                "preview_scale": [preview_scale],
                "orig_size": [int(w), int(h)]
            },
            "result": (cropped_image, cropped_mask, final_width, final_height)
        }

NODE_CLASS_MAPPINGS = {"orex Crop": OreXCrop}
NODE_DISPLAY_NAME_MAPPINGS = {"orex Crop": "🔳Crop (OreX)"}