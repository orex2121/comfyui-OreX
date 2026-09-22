import hashlib
import os

import numpy as np
import torch
from PIL import Image

import folder_paths
import node_helpers


def _hex_to_rgb(value):
    value = str(value).strip().lstrip("#")
    if len(value) != 6:
        return 0.0, 0.0, 0.0
    try:
        return tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        return 0.0, 0.0, 0.0


class OreXPainter:
    """Legacy/LiteGraph-compatible version of ComfyUI's Painter node."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # The JS extension hides this STRING widget and serializes its
                # transparent PNG into it before a prompt is queued.
                "mask": ("STRING", {"default": ""}),
                "width": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "height": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "bg_color": ("STRING", {"default": "#000000"}),
            },
            "optional": {
                "image": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("IMAGE", "MASK")
    FUNCTION = "paint"
    CATEGORY = "image"

    def paint(self, mask, width, height, bg_color="#000000", image=None):
        if image is not None:
            base_image = image[:1].detach().cpu().float()
            h, w = base_image.shape[1:3]
        else:
            h, w = int(height), int(width)
            r, g, b = _hex_to_rgb(bg_color)
            base_image = torch.empty((1, h, w, 3), dtype=torch.float32)
            base_image[..., 0] = r
            base_image[..., 1] = g
            base_image[..., 2] = b

        if mask and str(mask).strip():
            mask_path = folder_paths.get_annotated_filepath(mask)
            painter_image = node_helpers.pillow(Image.open, mask_path).convert("RGBA")
            if painter_image.size != (w, h):
                painter_image = painter_image.resize((w, h), Image.Resampling.LANCZOS)

            painter_np = np.asarray(painter_image, dtype=np.float32) / 255.0
            painter_rgb = painter_np[..., :3]
            painter_alpha = painter_np[..., 3:4]
            base_np = base_image[0].numpy()

            composited = painter_rgb * painter_alpha + base_np * (1.0 - painter_alpha)
            out_image = torch.from_numpy(composited).unsqueeze(0)
            out_mask = torch.from_numpy(painter_np[..., 3]).unsqueeze(0)
        else:
            out_image = base_image
            out_mask = torch.zeros((1, h, w), dtype=torch.float32)

        return out_image, out_mask

    @classmethod
    def IS_CHANGED(cls, mask, width, height, bg_color="#000000", image=None):
        if mask and str(mask).strip():
            path = folder_paths.get_annotated_filepath(mask)
            if os.path.isfile(path):
                digest = hashlib.sha256()
                with open(path, "rb") as file:
                    for chunk in iter(lambda: file.read(1024 * 1024), b""):
                        digest.update(chunk)
                return digest.hexdigest()
        return ""

