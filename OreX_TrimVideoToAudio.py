import math
import torch

try:
    from comfy_api.latest import InputImpl, Types
    VideoFromComponents = InputImpl.VideoFromComponents
    VideoComponents = Types.VideoComponents
except ImportError:  # older ComfyUI versions
    from comfy_api.input_impl import VideoFromComponents
    from comfy_api.util import VideoComponents


class OreX_TrimVideoToAudio:
    """
    Author: Pavel Korzhov (PaBoKor)

    Обрезает видеодорожку по длине аудио (или, в режиме pad_to_video,
    оставляет видео нетронутым и дополняет аудио тишиной до его длины —
    для склейки роликов встык, когда последний кадр видео несёт смысловую
    нагрузку как референс следующего куска и его нельзя терять при
    обрезке).

    Trims the video track to the audio length (or, in pad_to_video mode,
    leaves the video untouched and pads the audio with silence to its
    length — for back-to-back stitching, when the video's last frame
    matters as the next chunk's reference frame and must not be cut away).
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": ("VIDEO", {
                    "tooltip": "Видео для обрезки / Video to trim"}),
                "audio": ("AUDIO", {
                    "tooltip": "Аудио, по длине которого обрезаем видео / "
                               "Audio whose length defines the result"}),
                "audio_fit": (["pad_silence", "trim", "pad_to_video"], {
                    "default": "pad_silence",
                    "tooltip": "pad_silence: видео обрезается по аудио, аудио не режется, в конец добавляется "
                               "тишина до границы кадра. trim: видео обрезается по аудио, аудио тоже режется "
                               "по длине видео, тишина не добавляется. pad_to_video: видео НЕ обрезается (все "
                               "кадры сохраняются, в т.ч. референсный последний кадр для склейки), аудио "
                               "дополняется тишиной до полной длины видео / "
                               "pad_silence: video is trimmed to the audio, audio is kept and padded with "
                               "silence up to the frame boundary. trim: video is trimmed to the audio, audio is "
                               "also cut to the video length, no padding. pad_to_video: video is NOT trimmed "
                               "(all frames kept, including the last frame used as a reference for stitching), "
                               "audio is padded with silence up to the full video length"}),
            }
        }

    RETURN_TYPES = ("VIDEO", "FLOAT")
    RETURN_NAMES = ("video", "duration_sec")
    FUNCTION = "run"
    CATEGORY = "OreX/Video"

    def run(self, video, audio, audio_fit):
        comps = video.get_components()
        images = comps.images                      # [N, H, W, C]
        fps = float(comps.frame_rate)

        waveform = audio["waveform"]               # [B, C, S]
        sr = int(audio["sample_rate"])

        if audio_fit == "pad_to_video":
            # Видео остаётся как есть целиком; аудио просто дополняется
            # тишиной до полной длины видео (или обрезается, если вдруг
            # оказалось длиннее видео).
            n_frames = images.shape[0]
            video_dur = n_frames / fps
            target = int(round(video_dur * sr))
            cur = waveform.shape[-1]
            if cur > target:
                waveform = waveform[..., :target]
            elif cur < target:
                pad = torch.zeros(
                    (*waveform.shape[:-1], target - cur),
                    dtype=waveform.dtype, device=waveform.device,
                )
                waveform = torch.cat([waveform, pad], dim=-1)
            waveform = waveform.contiguous()

            out_audio = {"waveform": waveform, "sample_rate": sr}
            new_video = VideoFromComponents(
                VideoComponents(images=images, audio=out_audio, frame_rate=comps.frame_rate)
            )
            return (new_video, video_dur)

        audio_dur = waveform.shape[-1] / sr

        # Small tolerance so that 102.0000001 frames does not become 103
        n_frames = math.ceil(audio_dur * fps - 1e-3)
        n_frames = max(1, min(images.shape[0], n_frames))

        images = images[:n_frames]
        video_dur = n_frames / fps

        # Fit the audio to the video length
        target = int(round(video_dur * sr))
        cur = waveform.shape[-1]
        if cur > target:
            waveform = waveform[..., :target]
        elif cur < target and audio_fit == "pad_silence":
            pad = torch.zeros(
                (*waveform.shape[:-1], target - cur),
                dtype=waveform.dtype, device=waveform.device,
            )
            waveform = torch.cat([waveform, pad], dim=-1)
        waveform = waveform.contiguous()

        out_audio = {"waveform": waveform, "sample_rate": sr}
        new_video = VideoFromComponents(
            VideoComponents(images=images, audio=out_audio, frame_rate=comps.frame_rate)
        )
        return (new_video, video_dur)