# -*- coding: utf-8 -*-
import os
import random
import logging
from typing import Dict, Any, Optional
import torch
import numpy as np
from PIL import Image
import folder_paths

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class OreXImageCompare:
    """
    Интерактивный узел сравнения двух изображений в экосистеме OreX.
    """

    def __init__(self):
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        self.prefix_append = "_orexcmp_" + "".join(
            random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5)
        )
        self.compress_level = 4

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "mode": (
                    ["Slider", "Side-by-Side", "Overlap", "Difference", "Blink"],
                    {
                        "default": "Slider"
                    }
                ),
                "opacity": (
                    "FLOAT",
                    {
                        "default": 0.50,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "display": "slider"
                    }
                ),
                "blink_speed": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 1.0,
                        "max": 3.0,
                        "step": 0.05,
                        "display": "slider"
                    }
                ),
            },
            "optional": {
                "image_1": (
                    "IMAGE",
                    {}
                ),
                "image_2": (
                    "IMAGE",
                    {}
                ),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID"
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "compare_images"
    CATEGORY = "🤫OreX/Image"
    OUTPUT_NODE = True

    def compare_images(
        self,
        mode: str = "Slider",
        opacity: float = 0.50,
        blink_speed: float = 0.50,
        image_1: Optional[torch.Tensor] = None,
        image_2: Optional[torch.Tensor] = None,
        prompt: Optional[Any] = None,
        extra_pnginfo: Optional[Any] = None,
        unique_id: Optional[Any] = None
    ) -> Dict[str, Any]:
        pairs = [(1, image_1), (2, image_2)]
        present = [(slot, tensor) for (slot, tensor) in pairs if tensor is not None]

        ui_images = []

        if present:
            first_tensor = present[0][1]
            prefix = "orex_compare" + self.prefix_append

            # Извлекаем геометрию кадра
            height, width = first_tensor[0].shape[0], first_tensor[0].shape[1]

            full_output_folder, filename, counter, subfolder, _ = (
                folder_paths.get_save_image_path(
                    prefix, self.output_dir, width, height
                )
            )

            for slot, tensor in present:
                try:
                    # Преобразование PyTorch Tensor -> PIL Image
                    img_np = 255.0 * tensor[0].cpu().numpy()
                    img = Image.fromarray(np.clip(img_np, 0, 255).astype(np.uint8))

                    file_name = f"{filename}_{counter:05}_.png"
                    file_path = os.path.join(full_output_folder, file_name)

                    img.save(file_path, compress_level=self.compress_level)

                    # Извлекаем реальные габариты каждого кадра
                    cur_h, cur_w = tensor[0].shape[0], tensor[0].shape[1]

                    ui_images.append({
                        "filename": file_name,
                        "subfolder": subfolder,
                        "type": self.type,
                        "slot": slot,
                        "width": cur_w,
                        "height": cur_h
                    })

                    counter += 1
                except Exception as e:
                    logger.error(f"[OreX Compare] Ошибка обработки слота {slot}: {e}")

        return {
            "ui": {
                "images": ui_images
            }
        }


NODE_CLASS_MAPPINGS = {"OreX Image Compare": OreXImageCompare}
NODE_DISPLAY_NAME_MAPPINGS = {"OreX Image Compare": "↔️ OreX Image Compare"}
WEB_DIRECTORY = "./js"
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']