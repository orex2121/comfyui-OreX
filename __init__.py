from .OreXImageLoad import OreXImageLoad
from .OreXImageSave import OreXImageSave
from .OreXImageLoadBatch import OreXImageLoadBatch
from .OreXImageLoadBatchSize import OreXImageLoadBatchSize
from .OreXKontextPresets import KontextPresetsOrex
from .OreX_LMStudio import OreXLMStudio
from .OreX_Ollama import OreXOllama
from .OreX_Crop import OreXCrop
from .OreX_Ratio import OreXRatio
from .OreX_StringFunction import OreX_StringFunction
from .OreX_AudioLoad import OreX_AudioLoad
from .OreX_AdvancedVideoLoad import OreX_AdvancedVideoLoad
from .OreX_StringSelector import OreXStringSelector
from .OreX_ImageChunkCut import OreXImageChunkCut
from .OreX_ImageChunkStich import OreXImageChunkStich 
from .OreX_Scail import OreX_Scail # <--- ИМПОРТ НОВОГО УЗЛА SCAIL2

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
    "orex String Function": OreX_StringFunction,
    "orex Audio load": OreX_AudioLoad,
    "orex Advanced Video Load": OreX_AdvancedVideoLoad,
    "orex String Selector": OreXStringSelector,
    "orex Image Chunk Cut": OreXImageChunkCut,
    "orex Image Chunk Stich": OreXImageChunkStich, 
    "orex Scail2": OreX_Scail # <--- РЕГИСТРАЦИЯ КЛАССА SCAIL2
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
    "orex String Function": "✍️ String Function (OreX)",
    "orex Audio load": "🔉 Audio Load (OreX)",
    "orex Advanced Video Load": "🎬 Advanced Video Load (OreX)",
    "orex String Selector": "📝 String Selector (OreX)",
    "orex Image Chunk Cut": "🧩 Image Chunk Cut (OreX)",
    "orex Image Chunk Stich": "🧵 Image Chunk Stich (OreX)",
    "orex Scail2": "📼 Scail2 (OreX)" # <--- ОТОБРАЖАЕМОЕ ИМЯ SCAIL2
}

WEB_DIRECTORY = "./js"

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']