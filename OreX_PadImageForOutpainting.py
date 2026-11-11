import torch


COLORS = {
    "Red": (255, 0, 0),
    "Red Orange": (255, 85, 0),
    "Orange Red": (255, 170, 0),
    "Yellow": (255, 255, 0),
    "Yellow Green": (170, 255, 0),
    "Green Yellow": (85, 255, 0),
    "Green": (0, 255, 0),
    "Green Cyan": (0, 255, 85),
    "Cyan Green": (0, 255, 170),
    "Cyan": (0, 255, 255),
    "Cyan Blue": (0, 170, 255),
    "Blue Cyan": (0, 85, 255),
    "Blue": (0, 0, 255),
    "Blue Violet": (85, 0, 255),
    "Violet Blue": (170, 0, 255),
    "Violet": (255, 0, 255),
    "Violet Red": (255, 0, 170),
    "Red Violet": (255, 0, 85),
    "White": (255, 255, 255),
    "Gray": (128, 128, 128),
    "Black": (0, 0, 0),
}


class OreXPadImageForOutpainting:
    @classmethod
    def INPUT_TYPES(cls):
        number = {"default": 0, "min": 0, "max": 16384, "step": 1}
        return {
            "required": {
                "units": (["Percentages", "Pixels"], {"default": "Percentages"}),
                "image": ("IMAGE",),
                "left": ("INT", number),
                "top": ("INT", number),
                "right": ("INT", number),
                "bottom": ("INT", number),
                "feathering": ("INT", number),
                "color": ("STRING", {"default": "#808080"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    FUNCTION = "expand_image"
    CATEGORY = "OreX/Image"

    @staticmethod
    def _amount(value, dimension, units):
        return round(dimension * value / 100) if units == "Percentages" else value

    def expand_image(self, units, image, left, top, right, bottom, feathering, color):
        batch, height, width, channels = image.shape
        left = self._amount(left, width, units)
        right = self._amount(right, width, units)
        top = self._amount(top, height, units)
        bottom = self._amount(bottom, height, units)
        feathering = self._amount(feathering, min(width, height), units)

        color = str(color).strip()
        named_color = next((rgb for name, rgb in COLORS.items() if name.lower() == color.lower()), None)
        if named_color is not None:  # Compatibility with workflows saved by earlier versions.
            rgb_value = named_color
        else:
            value = color.lstrip("#")
            if len(value) == 6 and all(c in "0123456789abcdefABCDEF" for c in value):
                rgb_value = tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
            else:
                rgb_value = COLORS["Gray"]

        rgb = image.new_tensor(rgb_value, dtype=image.dtype) / 255
        fill = rgb[:channels]
        if channels > 3:
            fill = torch.cat((fill, image.new_ones(channels - 3)))
        new_image = fill.view(1, 1, 1, channels).expand(
            batch, height + top + bottom, width + left + right, channels
        ).clone()
        new_image[:, top:top + height, left:left + width, :] = image

        mask = image.new_ones((height + top + bottom, width + left + right), dtype=torch.float32)
        inner = image.new_zeros((height, width), dtype=torch.float32)

        if feathering > 0 and feathering * 2 < height and feathering * 2 < width:
            y = torch.arange(height, device=image.device)
            x = torch.arange(width, device=image.device)
            distances = []
            if top:
                distances.append(y[:, None].expand(height, width))
            if bottom:
                distances.append((height - y)[:, None].expand(height, width))
            if left:
                distances.append(x[None, :].expand(height, width))
            if right:
                distances.append((width - x)[None, :].expand(height, width))
            if distances:
                distance = torch.stack(distances).amin(0)
                inner = ((feathering - distance).clamp(min=0) / feathering).square()

        mask[top:top + height, left:left + width] = inner
        return new_image, mask.unsqueeze(0)


NODE_CLASS_MAPPINGS = {"OreXPadImageForOutpainting": OreXPadImageForOutpainting}
NODE_DISPLAY_NAME_MAPPINGS = {"OreXPadImageForOutpainting": "Pad Image for Outpainting (OreX)"}
