"""
OreX Remove Background (BiRefNet)

Один узел вместо флоу:
    Load Background Removal Model -> Remove Background -> Invert Mask -> Join Image with Alpha
One node instead of the flow above.

Author: Pavel Korzhov (PaBoKor)

Что делает / What it does
    - Вход: IMAGE. Выход: IMAGE (RGBA, фон прозрачный) и MASK (белое = объект).
    - Модель выбирается в списке (как в Load Background Removal Model) из
      ComfyUI/models/background_removal/ (с учётом extra_model_paths.yaml).
      Если выбрана одна из известных моделей (birefnet, lucida) и файла нет,
      она один раз скачивается с Hugging Face в эту же папку.
    - Сама инференс-часть берётся из ядра ComfyUI (comfy.bg_removal_model), поэтому
      результат совпадает со стандартными узлами Remove Background.
    - Input: IMAGE. Output: IMAGE (RGBA, transparent background) and MASK (white = subject).
    - The model is chosen from a list (like Load Background Removal Model) of files in
      ComfyUI/models/background_removal/ (extra_model_paths.yaml is respected).
      If one of the known models (birefnet, lucida) is selected and missing,
      it is downloaded once from Hugging Face into that folder.
    - Inference itself comes from the ComfyUI core (comfy.bg_removal_model), so the result
      matches the stock Remove Background node.

Про инверсию маски / About mask inversion
    В исходном флоу Invert Mask стоял перед Join Image with Alpha, а тот внутри сам делает
    1 - mask. Две инверсии сокращаются, поэтому альфа-канал = маска модели напрямую.
    In the original flow Invert Mask sat before Join Image with Alpha, which inverts again
    internally. The two inversions cancel out, so alpha = the model mask directly.
"""

import os

import torch
import folder_paths

try:
    import comfy.utils
    from comfy.bg_removal_model import load as _load_bg_model
    _IMPORT_ERROR = None
except Exception as e:  # старая версия ComfyUI без background removal / old ComfyUI build
    _load_bg_model = None
    _IMPORT_ERROR = e


# --------------------------------------------------------------------------- #
#  Настройки / Settings
# --------------------------------------------------------------------------- #
MODEL_FOLDER = "background_removal"
DEFAULT_MODEL = "birefnet.safetensors"
# Модели, которые узел умеет скачивать сам. Остальные берутся только с диска.
# Models the node can download by itself. Any other file is only loaded from disk.
MODEL_URLS = {
    "birefnet.safetensors": (
        "https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/"
        "background_removal/birefnet.safetensors"
    ),
    # Официальная копия lucida для ComfyUI в репозитории Comfy-Org (может отставать от релизов автора).
    # Official ComfyUI copy of lucida in the Comfy-Org repo (may lag behind the author's releases).
    "lucida.safetensors": (
        "https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/"
        "background_removal/lucida.safetensors"
    ),
}

NODE_KEY = "orex Remove Background"
NODE_DISPLAY_NAME = "🪄 Remove Background (OreX)"
NODE_CATEGORY = "OreX/Image"

LOG_PREFIX = "[OreX RemoveBackground]"

# Кэш загруженной модели, чтобы не читать большой файл с диска при каждом запуске.
# Cache of the loaded model so the large file isn't re-read from disk on every run.
_cache = {"key": None, "model": None}


# --------------------------------------------------------------------------- #
#  Загрузка модели / Model download
# --------------------------------------------------------------------------- #
def _download_model(url: str, dest: str) -> None:
    import urllib.request

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    print(f"{LOG_PREFIX} Модель не найдена, скачиваю / Model not found, downloading:\n"
          f"    {url}\n    -> {dest}")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "comfyui-OreX"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            total = int(resp.headers.get("Content-Length") or 0)
            pbar = comfy.utils.ProgressBar(total) if total else None
            done = 0
            next_log = 10
            with open(tmp, "wb") as f:
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    if pbar is not None:
                        pbar.update_absolute(done, total)
                    if total and done * 100 // total >= next_log:
                        print(f"{LOG_PREFIX} {done * 100 // total}% "
                              f"({done // (1024 * 1024)} / {total // (1024 * 1024)} MB)")
                        next_log += 10

        if total and done != total:
            raise IOError(f"incomplete download: {done} of {total} bytes")
        os.replace(tmp, dest)
        print(f"{LOG_PREFIX} Готово / Done: {dest}")

    except Exception as e:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
        raise RuntimeError(
            f"{LOG_PREFIX} Не удалось скачать модель / Failed to download the model: {e}\n"
            f"Проверь интернет или скачай файл вручную и положи сюда / "
            f"Check your connection or download it manually and put it here:\n"
            f"    {url}\n    -> {dest}"
        ) from e


def _get_model(name: str):
    if _load_bg_model is None:
        raise RuntimeError(
            f"{LOG_PREFIX} Эта версия ComfyUI не содержит модуль background removal "
            f"(comfy.bg_removal_model). Обнови ComfyUI. / "
            f"This ComfyUI build has no background removal support. Please update ComfyUI. "
            f"({_IMPORT_ERROR})"
        )

    path = folder_paths.get_full_path(MODEL_FOLDER, name)
    if path is None or not os.path.isfile(path):
        url = MODEL_URLS.get(name)
        dest = os.path.join(folder_paths.models_dir, MODEL_FOLDER, name)
        if url is None:
            raise RuntimeError(
                f"{LOG_PREFIX} Файл модели не найден / Model file not found: {dest}"
            )
        path = dest
        _download_model(url, path)

    key = (path, os.path.getmtime(path))
    if _cache["key"] != key:
        model = _load_bg_model(path)
        if model is None:
            raise RuntimeError(
                f"{LOG_PREFIX} Файл не является моделью BiRefNet / "
                f"The file is not a valid BiRefNet model: {path}\n"
                f"Удали его, и он скачается заново / Delete it to have it re-downloaded."
            )
        _cache["key"] = key
        _cache["model"] = model
    return _cache["model"]


# --------------------------------------------------------------------------- #
#  Узел / Node
# --------------------------------------------------------------------------- #
class OreX_RemoveBackground:
    @classmethod
    def INPUT_TYPES(cls):
        try:
            files = list(folder_paths.get_filename_list(MODEL_FOLDER))
        except Exception:
            files = []
        for name in MODEL_URLS:  # чтобы на чистой установке было что выбрать и скачать
            if name not in files:
                files.append(name)
        return {
            "required": {
                "bg_removal_name": (sorted(files), {
                    "default": DEFAULT_MODEL,
                    "tooltip": "Модель удаления фона. Модели из списка скачиваются сами при первом запуске.\n"
                               "• birefnet — универсальная BiRefNet (Comfy-Org): люди, волосы, шерсть, предметы, животные.\n"
                               "• lucida — дообученная BiRefNet_HR (egeorcun): по описанию автора, лучше справляется с "
                               "прозрачными материалами, текстом и логотипами, иллюстрациями, камуфляжем; файл 885 МБ.\n"
                               "Background removal model. Models from the list are downloaded automatically on first run.\n"
                               "• birefnet — general-purpose BiRefNet (Comfy-Org): people, hair, fur, objects, animals.\n"
                               "• lucida — fine-tuned BiRefNet_HR (egeorcun): per the author, stronger on transparent "
                               "materials, text and logos, illustrations, camouflage; 885 MB file."
                }),
                "image": ("IMAGE", {
                    "tooltip": "Изображение (или батч), у которого нужно убрать фон. / "
                               "Image (or batch) to remove the background from."
                }),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    RETURN_TOOLTIPS = (
        "Изображение RGBA: фон прозрачный. / RGBA image with a transparent background.",
        "Маска переднего плана (белое = объект). / Foreground mask (white = subject).",
    )
    FUNCTION = "run"
    CATEGORY = NODE_CATEGORY
    DESCRIPTION = (
        "Удаляет фон с помощью BiRefNet одним узлом. Модель скачивается один раз при "
        "первом запуске в ComfyUI/models/background_removal. / "
        "Removes the background with BiRefNet in a single node. The model is downloaded "
        "once on first run into ComfyUI/models/background_removal."
    )

    def run(self, bg_removal_name, image):
        model = _get_model(bg_removal_name)

        # (B, H, W), 1 = объект / 1 = subject. Размер совпадает с входным изображением.
        mask = model.encode_image(image)
        mask = mask.to(image)

        # RGB входа (если был альфа-канал, он отбрасывается) + маска как альфа.
        rgba = torch.cat((image[..., :3], mask.unsqueeze(-1)), dim=-1)
        return (rgba, mask)


NODE_CLASS_MAPPINGS = {
    NODE_KEY: OreX_RemoveBackground,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    NODE_KEY: NODE_DISPLAY_NAME,
}
