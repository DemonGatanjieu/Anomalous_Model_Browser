"""What a run an AI started shows beyond the node and its steps (ai_task_runs.py adds it to the
run's progress, for the AI and the workbench): ComfyUI's console since the run began (the
progress bar of the node running with its own note, "Model Initializing", the models it loads:
what the user sees in the console window), the time per step and the time left, the graphics
card's memory, and once per run estimate(): the size each sampler works at, read from the queued
prompt (never changed), with warnings for a run that will be very slow or will not fit, such as a
picture upscaled by a model and then sampled again at full size."""

import math
import re
import time
from datetime import datetime

ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
# tqdm's bar: " 12%|##  | 6/50 [00:03<00:22,  1.95it/s, a note]"
BAR = re.compile(r"(\d+)/(\d+)\s*\[([^<\]]*)<([^,\]]*),\s*([^,\]]*)(?:,\s*([^\]]*))?\]")
CONSOLE_LINES = 5
LINE_CHARS = 200
# Megapixels a sampler can work at comfortably on a 12 GB card; scaled by the card's memory. 8.4:
# on 2026-10-29 a 6 GB card (RTX 4050) sampled 4 megapixels (Anima, 10 steps) in about 100 s.
COMFORT_MP_12GB = 8.4
DECODE_MP_12GB = 8.4  # what a plain VAEDecode takes comfortably on a 12 GB card, likewise scaled
BIG_SAVE_MP = 64  # a saved picture past this (8192x8192) is heavy for the gallery and the viewers
PNG_BYTES_PER_PIXEL = 1.2  # what a ComfyUI PNG of a generated picture takes, roughly
LATENT_INPUTS = ("latent_image", "samples", "latent", "pixels", "image", "images")
NOT_PICTURES = {"model", "clip", "vae", "upscale_model", "positive", "negative", "conditioning", "control_net",
                "mask", "sampler", "sigmas", "guider", "noise", "clip_vision", "style_model"}


def _logs():
    try:
        from app import logger
    except ImportError:
        return []
    return list(logger.get_logs() or [])


def console_since(started, entries=None, limit=CONSOLE_LINES):
    """The console's last `limit` lines written since `started` (a time.time()), as shown: colours
    gone, a progress bar redrawn in place kept at its latest."""
    written = []
    for entry in _logs() if entries is None else entries:
        try:
            at = datetime.fromisoformat(entry["t"]).timestamp()
        except (KeyError, TypeError, ValueError):
            continue
        if at >= started - 1:
            written.append(str(entry.get("m") or ""))
    lines = []
    for raw in "".join(written).split("\n"):
        parts = [part for part in raw.split("\r") if part.strip()]
        line = ANSI.sub("", parts[-1]).strip() if parts else ""
        if line:
            lines.append(line[:LINE_CHARS])
    return lines[-limit:]


def _seconds(text):
    """tqdm's "01:23" / "1:02:03" in seconds, or None ("?")."""
    try:
        parts = [int(part) for part in text.strip().split(":")]
    except ValueError:
        return None
    return sum(part * 60 ** index for index, part in enumerate(reversed(parts))) if 1 < len(parts) <= 3 else None


def bar_of(lines):
    """The progress bar on the console's last line: steps, seconds left and per step, its note; or None."""
    match = BAR.search(lines[-1]) if lines else None
    if not match:
        return None
    out = {"value": int(match[1]), "max": int(match[2])}
    left = _seconds(match[4])
    if left is not None and out["value"]:
        out["left"] = left
    rate = match[5].strip()
    number = re.match(r"([\d.]+)\s*(s/it|it/s)", rate)
    if number and float(number[1]) > 0:
        out["rate"] = round(float(number[1]) if number[2] == "s/it" else 1 / float(number[1]), 2)
    if match[6] and match[6].strip():
        out["note"] = match[6].strip()[:80]
    return out


class Pace:
    """Seconds per step and seconds left of the node running, from the steps seen over time
    (for nodes whose bar is not on the console)."""

    def __init__(self):
        self.key, self.first = None, None

    def update(self, key, value, most, now=None):
        now = time.monotonic() if now is None else now
        if key != self.key or self.first is None or value < self.first[1]:
            self.key, self.first = key, (now, value)
            return None
        done = value - self.first[1]
        if done <= 0:
            return None
        rate = (now - self.first[0]) / done
        return {"rate": round(rate, 2), "left": max(0, round(rate * (most - value)))}


def vram():
    """The graphics card's free and total memory in MB, or None (no card, or no ComfyUI)."""
    try:
        import comfy.model_management as management
        device = management.get_torch_device()
        if getattr(device, "type", "") in ("cpu", "mps"):
            return None
        total, free = management.get_total_memory(device), management.get_free_memory(device)
    except Exception:  # noqa: BLE001 - memory is a hint; the run goes on without it
        return None
    return {"free_mb": int(free // 2 ** 26) * 64, "total_mb": int(total // 2 ** 20)}


def _image_size(name):
    """(width, height) of picture `name` in ComfyUI's input folder, or None."""
    try:
        import folder_paths
        from PIL import Image
        with Image.open(folder_paths.get_annotated_filepath(str(name))) as picture:
            return picture.size
    except Exception:  # noqa: BLE001 - an unreadable picture only leaves the size unknown
        return None


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def _linked(value):
    return isinstance(value, list) and len(value) == 2 and isinstance(value[0], (str, int))


def _model_factor(prompt, link):
    """How many times an upscale model enlarges, from its file name ("4x-UltraSharp", "x2plus"); 4 if unsaid."""
    name = str(((prompt.get(str(link[0])) or {}).get("inputs") or {}).get("model_name") or "") if _linked(link) else ""
    match = re.search(r"(?<![0-9])([1-8])x|x([1-8])(?![0-9])", name, re.I)
    return int(match[1] or match[2]) if match else 4


def estimate(prompt, vram_total_mb=None, image_size=_image_size):
    """The size each sampler of API prompt `prompt` works at, and warnings: {"samplers", "warnings"}."""
    sizes = {}

    def size(node_id, seen):
        node_id = str(node_id)
        if node_id in sizes:
            return sizes[node_id]
        node = prompt.get(node_id)
        if not isinstance(node, dict) or node_id in seen:
            return None
        seen.add(node_id)
        kind, inputs = str(node.get("class_type") or ""), node.get("inputs") or {}
        names = sorted((name for name, value in inputs.items() if _linked(value) and name not in NOT_PICTURES),
                       key=lambda name: LATENT_INPUTS.index(name) if name in LATENT_INPUTS else len(LATENT_INPUTS))
        upstream = next((found for found in (size(inputs[name][0], seen) for name in names) if found), None)
        width, height = _number(inputs.get("width")), _number(inputs.get("height"))
        scale = _number(inputs.get("scale_by"))
        out = upstream
        if kind == "LoadImage":
            dims = image_size(inputs.get("image"))
            out = {"width": dims[0], "height": dims[1], "batch": 1, "upscaled": False} if dims else None
        elif width and height and width > 0 and height > 0:
            batch = _number(inputs.get("batch_size")) or (upstream or {}).get("batch", 1)
            out = {"width": width, "height": height, "batch": int(batch), "upscaled": (upstream or {}).get("upscaled", False)}
        elif upstream and (width or height):  # one side given: the other keeps the picture's shape
            ratio = (width or 0) / upstream["width"] if width else height / upstream["height"]
            out = {**upstream, "width": upstream["width"] * ratio, "height": upstream["height"] * ratio}
        elif upstream and scale:
            out = {**upstream, "width": upstream["width"] * scale, "height": upstream["height"] * scale}
        elif upstream and kind == "ImageScaleToTotalPixels" and _number(inputs.get("megapixels")):
            ratio = math.sqrt(inputs["megapixels"] * 1024 * 1024 / (upstream["width"] * upstream["height"]))
            out = {**upstream, "width": upstream["width"] * ratio, "height": upstream["height"] * ratio}
        elif upstream and kind == "ImageUpscaleWithModel":
            factor = _model_factor(prompt, inputs.get("upscale_model"))
            out = {**upstream, "width": upstream["width"] * factor, "height": upstream["height"] * factor, "upscaled": True}
        sizes[node_id] = out
        return out

    def steps_of(inputs):
        if _number(inputs.get("steps")):
            return int(inputs["steps"])
        source = prompt.get(str(inputs["sigmas"][0])) if _linked(inputs.get("sigmas")) else None
        return int(source["inputs"]["steps"]) if source and _number((source.get("inputs") or {}).get("steps")) else None

    memory = max(0.5, min(3.0, (vram_total_mb or 12288) / 12288))
    comfort = COMFORT_MP_12GB * memory
    samplers, warnings = [], []
    for node_id, node in sorted(prompt.items(), key=lambda item: str(item[0])):
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs") or {}
        title = str((node.get("_meta") or {}).get("title") or node.get("class_type") or node_id)[:80]
        if _linked(inputs.get("latent_image")):
            found = size(inputs["latent_image"][0], set())
            if not found:
                continue
            entry = {"node": str(node_id), "title": title, "width": round(found["width"]), "height": round(found["height"]),
                     "batch": found["batch"], "steps": steps_of(inputs), "upscaled": found["upscaled"]}
            samplers.append(entry)
            megapixels = entry["width"] * entry["height"] * entry["batch"] / 1048576
            if megapixels > comfort:
                warnings.append({"kind": "upscale_resample" if found["upscaled"] else "big_sample",
                                 **entry, "megapixels": round(megapixels, 1)})
        elif node.get("class_type") == "VAEDecode" and _linked(inputs.get("samples")):
            found = size(inputs["samples"][0], set())
            if found and found["width"] * found["height"] * found["batch"] / 1048576 > DECODE_MP_12GB * memory:
                warnings.append({"kind": "big_decode", "node": str(node_id), "title": title,
                                 "width": round(found["width"]), "height": round(found["height"])})
        elif "Save" in str(node.get("class_type")) and _linked(inputs.get("images")):
            # What is finally saved: an upscale model after the last sampler can make it far larger.
            found = size(inputs["images"][0], set())
            if found and found["width"] * found["height"] / 1048576 > BIG_SAVE_MP:
                pixels = found["width"] * found["height"]
                warnings.append({"kind": "big_save", "node": str(node_id), "title": title, "width": round(found["width"]),
                                 "height": round(found["height"]), "megapixels": round(pixels / 1048576),
                                 "megabytes": round(pixels * PNG_BYTES_PER_PIXEL / 1048576, -1)})
    return {"samplers": samplers[:12], "warnings": warnings[:6], "comfort_mp": round(comfort, 1)}


def warning_words(warning):
    """One sentence for the AI on a warning of estimate()."""
    where = f"{warning['title']} (node {warning['node']}) works at {warning['width']}x{warning['height']}"
    if warning["kind"] == "upscale_resample":
        return (f"{where}{' for ' + str(warning['steps']) + ' steps' if warning.get('steps') else ''} after an upscale "
                "model enlarged the picture: very slow and may not fit in memory. If the user only wants it bigger, the "
                "upscale model alone (ImageUpscaleWithModel -> SaveImage, no sampler after it) is enough; else sample "
                "smaller (scale down before VAEEncode), use fewer steps or a lower denoise, or a tiled sampler.")
    if warning["kind"] == "big_save":
        return (f"{warning['title']} (node {warning['node']}) saves a {warning['width']}x{warning['height']} picture "
                f"({warning['megapixels']} megapixels, about {warning['megabytes']:.0f} MB as PNG): heavy to look at in the "
                "gallery and image viewers. Unless the user asked for that size, upscale less (2x instead of 4x) or start "
                "from a smaller picture.")
    if warning["kind"] == "big_sample":
        return (f"{where}: {warning['megapixels']} megapixels, more than this card is comfortable with; expect it to be "
                "very slow or run out of memory. Consider a smaller size and upscaling afterwards.")
    return f"{where} when decoded: VAEDecodeTiled saves memory there."
