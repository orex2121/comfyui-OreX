"""Classic-compatible copy of ComfyUI's Create Bounding Boxes node.

The core node is intentionally not patched.  This wrapper reuses its data and
rendering helpers, while the OreX frontend supplies an editor that also works
with the classic (Nodes 2.0 disabled) renderer.
"""

import json
import colorsys

import nodes
from comfy_extras.nodes_bounding_boxes import (
    _bg_from_image,
    boxes_from_input,
    boxes_to_regions,
    build_elements as _core_build_elements,
    fractions_to_bbox_frame,
    render_preview,
)


def _colour_name(value):
    """Return a simple colour word so text models do not have to infer a hex value."""
    try:
        text = str(value).strip().lstrip("#")
        if len(text) != 6:
            return ""
        r, g, b = (int(text[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except (TypeError, ValueError):
        return ""
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    if s < 0.12:
        if v >= 0.88:
            return "white"
        if v <= 0.15:
            return "black"
        return "grey"
    degrees = h * 360
    if degrees < 15 or degrees >= 345:
        return "red"
    if degrees < 45:
        return "orange"
    if degrees < 70:
        return "yellow"
    if degrees < 165:
        return "green"
    if degrees < 200:
        return "cyan"
    if degrees < 260:
        return "blue"
    if degrees < 300:
        return "purple"
    return "pink"


def _build_elements(regions):
    """Build core-compatible elements with unambiguous MOSS text guidance.

    MOSS can mistake a non-English text caption for another literal inscription.
    Keep the original ``text`` field exact, but mark ``desc`` as styling only and
    make palette semantics explicit for text regions.
    """
    elements = _core_build_elements(regions)
    for region, element in zip(regions, elements):
        if element.get("type") != "text":
            continue

        exact_text = element.get("text", "")
        original_desc = element.get("desc", "").strip()
        palette = element.get("color_palette", [])
        guidance = [
            "The text field is the sole visible wording.",
        ]
        if original_desc:
            guidance.append(f"Typography style guidance, not visible wording: {original_desc}")
        if palette:
            colour_name = _colour_name(palette[0])
            named = f"{colour_name} ({palette[0]})" if colour_name else palette[0]
            guidance.append(
                f"Render freestanding {named} letterforms directly over the uninterrupted image "
                "scene. Keep the scene continuously visible around and between every letter "
                "stroke. The bounding box controls placement and extent only."
            )
            # MOSS treats a text item's native palette as the colour of the whole
            # region and often produces dark letters on a coloured panel.  Keep
            # the user's colour in the caption above, but do not publish it as a
            # MOSS/Ideogram region palette for text elements.
            element.pop("color_palette", None)
        try:
            is_wide = abs(float(region.get("w", 0))) >= 3 * max(abs(float(region.get("h", 0))), 1e-6)
        except (TypeError, ValueError):
            is_wide = False
        if is_wide and "\n" not in exact_text:
            guidance.append("Fit the complete exact text on one single line spanning the wide bounding box.")
        element["desc"] = " ".join(guidance)
    return elements


def _state(raw):
    if not raw:
        return {"regions": [], "last_incoming": []}
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        value = {}
    if not isinstance(value, dict):
        value = {}
    regions = value.get("regions", [])
    last = value.get("last_incoming", [])
    return {
        "regions": regions if isinstance(regions, list) else [],
        "last_incoming": last if isinstance(last, list) else [],
    }


class OreXCreateBoundingBoxes:
    DESCRIPTION = (
        "Classic-compatible Create Bounding Boxes editor. Draw, move and resize boxes, "
        "choose object/text type, and set descriptions and color palettes. This is an "
        "independent OreX node; ComfyUI's original node remains unchanged."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 1024, "min": 64, "max": 16384, "step": 16}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 16384, "step": 16}),
            },
            "optional": {
                "background": ("IMAGE",),
                # Wildcard preserves the original node's ability to accept BOUNDING_BOX,
                # ARRAY and JSON-like string sources in the legacy schema.
                "bboxes": ("*", {"forceInput": True}),
            },
            "hidden": {"editor_state": "STRING"},
        }

    RETURN_TYPES = ("IMAGE", "BOUNDING_BOX", "ARRAY", "STRING")
    RETURN_NAMES = ("preview", "bboxes", "elements", "character_boxes")
    OUTPUT_TOOLTIPS = (
        "Preview of the boxes over the optional background.",
        "Pixel-space bounding boxes, one frame per image.",
        "Ideogram/FLUX prompt elements on the normalized 0..1000 grid.",
        "Comma-separated numbers of every box marked Character, ready for the MOSS-Image Layout Prompt character_boxes input.",
    )
    FUNCTION = "execute"
    CATEGORY = "OreX/Utilities"
    OUTPUT_NODE = True

    def execute(self, width, height, editor_state=None, background=None, bboxes=None):
        width, height = int(width), int(height)
        saved = _state(editor_state)
        incoming = boxes_from_input(bboxes, width, height)
        changed = bool(incoming) and incoming != saved["last_incoming"]
        regions = boxes_to_regions(incoming, width, height) if changed else saved["regions"]

        preview = render_preview(regions, width, height, _bg_from_image(background))
        character_boxes = ", ".join(
            str(index + 1)
            for index, region in enumerate(regions)
            if isinstance(region, dict) and region.get("type") == "character"
        )
        ui_state = {
            "regions": regions,
            "last_incoming": incoming if incoming else saved["last_incoming"],
            "dims": [width, height],
        }
        if background is not None and len(background) > 0:
            saved_image = nodes.PreviewImage().save_images(
                background[:1], "orex.bboxes.background"
            )
            images = saved_image.get("ui", {}).get("images", [])
            if images:
                ui_state["background_image"] = images[0]
        return {
            "ui": {"orex_create_bounding_boxes": [ui_state]},
            "result": (
                preview,
                fractions_to_bbox_frame(regions, width, height),
                _build_elements(regions),
                character_boxes,
            ),
        }


NODE_CLASS_MAPPINGS = {"OreXCreateBoundingBoxes": OreXCreateBoundingBoxes}
NODE_DISPLAY_NAME_MAPPINGS = {
    "OreXCreateBoundingBoxes": "Create Bounding Boxes (OreX)"
}
