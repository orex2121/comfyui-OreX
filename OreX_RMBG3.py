"""RMBG-3.0 background removal using ComfyUI's native Fibo2 pipeline."""

import gc
import json
import math
import os

import numpy as np
import torch
from PIL import Image, ImageFilter

import comfy.model_management
import comfy.sd
import comfy.text_encoders.fibo2
import comfy.utils
import folder_paths
import node_helpers
import nodes


MODEL_NAME = os.path.join("Fibo2", "rmbg_3.0_int8_convrot.safetensors")
MODEL_RESOURCE = "https://huggingface.co/briaai/RMBG-3.0"
INSTRUCTION = (
    "Generate a detailed grayscale alpha matte. Map the opaque foreground to white and the "
    "background to black. Produce soft, anti-aliased grayscale gradients at the edges of the "
    "subject to represent fine details and transparency."
)
PROMPT = json.dumps({"edit_instruction": INSTRUCTION})
LOG_PREFIX = "[OreX RMBG 3.0]"

_cache = {"key": None, "model": None}


def _model_path():
    path = folder_paths.get_full_path("diffusion_models", MODEL_NAME)
    if path and os.path.isfile(path):
        return path
    expected = os.path.join(folder_paths.models_dir, "Diffusion_Models", MODEL_NAME)
    raise RuntimeError(
        f"{LOG_PREFIX} Модель не найдена:\n{expected}\n"
        f"Исходный репозиторий: {MODEL_RESOURCE}"
    )


def _load_model():
    path = _model_path()
    key = (path, os.path.getmtime(path))
    if _cache["key"] != key:
        _cache.update(key=key, model=comfy.sd.load_diffusion_model(path, model_options={}))
        if _cache["model"] is None:
            raise RuntimeError(f"{LOG_PREFIX} Не удалось загрузить модель: {path}")
    return _cache["model"]


def _trained_size(aspect_ratio):
    area = 1024 * 1024
    sizes = [
        (w, h)
        for w in range(64, 2 * area // 64, 16)
        for h in range(
            max(64, 16 * math.ceil(0.9 * area / w / 16)),
            16 * math.floor(1.1 * area / w / 16) + 1,
            16,
        )
    ]
    return min(
        sizes,
        key=lambda size: (
            round(1 - min(size[0] / size[1] / aspect_ratio, aspect_ratio * size[1] / size[0]), 9),
            abs(size[0] * size[1] - area),
            -size[0],
        ),
    )


def _filter_mask(mask, blur, offset):
    array = mask.detach().clamp(0, 1).cpu().numpy()
    image = Image.fromarray((array * 255).round().astype(np.uint8), "L")
    if blur:
        image = image.filter(ImageFilter.GaussianBlur(radius=blur))
    filter_type = ImageFilter.MaxFilter if offset > 0 else ImageFilter.MinFilter
    for _ in range(abs(offset)):
        image = image.filter(filter_type(3))
    return torch.from_numpy(np.asarray(image, dtype=np.float32).copy() / 255.0)


def _parse_color(value):
    value = value.lstrip("#")
    if len(value) not in (6, 8):
        raise ValueError("background_color must be #RRGGBB or #RRGGBBAA")
    rgba = [int(value[i:i + 2], 16) / 255.0 for i in range(0, len(value), 2)]
    return rgba if len(rgba) == 4 else rgba + [1.0]


def _make_conditioning(clip, vae, image):
    tokens = clip.tokenize(PROMPT, images=[image])
    positive = clip.encode_from_tokens_scheduled(tokens)
    negative = clip.encode_from_tokens_scheduled(clip.tokenize(""))
    reference_latent = vae.encode(image)
    values = {"reference_latents": [reference_latent]}
    positive = node_helpers.conditioning_set_values(positive, values, append=True)
    negative = node_helpers.conditioning_set_values(negative, values, append=True)
    return positive, negative


class OreX_RMBG3:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "The image whose background will be removed.\n────────\nИзображение, у которого нужно удалить фон."}),
                "clip": ("CLIP", {"tooltip": "Fibo2 text and vision encoder. Connect qwen3vl_4b_int8_convrot.safetensors from a Load CLIP node.\n────────\nТекстовый и визуальный энкодер Fibo2. Подключите qwen3vl_4b_int8_convrot.safetensors из узла Load CLIP."}),
                "vae": ("VAE", {"tooltip": "Fibo2 VAE. Connect flux2-vae.safetensors from a Load VAE node.\n────────\nVAE модели Fibo2. Подключите flux2-vae.safetensors из узла Load VAE."}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True, "tooltip": "The initial number used to generate the matte. The same seed produces a reproducible result.\n────────\nНачальное число генерации маски. Одинаковый seed даёт воспроизводимый результат."}),
            },
            "optional": {
                "sensitivity": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": "Matte sensitivity. A lower value expands bright and semi-transparent foreground areas.\n────────\nЧувствительность маски. Меньшее значение расширяет светлые и полупрозрачные области переднего плана."}),
                "mask_blur": ("INT", {"default": 0, "min": 0, "max": 64, "step": 1, "tooltip": "Matte blur radius in pixels, used to soften its edges.\n────────\nРадиус размытия маски в пикселях для смягчения её краёв."}),
                "mask_offset": ("INT", {"default": 0, "min": -64, "max": 64, "step": 1, "tooltip": "Expands or contracts the matte in pixels: positive values expand it, negative values contract it.\n────────\nРасширение или сжатие маски в пикселях: положительное значение расширяет, отрицательное сжимает."}),
                "invert_output": ("BOOLEAN", {"default": False, "tooltip": "Invert the matte so the background becomes the foreground and vice versa.\n────────\nИнвертировать маску: фон станет передним планом, а передний план — фоном."}),
                "refine_foreground": ("BOOLEAN", {"default": False, "tooltip": "Multiply the foreground RGB by the matte to clean residual color from transparent areas.\n────────\nДополнительно умножить RGB переднего плана на маску, очищая остатки цвета в прозрачных областях."}),
                "unload_model": ("BOOLEAN", {"default": False, "tooltip": "Remove RMBG‑3.0 from the cache after processing to free memory. The next run will load it again.\n────────\nВыгрузить RMBG‑3.0 из кэша после обработки, чтобы освободить память. Следующий запуск потребует повторной загрузки."}),
                "background": (["Alpha", "Color"], {"default": "Alpha", "tooltip": "Alpha keeps the background transparent. Color replaces it with the solid background_color value.\n────────\nAlpha сохраняет прозрачный фон. Color заменяет фон сплошным цветом из background_color."}),
                "background_color": ("COLORCODE", {"default": "#222222", "tooltip": "The replacement background color used in Color mode. It is ignored in Alpha mode.\n────────\nЦвет нового фона в режиме Color. В режиме Alpha не используется."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE")
    RETURN_NAMES = ("IMAGE", "MASK", "MASK IMAGE")
    OUTPUT_TOOLTIPS = (
        "Image with a transparent or solid-color background.\n────────\nИзображение с прозрачным или цветным фоном.",
        "Matte: white is kept and black is removed.\n────────\nМаска: белое сохраняется, чёрное удаляется.",
        "The same matte converted to a three-channel image for preview.\n────────\nТа же маска, преобразованная в трёхканальное изображение для предпросмотра.",
    )
    FUNCTION = "remove_background"
    CATEGORY = "OreX/Image"
    DESCRIPTION = "RMBG-3.0 Int8 ConvRot: generative 4-step alpha matting with the existing Fibo2 CLIP and VAE."

    def remove_background(
        self, image, clip, vae, seed, sensitivity=1.0, mask_blur=0,
        mask_offset=0, invert_output=False, refine_foreground=False,
        unload_model=False, background="Alpha", background_color="#222222",
    ):
        model = _load_model()
        masks = []
        with torch.inference_mode():
            for index, source in enumerate(image[..., :3]):
                source = source.unsqueeze(0)
                original_height, original_width = source.shape[1:3]
                width, height = _trained_size(original_width / original_height)
                prepared = comfy.utils.common_upscale(
                    source.movedim(-1, 1), width, height, "lanczos", "center"
                ).movedim(1, -1)
                positive, negative = _make_conditioning(clip, vae, prepared)
                latent = {
                    "samples": torch.zeros(
                        [1, 128, height // 16, width // 16],
                        device=comfy.model_management.intermediate_device(),
                    )
                }
                sampled = nodes.common_ksampler(
                    model, seed + index, 4, 1.0, "euler", "simple",
                    positive, negative, latent, denoise=1.0,
                )[0]
                matte_rgb = vae.decode(sampled["samples"])[..., :3].clamp(0, 1)
                matte = (
                    matte_rgb[..., 0] * 0.299
                    + matte_rgb[..., 1] * 0.587
                    + matte_rgb[..., 2] * 0.114
                )
                matte = comfy.utils.common_upscale(
                    matte.unsqueeze(1), original_width, original_height, "lanczos", "disabled"
                ).squeeze(1)[0]
                masks.append(_filter_mask(
                    (matte * (2.0 - sensitivity)).clamp(0, 1), mask_blur, mask_offset
                ))

        masks = torch.stack(masks)
        if invert_output:
            masks = 1.0 - masks

        rgb = image[..., :3].cpu()
        alpha = masks.unsqueeze(-1)
        foreground = rgb * alpha if refine_foreground else rgb
        if background == "Color":
            color = torch.tensor(_parse_color(background_color)[:3], dtype=rgb.dtype)
            output = foreground * alpha + color * (1.0 - alpha)
        else:
            output = torch.cat((foreground, alpha.to(foreground.dtype)), dim=-1)
        mask_image = alpha.expand(-1, -1, -1, 3)

        if unload_model:
            _cache.update(key=None, model=None)
            del model
            gc.collect()
            comfy.model_management.soft_empty_cache()
        return output.to(image), masks.to(image), mask_image.to(image)


NODE_CLASS_MAPPINGS = {"OreX RMBG 3.0": OreX_RMBG3}
NODE_DISPLAY_NAME_MAPPINGS = {"OreX RMBG 3.0": "🪄 Remove Background RMBG 3.0 (OreX)"}
