"""OreX wrapper for OmniVoice Longform TTS with optional SRT input."""

from copy import deepcopy
import re


_SRT_TIME_RE = re.compile(
    r"^(?P<start>\d{1,3}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*"
    r"(?P<end>\d{1,3}:\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$"
)
_OMNIVOICE_TIME_PREFIX_RE = re.compile(
    r"^\s*\[\d+:\d{2}:\d{2}\s*-\s*\d+:\d{2}:\d{2}\]\s*:\s*"
)


def _source_node_class():
    import nodes

    node_class = nodes.NODE_CLASS_MAPPINGS.get("OmniVoiceLongformTTS")
    if node_class is None:
        raise RuntimeError(
            "OmniVoice Longform TTS is unavailable. "
            "Install and enable ComfyUI-omnivoice-tts, then restart ComfyUI."
        )
    return node_class


def _format_time(value):
    hours, minutes, rest = value.replace(",", ".").split(":")
    seconds, milliseconds = rest.split(".")
    total_minutes = int(hours) * 60 + int(minutes)
    return f"{total_minutes:02d}:{int(seconds):02d}:{int(milliseconds) // 10:02d}"


def srt_to_omnivoice_text(srt_text):
    blocks = re.split(r"\n\s*\n", srt_text.replace("\r\n", "\n").replace("\r", "\n").strip())
    converted = []

    for cue_number, block in enumerate(blocks, 1):
        lines = block.lstrip("\ufeff").splitlines()
        if lines and lines[0].strip().isdigit():
            lines.pop(0)

        match = _SRT_TIME_RE.match(lines[0].strip()) if lines else None
        subtitle = " ".join(line.strip() for line in lines[1:] if line.strip())
        if not match or not subtitle:
            raise ValueError(f"Invalid SRT cue #{cue_number}.")

        start = _format_time(match.group("start"))
        end = _format_time(match.group("end"))
        converted.append(f"[{start} - {end}]: {subtitle}")

    if not converted:
        raise ValueError("SRT input is empty.")
    return "\n".join(converted)


def _timed_text_to_plain(text):
    return "\n".join(_OMNIVOICE_TIME_PREFIX_RE.sub("", line) for line in text.splitlines())


class OreX_OmniVoiceLongformTTS:
    """OmniVoice Longform TTS with an optional SRT-to-timestamp conversion."""

    @classmethod
    def INPUT_TYPES(cls):
        input_types = deepcopy(_source_node_class().INPUT_TYPES())
        required = input_types["required"]
        with_srt = {}
        for name, definition in required.items():
            if name == "steps":
                with_srt["srt"] = (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": "Convert standard SRT subtitles in text to OmniVoice timestamps.",
                    },
                )
            with_srt[name] = definition
        input_types["required"] = with_srt
        return input_types

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    FUNCTION = "generate"
    CATEGORY = "OreX/Audio"
    DESCRIPTION = (
        "OmniVoice Longform TTS with optional conversion from standard SRT subtitles."
    )

    def generate(self, srt=False, **kwargs):
        if srt:
            kwargs["text"] = srt_to_omnivoice_text(kwargs["text"])
        kwargs["text"] = _timed_text_to_plain(kwargs["text"])
        return _source_node_class()().generate(**kwargs)


NODE_CLASS_MAPPINGS = {
    "OreX_OmniVoiceLongformTTS": OreX_OmniVoiceLongformTTS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "OreX_OmniVoiceLongformTTS": "OmniVoice Longform TTS (OreX)",
}


__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
