import torch
import math
import comfy.model_management

class OreXRatio:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ratio": (
                    [
                        "1:1 ◻", 
                        "5:4 ▭", "4:3 ▭", "3:2 ▭", "16:9 ▭", "2:1 ▭", "21:9 ▭", "32:9 ▭",
                        "4:5 ▯", "3:4 ▯", "2:3 ▯", "9:16 ▯", "1:2 ▯", "9:21 ▯", "9:32 ▯",
                        "Custom"
                    ],
                    {"default": "1:1 ◻"}
                ),
                "Megapixel": ("FLOAT", {"default": 1.00, "min": 0.1, "max": 50.0, "step": 0.01}),
                "Megapixel = 1024^2": ("BOOLEAN", {"default": True}),
                "Multiplicity": ("INT", {"default": 16, "min": 8, "max": 256, "step": 8}),
                "custom_width": ("INT", {"default": 1024, "min": 64, "max": 16384, "step": 8}),
                "custom_height": ("INT", {"default": 1024, "min": 64, "max": 16384, "step": 8}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "LATENT", "LATENT", "LATENT")
    RETURN_NAMES = ("width", "height", "empty_latent_image", "empty_sd3_flux1_latent", "empty_flux2_latent")
    FUNCTION = "calculate"
    CATEGORY = "OreX"

    def calculate(self, ratio, Megapixel, Multiplicity, custom_width, custom_height, **kwargs):
        # Проверяем состояние переключателя
        use_1024 = kwargs.get("Megapixel = 1024^2", True)
        base_pixels = (1024 * 1024) if use_1024 else (1000 * 1000)

        clean_ratio = ratio.split(' ')[0]
        
        # Если кастомное - берем значения, которые JS передал через скрытые поля
        if clean_ratio == "Custom":
            w_base = custom_width
            h_base = custom_height
        else:
            w_ratio, h_ratio = map(float, clean_ratio.split(':'))
            target_pixels = Megapixel * base_pixels
            ratio_fraction = w_ratio / h_ratio
            h_base = math.sqrt(target_pixels / ratio_fraction)
            w_base = h_base * ratio_fraction
        
        # Округляем до ближайшего числа, кратного Multiplicity
        width = int(round(w_base / Multiplicity) * Multiplicity)
        height = int(round(h_base / Multiplicity) * Multiplicity)

        # Получаем правильное устройство и тип данных, как в базовом узле ComfyUI
        device = comfy.model_management.intermediate_device()
        dtype = comfy.model_management.intermediate_dtype()

        # 1. Стандартный латент (SD 1.5, SDXL) с параметрами ComfyUI
        latent_image = torch.zeros([1, 4, height // 8, width // 8], device=device, dtype=dtype)
        
        # 2. Латент для SD3 и Flux 1
        sd3_flux1_latent = torch.zeros([1, 16, height // 8, width // 8], device=device, dtype=dtype)

        # 3. Латент для Flux 2
        flux2_latent = torch.zeros([1, 128, height // 16, width // 16], device=device, dtype=dtype)

        return (
            width, 
            height, 
            {"samples": latent_image, "downscale_ratio_spacial": 8}, 
            {"samples": sd3_flux1_latent, "downscale_ratio_spacial": 8}, 
            {"samples": flux2_latent, "downscale_ratio_spacial": 16}
        )