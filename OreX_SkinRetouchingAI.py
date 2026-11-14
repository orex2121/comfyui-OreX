import os
import sys
import time
from contextlib import contextmanager

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

# Print a per-stage timing breakdown of the ModelScope pipeline after
# every image (face detection, ONNX skin mask, local retouch, etc.).
# Set to False to silence it (the one-line summary is still printed).
_PROFILE = True

# With torch.backends.cudnn.benchmark = True, cuDNN re-tests convolution
# algorithms (with huge workspace buffers) every time it sees a NEW input
# shape. The face detector receives the whole image, so every new image
# size triggers ~20+ s of benchmarking. While the pipeline runs, the flag
# is switched off and then restored to its previous value, so other nodes
# are not affected. Set to False to leave the flag untouched.
_DISABLE_CUDNN_BENCHMARK = True

try:
    import folder_paths
    _MODELS_DIR = os.path.join(folder_paths.models_dir, "modelscope")
except ImportError:
    # Fallback for standalone testing outside a running ComfyUI
    _MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")


def _global_modelscope_hub_dir():
    """Global ModelScope cache (hub folder), used as a secondary source."""
    root = os.environ.get("MODELSCOPE_CACHE") or os.path.join(
        os.path.expanduser("~"), ".cache", "modelscope"
    )
    return os.path.join(root, "hub")


def _is_valid_model_dir(path):
    """
    A model folder counts as fully downloaded if it has
    configuration.json and at least one reasonably large file
    (weights) somewhere inside it.
    """
    if not os.path.isfile(os.path.join(path, "configuration.json")):
        return False
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                if os.path.getsize(os.path.join(root, name)) > 1024 * 1024:
                    return True
            except OSError:
                continue
    return False


def _find_in_base(base_dir, model_id):
    """
    Look for a downloaded copy of model_id ("org/name") under base_dir,
    regardless of the sub-layout modelscope used
    (<base>/org/name, <base>/models/org/name, <base>/hub/org/name, ...).
    """
    if not os.path.isdir(base_dir):
        return None
    org, _, name = model_id.rpartition("/")

    # Fast path: the most common layouts
    candidates = [
        os.path.join(base_dir, org, name),
        os.path.join(base_dir, "models", org, name),
        os.path.join(base_dir, "hub", org, name),
        os.path.join(base_dir, "hub", "models", org, name),
    ]
    for c in candidates:
        if _is_valid_model_dir(c):
            return c

    # Slow path: walk the tree looking for a folder with the model's name
    for root, dirs, _files in os.walk(base_dir):
        for d in dirs:
            if d == name:
                full = os.path.join(root, d)
                if _is_valid_model_dir(full):
                    return full
    return None


def _find_local_model_dir(model_id):
    """
    Find a local copy of model_id: first in ComfyUI/models/modelscope/,
    then in the global ModelScope cache. Returns a folder or None.
    """
    for base in (_MODELS_DIR, _global_modelscope_hub_dir()):
        found = _find_in_base(base, model_id)
        if found is not None:
            return found
    return None


@contextmanager
def _offline_first_snapshot_download():
    """
    While active, modelscope's snapshot_download returns a local folder
    right away (no network request at all) if the requested model is
    already on disk. Otherwise it falls through to the original
    function and downloads normally.

    This is needed because the skin-retouching model's own wrapper
    (ms_wrapper.py) loads extra sub-models, e.g. the face detector
    damo/cv_resnet50_face-detection_retinaface, through the regular
    pipeline() -> snapshot_download() path, and the newer modelscope
    always lists the repo files over the network first, which fails
    with a 403 when ModelScope's rate limit is hit.
    """
    import modelscope.pipelines.builder as ms_builder
    import modelscope.hub.snapshot_download as ms_snapshot

    originals = []

    def make_patched(original):
        def patched(model_id, *args, **kwargs):
            try:
                if isinstance(model_id, str):
                    if os.path.isdir(model_id):
                        return model_id
                    local = _find_local_model_dir(model_id)
                    if local is not None:
                        print(f"[OreX_SkinRetouchingAI] Using local model "
                              f"for {model_id}: {local}")
                        return local
            except Exception as e:  # never break loading because of the lookup
                print(f"[OreX_SkinRetouchingAI] Local lookup failed for "
                      f"{model_id}: {e}")
            return original(model_id, *args, **kwargs)
        return patched

    for module in (ms_builder, ms_snapshot):
        if hasattr(module, "snapshot_download"):
            original = module.snapshot_download
            originals.append((module, original))
            module.snapshot_download = make_patched(original)
    try:
        yield
    finally:
        for module, original in originals:
            module.snapshot_download = original


# ---------------------------------------------------------------------
# Per-stage profiling of the ModelScope pipeline (diagnostics only).
# The pipeline's internal steps are wrapped with timers on the live
# pipeline object; ms_wrapper.py itself is not modified on disk.
# ---------------------------------------------------------------------
_STAGE_STATS = {}            # stage name -> [calls, seconds, peak VRAM growth MB]
_RUN = {"peak_abs": 0}       # running max of torch VRAM peak within one image


def _note_peak():
    if torch.cuda.is_available():
        _RUN["peak_abs"] = max(_RUN["peak_abs"], torch.cuda.max_memory_allocated())


def _timed(name, fn):
    """Wrap fn so its wall time (GPU-synchronized) and VRAM peak are recorded."""
    def wrapper(*args, **kwargs):
        use_cuda = torch.cuda.is_available()
        base = 0
        if use_cuda:
            torch.cuda.synchronize()
            _note_peak()                      # keep the peak seen so far
            base = torch.cuda.memory_allocated()
            torch.cuda.reset_peak_memory_stats()
        t0 = time.perf_counter()
        try:
            return fn(*args, **kwargs)
        finally:
            peak_mb = 0.0
            if use_cuda:
                torch.cuda.synchronize()
                peak_mb = (torch.cuda.max_memory_allocated() - base) / (1024 ** 2)
                _note_peak()
            dt = time.perf_counter() - t0
            s = _STAGE_STATS.setdefault(name, [0, 0.0, 0.0])
            s[0] += 1
            s[1] += dt
            s[2] = max(s[2], peak_mb)
    return wrapper


def _install_profiling(pipe):
    """Wrap the pipeline's internal stages with timers (once per pipeline)."""
    if getattr(pipe, "_orex_profiled", False):
        return

    def wrap_attr(obj, attr, stage_name):
        try:
            setattr(obj, attr, _timed(stage_name, getattr(obj, attr)))
        except Exception as e:
            print(f"[OreX_SkinRetouchingAI] Profiling: can't wrap "
                  f"{stage_name}: {e}")

    wrap_attr(pipe, "detector", "face_detect")
    wrap_attr(pipe, "retouch_local", "retouch_local")
    wrap_attr(pipe, "predict_roi", "predict_roi (per face)")
    if hasattr(pipe, "sess"):
        wrap_attr(pipe.sess, "run", "onnx_skin_mask")
    try:
        mod = sys.modules.get(type(pipe).__module__)
        if mod is not None and hasattr(mod, "whiten_img"):
            mod.whiten_img = _timed("whiten_img", mod.whiten_img)
    except Exception as e:
        print(f"[OreX_SkinRetouchingAI] Profiling: can't wrap whiten_img: {e}")
    pipe._orex_profiled = True


def _format_stages(model_sec):
    parts = []
    accounted = 0.0
    for name, (calls, sec, peak) in _STAGE_STATS.items():
        accounted += sec
        parts.append(f"{name} {sec:.1f} s x{calls} (peak +{peak:.0f} MB)")
    parts.append(f"other {max(model_sec - accounted, 0.0):.1f} s")
    return "; ".join(parts)


class OreX_SkinRetouchingAI:
    """
    Author: Pavel Korzhov (PaBoKor)

    AI skin retouching via the ModelScope skin-retouching model
    (damo/cv_unet_skin_retouching_torch), wrapped as a standalone node.

    Adds controls the raw model pipeline doesn't have on its own: dial
    the effect back with `strength`, compensate a slight brightness
    shift with `density`, and restrict it to a masked region with a
    feathered edge.

    Model weights are stored in a shared ComfyUI/models/modelscope/
    folder (via modelscope's snapshot_download with a custom cache_dir),
    not inside this package and not the global ModelScope cache
    (~/.cache/modelscope). This means the node isn't tied to this
    package's location, and clearing the global ModelScope cache won't
    trigger a re-download here either - only deleting
    models/modelscope/ would.

    If the weights (the main model and its helper models, such as the
    face detector) are already present locally - in models/modelscope/
    or in the global ModelScope cache - the node uses them directly and
    makes NO network requests, so ModelScope rate limits and being
    offline don't matter. Downloads happen only for models that are
    not found locally.

    For every processed image the node prints a timing line to the
    console (model time, total time, peak VRAM growth, GPU name,
    cudnn.benchmark state) and, when _PROFILE is True, a per-stage
    breakdown of the pipeline.

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
    CATEGORY = "OreX/Filters"
    DESCRIPTION = ("AI-ретушь кожи через модель ModelScope, с регулировкой "
                   "силы эффекта и маской. / AI skin retouching via a "
                   "ModelScope model, with adjustable strength and mask.")

    @classmethod
    def _get_model_dir(cls):
        """
        Return the local folder with the main model's weights. Uses the
        existing local copy if there is one (no network access at
        all); otherwise downloads it once via snapshot_download.
        """
        os.makedirs(_MODELS_DIR, exist_ok=True)

        local_dir = _find_in_base(_MODELS_DIR, _MODEL_ID)
        if local_dir is not None:
            return local_dir

        print(f"[OreX_SkinRetouchingAI] Model not found in {_MODELS_DIR}, "
              f"downloading {_MODEL_ID} ({_MODEL_REVISION})...")
        from modelscope.hub.snapshot_download import snapshot_download
        try:
            local_dir = snapshot_download(
                _MODEL_ID, revision=_MODEL_REVISION, cache_dir=_MODELS_DIR
            )
        except Exception as e:
            raise RuntimeError(
                f"[OreX_SkinRetouchingAI] Failed to download the model "
                f"{_MODEL_ID} from ModelScope: {e}\n"
                f"If this is a rate limit (403 / '操作过于频繁'), wait a "
                f"while and try again, or turn off VPN/proxy. You can also "
                f"download the model manually into: {_MODELS_DIR}"
            ) from e
        return local_dir

    @classmethod
    def _get_pipeline(cls):
        if cls._pipeline is None:
            from modelscope.pipelines import pipeline

            t_load = time.perf_counter()
            local_dir = cls._get_model_dir()
            try:
                # Helper models loaded inside the pipeline (face detector
                # etc.) are also resolved from local disk first.
                with _offline_first_snapshot_download():
                    pipe = pipeline(
                        "skin-retouching-torch",
                        model=local_dir,
                        model_revision=_MODEL_REVISION,
                        trust_remote_code=True,
                    )
            except Exception as e:
                raise RuntimeError(
                    f"[OreX_SkinRetouchingAI] Failed to build the pipeline: "
                    f"{e}\nIf this is a ModelScope rate limit (403 / "
                    f"'操作过于频繁') for a helper model that isn't on disk "
                    f"yet, wait 15-30 minutes and run again - it will be "
                    f"downloaded once and reused afterwards."
                ) from e
            if _PROFILE:
                _install_profiling(pipe)
            cls._pipeline = pipe
            print(f"[OreX_SkinRetouchingAI] Pipeline loaded in "
                  f"{time.perf_counter() - t_load:.1f} s")
        return cls._pipeline

    def process(self, image, strength, density=0.0, mask=None, mask_feather=15):
        from modelscope.outputs import OutputKeys

        pipe = self._get_pipeline()

        batch = image.shape[0]
        results = []
        use_cuda = torch.cuda.is_available()
        gpu_name = torch.cuda.get_device_name(0) if use_cuda else "no CUDA (CPU)"

        for i in range(batch):
            t_total = time.perf_counter()

            img_np = np.clip(image[i].cpu().numpy(), 0.0, 1.0)  # H,W,C RGB 0..1
            pil_img = Image.fromarray((img_np * 255).astype(np.uint8)).convert("RGB")

            vram_base = 0
            if use_cuda:
                torch.cuda.synchronize()
                torch.cuda.reset_peak_memory_stats()
                vram_base = torch.cuda.memory_allocated()
            _RUN["peak_abs"] = 0
            _STAGE_STATS.clear()

            # cuDNN benchmark mode: remember the current value, switch it
            # off for the duration of the pipeline call, then restore it.
            prev_benchmark = torch.backends.cudnn.benchmark
            if _DISABLE_CUDNN_BENCHMARK:
                torch.backends.cudnn.benchmark = False

            t_model = time.perf_counter()
            try:
                out = pipe(pil_img)
            finally:
                torch.backends.cudnn.benchmark = prev_benchmark
            if use_cuda:
                torch.cuda.synchronize()
            model_sec = time.perf_counter() - t_model

            vram_peak_mb = 0.0
            if use_cuda:
                _note_peak()
                vram_peak_mb = (_RUN["peak_abs"] - vram_base) / (1024 ** 2)

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

            bench_note = (f"cudnn.benchmark was {prev_benchmark}"
                          + (" -> off during run" if _DISABLE_CUDNN_BENCHMARK else ""))
            print(f"[OreX_SkinRetouchingAI] image {i + 1}/{batch} "
                  f"({img_np.shape[1]}x{img_np.shape[0]}): "
                  f"total {time.perf_counter() - t_total:.1f} s, "
                  f"model {model_sec:.1f} s, "
                  f"peak VRAM +{vram_peak_mb:.0f} MB, GPU: {gpu_name}, "
                  f"{bench_note}")
            if _PROFILE and _STAGE_STATS:
                print(f"[OreX_SkinRetouchingAI]   stages: "
                      f"{_format_stages(model_sec)}")

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


NODE_CLASS_MAPPINGS = {
    "orex Skin Retouching AI": OreX_SkinRetouchingAI,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex Skin Retouching AI": "✨ Skin Retouching AI (OreX)",
}