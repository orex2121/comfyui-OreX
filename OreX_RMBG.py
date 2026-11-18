"""RMBG-2.0 background removal with a compact INT8 safetensors checkpoint."""

import gc
import os
import urllib.request

import numpy as np
import torch
from huggingface_hub import get_token
from PIL import Image, ImageFilter
from safetensors.torch import load_file

import comfy.model_management
import comfy.utils
import folder_paths
from comfy.bg_removal_model import load_background_removal_model


MODEL_NAME = "rmbg-2.0-int8.safetensors"
MODEL_LABEL = "RMBG-2.0"
MODEL_FOLDER = "background_removal"
RESOURCE_URL = "https://huggingface.co/OreX/Models2/blob/main/RMBG/rmbg-2.0-int8.safetensors"
DOWNLOAD_URL = "https://huggingface.co/OreX/Models2/resolve/main/RMBG/rmbg-2.0-int8.safetensors"
SCALE_SUFFIX = ".__orex_int8_scale"
LOG_PREFIX = "[OreX RMBG Int8]"

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


def _ensure_model():
    destination = os.path.join(folder_paths.models_dir, MODEL_FOLDER, MODEL_NAME)
    if os.path.isfile(destination):
        return destination

    try:
        print(f"{LOG_PREFIX} Model not found. Downloading: {RESOURCE_URL}")
        _download(DOWNLOAD_URL, destination)
    except Exception as error:
        raise RuntimeError(
            f"{LOG_PREFIX} Ресурс для скачивания модели недоступен. "
            f"Скачайте модель вручную:\n{RESOURCE_URL}\n"
            f"и поместите файл сюда:\n{destination}\n\n"
            f"The model download resource is unavailable. Download it manually from:\n"
            f"{RESOURCE_URL}\nError: {error}"
        ) from error
    return destination


def _load_model():
    path = _ensure_model()
    key = (path, os.path.getmtime(path))
    if _cache["key"] == key:
        return _cache["model"]

    state = load_file(path, device="cpu")
    for scale_name in [name for name in state if name.endswith(SCALE_SUFFIX)]:
        name = scale_name[:-len(SCALE_SUFFIX)]
        tensor = state[name]
        scale = state.pop(scale_name).float()
        view = scale.view(scale.shape[0], *([1] * (tensor.ndim - 1)))
        state[name] = (tensor.float() * view).to(torch.float16)

    model = load_background_removal_model(state)
    if model is None:
        raise RuntimeError(f"{LOG_PREFIX} Invalid RMBG-2.0 checkpoint: {path}")
    _cache.update(key=key, model=model)
    return model


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


class OreX_RMBG:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "model": ([MODEL_LABEL], {"default": MODEL_LABEL}),
            },
            "optional": {
                "sensitivity": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "process_res": ("INT", {"default": 1024, "min": 256, "max": 2048, "step": 128}),
                "mask_blur": ("INT", {"default": 0, "min": 0, "max": 64, "step": 1}),
                "mask_offset": ("INT", {"default": 0, "min": -64, "max": 64, "step": 1}),
                "invert_output": ("BOOLEAN", {"default": False}),
                "refine_foreground": ("BOOLEAN", {"default": False}),
                "unload_model": ("BOOLEAN", {"default": False}),
                "background": (["Alpha", "Color"], {"default": "Alpha"}),
                "background_color": ("COLORCODE", {"default": "#222222"}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE")
    RETURN_NAMES = ("IMAGE", "MASK", "MASK IMAGE")
    FUNCTION = "remove_background"
    CATEGORY = "OreX/Image"
    DESCRIPTION = (
        "RMBG-2.0 with an INT8 safetensors checkpoint stored in "
        "ComfyUI/models/background_removal."
    )

    def remove_background(
        self, image, model, sensitivity=1.0, process_res=1024, mask_blur=0,
        mask_offset=0, invert_output=False, refine_foreground=False,
        unload_model=False, background="Alpha", background_color="#222222",
    ):
        del model  # The selector intentionally contains only RMBG-2.0.
        rmbg = _load_model()
        old_size = rmbg.image_size
        rmbg.image_size = int(process_res)
        try:
            with torch.inference_mode():
                masks = rmbg.encode_image(image).float().cpu()
        finally:
            rmbg.image_size = old_size

        masks = torch.stack([
            _filter_mask((mask * (2.0 - sensitivity)).clamp(0, 1), mask_blur, mask_offset)
            for mask in masks
        ])
        if invert_output:
            masks = 1.0 - masks

        rgb = image[..., :3].cpu()
        foreground_rgb = rgb * masks.unsqueeze(-1) if refine_foreground else rgb
        if background == "Color":
            color = torch.tensor(_parse_color(background_color)[:3], dtype=rgb.dtype)
            output = foreground_rgb * masks.unsqueeze(-1) + color * (1.0 - masks.unsqueeze(-1))
        else:
            output = torch.cat((foreground_rgb, masks.unsqueeze(-1).to(foreground_rgb.dtype)), dim=-1)
        mask_image = masks.unsqueeze(-1).expand(-1, -1, -1, 3)

        if unload_model:
            _cache.update(key=None, model=None)
            del rmbg
            gc.collect()
            comfy.model_management.soft_empty_cache()
        return output.to(image), masks.to(image), mask_image.to(image)


NODE_CLASS_MAPPINGS = {"OreX RMBG Int8": OreX_RMBG}
NODE_DISPLAY_NAME_MAPPINGS = {"OreX RMBG Int8": "🪄 Remove Background RMBG 2.0 Int8 (OreX)"}
