"""Person-part mask selection for ComfyUI.

This is an independent OreX adaptation of LayerMask: PersonMaskUltra V2.
It intentionally does not import anything from comfyui_layerstyle.
"""

from __future__ import annotations

import math
from pathlib import Path
from urllib.request import urlretrieve

import numpy as np
import torch
from PIL import Image

import folder_paths


MODEL_NAME = "selfie_multiclass_256x256.tflite"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/"
    f"selfie_multiclass_256x256/float32/latest/{MODEL_NAME}"
)


def _model_path() -> Path:
    """Return the MediaPipe model path, downloading it only when necessary."""
    model_dir = Path(folder_paths.models_dir) / "mediapipe"
    model_path = model_dir / MODEL_NAME
    if not model_path.is_file():
        model_dir.mkdir(parents=True, exist_ok=True)
        print(f"[OreX Mask Selection] Downloading {MODEL_NAME}...")
        try:
            urlretrieve(MODEL_URL, model_path)
        except Exception as exc:
            model_path.unlink(missing_ok=True)
            raise RuntimeError(
                f"Could not download {MODEL_NAME}. Download it manually from "
                f"{MODEL_URL} and place it in {model_dir}"
            ) from exc
    return model_path


def _pil_to_tensor(image: Image.Image) -> torch.Tensor:
    array = np.asarray(image).astype(np.float32) / 255.0
    return torch.from_numpy(array).unsqueeze(0)


def _tensor_to_pil(tensor: torch.Tensor, mode: str | None = None) -> Image.Image:
    array = tensor.detach().cpu().numpy().squeeze()
    image = Image.fromarray(np.clip(array * 255.0, 0, 255).astype(np.uint8))
    return image.convert(mode) if mode else image


def _remap(mask: torch.Tensor, black_point: float, white_point: float) -> torch.Tensor:
    black_point = min(black_point, white_point - 0.001)
    return ((mask - black_point) / (white_point - black_point)).clamp(0.0, 1.0)


def _trimap(mask: torch.Tensor, erode: int, dilate: int) -> Image.Image:
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("OreX Mask Selection requires opencv-python.") from exc

    mask_np = np.clip(mask.detach().cpu().numpy().squeeze() * 255.0, 0, 255).astype(np.uint8)
    eroded = cv2.erode(mask_np, np.ones((erode, erode), np.uint8), iterations=5)
    dilated = cv2.dilate(mask_np, np.ones((dilate, dilate), np.uint8), iterations=5)
    result = np.zeros_like(mask_np)
    result[dilated == 255] = 128
    result[eroded == 255] = 255
    return Image.fromarray(result, mode="L")


def _guided_filter(image: Image.Image, mask: torch.Tensor, radius: int) -> torch.Tensor:
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("GuidedFilter requires opencv-python.") from exc

    # Some portable ComfyUI builds expose cv2.ximgproc but omit guidedFilter.
    # A single-channel guided filter avoids that optional binary dependency.
    guide_rgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    guide = cv2.cvtColor(guide_rgb, cv2.COLOR_RGB2GRAY)
    source = mask.detach().cpu().numpy().squeeze().astype(np.float32)
    window = max(1, radius) * 2 + 1
    kernel = (window, window)
    mean_guide = cv2.boxFilter(guide, -1, kernel, normalize=True)
    mean_source = cv2.boxFilter(source, -1, kernel, normalize=True)
    corr_guide = cv2.boxFilter(guide * guide, -1, kernel, normalize=True)
    corr_cross = cv2.boxFilter(guide * source, -1, kernel, normalize=True)
    variance = corr_guide - mean_guide * mean_guide
    covariance = corr_cross - mean_guide * mean_source
    coefficient = covariance / (variance + 0.015 ** 2)
    intercept = mean_source - coefficient * mean_guide
    mean_coefficient = cv2.boxFilter(coefficient, -1, kernel, normalize=True)
    mean_intercept = cv2.boxFilter(intercept, -1, kernel, normalize=True)
    result = mean_coefficient * guide + mean_intercept
    return torch.from_numpy(np.asarray(result, dtype=np.float32)).unsqueeze(0)


def _pymatting(image: Image.Image, mask: torch.Tensor, radius: int,
               black_point: float, white_point: float) -> torch.Tensor:
    try:
        import cv2
        from pymatting import estimate_alpha_cf, fix_trimap
    except ImportError as exc:
        raise RuntimeError("PyMatting detail mode requires pymatting and opencv-python.") from exc

    rgb = np.asarray(image.convert("RGB"), dtype=np.float64) / 255.0
    trimap = mask.detach().cpu().numpy().squeeze().astype(np.float64)
    diameter = radius * 5 + 1
    if diameter % 2 == 0:
        diameter += 1
    if radius > 0:
        trimap = cv2.GaussianBlur(trimap, (diameter, diameter), 0)
    trimap = fix_trimap(trimap, black_point, white_point)
    alpha = estimate_alpha_cf(
        rgb,
        trimap,
        laplacian_kwargs={"epsilon": 1e-6},
        cg_kwargs={"maxiter": 500},
    )
    return torch.from_numpy(alpha.astype(np.float32)).unsqueeze(0)


def _vitmatte(image: Image.Image, trimap: Image.Image, local_only: bool,
              device_name: str, max_megapixels: float) -> torch.Tensor:
    try:
        from transformers import VitMatteForImageMatting, VitMatteImageProcessor
    except ImportError as exc:
        raise RuntimeError("VITMatte detail mode requires transformers.") from exc

    original_size = image.size
    pixel_limit = max_megapixels * 1_048_576
    if image.width * image.height > pixel_limit:
        ratio = image.width / image.height
        width = max(1, int(math.sqrt(ratio * pixel_limit)))
        height = max(1, int(width / ratio))
        image = image.resize((width, height), Image.Resampling.BILINEAR)
        trimap = trimap.resize((width, height), Image.Resampling.NEAREST)

    model_source: str | Path = "hustvl/vitmatte-small-composition-1k"
    if local_only:
        model_source = Path(folder_paths.models_dir) / "vitmatte"
        if not model_source.exists():
            raise RuntimeError(
                f"VITMatte(local) expects a model in {model_source}. "
                "Use VITMatte once to download it, or place the model there."
            )

    device = torch.device("cuda" if device_name == "cuda" and torch.cuda.is_available() else "cpu")
    processor = VitMatteImageProcessor.from_pretrained(
        model_source, local_files_only=local_only
    )
    model = VitMatteForImageMatting.from_pretrained(
        model_source, local_files_only=local_only
    ).to(device)
    model.eval()
    inputs = processor(images=image.convert("RGB"), trimaps=trimap.convert("L"), return_tensors="pt")
    with torch.inference_mode():
        alpha = model(**{key: value.to(device) for key, value in inputs.items()}).alphas
    result = _tensor_to_pil(alpha, "L").crop((0, 0, image.width, image.height))
    if result.size != original_size:
        result = result.resize(original_size, Image.Resampling.BILINEAR)
    del model
    if device.type == "cuda":
        torch.cuda.empty_cache()
    return _pil_to_tensor(result).squeeze(-1)


class OreX_MaskSelection:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "face": ("BOOLEAN", {"default": True, "label_on": "enabled", "label_off": "disabled"}),
                "hair": ("BOOLEAN", {"default": False, "label_on": "enabled", "label_off": "disabled"}),
                "body": ("BOOLEAN", {"default": False, "label_on": "enabled", "label_off": "disabled"}),
                "clothes": ("BOOLEAN", {"default": False, "label_on": "enabled", "label_off": "disabled"}),
                "accessories": ("BOOLEAN", {"default": False, "label_on": "enabled", "label_off": "disabled"}),
                "background": ("BOOLEAN", {"default": False, "label_on": "enabled", "label_off": "disabled"}),
                "confidence": ("FLOAT", {"default": 0.4, "min": 0.05, "max": 0.95, "step": 0.01}),
                "detail_method": (["VITMatte", "VITMatte(local)", "PyMatting", "GuidedFilter"],),
                "detail_erode": ("INT", {"default": 6, "min": 1, "max": 255, "step": 1}),
                "detail_dilate": ("INT", {"default": 6, "min": 1, "max": 255, "step": 1}),
                "black_point": ("FLOAT", {"default": 0.01, "min": 0.01, "max": 0.98, "step": 0.01, "display": "slider"}),
                "white_point": ("FLOAT", {"default": 0.99, "min": 0.02, "max": 0.99, "step": 0.01, "display": "slider"}),
                "process_detail": ("BOOLEAN", {"default": True}),
                "device": (["cuda", "cpu"],),
                "max_megapixels": ("FLOAT", {"default": 2.0, "min": 1.0, "max": 999.0, "step": 0.1}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "mask_selection"
    CATEGORY = "OreX/Mask"

    def mask_selection(self, images, face, hair, body, clothes, accessories,
                       background, confidence, detail_method, detail_erode,
                       detail_dilate, black_point, white_point, process_detail,
                       device, max_megapixels):
        try:
            import mediapipe as mp
        except ImportError as exc:
            raise RuntimeError("OreX Mask Selection requires mediapipe.") from exc

        class_indexes = []
        for enabled, index in (
            (background, 0), (hair, 1), (body, 2), (face, 3),
            (clothes, 4), (accessories, 5),
        ):
            if enabled:
                class_indexes.append(index)

        options = mp.tasks.vision.ImageSegmenterOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(_model_path())),
            running_mode=mp.tasks.vision.RunningMode.IMAGE,
            output_category_mask=True,
            output_confidence_masks=True,
        )

        output_images = []
        output_masks = []
        with mp.tasks.vision.ImageSegmenter.create_from_options(options) as segmenter:
            for source in images:
                rgb_array = np.ascontiguousarray(
                    np.clip(source.detach().cpu().numpy() * 255.0, 0, 255).astype(np.uint8)[..., :3]
                )
                original = Image.fromarray(rgb_array, mode="RGB")
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_array)
                result = segmenter.segment(mp_image)

                if class_indexes:
                    selected = [result.confidence_masks[index].numpy_view() for index in class_indexes]
                    mask_np = np.maximum.reduce(selected)
                    mask_np = (mask_np > confidence).astype(np.float32)
                else:
                    mask_np = np.zeros(rgb_array.shape[:2], dtype=np.float32)
                mask = torch.from_numpy(mask_np).unsqueeze(0)

                if process_detail:
                    detail_range = detail_erode + detail_dilate
                    if detail_method == "GuidedFilter":
                        mask = _remap(
                            _guided_filter(original, mask, detail_range // 6 + 1),
                            black_point,
                            white_point,
                        )
                    elif detail_method == "PyMatting":
                        mask = _pymatting(
                            original, mask, detail_range // 8 + 1,
                            black_point, white_point,
                        )
                    else:
                        trimap = _trimap(mask, detail_erode, detail_dilate)
                        mask = _remap(
                            _vitmatte(
                                original,
                                trimap,
                                detail_method == "VITMatte(local)",
                                device,
                                max_megapixels,
                            ),
                            black_point,
                            white_point,
                        )

                mask = mask.squeeze().clamp(0.0, 1.0)
                rgba = np.dstack((rgb_array, (mask.numpy() * 255.0).astype(np.uint8)))
                output_images.append(_pil_to_tensor(Image.fromarray(rgba, mode="RGBA")))
                output_masks.append(mask.unsqueeze(0))

        print(f"[OreX Mask Selection] Processed {len(output_images)} image(s).")
        return torch.cat(output_images, dim=0), torch.cat(output_masks, dim=0)


NODE_CLASS_MAPPINGS = {"OreX_MaskSelection": OreX_MaskSelection}
NODE_DISPLAY_NAME_MAPPINGS = {"OreX_MaskSelection": "🎭 Mask Selection (OreX)"}
