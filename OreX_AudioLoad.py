import os
import folder_paths
import torch
import numpy as np
from server import PromptServer
from aiohttp import web
import traceback

# === КАСТОМНЫЙ ЭНДПОИНТ ДЛЯ ЗАГРУЗКИ БОЛЬШИХ ФАЙЛОВ ПО ЧАСТЯМ ===
@PromptServer.instance.routes.post("/orex/upload_chunk")
async def upload_chunk(request):
    try:
        post = await request.post()
        file = post.get("file")
        filename = post.get("filename")
        chunk_index = int(post.get("chunk_index", 0))
        total_chunks = int(post.get("total_chunks", 1))

        if not filename or not file:
            return web.json_response({"error": "No file or filename provided"}, status=400)

        upload_dir = folder_paths.get_input_directory()
        safe_filename = os.path.basename(filename)
        file_path = os.path.join(upload_dir, safe_filename)

        # Если первый чанк - перезаписываем файл (очищаем старый мусор), иначе дописываем в конец
        mode = "ab" if chunk_index > 0 else "wb"
        with open(file_path, mode) as f:
            f.write(file.file.read())

        # Если это последний чанк, возвращаем полный путь, чтобы JS мог вставить его в текстовое поле
        if chunk_index == total_chunks - 1:
            full_path = os.path.abspath(file_path)
            return web.json_response({"status": "success", "name": safe_filename, "full_path": full_path})
        
        return web.json_response({"status": "chunk_success"})

    except Exception as e:
        print(f"[OreX_AudioLoad] Ошибка загрузки чанка: {e}")
        traceback.print_exc()
        return web.json_response({"error": str(e)}, status=500)


# === ОСНОВНОЙ КЛАСС НОДЫ ===
class OreX_AudioLoad:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # Превращаем поле в текстовое (STRING) для ручного ввода путей или вставки из Drag&Drop
                "audio": ("STRING", {"default": "", "multiline": False}),
                "trim_start_sec": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100000.0, "step": 0.01, "display": "slider"}),
                "trim_start": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100000.0, "step": 0.01}),
                "trim_end_sec": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100000.0, "step": 0.01, "display": "slider"}),
                "trim_end": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100000.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("AUDIO", "STRING", "FLOAT")
    RETURN_NAMES = ("audio_out", "file_path", "duration")
    FUNCTION = "load_audio"
    CATEGORY = "OreX/Audio"

    @classmethod
    def resolve_audio_path(cls, audio_str):
        """Вспомогательный метод для безопасного разрешения пути: абсолютного или из папки input"""
        clean_str = audio_str.strip('"').strip("'")  # Убираем кавычки, если пользователь скопировал путь с ними
        
        # Проверяем, является ли это валидным абсолютным путем
        if os.path.isabs(clean_str) and os.path.exists(clean_str):
            return clean_str
        
        # Если это просто имя файла или относительный путь, ищем в папке input
        try:
            path = folder_paths.get_annotated_filepath(clean_str)
            if os.path.exists(path):
                return path
        except:
            pass
            
        return clean_str  # Возвращаем как есть, логика ниже выдаст нормальную ошибку

    def load_audio(self, audio, trim_start_sec, trim_start, trim_end_sec, trim_end):
        if not audio:
            raise ValueError("[OreX] Путь к аудиофайлу не указан.")
            
        audio_path = self.resolve_audio_path(audio)
        
        if not os.path.exists(audio_path):
             raise FileNotFoundError(f"[OreX] Файл не найден по пути: {audio_path}")
        
        waveform = None
        sample_rate = None
        errors = []

        # === Попытка 1: Загрузка через pydub ===
        try:
            from pydub import AudioSegment
            audio_segment = AudioSegment.from_file(audio_path)
            sample_rate = audio_segment.frame_rate
            
            samples = np.array(audio_segment.get_array_of_samples(), dtype=np.float32)
            if audio_segment.sample_width == 2:
                samples /= 32768.0
            elif audio_segment.sample_width == 4:
                samples /= 2147483648.0
                
            channels = audio_segment.channels
            if channels > 1:
                samples = samples.reshape((-1, channels)).T
            else:
                samples = samples.reshape((1, -1))
                
            waveform = torch.from_numpy(samples).float()
        except Exception as e1:
            errors.append(f"Pydub Error: {e1}")

        # === Попытка 2: Загрузка через soundfile ===
        if waveform is None:
            try:
                import soundfile as sf
                data, sample_rate = sf.read(audio_path, always_2d=True)
                waveform = torch.from_numpy(data.T).float()
            except Exception as e2:
                errors.append(f"Soundfile Error: {e2}")

        # === Попытка 3: Torchaudio ===
        if waveform is None:
            try:
                import torchaudio
                waveform, sample_rate = torchaudio.load(audio_path)
            except Exception as e3:
                errors.append(f"Torchaudio Error: {e3}")

        if waveform is None:
            error_details = "\n".join(errors)
            raise RuntimeError(
                f"[OreX] Не удалось прочитать медиафайл '{audio}'.\n"
                f"РЕКОМЕНДАЦИЯ: Проверьте наличие установленного ffmpeg или перекодируйте файл.\n"
                f"Детали ошибок конвейера:\n{error_details}"
            )

        # === ЛОГИКА ПОДРЕЗКИ ===
        total_samples = waveform.shape[-1]

        final_start = trim_start if trim_start > 0.0 else trim_start_sec
        final_end_cut = trim_end if trim_end > 0.0 else trim_end_sec

        start_sample = int(final_start * sample_rate)
        end_cut_sample = int(final_end_cut * sample_rate)

        actual_end_sample = total_samples - end_cut_sample

        if actual_end_sample <= start_sample:
            actual_end_sample = total_samples
            start_sample = 0

        trimmed_waveform = waveform[:, start_sample:actual_end_sample]
        duration = float(trimmed_waveform.shape[-1]) / float(sample_rate)

        if trimmed_waveform.dim() == 2:
            trimmed_waveform = trimmed_waveform.unsqueeze(0)

        processed_audio = {
            "waveform": trimmed_waveform,
            "sample_rate": sample_rate
        }

        return (processed_audio, audio_path, duration)

    @classmethod
    def IS_CHANGED(cls, audio, trim_start_sec, trim_start, trim_end_sec, trim_end):
        audio_path = cls.resolve_audio_path(audio)
        if os.path.exists(audio_path):
            m = os.stat(audio_path).st_mtime
            return f"{m}-{trim_start_sec}-{trim_start}-{trim_end_sec}-{trim_end}"
        return "0"
    
    @classmethod
    def VALIDATE_INPUTS(cls, audio, **kwargs):
        audio_path = cls.resolve_audio_path(audio)
        if not os.path.exists(audio_path):
            return "Invalid audio file path: {}".format(audio_path)
        return True