# Based on the Divide and Conquer nodes by Steudio:
# https://github.com/Steudio/ComfyUI_Steudio
# Modified for comfyui-OreX on 2026-10-06.
# Licensed under GNU GPL v3; see the upstream LICENSE.

import math

import torch
from spandrel import ImageModelDescriptor, ModelLoader

import comfy.model_patcher
import comfy.storage
import comfy.utils
import folder_paths
from comfy import model_management


OVERLAP_DICT = {
    "None": 0,
    "1/64 Tile": 0.015625,
    "1/56 Tile": 1 / 56,
    "1/48 Tile": 1 / 48,
    "1/40 Tile": 1 / 40,
    "1/32 Tile": 0.03125,
    "1/28 Tile": 1 / 28,
    "1/24 Tile": 1 / 24,
    "1/20 Tile": 1 / 20,
    "1/16 Tile": 0.0625,
    "1/12 Tile": 1 / 12,
    "1/8 Tile": 0.125,
    "1/6 Tile": 1 / 6,
    "1/4 Tile": 0.25,
    "1/2 Tile": 0.5,
}

TILE_ORDER_DICT = {
    "linear": 0,
    "spiral": 1,
}

SCALING_METHODS = [
    "nearest-exact",
    "bilinear",
    "area",
    "bicubic",
    "lanczos",
]

MIN_SCALE_FACTOR_THRESHOLD = 1.0
SCALE_MODES = ["max_tiles_by_side", "min_scale_factor", "min_longest_size"]
NO_UPSCALE_MODEL = "none"


def calculate_overlap(tile_size, overlap_fraction):
    return int(overlap_fraction * tile_size)


def load_upscale_model(model_name):
    model_path = folder_paths.get_full_path_or_raise("upscale_models", model_name)
    state_dict = comfy.utils.load_torch_file(model_path, safe_load=True)
    if "module.layers.0.residual_group.blocks.0.norm1.weight" in state_dict:
        state_dict = comfy.utils.state_dict_prefix_replace(state_dict, {"module.": ""})

    model = ModelLoader().load_from_state_dict(state_dict).eval()
    if not isinstance(model, ImageModelDescriptor):
        raise ValueError("Upscale model must be a single-image model.")

    model.patcher = comfy.model_patcher.CoreModelPatcher(
        model.model,
        load_device=model_management.get_torch_device(),
        offload_device=model_management.unet_offload_device(),
        fast_disk=comfy.storage.state_dict_fast_disk(state_dict),
    )
    return model


def upscale_with_model(image, upscale_model):
    device = upscale_model.patcher.load_device
    alpha = None
    model_image = image
    if image.shape[-1] == 4:
        alpha = image[..., 3:4]
        model_image = image[..., :3]

    memory_required = (
        (512 * 512 * 3)
        * model_image.element_size()
        * max(upscale_model.scale, 1.0)
        * 384.0
    )
    memory_required += model_image.nelement() * model_image.element_size()
    model_management.load_models_gpu(
        [upscale_model.patcher],
        memory_required=memory_required,
        force_full_load=True,
    )

    in_img = model_image.movedim(-1, -3).to(device)
    model_tile = 512
    model_overlap = 32
    output_device = model_management.intermediate_device()

    while True:
        try:
            steps = in_img.shape[0] * comfy.utils.get_tiled_scale_steps(
                in_img.shape[3],
                in_img.shape[2],
                tile_x=model_tile,
                tile_y=model_tile,
                overlap=model_overlap,
            )
            pbar = comfy.utils.ProgressBar(steps)
            scaled = comfy.utils.tiled_scale(
                in_img,
                lambda value: upscale_model(value.float()),
                tile_x=model_tile,
                tile_y=model_tile,
                overlap=model_overlap,
                upscale_amount=upscale_model.scale,
                pbar=pbar,
                output_device=output_device,
            )
            break
        except Exception as error:
            model_management.raise_non_oom(error)
            model_tile //= 2
            if model_tile < 128:
                raise error

    scaled = torch.clamp(scaled.movedim(-3, -1), min=0, max=1.0).to(
        model_management.intermediate_dtype()
    )

    if alpha is not None:
        alpha = comfy.utils.common_upscale(
            alpha.movedim(-1, -3).to(scaled),
            scaled.shape[2],
            scaled.shape[1],
            "bilinear",
            "disabled",
        )
        scaled = torch.cat((scaled, alpha.movedim(-3, -1)), dim=-1)

    return scaled


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


class OreXTileSplit:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "tile": ("INT", {"default": 0, "min": 0, "step": 1}),
                "tile_width": ("INT", {"default": 1024}),
                "tile_height": ("INT", {"default": 1024}),
                "min_overlap": (list(OVERLAP_DICT.keys()), {"default": "1/32 Tile"}),
                "mode_scale": (SCALE_MODES, {"default": "max_tiles_by_side"}),
                "min_scale_factor": ("FLOAT", {"default": 1.5, "min": 1.0, "max": 8.0}),
                "min_longest_size": (
                    "INT",
                    {"default": 1536, "min": 64, "max": 65536, "step": 64},
                ),
                "max_tiles_by_side": (
                    "INT",
                    {"default": 2, "min": 1, "max": 64, "step": 1},
                ),
                "tile_order": (list(TILE_ORDER_DICT.keys()), {"default": "linear"}),
                "scaling_method": (SCALING_METHODS, {"default": "lanczos"}),
                "upscale_model": (
                    [NO_UPSCALE_MODEL] + folder_paths.get_filename_list("upscale_models"),
                    {"default": NO_UPSCALE_MODEL},
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "DAC_DATA", "IMAGE")
    RETURN_NAMES = ("IMAGE", "dac_data", "TILE(S)")
    OUTPUT_IS_LIST = (False, False, True)
    OUTPUT_NODE = True
    FUNCTION = "execute"
    CATEGORY = "OreX/Image"
    DESCRIPTION = """Calculate the target size, upscale the image and divide it into tiles.
tile 0 = all tiles
tile # = the selected tile"""

    def execute(
        self,
        image,
        tile,
        scaling_method,
        tile_width,
        tile_height,
        min_overlap,
        mode_scale,
        min_scale_factor,
        min_longest_size,
        max_tiles_by_side,
        tile_order,
        upscale_model,
    ):
        overlap = OVERLAP_DICT.get(min_overlap, 0)
        tile_order_value = TILE_ORDER_DICT.get(tile_order, 0)

        _, height, width, _ = image.shape
        overlap_x = calculate_overlap(tile_width, overlap)
        overlap_y = calculate_overlap(tile_height, overlap)
        if mode_scale == "max_tiles_by_side":
            max_width = tile_width * max_tiles_by_side - overlap_x * (max_tiles_by_side - 1)
            max_height = tile_height * max_tiles_by_side - overlap_y * (max_tiles_by_side - 1)
            width_scale = max_width / width
            height_scale = max_height / height

            if width_scale <= height_scale:
                upscaled_width = max_width
                upscaled_height = round(height * width_scale)
            else:
                upscaled_height = max_height
                upscaled_width = round(width * height_scale)

            if upscaled_width < tile_width or upscaled_height < tile_height:
                minimum_tiles = None
                for candidate in range(max_tiles_by_side + 1, 65):
                    candidate_width = tile_width * candidate - overlap_x * (candidate - 1)
                    candidate_height = tile_height * candidate - overlap_y * (candidate - 1)
                    candidate_scale = min(candidate_width / width, candidate_height / height)
                    if (
                        round(width * candidate_scale) >= tile_width
                        and round(height * candidate_scale) >= tile_height
                    ):
                        minimum_tiles = candidate
                        break
                recommendation = (
                    f"use at least {minimum_tiles}."
                    if minimum_tiles is not None
                    else "increase the limit or use a tile size closer to the image aspect ratio."
                )
                raise ValueError(
                    "max_tiles_by_side is too small for this image and tile aspect ratio: "
                    + recommendation
                )

            grid_x = math.ceil((upscaled_width - overlap_x) / (tile_width - overlap_x))
            grid_y = math.ceil((upscaled_height - overlap_y) / (tile_height - overlap_y))
            if grid_x > max_tiles_by_side or grid_y > max_tiles_by_side:
                raise RuntimeError("Calculated tile grid exceeds max_tiles_by_side.")

            if grid_x > 1:
                overlap_x = round((tile_width * grid_x - upscaled_width) / (grid_x - 1))
            else:
                overlap_x = 0
            if grid_y > 1:
                overlap_y = round((tile_height * grid_y - upscaled_height) / (grid_y - 1))
            else:
                overlap_y = 0
        else:
            if mode_scale == "min_longest_size":
                requested_scale = min_longest_size / max(width, height)
            else:
                requested_scale = min_scale_factor
            requested_scale = max(requested_scale, MIN_SCALE_FACTOR_THRESHOLD)

            if width <= height:
                multiply_factor = math.ceil(requested_scale * width / tile_width)
                while True:
                    upscaled_width = tile_width * multiply_factor
                    grid_x = math.ceil(upscaled_width / tile_width)
                    upscaled_width = (tile_width * grid_x) - (overlap_x * (grid_x - 1))
                    upscale_ratio = upscaled_width / width
                    if upscale_ratio >= requested_scale:
                        break
                    multiply_factor += 1

                upscaled_height = int(height * upscale_ratio)
                grid_y = math.ceil((upscaled_height - overlap_y) / (tile_height - overlap_y))
                if grid_y > 1:
                    overlap_y = round((tile_height * grid_y - upscaled_height) / (grid_y - 1))
                else:
                    overlap_y = 0
                    upscaled_height = tile_height
            else:
                multiply_factor = math.ceil(requested_scale * height / tile_height)
                while True:
                    upscaled_height = tile_height * multiply_factor
                    grid_y = math.ceil(upscaled_height / tile_height)
                    upscaled_height = (tile_height * grid_y) - (overlap_y * (grid_y - 1))
                    upscale_ratio = upscaled_height / height
                    if upscale_ratio >= requested_scale:
                        break
                    multiply_factor += 1

                upscaled_width = int(width * upscale_ratio)
                grid_x = math.ceil((upscaled_width - overlap_x) / (tile_width - overlap_x))
                if grid_x > 1:
                    overlap_x = round((tile_width * grid_x - upscaled_width) / (grid_x - 1))
                else:
                    overlap_x = 0
                    upscaled_width = tile_width

        dac_data = {
            "upscaled_width": upscaled_width,
            "upscaled_height": upscaled_height,
            "tile_width": tile_width,
            "tile_height": tile_height,
            "overlap_x": overlap_x,
            "overlap_y": overlap_y,
            "grid_x": grid_x,
            "grid_y": grid_y,
            "tile_order": tile_order_value,
        }

        if upscale_model != NO_UPSCALE_MODEL:
            model_upscaled = upscale_with_model(image, load_upscale_model(upscale_model))
            samples = model_upscaled.movedim(-1, 1)
        else:
            samples = image.movedim(-1, 1)

        upscaled_image = comfy.utils.common_upscale(
            samples,
            upscaled_width,
            upscaled_height,
            scaling_method,
            crop=0,
        ).movedim(1, -1)

        tile_coordinates = create_tile_coordinates(
            upscaled_width,
            upscaled_height,
            tile_width,
            tile_height,
            overlap_x,
            overlap_y,
            grid_x,
            grid_y,
            tile_order_value,
        )
        image_tiles = [
            upscaled_image[:, y : y + tile_height, x : x + tile_width, :]
            for x, y in tile_coordinates
        ]

        if tile == 0:
            selected_tiles = image_tiles
        elif 1 <= tile <= len(image_tiles):
            selected_tiles = [image_tiles[tile - 1]]
        else:
            raise ValueError(
                f"Tile {tile} is out of range. Use 0 for all tiles or 1-{len(image_tiles)}."
            )

        return (upscaled_image, dac_data, selected_tiles)
