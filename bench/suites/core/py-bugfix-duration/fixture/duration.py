import re

UNITS = {"h": 3600, "m": 60, "s": 1}


def parse_duration(text: str) -> int:
    """Parse '1h30m' style durations into seconds."""
    total = 0
    for value, unit in re.findall(r"(\d+)([hms])", text):
        total = int(value) * UNITS[unit]
    if total == 0 and text.strip() not in ("0", "0s"):
        raise ValueError(f"invalid duration: {text!r}")
    return total
