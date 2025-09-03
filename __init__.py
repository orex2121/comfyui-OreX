from .orex_node import IoNet, IoNetVisionUrl
from .io_net_vision import IoNetVision
from .OreXImageLoad import OreXImageLoad
from .OreXImageSave import OreXImageSave
from .OreXImageLoadBatch import OreXImageLoadBatch
from .OreXKontextPresets import KontextPresetsOrex
from .OrexPollinationsTextLLM import PollinationsTextGenOrex

NODE_CLASS_MAPPINGS = { 
    "orex IoNet Chat": IoNet,
    "orex IoNet Vision Url": IoNetVisionUrl,
    "orex IoNet Vision": IoNetVision,
    "orex Load Image": OreXImageLoad,
    "orex Save Image": OreXImageSave,
    "orex Load Image Batch": OreXImageLoadBatch,
    "orex Kontext Presets": KontextPresetsOrex,
    "orex Polination Text Gen": PollinationsTextGenOrex
}

NODE_DISPLAY_NAME_MAPPINGS = { 
    "orex Kontext Presets": "📦 Kontext Presets (OreX)",
    "orex IoNet Chat": "io.net Chat",
    "orex IoNet Vision Url": "io.net Vision Url",
    "orex IoNet Vision": "io.net Vision",
    "orex Load Image": "🖼️ Load Image (OreX)",
    "orex Save Image": "💾 Save Image (OreX)",
    "orex Load Image Batch": "📦 Load Image Batch (OreX)",
    "orex Polination Text Gen": "💬 Polination Text Gen (OreX)"
}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']