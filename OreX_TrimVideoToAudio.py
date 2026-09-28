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

    Обрезает видеодорожку по длине аудио. Аудио остаётся целиком:
    длина видео = ceil(длительность_аудио * fps) кадров, а недостающий
    хвост аудио (меньше одного кадра) добивается тишиной.

    Trims the video track to the audio length. Audio is kept intact:
    video length = ceil(audio_duration * fps) frames, and the sub-frame
    remainder is padded with silence.
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
                "audio_fit": (["pad_silence", "trim"], {
                    "default": "pad_silence",
                    "tooltip": "pad_silence: аудио не режется, в конец добавляется тишина до границы кадра. "
                               "trim: аудио режется по длине видео, тишина не добавляется / "
                               "pad_silence: audio is kept, silence is added up to the frame boundary. "
                               "trim: audio is cut to the video length, no padding"}),
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