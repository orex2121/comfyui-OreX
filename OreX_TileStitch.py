# Based on the Divide and Conquer nodes by Steudio:
# https://github.com/Steudio/ComfyUI_Steudio
# Modified for comfyui-OreX on 2026-10-06.
# Licensed under GNU GPL v3; see the upstream LICENSE.

import math

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFilter


def create_tile_coordinates(
    image_width,
    image_height,
    tile_width,
    tile_height,
    overlap_x,
    overlap_y,
    grid_x,
    grid_y,
    tile_order,
):
    tiles = []

    for row in range(grid_y):
        y = row * (tile_height - overlap_y)
        if row == grid_y - 1:
            y = image_height - tile_height
        for col in range(grid_x):
            x = col * (tile_width - overlap_x)
            if col == grid_x - 1:
                x = image_width - tile_width
            tiles.append((x, y))

    if tile_order == 1:
        spiral_tiles = []
        visited = set()
        x, y = grid_x // 2, grid_y // 2
        dx, dy = 1, 0
        layer = 1

        while len(spiral_tiles) < len(tiles):
            for _ in range(2):
                for _ in range(layer):
                    if 0 <= x < grid_x and 0 <= y < grid_y and (x, y) not in visited:
                        index = y * grid_x + x
                        if index < len(tiles):
                            spiral_tiles.append(tiles[index])
                            visited.add((x, y))
                    x += dx
                    y += dy
                dx, dy = -dy, dx
            layer += 1

        spiral_tiles.reverse()
        tiles = spiral_tiles

    return tiles


class OreXTileStitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "dac_data": ("DAC_DATA",),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    INPUT_IS_LIST = True
    FUNCTION = "execute"
    CATEGORY = "OreX/Image"

    def execute(self, images, dac_data):
        if isinstance(dac_data, list):
            dac_data = dac_data[0]

        if not images:
            raise ValueError("Image Tile Stitch received no tiles.")

        images = torch.stack(images).squeeze(1)

        upscaled_width = dac_data["upscaled_width"]
        upscaled_height = dac_data["upscaled_height"]
        overlap_x = dac_data["overlap_x"]
        overlap_y = dac_data["overlap_y"]
        grid_x = dac_data["grid_x"]
        grid_y = dac_data["grid_y"]
        tile_order = dac_data["tile_order"]

        expected_tiles = grid_x * grid_y
        if len(images) != expected_tiles:
            raise ValueError(
                f"Image Tile Stitch expected {expected_tiles} tiles, but received {len(images)}."
            )

        tile_width = images.shape[2]
        tile_height = images.shape[1]
        overlap_factor = 4
        f_overlap_x = overlap_x // overlap_factor
        f_overlap_y = overlap_y // overlap_factor
        blend_x = math.sqrt(overlap_x)
        blend_y = math.sqrt(overlap_y)

        tile_coordinates = create_tile_coordinates(
            upscaled_width,
            upscaled_height,
            tile_width,
            tile_height,
            overlap_x,
            overlap_y,
            grid_x,
            grid_y,
            tile_order,
        )

        output = torch.zeros(
            (1, upscaled_height, upscaled_width, images.shape[-1]),
            dtype=images.dtype,
            device=images.device,
        )

        for index, (x, y) in enumerate(tile_coordinates):
            image_tile = images[index]
            mask = Image.new("L", (tile_width, tile_height), 0)
            draw = ImageDraw.Draw(mask)

            if x == 0 and y == 0 and upscaled_height != tile_height and upscaled_width != tile_width:
                draw.rectangle([x, y, tile_width - f_overlap_x, tile_height - f_overlap_y], fill=255)
            elif x == upscaled_width - tile_width and y == 0 and upscaled_height != tile_height and upscaled_width != tile_width:
                draw.rectangle([f_overlap_x, y, tile_width, tile_height - f_overlap_y], fill=255)
            elif x == 0 and y == upscaled_height - tile_height and upscaled_height != tile_height and upscaled_width != tile_width:
                draw.rectangle([x, f_overlap_y, tile_width - f_overlap_x, tile_height], fill=255)
            elif x == upscaled_width - tile_width and y == upscaled_height - tile_height and upscaled_height != tile_height and upscaled_width != tile_width:
                draw.rectangle([f_overlap_x, f_overlap_y, tile_width, tile_height], fill=255)
            elif x == 0 and y == 0 and upscaled_height == tile_height:
                draw.rectangle([x, y, tile_width - f_overlap_x, tile_height], fill=255)
            elif x == upscaled_width - tile_width and y == 0 and upscaled_height == tile_height:
                draw.rectangle([f_overlap_x, y, tile_width, tile_height], fill=255)
            elif x == 0 and y == 0 and upscaled_width == tile_width:
                draw.rectangle([x, y, tile_width, tile_height - f_overlap_y], fill=255)
            elif x == 0 and y == upscaled_height - tile_height and upscaled_width == tile_width:
                draw.rectangle([x, f_overlap_y, tile_width, tile_height], fill=255)
            elif x != 0 and x != upscaled_width - tile_width and y == 0 and upscaled_height != tile_height and upscaled_width != tile_width:
                draw.rectangle([f_overlap_x, y, tile_width - f_overlap_x, tile_height - f_overlap_y], fill=255)
            elif x != 0 and x != upscaled_width - tile_width and y == upscaled_height - tile_height and upscaled_height != tile_height and upscaled_width != tile_width:
                draw.rectangle([f_overlap_x, f_overlap_y, tile_width - f_overlap_x, tile_height], fill=255)
            elif x == 0 and y != 0 and y != upscaled_height - tile_height and upscaled_height != tile_height and upscaled_width != tile_width:
                draw.rectangle([x, f_overlap_y, tile_width - f_overlap_x, tile_height - f_overlap_y], fill=255)
            elif x == upscaled_width - tile_width and y != 0 and y != upscaled_height - tile_height and upscaled_height != tile_height and upscaled_width != tile_width:
                draw.rectangle([f_overlap_x, f_overlap_y, tile_width, tile_height - f_overlap_y], fill=255)
            elif x != 0 and x != upscaled_width - tile_width and y == 0 and upscaled_height == tile_height and upscaled_width != tile_width:
                draw.rectangle([f_overlap_x, y, tile_width - f_overlap_x, tile_height], fill=255)
            elif x == 0 and y != 0 and y != upscaled_height - tile_height and upscaled_height != tile_height and upscaled_width == tile_width:
                draw.rectangle([x, f_overlap_y, tile_width, tile_height - f_overlap_y], fill=255)
            elif x != 0 and x != upscaled_width - tile_width and y != 0 and y != upscaled_height - tile_height and upscaled_height != tile_height and upscaled_width != tile_width:
                draw.rectangle([f_overlap_x, f_overlap_y, tile_width - f_overlap_x, tile_height - f_overlap_y], fill=255)
            else:
                draw.rectangle([0, 0, tile_width, tile_height], fill=255)

            if overlap_x <= 64 or overlap_y <= 64:
                mask = mask.filter(ImageFilter.BoxBlur(radius=(blend_x, blend_y)))
            else:
                mask = mask.filter(ImageFilter.GaussianBlur(radius=(blend_x, blend_y)))

            mask_np = np.array(mask) / 255.0
            mask_tensor = torch.tensor(
                mask_np,
                dtype=images.dtype,
                device=images.device,
            ).unsqueeze(0).unsqueeze(-1)

            output[:, y : y + tile_height, x : x + tile_width, :] *= 1 - mask_tensor
            output[:, y : y + tile_height, x : x + tile_width, :] += image_tile * mask_tensor

        return (output,)
