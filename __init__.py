from .orex_node import IoNet, IoNetVisionUrl
from .io_net_vision import IoNetVision
from .OreXImageLoad import OreXImageLoad
from .OreXImageSave import OreXImageSave
from .OreXImageLoadBatch import OreXImageLoadBatch

NODE_CLASS_MAPPINGS = { 
    "orex IoNet Chat": IoNet,
    "orex IoNet Vision Url": IoNetVisionUrl,
    "orex IoNet Vision": IoNetVision,
    "orex Load Image": OreXImageLoad,
    "orex Save Image": OreXImageSave,
    "orex Load Image Batch": OreXImageLoadBatch
}

NODE_DISPLAY_NAME_MAPPINGS = { 
    "orex IoNet Chat": "io.net Chat",
    "orex IoNet Vision Url": "io.net Vision Url",
    "orex IoNet Vision": "io.net Vision",
    "orex Load Image": "🖼️ Load Image (OreX)",
    "orex Save Image": "💾 Save Image (OreX)",
    "orex Load Image Batch": "📦 Load Image Batch (OreX)"  # Только коробка (пакетная обработка)
}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']