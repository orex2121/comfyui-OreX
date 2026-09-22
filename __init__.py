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
from .OreX_AudioLoad_v2 import OreX_AudioLoad_v2
from .OreX_AdvancedVideoLoad import OreX_AdvancedVideoLoad
from .OreX_StringSelector import OreXStringSelector
from .OreX_ImageChunkCut import OreXImageChunkCut
from .OreX_ImageChunkStich import OreXImageChunkStich 
from .OreX_Scail import OreX_Scail 
from .OreX_TextSave import OreX_TextSave
from .OreX_LoraLoader import OreX_LoraLoader
from .OreX_CipTextEncode import OreX_CipTextEncode
from .OreX_ImageMerging import OrexImageMerging
from .OreX_StyleSelector import OrexStyleSelector
from .OreX_ImageMergingV2 import OrexImageMergingV2 
from .OreX_ImageCompare import OreXImageCompare
from .OreX_CameraRaw import OreX_CameraRaw
from .OreX_VideoPreview import OreX_VideoPreview
from .OreX_Painter import OreXPainter
from .OreX_SkinRetouchingAI import OreX_SkinRetouchingAI

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
    "orex Audio load v2": OreX_AudioLoad_v2,
    "orex Advanced Video Load": OreX_AdvancedVideoLoad,
    "orex String Selector": OreXStringSelector,
    "orex Image Chunk Cut": OreXImageChunkCut,
    "orex Image Chunk Stich": OreXImageChunkStich, 
    "orex Scail2": OreX_Scail, 
    "orex Save Text": OreX_TextSave,
    "orex Lora Loader": OreX_LoraLoader,
    "orex Cip Text Encode": OreX_CipTextEncode,
    "orex Image Merging": OrexImageMerging,
    "OrexStyleSelector": OrexStyleSelector,
    "OrexImageMergingV2": OrexImageMergingV2,
    "OreX Image Compare": OreXImageCompare,
    "orex Camera Raw": OreX_CameraRaw,
    "OreX Video Preview": OreX_VideoPreview,
    "orex Painter": OreXPainter,
    "orex Skin Retouching AI": OreX_SkinRetouchingAI,
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
    "orex Audio load v2": "🔉 Audio Load V2 (OreX)",
    "orex Advanced Video Load": "🎬 Advanced Video Load (OreX)",
    "orex String Selector": "📝 String Selector (OreX)",
    "orex Image Chunk Cut": "🧩 Image Chunk Cut (OreX)",
    "orex Image Chunk Stich": "🧵 Image Chunk Stich (OreX)",
    "orex Scail2": "📼 Scail2 (OreX)", 
    "orex Save Text": "📝 Save Text (OreX)",
    "orex Lora Loader": "🧩 Lora Loader (OreX)",
    "orex Cip Text Encode": "CLIP Text Encode (OreX)",
    "orex Image Merging": "🧱 Image Merging (OreX)",
    "OrexStyleSelector": "🪄 Style Selector (OreX)",
    "OrexImageMergingV2": "OreX Image Merging V2",
    "OreX Image Compare": "↔️ OreX Image Compare",
    "orex Camera Raw": "📸 Camera Raw (OreX)",
    "OreX Video Preview": "📺 Video Preview (OreX)",
    "orex Painter": "🖼️ Painter (OreX)",
    "orex Skin Retouching AI": "✨ Skin Retouching AI (OreX)",
}

WEB_DIRECTORY = "./js"

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
