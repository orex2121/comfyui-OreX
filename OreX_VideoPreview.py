import os
import torch
import torch.nn.functional as F
import folder_paths
from fractions import Fraction
from typing import Optional
from comfy_api.latest import io, ui, Input, InputImpl, Types
from comfy.cli_args import args

class OreX_VideoPreview(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="OreX Video Preview",
            display_name="📺 Video Preview (OreX)",
            category="OreX",
            is_output_node=True,
            inputs=[
                io.Image.Input("images", optional=True),
                io.Video.Input("video", optional=True),
                io.Audio.Input("audio", optional=True),
                io.Boolean.Input("save_output", default=False, extra_dict={"label_on": "ON", "label_off": "OFF"}),
                io.Boolean.Input("embed_workflow", default=True, extra_dict={"label_on": "ON", "label_off": "OFF"}),
                io.String.Input("filename_prefix", default="video/ComfyUI"),
                io.Float.Input("fps_for_images", default=30.0, min=1.0, max=120.0, step=1.0),
                io.Combo.Input("format", options=["auto", "mp4", "mkv", "webm"], default="mp4"),
                io.Combo.Input("codec", options=["auto", "h264", "av1"], default="h264"),
                io.Combo.Input("bit_depth", options=["auto", 8, 10], default="auto", tooltip="Auto uses 8-bit for sRGB and 10-bit for HDR."),
                io.Combo.Input("color_space", options=["sRGB", "HDR", "HDR PQ"], default="sRGB"),
                io.Combo.Input("resolution", options=[
                    "original",
                    "360p (640x360) nHD",
                    "480p (854x480) SD",
                    "720p (1280x720) HD",
                    "1080p (1920x1080) Full HD",
                    "1152p (2048x1152) 2K",
                    "1440p (2560x1440) 2K",
                    "1620p (2880x1620) 3K",
                    "1800p (3200x1800) QHD+",
                    "2160p (3840x2160) 4K"
                ], default="original"),
                io.Float.Input("audio_mix", default=100.0, min=0.0, max=100.0, step=1.0),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            outputs=[
                io.Video.Output("video"),
            ],
        )

    @classmethod
    def execute(cls, save_output: bool, embed_workflow: bool, filename_prefix: str, fps_for_images: float, format: str, codec: str, bit_depth: int | str, color_space: str, resolution: str, audio_mix: float, images: Optional[Input.Image] = None, video: Optional[Input.Video] = None, audio: Optional[Input.Audio] = None) -> io.NodeOutput:
        
        # 1. Определение приоритета входа (images > video)
        if images is not None:
            frames = images
            fps = float(fps_for_images)
            orig_audio = None
            orig_h, orig_w = frames.shape[1], frames.shape[2]
        elif video is not None:
            comp = video.get_components()
            frames = comp.images
            orig_audio = comp.audio
            fps = float(comp.frame_rate)
            orig_w, orig_h = video.get_dimensions()
        else:
            raise ValueError("Either 'images' or 'video' must be provided to OreX_VideoPreview.")

        # 2. Программное изменение разрешения с сохранением пропорций
        if resolution != "original":
            res_map = {
                "360p (640x360) nHD": (640, 360),
                "480p (854x480) SD": (854, 480),
                "720p (1280x720) HD": (1280, 720),
                "1080p (1920x1080) Full HD": (1920, 1080),
                "1152p (2048x1152) 2K": (2048, 1152),
                "1440p (2560x1440) 2K": (2560, 1440),
                "1620p (2880x1620) 3K": (2880, 1620),
                "1800p (3200x1800) QHD+": (3200, 1800),
                "2160p (3840x2160) 4K": (3840, 2160)
            }
            if resolution in res_map:
                target_w, target_h = res_map[resolution]
                scale = min(target_w / orig_w, target_h / orig_h)
                new_w = int(round(orig_w * scale))
                new_h = int(round(orig_h * scale))
                
                new_w = new_w if new_w % 2 == 0 else new_w + 1
                new_h = new_h if new_h % 2 == 0 else new_h + 1
                
                frames = frames.permute(0, 3, 1, 2)
                frames = F.interpolate(frames, size=(new_h, new_w), mode="bilinear", align_corners=False)
                frames = frames.permute(0, 2, 3, 1)

        # 3. Подрезка, добивка и микширование аудиодорожки
        final_audio = orig_audio
        if audio is not None:
            num_frames = frames.shape[0]
            duration = num_frames / fps
            
            ext_waveform = audio["waveform"]
            ext_sample_rate = audio["sample_rate"]
            target_samples = int(duration * ext_sample_rate)
            
            current_ext = ext_waveform.shape[-1]
            if current_ext > target_samples:
                ext_waveform = ext_waveform[..., :target_samples]
            elif current_ext < target_samples:
                ext_waveform = F.pad(ext_waveform, (0, target_samples - current_ext))
                
            if orig_audio is not None:
                orig_waveform = orig_audio["waveform"]
                orig_sample_rate = orig_audio["sample_rate"]
                
                orig_target_samples = int(duration * orig_sample_rate)
                current_orig = orig_waveform.shape[-1]
                
                if current_orig > orig_target_samples:
                    orig_waveform = orig_waveform[..., :orig_target_samples]
                elif current_orig < orig_target_samples:
                    orig_waveform = F.pad(orig_waveform, (0, orig_target_samples - current_orig))
                    
                if orig_sample_rate != ext_sample_rate:
                    orig_waveform = F.interpolate(orig_waveform, size=target_samples, mode='linear', align_corners=False)
                
                if ext_waveform.dim() == 3 and orig_waveform.dim() == 3:
                    if ext_waveform.shape[1] == 1 and orig_waveform.shape[1] > 1:
                        ext_waveform = ext_waveform.repeat(1, orig_waveform.shape[1], 1)
                    elif orig_waveform.shape[1] == 1 and ext_waveform.shape[1] > 1:
                        orig_waveform = orig_waveform.repeat(1, ext_waveform.shape[1], 1)

                ext_vol = audio_mix / 100.0
                orig_vol = 1.0 - ext_vol
                final_waveform = (ext_waveform * ext_vol) + (orig_waveform * orig_vol)
            else:
                ext_vol = audio_mix / 100.0
                final_waveform = ext_waveform * ext_vol
                
            final_audio = {"waveform": final_waveform, "sample_rate": ext_sample_rate}

        # 4. Вычисление параметров цвета и пересборка видеообъекта
        if str(bit_depth) == "auto":
            final_bit_depth = 10 if color_space in ("HDR", "HDR PQ") else 8
        else:
            final_bit_depth = int(bit_depth)

        video = InputImpl.VideoFromComponents(
            Types.VideoComponents(images=frames, audio=final_audio, frame_rate=Fraction(fps)),
            bit_depth=final_bit_depth,
            color_space=color_space,
        )

        format_name = "webm" if (format == "auto" and codec == "av1") else ("mp4" if format == "auto" else format)
        codec_name = "h264" if codec == "auto" else codec
        width, height = video.get_dimensions()
        
        if save_output:
            output_dir = folder_paths.get_output_directory()
            folder_type = io.FolderType.output
        else:
            output_dir = folder_paths.get_temp_directory()
            folder_type = io.FolderType.temp
            filename_prefix = "temp_" + filename_prefix

        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            filename_prefix, output_dir, width, height
        )

        saved_metadata = None
        if embed_workflow and not args.disable_metadata:
            metadata = {}
            if cls.hidden.extra_pnginfo is not None:
                metadata.update(cls.hidden.extra_pnginfo)
            if cls.hidden.prompt is not None:
                metadata["prompt"] = cls.hidden.prompt
            if len(metadata) > 0:
                saved_metadata = metadata

        extension = Types.VideoContainer.get_extension(format_name)
        file = f"{filename}_{counter:05}_.{extension}"
        full_path = os.path.join(full_output_folder, file)
        
        save_kwargs = {}
        if not save_output:
            save_kwargs["preset"] = "ultrafast" 

        video.save_to(
            full_path,
            format=Types.VideoContainer(format_name),
            codec=Types.VideoCodec(codec_name), 
            metadata=saved_metadata,
            **save_kwargs
        )

        return io.NodeOutput(
            video, 
            ui=ui.PreviewVideo([ui.SavedResult(file, subfolder, folder_type)])
        )