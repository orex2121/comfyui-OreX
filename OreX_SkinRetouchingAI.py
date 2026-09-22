import os

import numpy as np
import torch
from PIL import Image, ImageFilter

# Where model weights are cached: a shared ComfyUI/models/modelscope/
# folder (mirroring ModelScope's own damo/<model> layout), not inside
# this package and not the global ModelScope cache
# (~/.cache/modelscope). This way the node isn't tied to this specific
# package's location, and clearing the global ModelScope cache
# won't force a re-download for this node either.
_MODEL_ID = "damo/cv_unet_skin_retouching_torch"
_MODEL_REVISION = "v1.0.2"

try:
    import folder_paths
    _MODELS_DIR = os.path.join(folder_paths.models_dir, "modelscope")
except ImportError:
    # Fallback for standalone testing outside a running ComfyUI
    _MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")


class OreX_SkinRetouchingAI:
    """
    Author: Pavel Korzhov (PaBoKor)

    AI skin retouching via the ModelScope skin-retouching model
    (damo/cv_unet_skin_retouching_torch), wrapped as a standalone node.

    Adds controls the raw model pipeline doesn't have on its own: dial
    the effect back with `strength`, compensate a slight brightness
    shift with `density`, and restrict it to a masked region with a
    feathered edge.

    Model weights are downloaded into a shared ComfyUI/models/modelscope/
    folder (via modelscope's snapshot_download with a custom cache_dir),
    not inside this package and not the global ModelScope cache
    (~/.cache/modelscope). This means the node isn't tied to this
    package's location, and clearing the global ModelScope cache won't
    trigger a re-download here either - only deleting
    models/modelscope/ would. First run still downloads the weights
    if they aren't already present there; subsequent runs reuse them.

    REQUIRES: the `modelscope` Python package (pip library) installed in this environment.
    """

    _pipeline = None  # loaded lazily once, shared across calls/instances

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Исходное изображение. / Source image."}),
                "strength": ("FLOAT", {
                    "default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "Сила эффекта: смешивание оригинала с "
                               "результатом нейросети. 1.0 = полный эффект "
                               "модели, ниже — мягче. / Effect strength: "
                               "blends the original with the neural "
                               "network's result. 1.0 = full model effect, "
                               "lower is softer."
                }),
                "density": ("FLOAT", {
                    "default": 0.0, "min": -0.2, "max": 0.2, "step": 0.01,
                    "tooltip": "Компенсация яркости результата (модель "
                               "иногда делает картинку чуть светлее "
                               "оригинала). Отрицательные значения "
                               "притемняют, применяется только в зоне "
                               "эффекта. / Brightness compensation for the "
                               "result (the model sometimes makes the image "
                               "slightly brighter than the original). "
                               "Negative values darken; only applied within "
                               "the affected area."
                }),
            },
            "optional": {
                "mask": ("MASK", {
                    "tooltip": "Ограничивает эффект областью маски. / "
                               "Restricts the effect to the mask's area."
                }),
                "mask_feather": ("INT", {
                    "default": 15, "min": 0, "max": 150, "step": 1,
                    "tooltip": "Растушёвка края маски. Модель сама "
                               "определяет лицо, поэтому при выделении "
                               "лица целиком маску можно выделять с "
                               "запасом — но при выделении только части "
                               "лица (граница маски проходит по коже), "
                               "растушёвка обязательна, иначе будет "
                               "заметен перепад. / Feathers the mask edge. "
                               "The model detects the face itself, so when "
                               "selecting the whole face the mask can be "
                               "drawn with margin — but when selecting "
                               "only part of the face (the mask border "
                               "crosses skin), feathering is essential, or "
                               "a visible seam will appear."
                }),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("result",)
    FUNCTION = "process"
    CATEGORY = "🤫OreX/Filters"
    DESCRIPTION = ("AI-ретушь кожи через модель ModelScope, с регулировкой "
                   "силы эффекта и маской. / AI skin retouching via a "
                   "ModelScope model, with adjustable strength and mask.")

    @classmethod
    def _get_pipeline(cls):
        if cls._pipeline is None:
            from modelscope.hub.snapshot_download import snapshot_download
            from modelscope.pipelines import pipeline

            os.makedirs(_MODELS_DIR, exist_ok=True)
            local_dir = snapshot_download(
                _MODEL_ID, revision=_MODEL_REVISION, cache_dir=_MODELS_DIR
            )
            cls._pipeline = pipeline(
                "skin-retouching-torch",
                model=local_dir,
                model_revision=_MODEL_REVISION,
            )
        return cls._pipeline

    def process(self, image, strength, density=0.0, mask=None, mask_feather=15):
        from modelscope.outputs import OutputKeys

        pipe = self._get_pipeline()

        batch = image.shape[0]
        results = []

        for i in range(batch):
            img_np = np.clip(image[i].cpu().numpy(), 0.0, 1.0)  # H,W,C RGB 0..1
            pil_img = Image.fromarray((img_np * 255).astype(np.uint8)).convert("RGB")

            out = pipe(pil_img)
            out_bgr = np.asarray(out[OutputKeys.OUTPUT_IMG])
            out_rgb = out_bgr[..., ::-1].astype(np.float32) / 255.0

            if out_rgb.shape[:2] != img_np.shape[:2]:
                out_img = Image.fromarray(
                    (np.clip(out_rgb, 0, 1) * 255).astype(np.uint8)
                ).resize((img_np.shape[1], img_np.shape[0]))
                out_rgb = np.asarray(out_img).astype(np.float32) / 255.0

            if density != 0.0:
                out_rgb = np.clip(out_rgb + density, 0.0, 1.0)

            amount = strength
            if mask is not None:
                m = self._normalize_mask(
                    mask[i].cpu().numpy(), img_np.shape[:2], mask_feather,
                    "OreX_SkinRetouchingAI"
                )
                if m is not None:
                    if m.max() < 1e-6:
                        # An entirely empty mask is treated the same as no
                        # mask at all (apply to the whole image) - a fully
                        # black mask virtually never means "edit nothing",
                        # it usually just means nothing was painted.
                        pass
                    else:
                        amount = strength * m[..., None]

            blended = img_np * (1 - amount) + out_rgb * amount
            results.append(torch.from_numpy(np.clip(blended, 0, 1).astype(np.float32)))

        return (torch.stack(results, dim=0),)

    @staticmethod
    def _normalize_mask(m, target_hw, mask_feather, node_name=""):
        """
        Defensively normalize an incoming MASK array to a clean 2D
        (H, W) float array in [0, 1], resized to target_hw and
        feathered. Some third-party nodes occasionally emit masks
        with extra singleton dimensions or unexpected shapes; rather
        than crash deep inside PIL, squeeze/validate here and fall
        back to "no mask" (returns None) with a console warning if
        the shape still doesn't make sense.
        """
        m = np.asarray(m)
        m = np.squeeze(m)
        if m.ndim != 2:
            print(f"[{node_name}] Warning: unexpected mask shape "
                  f"{np.asarray(m).shape}, ignoring mask for this image.")
            return None
        m = np.clip(m, 0.0, 1.0)
        if m.shape != target_hw:
            m_img = Image.fromarray((m * 255).astype(np.uint8)).resize(
                (target_hw[1], target_hw[0])
            )
            m = np.asarray(m_img).astype(np.float32) / 255.0
        if mask_feather > 0:
            m_img = Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8)).filter(
                ImageFilter.GaussianBlur(radius=mask_feather)
            )
            m = np.asarray(m_img).astype(np.float32) / 255.0
        return m