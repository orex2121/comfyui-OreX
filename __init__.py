# .orex_node - имя файла py, import - имя класса из файла. 
# Если в файле много классов то перечислить через запятую.
from .orex_node import IoNet, IoNetVisionUrl

# Имя узла в comfyui : имя класса
NODE_CLASS_MAPPINGS = { 
    "orex IoNet Chat": IoNet,
    "orex IoNet Vision Url": IoNetVisionUrl,
}

# Имя узла в comfyui : отображаеммое название в заголовках и меню
NODE_DISPLAY_NAME_MAPPINGS = { 
    "orex IoNet Chat": "io.net Chat",
    "orex IoNet Vision Url": "io.net Vision Url",
    }

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']