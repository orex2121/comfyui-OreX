import os
import json
import folder_paths
import torch
import numpy as np
import random
import string
import traceback
from aiohttp import web

try:
    from server import PromptServer
except ImportError:
    PromptServer = None

# Путь к файлу с маркерами (рядом с этим скриптом)
MARKERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "OreX_AudioLoad_v2.json")

def load_markers_data():
    if os.path.exists(MARKERS_FILE):
        try:
            with open(MARKERS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_markers_data(data):
    try:
        with open(MARKERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"[OreX] Error saving markers: {e}")

# === ОСНОВНОЙ КЛАСС НОДЫ ===
class OreX_AudioLoad_v2:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("STRING", {"default": "", "multiline": False}),
                "start_time": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100000.0, "step": 0.01}),
                "end_time": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100000.0, "step": 0.01}),
                "normalize_audio": ("FLOAT", {"default": -18.0, "min": -100.0, "max": 0.0, "step": 0.1, "tooltip": "Target LUFS"}),
            }
        }

    RETURN_TYPES = ("AUDIO", "FLOAT", "STRING")
    RETURN_NAMES = ("audio", "duration_sec", "file_path")
    FUNCTION = "load_audio"
    CATEGORY = "OreX/Audio"

    @classmethod
    def resolve_audio_path(cls, audio_str):
        clean_str = audio_str.strip('"').strip("'")
        if os.path.isabs(clean_str) and os.path.exists(clean_str):
            return clean_str
        try:
            path = folder_paths.get_annotated_filepath(clean_str)
            if os.path.exists(path):
                return path
        except:
            pass
        return clean_str

    def load_audio(self, audio, start_time, end_time, normalize_audio):
        import torchaudio
        
        if not audio:
            raise ValueError("[OreX] Путь к аудиофайлу не указан.")
            
        audio_path = self.resolve_audio_path(audio)
        if not os.path.exists(audio_path):
             raise FileNotFoundError(f"[OreX] Файл не найден по пути: {audio_path}")
        
        waveform = None
        sample_rate = None
        errors = []

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

        if waveform is None:
            try:
                import soundfile as sf
                data, sample_rate = sf.read(audio_path, always_2d=True)
                waveform = torch.from_numpy(data.T).float()
            except Exception as e2:
                errors.append(f"Soundfile Error: {e2}")

        if waveform is None:
            try:
                waveform, sample_rate = torchaudio.load(audio_path)
            except Exception as e3:
                errors.append(f"Torchaudio Error: {e3}")

        if waveform is None:
            error_details = "\n".join(errors)
            raise RuntimeError(f"[OreX] Не удалось прочитать медиафайл '{audio}'.\nДетали:\n{error_details}")

        total_samples = waveform.shape[-1]
        start_sample = int(start_time * sample_rate)
        
        if end_time > 0.0:
            actual_end_sample = int(end_time * sample_rate)
            actual_end_sample = min(actual_end_sample, total_samples)
        else:
            actual_end_sample = total_samples

        if actual_end_sample <= start_sample:
            actual_end_sample = total_samples
            start_sample = 0

        trimmed_waveform = waveform[:, start_sample:actual_end_sample]

        # === НОРМАЛИЗАЦИЯ (LUFS) ===
        if normalize_audio < 0.0:
            try:
                import pyloudnorm
                wave_sq = trimmed_waveform.squeeze(0) if trimmed_waveform.dim() == 3 else trimmed_waveform
                audio_np = wave_sq.detach().transpose(0, 1).numpy().astype(np.float32)
                audio_np = np.ascontiguousarray(audio_np)
                
                meter = pyloudnorm.Meter(sample_rate)
                loudness = meter.integrated_loudness(audio_np)
                
                if abs(loudness) <= 100:
                    normalized_np = pyloudnorm.normalize.loudness(audio_np, loudness, normalize_audio)
                    wave_sq = torch.from_numpy(normalized_np).transpose(0, 1).float()
                    trimmed_waveform = wave_sq.unsqueeze(0) if trimmed_waveform.dim() == 3 else wave_sq
            except ImportError:
                print("[OreX] Warning: pyloudnorm package is not installed. Skipping normalization.")

        duration_raw = float(trimmed_waveform.shape[-1]) / float(sample_rate)
        duration_sec = round(duration_raw, 2)

        if trimmed_waveform.dim() == 2:
            trimmed_waveform = trimmed_waveform.unsqueeze(0)

        processed_audio = {
            "waveform": trimmed_waveform,
            "sample_rate": sample_rate
        }

        temp_dir = folder_paths.get_temp_directory()
        random_name = "".join(random.choices(string.ascii_letters + string.digits, k=10)) + ".wav"
        temp_path = os.path.join(temp_dir, random_name)
        
        save_waveform = trimmed_waveform.squeeze(0) if trimmed_waveform.dim() == 3 else trimmed_waveform
        import torchaudio
        torchaudio.save(temp_path, save_waveform, sample_rate)

        return {"ui": {"audio": [{"filename": random_name, "type": "temp"}]}, "result": (processed_audio, duration_sec, audio_path)}

    @classmethod
    def IS_CHANGED(cls, audio, start_time, end_time, normalize_audio):
        audio_path = cls.resolve_audio_path(audio)
        if os.path.exists(audio_path):
            m = os.stat(audio_path).st_mtime
            return f"{m}-{start_time}-{end_time}-{normalize_audio}"
        return "0"
    
    @classmethod
    def VALIDATE_INPUTS(cls, audio, **kwargs):
        audio_path = cls.resolve_audio_path(audio)
        if not os.path.exists(audio_path):
            return "Invalid audio file path: {}".format(audio_path)
        return True


# === СЕРВЕРНЫЕ ЭНДПОИНТЫ ===
if PromptServer is not None:
    @PromptServer.instance.routes.get("/orex/audio_markers")
    async def get_audio_markers(request):
        return web.json_response(load_markers_data())

    @PromptServer.instance.routes.post("/orex/audio_markers/save")
    async def save_audio_markers(request):
        try:
            data = await request.json()
            name = data.get("name")
            markers = data.get("markers", [])
            bounds = data.get("bounds", {"start": 0, "end": 0})
            
            if not name:
                return web.json_response({"error": "No name provided"}, status=400)
                
            db = load_markers_data()
            db[name] = {"markers": markers, "bounds": bounds}
            save_markers_data(db)
            return web.json_response({"status": "success", "name": name})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    @PromptServer.instance.routes.post("/orex/audio_markers/delete")
    async def delete_audio_markers(request):
        try:
            data = await request.json()
            name = data.get("name")
            if not name:
                return web.json_response({"error": "No name provided"}, status=400)
                
            db = load_markers_data()
            if name in db:
                del db[name]
                save_markers_data(db)
            return web.json_response({"status": "success"})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    @PromptServer.instance.routes.post("/orex/trim_download_mp3")
    async def trim_download_mp3(request):
        try:
            data = await request.json()
            filename = data.get("filename")
            start_time = float(data.get("start_time", 0.0))
            end_time = float(data.get("end_time", 0.0))
            normalize_audio = float(data.get("normalize_audio", -18.0))

            if not filename:
                return web.json_response({"error": "No filename"}, status=400)

            audio_path = OreX_AudioLoad_v2.resolve_audio_path(filename)
            if not os.path.exists(audio_path):
                return web.json_response({"error": "File not found"}, status=404)

            from pydub import AudioSegment
            audio_segment = AudioSegment.from_file(audio_path)

            start_ms = int(start_time * 1000)
            end_ms = int(end_time * 1000) if end_time > 0 else len(audio_segment)

            if end_ms <= start_ms:
                end_ms = len(audio_segment)
                start_ms = 0

            trimmed = audio_segment[start_ms:end_ms]

            if normalize_audio < 0.0:
                gain = normalize_audio - trimmed.dBFS
                trimmed = trimmed.apply_gain(gain)

            temp_dir = folder_paths.get_temp_directory()
            random_name = "orex_trimmed_" + "".join(random.choices(string.ascii_letters + string.digits, k=6)) + ".mp3"
            temp_path = os.path.join(temp_dir, random_name)

            trimmed.export(temp_path, format="mp3")

            return web.json_response({"url": f"/view?filename={random_name}&type=temp"})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)