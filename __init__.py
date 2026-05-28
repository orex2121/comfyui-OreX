from .OreXImageLoad import OreXImageLoad
from .OreXImageSave import OreXImageSave
from .OreXImageLoadBatch import OreXImageLoadBatch
from .OreXImageLoadBatchSize import OreXImageLoadBatchSize
from .OreXKontextPresets import KontextPresetsOrex
from .OreX_LMStudio import OreXLMStudio
from .OreX_Ollama import OreXOllama
from .OreX_Crop import OreXCrop
from .OreX_Ratio import OreXRatio # Добавлен импорт нового узла

NODE_CLASS_MAPPINGS = {
    "orex Load Image": OreXImageLoad,
    "orex Save Image": OreXImageSave,
    "orex Load Image Batch": OreXImageLoadBatch,
    "orex Load Image Batch Size": OreXImageLoadBatchSize,
    "orex Kontext Presets": KontextPresetsOrex,
    "orex LMStudio": OreXLMStudio,
    "orex Ollama": OreXOllama,
    "orex Crop": OreXCrop,
    "orex Ratio": OreXRatio # Добавлен узел в маппинг
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
    "orex Ratio": "📐 Ratio (OreX)" # Добавлено отображаемое имя
}

WEB_DIRECTORY = "./js"

# Изменено: добавлению WEB_DIRECTORY в список экспорта фронтенда
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']