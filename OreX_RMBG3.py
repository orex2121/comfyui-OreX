"""RMBG-3.0 background removal using ComfyUI's native Fibo2 pipeline."""

import gc
import json
import math
import os
import urllib.request

import numpy as np
import torch
from huggingface_hub import get_token
from PIL import Image, ImageFilter

import comfy.model_management
import comfy.samplers
import comfy.sd
import comfy.text_encoders.fibo2
import comfy.utils
import folder_paths
import node_helpers
import nodes


MODEL_NAME = "rmbg_3.0_int8_convrot.safetensors"
DOWNLOAD_LABEL = "Download rmbg_3.0_int8_convrot"
MODEL_RESOURCE = "https://huggingface.co/OreX/Models2/blob/main/RMBG/rmbg_3.0_int8_convrot.safetensors"
MODEL_DOWNLOAD = "https://huggingface.co/OreX/Models2/resolve/main/RMBG/rmbg_3.0_int8_convrot.safetensors"
INSTRUCTION = (
    "Generate a detailed grayscale alpha matte. Map the opaque foreground to white and the "
    "background to black. Produce soft, anti-aliased grayscale gradients at the edges of the "
    "subject to represent fine details and transparency."
)
LOG_PREFIX = "[OreX RMBG 3.0]"

_cache = {"key": None, "model": None}


def _download(url, destination):
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    partial = destination + ".part"
    headers = {"User-Agent": "comfyui-OreX"}
    token = get_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response, open(partial, "wb") as output:
            total = int(response.headers.get("Content-Length") or 0)
            progress = comfy.utils.ProgressBar(total) if total else None
            done = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                done += len(chunk)
                if progress:
                    progress.update_absolute(done, total)
        if total and done != total:
            raise IOError(f"incomplete download: {done} of {total} bytes")
        os.replace(partial, destination)
    except Exception:
        if os.path.exists(partial):
            os.remove(partial)
        raise


def _model_path(model_name):
    if model_name == DOWNLOAD_LABEL:
        path = os.path.join(folder_paths.models_dir, "Diffusion_Models", MODEL_NAME)
        if os.path.isfile(path):
            return path
        for existing_name in folder_paths.get_filename_list("diffusion_models"):
            if os.path.basename(existing_name) == MODEL_NAME:
                existing_path = folder_paths.get_full_path("diffusion_models", existing_name)
                if existing_path and os.path.isfile(existing_path):
                    return existing_path
        try:
            print(f"{LOG_PREFIX} Model not found. Downloading: {MODEL_RESOURCE}")
            _download(MODEL_DOWNLOAD, path)
        except Exception as error:
            raise RuntimeError(
                f"{LOG_PREFIX} Ресурс для скачивания модели недоступен. "
                f"Скачайте модель вручную:\n{MODEL_RESOURCE}\n"
                f"и поместите файл сюда:\n{path}\n\n"
                f"The model download resource is unavailable. Download it manually from:\n"
                f"{MODEL_RESOURCE}\nError: {error}"
            ) from error
        return path

    path = folder_paths.get_full_path("diffusion_models", model_name)
    if path and os.path.isfile(path):
        return path
    raise RuntimeError(f"{LOG_PREFIX} Model not found / Модель не найдена:\n{model_name}")


def _load_model(model_name):
    path = _model_path(model_name)
    key = (path, os.path.getmtime(path))
    if _cache["key"] != key:
        _cache.update(key=key, model=comfy.sd.load_diffusion_model(path, model_options={}))
        if _cache["model"] is None:
            raise RuntimeError(f"{LOG_PREFIX} Не удалось загрузить модель: {path}")
    return _cache["model"]


def _trained_size(aspect_ratio, processing_resolution):
    area = processing_resolution * processing_resolution
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


def _make_conditioning(clip, vae, image, prompt):
    tokens = clip.tokenize(json.dumps({"edit_instruction": prompt}), images=[image])
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
                "model": ([DOWNLOAD_LABEL, *folder_paths.get_filename_list("diffusion_models")], {
                    "default": DOWNLOAD_LABEL,
                    "tooltip": "Select any model from models/Diffusion_Models, including its subfolders. Download rmbg_3.0_int8_convrot uses the local file if present; otherwise it downloads it from OreX/Models2.\n────────\nВыберите любую модель из models/Diffusion_Models, включая подпапки. Download rmbg_3.0_int8_convrot использует локальный файл, если он существует; иначе скачивает его из OreX/Models2.",
                }),
                "image": ("IMAGE", {"tooltip": "The image whose background will be removed.\n────────\nИзображение, у которого нужно удалить фон."}),
                "clip": ("CLIP", {"tooltip": "Fibo2 text and vision encoder. Connect qwen3vl_4b_int8_convrot.safetensors from a Load CLIP node.\n────────\nТекстовый и визуальный энкодер Fibo2. Подключите qwen3vl_4b_int8_convrot.safetensors из узла Load CLIP."}),
                "vae": ("VAE", {"tooltip": "Fibo2 VAE. Connect flux2-vae.safetensors from a Load VAE node.\n────────\nVAE модели Fibo2. Подключите flux2-vae.safetensors из узла Load VAE."}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True, "tooltip": "The initial number used to generate the matte. The same seed produces a reproducible result.\n────────\nНачальное число генерации маски. Одинаковый seed даёт воспроизводимый результат."}),
                "steps": ("INT", {"default": 4, "min": 1, "max": 10000, "step": 1, "tooltip": "Number of diffusion sampling steps. RMBG-3.0 was distilled for 4 steps.\n────────\nКоличество шагов диффузионного сэмплирования. RMBG-3.0 дистиллирована для 4 шагов."}),
                "cfg": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 100.0, "step": 0.1, "round": 0.01, "tooltip": "Classifier-Free Guidance scale. The official RMBG-3.0 value is 1.0.\n────────\nСила Classifier-Free Guidance. Официальное значение RMBG-3.0 — 1.0."}),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS, {"default": "euler", "tooltip": "Sampling algorithm. The current official-compatible default is euler.\n────────\nАлгоритм сэмплирования. Текущее совместимое значение по умолчанию — euler."}),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS, {"default": "simple", "tooltip": "Noise sigma scheduler. The current official-compatible default is simple.\n────────\nПланировщик сигм шума. Текущее совместимое значение по умолчанию — simple."}),
                "prompt": ("STRING", {"default": INSTRUCTION, "multiline": True, "dynamicPrompts": False, "tooltip": "Alpha-matte instruction. The default is the exact fixed prompt used by RMBG-3.0 training; changing it may produce an incorrect or colored result.\n────────\nИнструкция для альфа-маски. По умолчанию используется точный фиксированный промпт обучения RMBG-3.0; его изменение может дать неправильный или цветной результат."}),
                "processing_resolution": ("INT", {"default": 1024, "min": 256, "max": 2048, "step": 64, "tooltip": "Target processing resolution. 1024 means approximately one megapixel; width and height are adapted to the source aspect ratio and multiples of 16.\n────────\nЦелевое разрешение обработки. 1024 означает примерно один мегапиксель; ширина и высота подбираются под пропорции исходника и кратность 16."}),
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
    DESCRIPTION = "RMBG-3.0 Int8 ConvRot: generative alpha matting with configurable Fibo2 sampling settings."

    def remove_background(
        self, model, image, clip, vae, seed, steps, cfg, sampler_name, scheduler,
        prompt, processing_resolution, sensitivity=1.0, mask_blur=0,
        mask_offset=0, invert_output=False, refine_foreground=False,
        unload_model=False, background="Alpha", background_color="#222222",
    ):
        model = _load_model(model)
        masks = []
        with torch.inference_mode():
            for index, source in enumerate(image[..., :3]):
                source = source.unsqueeze(0)
                original_height, original_width = source.shape[1:3]
                width, height = _trained_size(
                    original_width / original_height, processing_resolution
                )
                prepared = comfy.utils.common_upscale(
                    source.movedim(-1, 1), width, height, "lanczos", "center"
                ).movedim(1, -1)
                positive, negative = _make_conditioning(
                    clip, vae, prepared, prompt
                )
                latent = {
                    "samples": torch.zeros(
                        [1, 128, height // 16, width // 16],
                        device=comfy.model_management.intermediate_device(),
                    )
                }
                sampled = nodes.common_ksampler(
                    model, seed + index, steps, cfg, sampler_name, scheduler,
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
