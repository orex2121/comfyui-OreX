"""
OreX KSampler Config
Author: Pavel Korzhov (PaBoKor)

Простой узел-конфигуратор: собирает steps, cfg, sampler и scheduler в одном месте
и отдаёт их отдельными выходами для подключения к KSampler (и аналогам).
A simple config node: gathers steps, cfg, sampler and scheduler in one place
and exposes them as separate outputs to wire into KSampler (and similar nodes).
"""

import comfy.samplers


class OreXKSamplerConfig:
    """KSampler Config (OreX)."""

    @classmethod
    def INPUT_TYPES(cls):  # pylint: disable=invalid-name
        return {
            "required": {
                "steps": ("INT", {
                    "default": 20,
                    "min": 1,
                    "max": 10000,
                    "step": 1,
                    "tooltip": "Количество шагов сэмплирования.\nNumber of sampling steps.",
                }),
                "cfg": ("FLOAT", {
                    "default": 8.0,
                    "min": 0.0,
                    "max": 100.0,
                    "step": 0.1,
                    "round": 0.01,
                    "tooltip": "Classifier-Free Guidance scale: сила следования промпту.\n"
                               "Classifier-Free Guidance scale: how strongly the prompt is followed.",
                }),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS, {
                    "tooltip": "Алгоритм сэмплирования.\nSampling algorithm.",
                }),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS, {
                    "tooltip": "Планировщик шума (sigmas).\nNoise (sigmas) scheduler.",
                }),
            },
        }

    RETURN_TYPES = ("INT", "FLOAT", comfy.samplers.KSampler.SAMPLERS,
                    comfy.samplers.KSampler.SCHEDULERS)
    RETURN_NAMES = ("steps", "cfg", "sampler_name", "scheduler")
    FUNCTION = "main"
    CATEGORY = "OreX/Sampler"
    DESCRIPTION = (
        "Собирает steps, cfg, sampler и scheduler в одном узле.\n"
        "Gathers steps, cfg, sampler and scheduler in a single node."
    )

    def main(self, steps, cfg, sampler_name, scheduler):
        """Возвращает настройки как есть / Returns the settings as is."""
        return (steps, cfg, sampler_name, scheduler)


NODE_CLASS_MAPPINGS = {
    "orex KSampler Config": OreXKSamplerConfig,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex KSampler Config": "⚙️ KSampler Config (OreX)",
}