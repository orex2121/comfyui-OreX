from __future__ import annotations

import gc
import hashlib
import json
import os
import queue
import shutil
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
from pathlib import Path

import folder_paths
import nodes
import torch
import torch.nn.functional as F
import comfy.model_management
import comfy.model_prefetch
import comfy.samplers
import comfy.utils
from comfy_api.latest import InputImpl, Types
from comfy_extras.nodes_wan import RelayVSRConditioning, VSRDecode


KEYFRAME_INTERVAL = 15
PIPE_WRITE_SIZE = 1024 * 1024
RESOLUTION_PRESETS = {
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "2k": (2560, 1440),
    "4k": (3840, 2160),
}


def _plan(total_frames: int, chunk_frames: int, overlap_frames: int):
    for core_start in range(0, total_frames, chunk_frames):
        core_end = min(core_start + chunk_frames, total_frames)
        process_start = max(0, core_start - overlap_frames)
        process_end = min(total_frames, core_end + overlap_frames)
        yield process_start, process_end, core_start - process_start, core_end - core_start


def _check_multiple(name: str, value: int, allow_zero: bool = False):
    if value < 0 or (value == 0 and not allow_zero) or value % KEYFRAME_INTERVAL:
        zero = "неотрицательным" if allow_zero else "положительным"
        raise ValueError(f"{name} должен быть {zero} и кратным {KEYFRAME_INTERVAL}")


def _resume_config(
    video, model, vae, total_frames, fps, chunk_frames, overlap_frames, video_encoder,
    stream_flash_decode, input_resolution, output_resolution, seed, steps, cfg,
    sampler_name, scheduler, detail
):
    source = video.get_stream_source()
    if isinstance(source, (str, os.PathLike)):
        source_path = Path(source).resolve()
        stat = source_path.stat()
        source_info = {
            "path": str(source_path),
            "size": stat.st_size,
            "mtime_ns": stat.st_mtime_ns,
        }
    else:
        source_info = {"type": type(source).__name__}
    diffusion_model = model.model.diffusion_model
    decoder = vae.first_stage_model
    trim_start, trim_duration = video.get_active_trim_window()
    source_info["trim"] = {"start": trim_start, "duration": trim_duration}
    return {
        "version": 7,
        "source": source_info,
        "total_frames": total_frames,
        "fps": f"{fps.numerator}/{fps.denominator}",
        "chunk_frames": chunk_frames,
        "overlap_frames": overlap_frames,
        "video_encoder": video_encoder,
        "stream_flash_decode": stream_flash_decode,
        "input_resolution": input_resolution,
        "output_resolution": output_resolution,
        "seed": seed,
        "steps": steps,
        "cfg": cfg,
        "sampler_name": sampler_name,
        "scheduler": scheduler,
        "detail": detail,
        "model": {
            "class": type(diffusion_model).__name__,
            "upscale_factor": getattr(diffusion_model, "upscale_factor", None),
            "latent_stride": getattr(diffusion_model, "latent_stride", None),
        },
        "vae": {
            "class": type(decoder).__name__,
            "upscale_factor": getattr(decoder, "upscale_factor", None),
            "latent_stride": getattr(decoder, "latent_stride", None),
        },
    }


def _write_manifest(path: Path, manifest: dict):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def _target_dimensions(width: int, height: int, output_resolution: str):
    if output_resolution == "Default":
        return width, height
    box_width, box_height = RESOLUTION_PRESETS[output_resolution]
    if height > width:
        box_width, box_height = box_height, box_width
    scale = min(box_width / width, box_height / height)
    target_width = max(2, round(width * scale / 2) * 2)
    target_height = max(2, round(height * scale / 2) * 2)
    return min(target_width, box_width), min(target_height, box_height)


def _input_target_dimensions(width: int, height: int, input_resolution: str):
    target = _target_dimensions(width, height, input_resolution)
    return target if target[0] > width else (width, height)


def _resize_images_cpu(images, dimensions):
    width, height = dimensions
    if (images.shape[2], images.shape[1]) == dimensions:
        return images
    return F.interpolate(
        images.cpu().movedim(-1, 1),
        size=(height, width),
        mode="bicubic",
        align_corners=False,
        antialias=True,
    ).movedim(1, -1).clamp_(0.0, 1.0)


def _valid_part(path: Path, expected_frames: int, fps: Fraction, expected_dimensions=None) -> bool:
    if not path.is_file() or path.stat().st_size == 0:
        return False
    try:
        video = InputImpl.VideoFromFile(str(path))
        return (
            video.get_frame_count() == expected_frames
            and Fraction(video.get_frame_rate()) == fps
            and (expected_dimensions is None or video.get_dimensions() == expected_dimensions)
        )
    except Exception:
        return False


def _clear_directory(path: Path, keep: Path | None = None):
    if not path.is_dir():
        return
    for child in path.iterdir():
        if keep is not None and child == keep:
            continue
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)


def _write_pipe_chunks(pipe, data):
    view = memoryview(data).cast("B")
    offset = 0
    while offset < len(view):
        written = pipe.write(view[offset:offset + PIPE_WRITE_SIZE])
        if not written:
            raise BrokenPipeError("FFmpeg pipe closed")
        offset += written


def _encode_part(images, fps: Fraction, path: Path, video_encoder: str, output_resolution: str):
    path.unlink(missing_ok=True)
    if video_encoder.startswith("x264_") and output_resolution == "Default":
        part_video = InputImpl.VideoFromComponents(
            Types.VideoComponents(images=images, audio=None, frame_rate=fps)
        )
        part_video.save_to(
            str(path),
            format=Types.VideoContainer("mp4"),
            codec=Types.VideoCodec("h264"),
            preset=video_encoder.removeprefix("x264_"),
        )
        return

    height, width = images.shape[1:3]
    command = _stream_encoder_command(width, height, fps, path, video_encoder, output_resolution)
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for frame in images:
            data = (frame[..., :3] * 255).clamp(0, 255).byte().cpu().contiguous().numpy()
            _write_pipe_chunks(process.stdin, data)
        process.stdin.close()
        error = process.stderr.read().decode("utf-8", errors="replace")
        return_code = process.wait()
    except OSError as exception:
        try:
            process.stdin.close()
        except Exception:
            pass
        error = process.stderr.read().decode("utf-8", errors="replace")
        process.wait()
        path.unlink(missing_ok=True)
        raise RuntimeError("NVENC преждевременно завершил кодирование:\n" + error[-4000:]) from exception
    except BaseException:
        process.kill()
        process.wait()
        path.unlink(missing_ok=True)
        raise
    if return_code:
        path.unlink(missing_ok=True)
        raise RuntimeError("NVENC не смог закодировать чанк:\n" + error[-4000:])


def _stream_encoder_command(
    width: int, height: int, fps: Fraction, path: Path, video_encoder: str, output_resolution: str
):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("Для потокового Flash Decode требуется ffmpeg в PATH")
    command = [
        ffmpeg,
        "-hide_banner", "-loglevel", "warning", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-video_size", f"{width}x{height}", "-framerate", f"{fps.numerator}/{fps.denominator}",
        "-i", "-", "-an",
    ]
    target_width, target_height = _target_dimensions(width, height, output_resolution)
    if (target_width, target_height) != (width, height):
        command += ["-vf", f"scale={target_width}:{target_height}:flags=lanczos"]
    if video_encoder.startswith("x264_"):
        command += ["-c:v", "libx264", "-preset", video_encoder.removeprefix("x264_"), "-crf", "18"]
    else:
        codec = "h264_nvenc" if target_width <= 4096 and target_height <= 4096 else "hevc_nvenc"
        command += [
            "-c:v", codec, "-preset", "p5", "-tune", "hq",
            "-rc", "vbr", "-cq", "18", "-b:v", "0",
            "-spatial-aq", "1", "-temporal-aq", "1",
        ]
    return command + ["-pix_fmt", "yuv420p", "-movflags", "+faststart", str(path)]


class _StreamingVideoEncoder:
    def __init__(
        self, width: int, height: int, fps: Fraction, path: Path, video_encoder: str, output_resolution: str
    ):
        self.path = path
        self.path.unlink(missing_ok=True)
        self.process = subprocess.Popen(
            _stream_encoder_command(width, height, fps, path, video_encoder, output_resolution),
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        self.queue = queue.Queue(maxsize=2)
        self.error = None
        self.frames = 0
        self.worker = threading.Thread(target=self._write_loop, name="relayvsr-frame-encoder", daemon=True)
        self.worker.start()

    def _write_loop(self):
        try:
            while True:
                data = self.queue.get()
                if data is None:
                    break
                _write_pipe_chunks(self.process.stdin, data)
        except BaseException as error:
            self.error = error
        finally:
            try:
                self.process.stdin.close()
            except Exception:
                pass

    def write(self, frame):
        if self.error is not None:
            raise RuntimeError("Потоковый encoder остановился") from self.error
        image = (frame[0].movedim(0, -1)[..., :3] * 255).clamp(0, 255).byte().cpu().contiguous().numpy()
        data = image.tobytes()
        while True:
            if self.error is not None:
                raise RuntimeError("Потоковый encoder остановился") from self.error
            try:
                self.queue.put(data, timeout=0.1)
                self.frames += 1
                return
            except queue.Full:
                continue

    def close(self):
        while self.worker.is_alive():
            try:
                self.queue.put(None, timeout=0.1)
                break
            except queue.Full:
                if self.error is not None:
                    break
        self.worker.join()
        error_text = self.process.stderr.read().decode("utf-8", errors="replace")
        return_code = self.process.wait()
        if self.error is not None or return_code:
            self.path.unlink(missing_ok=True)
            raise RuntimeError("Потоковый encoder завершился с ошибкой:\n" + error_text[-4000:]) from self.error

    def abort(self):
        if self.process.poll() is None:
            self.process.kill()
        while self.worker.is_alive():
            try:
                self.queue.put(None, timeout=0.1)
                break
            except queue.Full:
                continue
        self.worker.join()
        self.process.wait()
        self.path.unlink(missing_ok=True)


class _FrameSink:
    def __init__(self, frame: int, first: int, last: int, encoder: _StreamingVideoEncoder):
        self.frame = frame
        self.first = first
        self.last = last
        self.encoder = encoder

    def copy_(self, source):
        if self.first <= self.frame < self.last:
            self.encoder.write(source)
        return self


class _StreamingOutputBuffer:
    def __init__(self, shape, dtype, first: int, count: int, encoder: _StreamingVideoEncoder):
        self.shape = torch.Size(shape)
        self.dtype = dtype
        self.device = torch.device("cpu")
        self.first = first
        self.last = first + count
        self.encoder = encoder

    def element_size(self):
        return torch.empty((), dtype=self.dtype).element_size()

    def __getitem__(self, key):
        return _FrameSink(key[2], self.first, self.last, self.encoder)


def _stream_vsr_decode_to_part(
    vae, samples, images, trim_start, keep_frames, fps, path, video_encoder, output_resolution, detail
):
    vae.throw_exception_if_invalid()
    samples_in = samples["samples"]
    with comfy.model_management.cuda_device_context(vae.device):
        memory_used = vae.memory_used_decode(samples_in.shape, vae.vae_dtype)
        with comfy.model_prefetch.pause_malloc_graph():
            comfy.model_management.load_models_gpu(
                [vae.patcher], memory_required=memory_used, force_full_load=vae.disable_offload
            )
        latent = samples_in.to(device=vae.device, dtype=vae.vae_dtype)
        output_shape = vae.first_stage_model.decode_output_shape(latent.shape, lq_images=images, detail=detail)
        _, _, _, height, width = output_shape
        encoder = _StreamingVideoEncoder(width, height, fps, path, video_encoder, output_resolution)
        output = _StreamingOutputBuffer(output_shape, vae.vae_output_dtype(), trim_start, keep_frames, encoder)
        try:
            vae.first_stage_model.decode(latent, lq_images=images, output_buffer=output, detail=detail)
            encoder.close()
        except BaseException:
            encoder.abort()
            raise
        if encoder.frames != keep_frames:
            path.unlink(missing_ok=True)
            raise RuntimeError(f"Ожидалось {keep_frames} потоковых кадров, закодировано {encoder.frames}")


def _ffconcat_path(path: Path) -> str:
    return str(path.resolve()).replace("\\", "/").replace("'", "'\\''")


class RelayVSRAutoChunked:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": ("VIDEO", {"tooltip": "Source video that will be split into chunks automatically.\nИсходное видео, которое будет автоматически разбито на чанки."}),
                "model": ("MODEL", {"tooltip": "RelayVSR model. The selected model determines the x2 or x4 upscale factor.\nМодель RelayVSR. Коэффициент апскейла x2 или x4 определяется выбранной моделью."}),
                "vae": ("VAE", {"tooltip": "Matching RelayVSR Flash VAE/decoder. It must use the same x2 or x4 factor as the model.\nСоответствующий RelayVSR Flash VAE/decoder. Он должен иметь тот же коэффициент x2 или x4, что и модель."}),
                "chunk_frames": ("INT", {"default": 180, "min": 15, "max": 4095, "step": 15, "tooltip": "Useful frames per chunk. Lower values reduce peak RAM/VRAM usage. Must be a multiple of 15.\nЧисло полезных кадров в одном чанке. Меньшее значение снижает пиковое потребление RAM/VRAM. Должно быть кратно 15."}),
                "overlap_frames": ("INT", {"default": 0, "min": 0, "max": 240, "step": 15, "tooltip": "Extra context at chunk boundaries. It may reduce visible seams but increases processing time. Must be a multiple of 15.\nДополнительный контекст по краям чанков. Может уменьшить заметность стыков, но увеличивает время обработки. Должно быть кратно 15."}),
                "continue_if_stopped": ("BOOLEAN", {"default": False, "label_on": "ON", "label_off": "OFF", "tooltip": "ON keeps completed chunks after Stop/error and allows resuming after a ComfyUI restart. The cache is deleted after successful completion.\nON сохраняет готовые чанки после Stop/ошибки и позволяет продолжить после перезапуска ComfyUI. После успешного завершения кэш удаляется."}),
                "seed": ("INT", {"default": 777, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True, "tooltip": "KSampler noise seed. Keep the control mode fixed for reliable resume.\nSeed шума KSampler. Для корректного продолжения обработки оставляйте режим fixed."}),
                "filename_prefix": ("STRING", {"default": "video/RelayVSR_auto", "tooltip": "Final file name and subfolder relative to ComfyUI/output.\nИмя и подпапка итогового файла относительно ComfyUI/output."}),
                "video_encoder": (["x264_medium", "x264_veryfast", "nvenc"], {"default": "x264_medium", "tooltip": "x264_medium offers better compression; x264_veryfast is faster but usually creates a larger file; nvenc uses fast NVIDIA hardware encoding.\nx264_medium даёт лучшее сжатие; x264_veryfast работает быстрее, но обычно создаёт больший файл; nvenc использует быстрое аппаратное кодирование NVIDIA."}),
                "stream_flash_decode": ("BOOLEAN", {"default": False, "label_on": "ON", "label_off": "OFF", "tooltip": "ON sends Flash Decode frames directly to the encoder and reduces RAM usage by not storing the whole decoded chunk.\nON передаёт кадры Flash Decode прямо в encoder и уменьшает расход RAM, не сохраняя весь декодированный чанк."}),
                "input_resolution": (["Default", "720p", "1080p", "2k", "4k"], {"default": "Default", "tooltip": "Minimum resolution before RelayVSR. Upscaling runs on the CPU; video larger than the preset is not reduced. Higher values increase model time and VRAM usage.\nМинимальное разрешение до RelayVSR. Увеличение выполняется на CPU; видео крупнее пресета не уменьшается. Высокое значение увеличивает время и VRAM самой модели."}),
                "output_resolution": (["Default", "720p", "1080p", "2k", "4k"], {"default": "Default", "tooltip": "Final resolution after RelayVSR. FFmpeg scales on the CPU while preserving aspect ratio.\nКонечное разрешение после RelayVSR. Масштабирование выполняется FFmpeg на CPU с сохранением пропорций."}),
                "steps": ("INT", {"default": 1, "min": 1, "max": 10000, "tooltip": "Number of KSampler denoising steps. RelayVSR developer recommendation: 1.\nЧисло шагов denoise в KSampler. Рекомендация разработчика RelayVSR: 1."}),
                "cfg": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 100.0, "step": 0.1, "round": 0.01, "tooltip": "Classifier-Free Guidance strength. RelayVSR developer recommendation: 1.0.\nСила Classifier-Free Guidance. Рекомендация разработчика RelayVSR: 1.0."}),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS, {"default": "euler", "tooltip": "KSampler sampling algorithm. The original RelayVSR workflow uses euler.\nАлгоритм сэмплирования KSampler. В оригинальном workflow RelayVSR используется euler."}),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS, {"default": "simple", "tooltip": "Noise removal schedule. The original RelayVSR workflow uses simple.\nРасписание удаления шума. В оригинальном workflow RelayVSR используется simple."}),
                "detail": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "round": 0.01, "tooltip": "Share of Flash decoder detail over bicubic upscale: 0 keeps only the base upscale, 1 keeps the full model output. The original workflow uses 1.0.\nДоля деталей Flash decoder поверх bicubic-апскейла: 0 — только базовый апскейл, 1 — полный результат модели. В оригинальном workflow используется 1.0."}),
            }
        }

    RETURN_TYPES = ("VIDEO",)
    RETURN_NAMES = ("video",)
    FUNCTION = "run"
    CATEGORY = "video/upscaling"
    OUTPUT_NODE = True
    DESCRIPTION = "RelayVSR x2: автоматически обрабатывает видео частями и склеивает результат с исходным звуком."

    def run(
        self, video, model, vae, chunk_frames, overlap_frames, continue_if_stopped, seed, filename_prefix,
        video_encoder, stream_flash_decode, input_resolution, output_resolution, steps, cfg,
        sampler_name, scheduler, detail
    ):
        _check_multiple("chunk_frames", chunk_frames)
        _check_multiple("overlap_frames", overlap_frames, allow_zero=True)

        fps = Fraction(video.get_frame_rate())
        total_frames = int(video.get_frame_count())
        if total_frames < 1:
            raise ValueError("В видео нет кадров")
        source_width, source_height = video.get_dimensions()
        model_input_dimensions = _input_target_dimensions(source_width, source_height, input_resolution)
        upscale_factor = int(vae.first_stage_model.upscale_factor)
        expected_dimensions = _target_dimensions(
            model_input_dimensions[0] * upscale_factor,
            model_input_dimensions[1] * upscale_factor,
            output_resolution,
        )
        plan = list(_plan(total_frames, chunk_frames, overlap_frames))
        if sum(item[3] for item in plan) != total_frames:
            raise RuntimeError("Внутренняя ошибка плана разбиения")

        resume_config = _resume_config(
            video, model, vae, total_frames, fps, chunk_frames, overlap_frames,
            video_encoder, stream_flash_decode, input_resolution, output_resolution, seed,
            steps, cfg, sampler_name, scheduler, detail
        )
        resume_id = hashlib.sha256(json.dumps(resume_config, sort_keys=True).encode("utf-8")).hexdigest()[:16]
        resume_root = Path(folder_paths.get_output_directory()) / "relayvsr_resume"
        legacy_temp_root = Path(folder_paths.get_temp_directory())
        for legacy in legacy_temp_root.glob("relayvsr_resume_*"):
            if legacy.is_dir():
                shutil.rmtree(legacy, ignore_errors=True)

        if continue_if_stopped:
            temp_root = resume_root / resume_id
            resume_root.mkdir(parents=True, exist_ok=True)
            _clear_directory(resume_root, keep=temp_root)
        else:
            shutil.rmtree(resume_root, ignore_errors=True)
            temp_root = legacy_temp_root / f"relayvsr_auto_{uuid.uuid4().hex[:10]}"
        temp_root.mkdir(parents=True, exist_ok=True)
        manifest_path = temp_root / "manifest.json"
        manifest = {"config": resume_config, "completed_parts": []}
        if continue_if_stopped and manifest_path.is_file():
            try:
                existing = json.loads(manifest_path.read_text(encoding="utf-8"))
                if existing.get("config") == resume_config:
                    manifest = existing
            except Exception:
                pass
        _write_manifest(manifest_path, manifest)
        part_paths = [temp_root / f"part_{index:05d}.mp4" for index in range(len(plan))]
        progress = comfy.utils.ProgressBar(len(plan))
        final_path = None
        success = False
        encoder_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="relayvsr-encoder")
        pending_encode = None

        def finish_pending_encode():
            nonlocal pending_encode
            if pending_encode is None:
                return
            index, future = pending_encode
            future.result()
            completed = set(manifest.get("completed_parts", []))
            completed.add(index)
            manifest["completed_parts"] = sorted(completed)
            _write_manifest(manifest_path, manifest)
            progress.update(1)
            pending_encode = None

        try:
            for index, (start, end, trim_start, keep_frames) in enumerate(plan):
                comfy.model_management.throw_exception_if_processing_interrupted()
                part_path = part_paths[index]
                if continue_if_stopped and _valid_part(part_path, keep_frames, fps, expected_dimensions):
                    print(f"[RelayVSR Auto Chunked] Продолжение: часть {index + 1}/{len(plan)} уже готова")
                    progress.update(1)
                    continue

                sliced = video.as_trimmed(float(Fraction(start, 1) / fps), float(Fraction(end - start, 1) / fps), strict_duration=False)
                if sliced is None:
                    raise RuntimeError(f"Не удалось прочитать часть {index + 1}: кадры {start}..{end - 1}")
                components = sliced.get_components()
                images = components.images
                components = None
                if (images.shape[2], images.shape[1]) != model_input_dimensions:
                    source_images = images
                    images = _resize_images_cpu(source_images, model_input_dimensions)
                    del source_images

                positive, latent = RelayVSRConditioning.execute(model, images).args
                samples = nodes.common_ksampler(
                    model,
                    seed,
                    steps,
                    cfg,
                    sampler_name,
                    scheduler,
                    positive,
                    positive,
                    latent,
                    denoise=1.0,
                )[0]

                if stream_flash_decode:
                    finish_pending_encode()
                    _stream_vsr_decode_to_part(
                        vae, samples, images, trim_start, keep_frames, fps, part_path,
                        video_encoder, output_resolution, detail
                    )
                    completed = set(manifest.get("completed_parts", []))
                    completed.add(index)
                    manifest["completed_parts"] = sorted(completed)
                    _write_manifest(manifest_path, manifest)
                    progress.update(1)
                    del samples, latent, positive, images, components, sliced
                    gc.collect()
                    comfy.model_management.soft_empty_cache()
                    continue

                decoded = VSRDecode.execute(vae, samples, images, detail=detail).args[0]
                kept = decoded[trim_start:trim_start + keep_frames]
                if kept.shape[0] != keep_frames:
                    raise RuntimeError(
                        f"Часть {index + 1}: ожидалось {keep_frames} кадров, получено {kept.shape[0]}"
                    )

                # Пока кодируется предыдущая часть, GPU уже рассчитывает текущую.
                finish_pending_encode()
                pending_encode = (
                    index,
                    encoder_pool.submit(
                        _encode_part, kept, fps, part_path, video_encoder, output_resolution
                    ),
                )

                del kept, decoded, samples, latent, positive, images, components, sliced
                gc.collect()
                comfy.model_management.soft_empty_cache()

            finish_pending_encode()
            encoder_pool.shutdown(wait=True)
            for index, ((_, _, _, keep_frames), part_path) in enumerate(zip(plan, part_paths)):
                if not _valid_part(part_path, keep_frames, fps, expected_dimensions):
                    raise RuntimeError(f"Часть {index + 1} не была корректно закодирована")

            first_width, first_height = InputImpl.VideoFromFile(str(part_paths[0])).get_dimensions()
            full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
                filename_prefix,
                folder_paths.get_output_directory(),
                first_width,
                first_height,
            )
            output_file = f"{filename}_{counter:05}_.mp4"
            final_path = Path(full_output_folder) / output_file

            ffmpeg = shutil.which("ffmpeg")
            source = video.get_stream_source()
            if ffmpeg and isinstance(source, (str, os.PathLike)):
                concat_path = temp_root / "parts.ffconcat"
                concat_path.write_text(
                    "ffconcat version 1.0\n" + "".join(f"file '{_ffconcat_path(path)}'\n" for path in part_paths),
                    encoding="utf-8",
                )
                trim_start, trim_duration = video.get_active_trim_window()
                audio_input = []
                if trim_start > 0:
                    audio_input += ["-ss", f"{trim_start:.9f}"]
                if trim_duration > 0:
                    audio_input += ["-t", f"{trim_duration:.9f}"]
                command = [
                    ffmpeg,
                    "-hide_banner", "-loglevel", "warning", "-y",
                    "-f", "concat", "-safe", "0", "-i", str(concat_path),
                    *audio_input, "-i", str(source),
                    "-map", "0:v:0", "-map", "1:a:0?",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                    "-shortest", "-movflags", "+faststart", str(final_path),
                ]
                result = subprocess.run(command, capture_output=True, text=True)
                if result.returncode:
                    raise RuntimeError("ffmpeg не смог собрать итоговое видео:\n" + result.stderr[-4000:])
            else:
                joined = InputImpl.VideoFromList(
                    [InputImpl.VideoFromFile(str(path)) for path in part_paths],
                    None,
                    Types.VideoCodec("h264"),
                )
                joined.save_to(str(final_path), format=Types.VideoContainer("mp4"), codec=Types.VideoCodec("h264"))

            result_video = InputImpl.VideoFromFile(str(final_path))
            ui = {
                "images": [{"filename": output_file, "subfolder": subfolder, "type": "output"}],
                "animated": (True,),
                "orex_resolution": [f"{first_width}x{first_height}"],
            }
            success = True
            return {"ui": ui, "result": (result_video,)}
        except Exception:
            if continue_if_stopped:
                print(f"[RelayVSR Auto Chunked] Продолжение сохранено: {temp_root}")
            else:
                print("[RelayVSR Auto Chunked] Временные части будут удалены")
            raise
        finally:
            encoder_pool.shutdown(wait=True, cancel_futures=True)
            if success or not continue_if_stopped:
                shutil.rmtree(temp_root, ignore_errors=True)
            if resume_root.is_dir():
                try:
                    resume_root.rmdir()
                except OSError:
                    pass


NODE_CLASS_MAPPINGS = {"RelayVSRAutoChunked": RelayVSRAutoChunked}
NODE_DISPLAY_NAME_MAPPINGS = {"RelayVSRAutoChunked": "RelayVSR Auto Chunked (OreX)"}
