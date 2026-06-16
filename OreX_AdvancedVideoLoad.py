import os
import subprocess
import folder_paths
import soundfile as sf
import uuid

try:
    from comfy_api.latest import InputImpl
except ImportError:
    InputImpl = None

try:
    import imageio_ffmpeg
    FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FFMPEG_PATH = "ffmpeg"

class OreX_AdvancedVideoLoad:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # Используем STRING для прямых путей или чанковой загрузки (как в AudioLoad)
                "video_path": ("STRING", {"default": "", "multiline": False, "placeholder": r"Q:\Path\To\LargeVideo.mp4"}),
                "audio_mode": (["Replace (Fast)", "Mute Original (Fast)", "Mix Audio (Re-encode audio)"],),
                "orig_vol": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.1, "display": "slider"}),
                "new_vol": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.1, "display": "slider"}),
            },
            "optional": {
                "new_audio": ("AUDIO", ),
            }
        }

    RETURN_TYPES = ("VIDEO",)
    RETURN_NAMES = ("video",)
    FUNCTION = "process_video"
    CATEGORY = "OreX/Video"

    def process_video(self, video_path, audio_mode, orig_vol, new_vol, new_audio=None):
        clean_path = video_path.strip('\" \t\n\r')
        
        # Разрешение пути (ищем по абсолютному или в папке input)
        target_path = clean_path
        if not os.path.isabs(clean_path):
            input_path = folder_paths.get_annotated_filepath(clean_path)
            if os.path.exists(input_path):
                target_path = input_path

        if not os.path.isfile(target_path):
            raise FileNotFoundError(f"[OreX] Видео не найдено: {target_path}")

        temp_dir = folder_paths.get_temp_directory()
        uid = str(uuid.uuid4())[:8]
        ext = os.path.splitext(target_path)[1] or ".mp4"
        out_filename = f"orex_muxed_{uid}{ext}"
        out_video_path = os.path.join(temp_dir, out_filename)
        temp_audio_path = os.path.join(temp_dir, f"orex_tmp_audio_{uid}.wav")

        cmd = [FFMPEG_PATH, "-y", "-i", target_path]

        # Подготовка нового аудио, если оно пришло из другого узла
        has_new_audio = False
        if new_audio is not None:
            wf = new_audio["waveform"]
            if wf.dim() == 3:
                wf = wf.squeeze(0)
            audio_data = wf.cpu().numpy().T
            sf.write(temp_audio_path, audio_data, new_audio["sample_rate"])
            cmd.extend(["-i", temp_audio_path])
            has_new_audio = True

        # === ЛОГИКА FFMPEG ===
        if audio_mode == "Mute Original (Fast)":
            print("[OreX] Режим: Mute. Моментальное копирование без звука.")
            cmd.extend(["-c:v", "copy", "-an"])

        elif audio_mode == "Replace (Fast)":
            if has_new_audio:
                print("[OreX] Режим: Replace. Моментальная склейка (Stream Copy).")
                # Берем видео из 0-го инпута, аудио из 1-го
                cmd.extend(["-c:v", "copy", "-c:a", "aac", "-map", "0:v:0", "-map", "1:a:0"])
            else:
                print("[OreX] Новое аудио не подано. Просто копируем оригинал.")
                cmd.extend(["-c:v", "copy", "-c:a", "copy"])

        elif audio_mode == "Mix Audio (Re-encode audio)":
            if has_new_audio:
                print("[OreX] Режим: Mix. Копируем видео, микшируем аудиодорожки.")
                # Фильтр комплексного микширования (видео не трогаем, аудио пересчитываем)
                filter_str = f"[0:a]volume={orig_vol}[a0];[1:a]volume={new_vol}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]"
                cmd.extend([
                    "-filter_complex", filter_str,
                    "-map", "0:v:0", "-map", "[a]",
                    "-c:v", "copy", "-c:a", "aac"
                ])
            else:
                # Если нового аудио нет, просто меняем громкость оригинала
                cmd.extend(["-c:v", "copy", "-c:a", "aac", "-filter:a", f"volume={orig_vol}"])

        cmd.append(out_video_path)

        # Выполнение команды
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except subprocess.CalledProcessError as e:
            err_msg = e.stderr.decode('utf-8', errors='ignore') if e.stderr else "Unknown FFmpeg Error"
            raise RuntimeError(f"[OreX] Ошибка FFmpeg: {err_msg}")
        finally:
            if os.path.exists(temp_audio_path):
                try: os.remove(temp_audio_path)
                except: pass

        # Оборачиваем для ComfyUI
        final_video_obj = InputImpl.VideoFromFile(out_video_path) if InputImpl else out_video_path

        # UI-ответ для JS-фронтенда (чтобы плеер обновился после генерации)
        ui_result = {
            "ui": {
                "video": [{"filename": out_filename, "subfolder": "", "type": "temp"}]
            },
            "result": (final_video_obj,)
        }
        return ui_result