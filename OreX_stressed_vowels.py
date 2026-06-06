from ruaccent import RUAccent
import numpy as np
import os
import folder_paths
import random
import torch

class OreXStressedVowels:
    """
    Узел для расстановки ударений в русском тексте.
    Ударение выделяется ЗАГЛАВНОЙ гласной буквой (например: автомобИль).
    """
    
    def __init__(self):
        # Инициализируем библиотеку при создании узла
        self.accentizer = RUAccent()
        self.current_model = None

    def _apply_hotfix(self):
        # --- HOTFIX ДЛЯ БАГА RUACCENT ---
        # При встрече редкого/неизвестного слова (которого нет в словаре),
        # библиотека вызывает резервную нейросеть `accent_model`. Её ONNX-сессия 
        # требует параметр 'token_type_ids', который её же токенизатор не создаёт.
        # Этот патч автоматически подставляет массив нулей и спасает от вылета.
        if hasattr(self.accentizer, 'accent_model') and self.accentizer.accent_model is not None:
            if hasattr(self.accentizer.accent_model, 'session'):
                original_run = self.accentizer.accent_model.session.run
                def patched_run(output_names, input_feed, run_options=None):
                    if isinstance(input_feed, dict) and 'input_ids' in input_feed and 'token_type_ids' not in input_feed:
                        input_feed = dict(input_feed) # Делаем копию, чтобы не менять оригинал
                        input_feed['token_type_ids'] = np.zeros_like(input_feed['input_ids'], dtype=np.int64)
                    
                    if run_options is not None:
                        return original_run(output_names, input_feed, run_options)
                    return original_run(output_names, input_feed)
                    
                self.accentizer.accent_model.session.run = patched_run

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": "гараж\nавтомобиль"}),
                "model": (["turbo3 (auto download)", "turbo2 (auto download)", "turbo (auto download)", "big_poets (auto download)"], {"default": "turbo3 (auto download)"}),
                "fixed_seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("stressed_text",)
    FUNCTION = "process_text"
    CATEGORY = "OreX"

    def process_text(self, text, model, fixed_seed):
        if not text or not text.strip():
            return ("",)

        # Шаг 0: Фиксируем сиды для детерминированной работы резервной нейросети
        random.seed(fixed_seed)
        np.random.seed(fixed_seed)
        torch.manual_seed(fixed_seed)

        # Шаг 1: Загружаем модель, если она изменилась или еще не загружалась
        model_name = model.split(" ")[0] # Отсекаем "(auto download)" и получаем чистое имя, например "turbo3"
        
        if self.current_model != model_name:
            # Настраиваем относительный путь для скачивания (ComfyUI/models/audio_encoders)
            audio_encoders_path = os.path.join(folder_paths.models_dir, "audio_encoders")
            os.makedirs(audio_encoders_path, exist_ok=True)
            
            # Временно перенаправляем директорию кэша HuggingFace, чтобы загрузка шла в нужную папку
            old_hf_home = os.environ.get("HF_HOME")
            os.environ["HF_HOME"] = audio_encoders_path
            
            try:
                self.accentizer.load(omograph_model_size=model_name, use_dictionary=True, tiny_mode=False)
                self._apply_hotfix() # Применяем патч после каждой загрузки новой модели
                self.current_model = model_name
            finally:
                # Возвращаем системную переменную в исходное состояние
                if old_hf_home is not None:
                    os.environ["HF_HOME"] = old_hf_home
                else:
                    del os.environ["HF_HOME"]

        # Шаг 2: Расставляем ударения с помощью ruaccent
        # Библиотека обычно ставит знак '+' ПЕРЕД ударной гласной (пр: гар+аж)
        accented_text = self.accentizer.process_all(text)

        # Шаг 3: Конвертируем маркеры ударений в заглавные буквы
        vowels = "аеёиоуыэюяАЕЁИОУЫЭЮЯ"
        result = []
        capitalize_next = False
        
        for char in accented_text:
            if char == '+':
                # Если встретили плюс, значит следующая буква — это ударная гласная
                capitalize_next = True
            elif char == '\u0301':
                # Резервный вариант: если вернется юникод-ударение (оно обычно ставится ПОСЛЕ буквы)
                if result and result[-1] in vowels:
                    result[-1] = result[-1].upper()
                else:
                    capitalize_next = True
            else:
                if capitalize_next:
                    result.append(char.upper())
                    capitalize_next = False
                else:
                    result.append(char)

        # Шаг 4: Собираем текст обратно
        final_text = "".join(result)
        
        return (final_text,)