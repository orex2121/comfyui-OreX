from .OreXImageLoad import OreXImageLoad
from .OreXImageSave import OreXImageSave
from .OreXImageLoadBatch import OreXImageLoadBatch
from .OreXImageLoadBatchSize import OreXImageLoadBatchSize
from .OreXKontextPresets import KontextPresetsOrex
from .OreX_LMStudio import OreXLMStudio
from .OreX_Ollama import OreXOllama
from .OreX_Crop import OreXCrop
from .OreX_Ratio import OreXRatio
from .OreX_stressed_vowels import OreXStressedVowels
from .OreX_StringFunction import OreX_StringFunction
from .OreX_AudioLoad import OreX_AudioLoad
from .OreX_AdvancedVideoLoad import OreX_AdvancedVideoLoad # <--- ИМПОРТ НОВОГО УЗЛА ВИДЕО
from .OreX_StringSelector import OreXStringSelector # <--- ИМПОРТ НОВОГО УЗЛА СЕЛЕКТОРА СТРОК

NODE_CLASS_MAPPINGS = {
    "orex Load Image": OreXImageLoad,
    "orex Save Image": OreXImageSave,
    "orex Load Image Batch": OreXImageLoadBatch,
    "orex Load Image Batch Size": OreXImageLoadBatchSize,
    "orex Kontext Presets": KontextPresetsOrex,
    "orex LMStudio": OreXLMStudio,
    "orex Ollama": OreXOllama,
    "orex Crop": OreXCrop,
    "orex Ratio": OreXRatio,
    "orex Stressed Vowels": OreXStressedVowels,
    "orex String Function": OreX_StringFunction,
    "orex Audio load": OreX_AudioLoad,
    "orex Advanced Video Load": OreX_AdvancedVideoLoad, # <--- РЕГИСТРАЦИЯ КЛАССА ВИДЕО
    "orex String Selector": OreXStringSelector # <--- РЕГИСТРАЦИЯ КЛАССА СЕЛЕКТОРА СТРОК
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex Load Image": "🖼️ Load Image (OreX)",
    "orex Save Image": "💾 Save Image (OreX)",
    "orex Load Image Batch": "📦 Load Image Batch (OreX)",
    "orex Load Image Batch Size": "📦 Load Image Batch Size (OreX)",
    "orex Kontext Presets": "📦 Kontext Presets (OreX)",
    "orex LMStudio": "🤖 LMStudio (OreX)",
    "orex Ollama": "🦙 Ollama (OreX)",
    "orex Crop": "🔳Crop (OreX)",
    "orex Ratio": "📐 Ratio (OreX)",
    "orex Stressed Vowels": "🥊 Stressed Vowels (OreX)",
    "orex String Function": "✍️ String Function (OreX)",
    "orex Audio load": "🔉 Audio Load (OreX)",
    "orex Advanced Video Load": "🎬 Advanced Video Load (OreX)", # <--- ОТОБРАЖАЕМОЕ ИМЯ
    "orex String Selector": "📝 String Selector (OreX)" # <--- ОТОБРАЖАЕМОЕ ИМЯ СЕЛЕКТОРА СТРОК
}

# Изменено: стандартное имя переменной версии для ComfyUI
__version__ = "1.1.4"
WEB_DIRECTORY = "./js"

# Изменено: добавлена переменная __version__ для корректного чтения менеджером
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY', '__version__']