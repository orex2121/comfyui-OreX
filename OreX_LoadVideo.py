from __future__ import annotations

import os
from fractions import Fraction

import av
import folder_paths
import torch
import torch.nn.functional as F
from aiohttp import web
from comfy_api.latest import InputImpl, io
from comfy_extras.nodes_video import preview_input_video, save_video_preview
from server import PromptServer


RESOLUTION_PRESETS = {
    "360p": (640, 360),
    "480p": (854, 480),
    "540p": (960, 540),
    "720p": (1280, 720),
    "900p": (1600, 900),
    "1080p": (1920, 1080),
    "1152p": (2048, 1152),
    "2k": (2560, 1440),
    "1620p": (2880, 1620),
    "1800p": (3200, 1800),
    "4k": (3840, 2160),
}


def _input_videos():
    input_dir = folder_paths.get_input_directory()
    files = [name for name in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, name))]
    return sorted(folder_paths.filter_files_content_types(files, ["video"]))


def _target_dimensions(width: int, height: int, resolution: str) -> tuple[int, int]:
    if resolution == "Default":
        return width, height
    box_width, box_height = RESOLUTION_PRESETS[resolution]
    if height > width:
        box_width, box_height = box_height, box_width
    scale = min(box_width / width, box_height / height)
    target_width = max(2, round(width * scale / 2) * 2)
    target_height = max(2, round(height * scale / 2) * 2)
    return min(target_width, box_width), min(target_height, box_height)


def _resize_frames(images: torch.Tensor, dimensions: tuple[int, int]) -> torch.Tensor:
    width, height = dimensions
    if (images.shape[2], images.shape[1]) == dimensions:
        return images
    output = torch.empty(
        (images.shape[0], height, width, images.shape[3]),
        dtype=images.dtype,
        device="cpu",
    )
    for start in range(0, images.shape[0], 16):
        batch = images[start:start + 16].cpu().movedim(-1, 1)
        resized = F.interpolate(
            batch,
            size=(height, width),
            mode="bicubic",
            align_corners=False,
            antialias=True,
        ).movedim(1, -1).clamp_(0.0, 1.0)
        output[start:start + resized.shape[0]].copy_(resized)
    return output


def _resample_frames(images: torch.Tensor, source_fps: Fraction, target_fps: float) -> torch.Tensor:
    if not target_fps or abs(float(source_fps) - target_fps) < 1e-6:
        return images
    count = max(1, round(images.shape[0] * target_fps / float(source_fps)))
    positions = torch.arange(count, dtype=torch.float64) * float(source_fps) / target_fps
    indices = positions.round().long().clamp_(0, images.shape[0] - 1)
    return images.index_select(0, indices)


def _connected_output_slots(prompt, node_id) -> set[int]:
    """Return output slots from this node that are linked in the submitted prompt."""
    if not isinstance(prompt, dict) or node_id is None:
        return set()

    origin_id = str(node_id)
    slots: set[int] = set()

    def inspect(value):
        if (
            isinstance(value, (list, tuple))
            and len(value) == 2
            and str(value[0]) == origin_id
            and isinstance(value[1], int)
        ):
            slots.add(value[1])
            return
        if isinstance(value, dict):
            for nested in value.values():
                inspect(nested)
        elif isinstance(value, (list, tuple)):
            for nested in value:
                inspect(nested)

    for prompt_node in prompt.values():
        if isinstance(prompt_node, dict):
            inspect(prompt_node.get("inputs", {}))
    return slots


def _load_trimmed_audio(path: str, start_time: float, duration: float):
    """Decode only the requested audio window without materializing video frames."""
    with av.open(path) as container:
        if not container.streams.audio:
            return None
        stream = container.streams.audio[0]
        sample_rate = stream.codec_context.sample_rate
        channels = stream.codec_context.channels
        if not sample_rate or not channels:
            return None
        if start_time > 0 and stream.time_base:
            container.seek(int(start_time / stream.time_base), stream=stream, backward=True)

        end_time = start_time + duration if duration > 0 else None
        chunks = []
        cursor = 0.0
        for frame in container.decode(stream):
            frame_rate = frame.sample_rate or sample_rate
            frame_start = float(frame.pts * frame.time_base) if frame.pts is not None else cursor
            frame_end = frame_start + frame.samples / frame_rate
            cursor = frame_end
            if frame_end <= start_time:
                continue
            if end_time is not None and frame_start >= end_time:
                break

            data = torch.from_numpy(frame.to_ndarray())
            if data.shape[0] != channels:
                data = data.reshape(-1, channels).t()
            if data.dtype == torch.int16:
                data = data.float().div_(2**15)
            elif data.dtype == torch.int32:
                data = data.float().div_(2**31)
            else:
                data = data.float()

            first = max(0, round((start_time - frame_start) * frame_rate))
            last = frame.samples
            if end_time is not None:
                last = min(last, round((end_time - frame_start) * frame_rate))
            if first < last:
                chunks.append(data[:, first:last])

        if not chunks:
            return None
        return {"waveform": torch.cat(chunks, dim=1).unsqueeze(0), "sample_rate": sample_rate}


async def orex_load_video_metadata(request):
    file = request.rel_url.query.get("file", "")
    if not file or not folder_paths.exists_annotated_filepath(file):
        raise web.HTTPNotFound(text="Video not found")
    source = InputImpl.VideoFromFile(folder_paths.get_annotated_filepath(file))
    return web.json_response({"fps": float(source.get_frame_rate())})


if getattr(PromptServer, "instance", None) is not None:
    PromptServer.instance.routes.get("/orex/load-video-metadata")(orex_load_video_metadata)


class OreXLoadVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="OreXLoadVideo",
            display_name="Load Video (OreX)",
            category="OreX/Video",
            has_intermediate_output=True,
            inputs=[
                io.Combo.Input(
                    "file",
                    options=_input_videos(),
                    upload=io.UploadType.video,
                    tooltip="Video file from the ComfyUI input folder.\nВидеофайл из папки input ComfyUI.",
                ),
                io.Float.Input(
                    "start_time",
                    display_name="start_time (frame)",
                    default=0.0,
                    min=0.0,
                    max=86400.0,
                    step=0.01,
                    tooltip=(
                        "Dual-purpose start position. With the video output connected, the value is time in seconds. "
                        "With the images output connected, it is the zero-based source frame number; fractional values are rounded to the nearest frame. "
                        "0 starts from the beginning.\n"
                        "Начальная позиция двойного назначения. При подключённом выходе video значение задаёт время в секундах. "
                        "При подключённом выходе images это номер исходного кадра, начиная с нуля; дробное значение округляется до ближайшего кадра. "
                        "0 означает начало видео."
                    ),
                ),
                io.Float.Input(
                    "durations",
                    display_name="durations (max_frames)",
                    default=0.0,
                    min=0.0,
                    max=86400.0,
                    step=0.01,
                    tooltip=(
                        "Dual-purpose range length. With the video output connected, the value is duration in seconds. "
                        "With the images output connected, it is the maximum number of source frames to decode; fractional values are rounded to the nearest frame. "
                        "0 loads to the end.\n"
                        "Длина диапазона двойного назначения. При подключённом выходе video значение задаёт длительность в секундах. "
                        "При подключённом выходе images это максимальное количество декодируемых исходных кадров; дробное значение округляется до ближайшего кадра. "
                        "0 загружает до конца."
                    ),
                ),
                io.Float.Input(
                    "set_fps",
                    default=0.0,
                    min=0.0,
                    max=240.0,
                    step=1.0,
                    tooltip=(
                        "Frame rate for the images output only. Frames are dropped or duplicated without changing playback duration. "
                        "It is intentionally ignored in video mode to avoid decoding and re-encoding. 0 keeps the source FPS.\n"
                        "Частота кадров только для выхода images. Кадры удаляются или дублируются без изменения длительности воспроизведения. "
                        "В режиме video параметр намеренно игнорируется, чтобы избежать декодирования и повторного кодирования. 0 сохраняет исходный FPS."
                    ),
                ),
                io.Combo.Input(
                    "resolution",
                    options=["Default", *RESOLUTION_PRESETS],
                    default="Default",
                    tooltip=(
                        "Resolution for the images output only. Resizing runs on the CPU, preserves the aspect ratio, and automatically rotates the preset box for portrait video. "
                        "It is intentionally ignored in video mode to keep the original stream without decoding. Default keeps the source size.\n"
                        "Разрешение только для выхода images. Масштабирование выполняется на CPU, сохраняет пропорции и автоматически поворачивает рамку пресета для вертикального видео. "
                        "В режиме video параметр намеренно игнорируется, чтобы сохранить исходный поток без декодирования. Default сохраняет исходный размер."
                    ),
                ),
            ],
            outputs=[
                io.Video.Output(
                    display_name="video",
                    tooltip=(
                        "Trimmed ComfyUI VIDEO object. Connecting this output selects video mode: the source stream stays lazy and frames are not decoded, resized, or frame-rate converted. "
                        "Do not connect video and images at the same time.\n"
                        "Обрезанный объект VIDEO ComfyUI. Подключение этого выхода выбирает режим video: исходный поток остаётся отложенным, кадры не декодируются, не масштабируются и не преобразуются по FPS. "
                        "Не подключайте video и images одновременно."
                    ),
                ),
                io.Image.Output(
                    display_name="images",
                    tooltip=(
                        "Decoded frame sequence. Connecting this output selects images mode and applies frame-based trimming, set_fps, and resolution. "
                        "Do not connect video and images at the same time.\n"
                        "Декодированная секвенция кадров. Подключение этого выхода выбирает режим images и применяет обрезку по кадрам, set_fps и resolution. "
                        "Не подключайте video и images одновременно."
                    ),
                ),
                io.Audio.Output(display_name="audio", tooltip="Audio trimmed to exactly the same range as video or images. It is decoded only when this output is connected.\nАудио, обрезанное точно по тому же диапазону, что video или images. Декодируется только при подключении этого выхода."),
                io.Int.Output(display_name="frame_count", tooltip="Number of frames in the selected result. In video mode it is read from stream metadata without creating an image tensor.\nКоличество кадров выбранного результата. В режиме video считывается из метаданных потока без создания тензора изображений."),
                io.Float.Output(display_name="fps", tooltip="Frame rate of the selected result. In images mode this includes set_fps conversion.\nЧастота кадров выбранного результата. В режиме images учитывает преобразование set_fps."),
                io.Int.Output(display_name="width", tooltip="Width of the selected result in pixels. In images mode this includes resolution scaling.\nШирина выбранного результата в пикселях. В режиме images учитывает масштабирование resolution."),
                io.Int.Output(display_name="height", tooltip="Height of the selected result in pixels. In images mode this includes resolution scaling.\nВысота выбранного результата в пикселях. В режиме images учитывает масштабирование resolution."),
                io.Float.Output(display_name="duration", tooltip="Duration of the selected result in seconds.\nДлительность выбранного результата в секундах."),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, file, start_time=0.0, durations=0.0, set_fps=0.0, resolution="Default"):
        path = folder_paths.get_annotated_filepath(file)
        source = InputImpl.VideoFromFile(path)
        connected = _connected_output_slots(cls.hidden.prompt, cls.hidden.unique_id)
        images_mode = 1 in connected
        video_mode = 0 in connected or not images_mode
        if video_mode and images_mode:
            raise ValueError(
                "Connect either video or images, not both. / Подключите либо video, либо images, но не оба выхода одновременно."
            )

        if video_mode:
            start_seconds = float(start_time)
            duration_seconds = float(durations)
            video = source.as_trimmed(start_seconds, duration_seconds, strict_duration=False)
            if video is None:
                raise ValueError("The requested video range is empty. / Запрошенный диапазон видео пуст.")
            width, height = video.get_dimensions()
            frame_count = video.get_frame_count()
            output_fps = float(video.get_frame_rate())
            output_duration = float(video.get_duration())
            audio = _load_trimmed_audio(path, start_seconds, duration_seconds) if 2 in connected else None
            empty_images = torch.empty((0, 1, 1, 3), dtype=torch.float32)
            preview = (
                save_video_preview(video)
                if float(start_time) or float(durations)
                else preview_input_video(file, source)
            )
            return io.NodeOutput(
                video,
                empty_images,
                audio,
                frame_count,
                output_fps,
                width,
                height,
                output_duration,
                ui=preview,
            )

        source_fps = Fraction(source.get_frame_rate())
        start_frame = max(0, round(float(start_time)))
        max_frames = max(0, round(float(durations)))
        start_seconds = start_frame / float(source_fps)
        duration_seconds = max_frames / float(source_fps) if max_frames else 0.0
        video = source.as_trimmed(start_seconds, duration_seconds, strict_duration=False)
        if video is None:
            raise ValueError("The requested video range is empty. / Запрошенный диапазон видео пуст.")

        components = video.get_components()
        images = components.images
        if images.shape[0] == 0:
            raise ValueError("No frames were decoded. / Не удалось декодировать ни одного кадра.")

        if max_frames and images.shape[0] > max_frames:
            images = images[:max_frames]
        source_fps = Fraction(components.frame_rate)
        output_fps = float(set_fps) if set_fps > 0 else float(source_fps)
        images = _resample_frames(images, source_fps, output_fps)
        dimensions = _target_dimensions(images.shape[2], images.shape[1], resolution)
        images = _resize_frames(images, dimensions)

        frame_count = int(images.shape[0])
        width, height = dimensions
        output_duration = frame_count / output_fps
        preview = (
            save_video_preview(video)
            if start_frame or max_frames
            else preview_input_video(file, source)
        )
        return io.NodeOutput(
            None,
            images,
            components.audio,
            frame_count,
            output_fps,
            width,
            height,
            output_duration,
            ui=preview,
        )

    @classmethod
    def fingerprint_inputs(cls, file, **kwargs):
        path = folder_paths.get_annotated_filepath(file)
        stat = os.stat(path)
        connected = ",".join(map(str, sorted(_connected_output_slots(cls.hidden.prompt, cls.hidden.unique_id))))
        return f"{stat.st_mtime_ns}:{stat.st_size}:{connected}"

    @classmethod
    def validate_inputs(cls, file, **kwargs):
        if not folder_paths.exists_annotated_filepath(file):
            return f"Video not found: {file}"
        return True


NODE_CLASS_MAPPINGS = {"OreXLoadVideo": OreXLoadVideo}
NODE_DISPLAY_NAME_MAPPINGS = {"OreXLoadVideo": "Load Video (OreX)"}
