# -*- coding: utf-8 -*-
import os
import re
import glob
import base64
import datetime
import random
import logging
from typing import Dict, Any, Optional
import torch
import numpy as np
from PIL import Image
import folder_paths

try:
    from aiohttp import web
    from server import PromptServer
    _HAS_SERVER = True
except Exception:
    _HAS_SERVER = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Соответствие режима сравнения -> (подпапка, суффикс файла)
MODE_FOLDER_MAP = {
    "Slider": "slider",
    "Side-by-Side": "sidebyside",
    "Overlap": "overlap",
    "Difference": "difference",
    "Blink": "blink",
}

# Фиксированный период смены кадра для Blink GIF (мс), не зависит от виджета blink_speed
BLINK_GIF_FRAME_MS = 1000


def _today_folder() -> str:
    """Актуальная дата на момент вызова (не дата старта сервера)."""
    return datetime.datetime.now().strftime("%Y-%m-%d")


def _ensure_mode_dir(mode_key: str, custom_root: Optional[str] = None) -> str:
    """
    Создаёт (если нужно) папку под сохранение и возвращает путь.
    Без custom_root: output/<дата>/<режим>/
    С custom_root: <custom_root>/<режим>/  (без даты — путь уже указывает
    в нужное место, дублировать дату избыточно)
    """
    if custom_root:
        mode_dir = os.path.join(custom_root, mode_key)
    else:
        base_output = folder_paths.get_output_directory()
        day_dir = os.path.join(base_output, _today_folder())
        mode_dir = os.path.join(day_dir, mode_key)
    os.makedirs(mode_dir, exist_ok=True)
    return mode_dir


def _validate_custom_path(path: str) -> Optional[str]:
    """
    Минимальная проверка пользовательского пути перед сохранением:
    диск/корень существует, папку можно создать и в неё можно писать.
    Возвращает текст ошибки (для показа на кнопке) или None, если всё ок.
    Рассчитано на Windows-пути (буква диска), но не ломается и на других ОС.
    """
    if not path:
        return None

    drive, _tail = os.path.splitdrive(path)
    if drive and not os.path.exists(drive + os.sep):
        return f"Диск {drive} недоступен"

    try:
        os.makedirs(path, exist_ok=True)
    except Exception as e:
        return f"Нет доступа к папке: {e}"

    if not os.access(path, os.W_OK):
        return f"Папка недоступна для записи: {path}"

    return None


def _next_counter(mode_dir: str, suffix: str, ext: str) -> int:
    """Отдельный счётчик на каждый режим: сканирует папку и берёт max+1."""
    pattern = os.path.join(mode_dir, f"OreX_Compare_{suffix}_*.{ext}")
    max_idx = 0
    rx = re.compile(rf"OreX_Compare_{re.escape(suffix)}_(\d+)\.{re.escape(ext)}$")
    for fp in glob.glob(pattern):
        m = rx.search(os.path.basename(fp))
        if m:
            max_idx = max(max_idx, int(m.group(1)))
    return max_idx + 1


def _resolve_source_path(filename: str, subfolder: str, img_type: str) -> str:
    """Определяет полный путь к уже сохранённому исходнику (temp/output/input)."""
    if img_type == "temp":
        root = folder_paths.get_temp_directory()
    elif img_type == "input":
        root = folder_paths.get_input_directory()
    else:
        root = folder_paths.get_output_directory()
    return os.path.join(root, subfolder, filename) if subfolder else os.path.join(root, filename)

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
                "output_path": (
                    "STRING",
                    {
                        "default": "",
                        "forceInput": True
                    }
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
        blink_speed: float = 1.0,
        image_1: Optional[torch.Tensor] = None,
        image_2: Optional[torch.Tensor] = None,
        output_path: Optional[str] = None,
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
                "images": ui_images,
                # Прокидываем путь на фронтенд, чтобы кнопка "Сохранить" знала,
                # куда писать — путь известен только во время выполнения графа.
                "output_path": [output_path or ""]
            }
        }


NODE_CLASS_MAPPINGS = {"OreX Image Compare": OreXImageCompare}
NODE_DISPLAY_NAME_MAPPINGS = {"OreX Image Compare": "↔️ OreX Image Compare"}
WEB_DIRECTORY = "./js"
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']


# ---------------------------------------------------------------------------
# HTTP-роуты для сохранения "как видишь" по кнопке на узле
# ---------------------------------------------------------------------------
if _HAS_SERVER:
    routes = PromptServer.instance.routes

    @routes.post("/orex/save_compare")
    async def orex_save_compare(request):
        """
        Принимает снимок канваса (JPEG в base64, качество 0.80) для режимов
        Slider / Side-by-Side / Overlap / Difference и сохраняет его
        в output/<дата>/<режим>/OreX_Compare_<суффикс>_NNNNN.jpg.
        Разрешение снимка соответствует более крупному из двух исходников
        (см. _captureComposite на стороне JS).
        """
        try:
            data = await request.json()
            mode = data.get("mode")
            image_data_url = data.get("image", "")
            output_path = (data.get("output_path") or "").strip()

            suffix = MODE_FOLDER_MAP.get(mode)
            if not suffix or suffix == "blink":
                return web.json_response(
                    {"success": False, "error": f"Недопустимый режим для этого роута: {mode}"},
                    status=400
                )

            if output_path:
                validation_error = _validate_custom_path(output_path)
                if validation_error:
                    return web.json_response({"success": False, "error": validation_error}, status=400)

            if "," in image_data_url:
                image_data_url = image_data_url.split(",", 1)[1]
            jpg_bytes = base64.b64decode(image_data_url)

            mode_dir = _ensure_mode_dir(suffix, custom_root=output_path or None)
            idx = _next_counter(mode_dir, suffix, "jpg")
            file_name = f"OreX_Compare_{suffix}_{idx:05}.jpg"
            file_path = os.path.join(mode_dir, file_name)

            with open(file_path, "wb") as f:
                f.write(jpg_bytes)

            logger.info(f"[OreX Compare] Сохранён снимок: {file_path}")
            return web.json_response({"success": True, "path": file_path, "filename": file_name})

        except Exception as e:
            logger.error(f"[OreX Compare] Ошибка сохранения снимка: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/orex/save_blink_gif")
    async def orex_save_blink_gif(request):
        """
        Собирает зацикленный GIF из двух исходных изображений
        (уже сохранённых узлом при выполнении схемы) для режима Blink.
        Период кадра фиксирован (BLINK_GIF_FRAME_MS), не зависит от blink_speed.
        """
        try:
            data = await request.json()
            meta1 = data.get("img1")
            meta2 = data.get("img2")
            output_path = (data.get("output_path") or "").strip()

            if not meta1 or not meta2:
                return web.json_response(
                    {"success": False, "error": "Нужны оба изображения (image_1 и image_2) для Blink GIF"},
                    status=400
                )

            if output_path:
                validation_error = _validate_custom_path(output_path)
                if validation_error:
                    return web.json_response({"success": False, "error": validation_error}, status=400)

            path1 = _resolve_source_path(meta1["filename"], meta1.get("subfolder", ""), meta1.get("type", "temp"))
            path2 = _resolve_source_path(meta2["filename"], meta2.get("subfolder", ""), meta2.get("type", "temp"))

            frame1 = Image.open(path1).convert("RGB")
            frame2 = Image.open(path2).convert("RGB")

            # Приводим кадры к одному размеру (по первому кадру), если вдруг отличаются
            if frame2.size != frame1.size:
                frame2 = frame2.resize(frame1.size)

            mode_dir = _ensure_mode_dir("blink", custom_root=output_path or None)
            idx = _next_counter(mode_dir, "blink", "gif")
            file_name = f"OreX_Compare_blink_{idx:05}.gif"
            file_path = os.path.join(mode_dir, file_name)

            frame1.save(
                file_path,
                save_all=True,
                append_images=[frame2],
                duration=BLINK_GIF_FRAME_MS,
                loop=0,
                disposal=2,
            )

            logger.info(f"[OreX Compare] Сохранён Blink GIF: {file_path}")
            return web.json_response({"success": True, "path": file_path, "filename": file_name})

        except Exception as e:
            logger.error(f"[OreX Compare] Ошибка сохранения Blink GIF: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)
else:
    logger.warning("[OreX Compare] PromptServer недоступен — роуты сохранения не зарегистрированы.")