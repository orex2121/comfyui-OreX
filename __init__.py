import importlib
import os
import pkgutil
import traceback

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

WEB_DIRECTORY = "./js"

# Auto-discover every .py file in this folder (except those starting with "_",
# including this __init__.py) and merge its NODE_CLASS_MAPPINGS /
# NODE_DISPLAY_NAME_MAPPINGS. Adding a new node only requires dropping a new
# .py file here that defines both dictionaries at the end — no need to touch
# this file. Helper modules without nodes should be named with a leading "_"
# (e.g. _utils.py) so they are skipped.
# A broken node file is reported in the console and does not stop the others.
_package_dir = os.path.dirname(__file__)

for _module_info in sorted(pkgutil.iter_modules([_package_dir]), key=lambda m: m[1].lower()):
    _module_name = _module_info[1]
    _is_pkg = _module_info[2]
    if _is_pkg or _module_name.startswith("_"):
        continue

    try:
        _module = importlib.import_module(f".{_module_name}", package=__name__)
    except Exception:
        print(f"[OreX] Failed to load module '{_module_name}':")
        traceback.print_exc()
        continue

    _classes = getattr(_module, "NODE_CLASS_MAPPINGS", None)
    if not _classes:
        continue

    for _key in _classes:
        if _key in NODE_CLASS_MAPPINGS:
            print(f"[OreX] Warning: node key '{_key}' from '{_module_name}' overrides an earlier one")

    NODE_CLASS_MAPPINGS.update(_classes)
    NODE_DISPLAY_NAME_MAPPINGS.update(getattr(_module, "NODE_DISPLAY_NAME_MAPPINGS", {}))

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
