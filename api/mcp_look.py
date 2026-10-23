"""zoom_image, the AI's closer look: part of a picture (in ComfyUI's output, input or temp folder)
cut out and shown larger, and the same part of a second picture beside it to compare a before
and an after, attached to the answer. It reads only: the pictures stay as they are. With it an AI
need not crop, enlarge or compare pictures with code of its own (each such command asks the user
to allow it). The region is in fractions of the picture, as the user's marks give theirs."""

import base64
import io

from PIL import Image

from .mcp_tools import ToolError, _resolve_folder_image, _tool

MIN_SIZE, MAX_SIZE, DEFAULT_SIZE = 256, 1024, 768
MAX_ENLARGE = 4  # a tiny part is shown at most this many times its size
MIN_PIXELS = 8


def _box(region, width, height):
    """Region {x, y, width, height} (fractions 0-1, default the whole picture) as a pixel box."""
    region = region if isinstance(region, dict) else {}
    try:
        x, y = (min(1.0, max(0.0, float(region.get(key, 0)))) for key in ("x", "y"))
        w, h = (min(1.0, max(0.0, float(region.get(key, 1)))) for key in ("width", "height"))
    except (TypeError, ValueError):
        raise ToolError("region is {x, y, width, height}, each a fraction 0-1 of the picture.")
    left, top = round(x * width), round(y * height)
    right, bottom = min(width, round((x + w) * width)), min(height, round((y + h) * height))
    if right - left < MIN_PIXELS or bottom - top < MIN_PIXELS:
        raise ToolError(f"The region is under {MIN_PIXELS} pixels across; give a larger one.")
    return left, top, right, bottom


def _part(path, region, size):
    """(facts, MCP image item) of `region` of the picture at `path`, its longer side `size` at most."""
    try:
        with Image.open(path) as picture:
            box = _box(region, picture.width, picture.height)
            part = picture.crop(box).convert("RGB")
            whole = f"{picture.width}x{picture.height}"
    except (OSError, ValueError, Image.DecompressionBombError):
        raise ToolError("The picture cannot be read.")
    scale = min(size / max(part.size), MAX_ENLARGE)
    shown = part.resize((max(1, round(part.width * scale)), max(1, round(part.height * scale))), Image.LANCZOS)
    data = io.BytesIO()
    shown.save(data, "JPEG", quality=88)
    facts = {"picture": whole, "region": f"x {box[0]}-{box[2]}, y {box[1]}-{box[3]} px", "shown": f"{shown.width}x{shown.height}"}
    return facts, {"type": "image", "data": base64.b64encode(data.getvalue()).decode("ascii"), "mimeType": "image/jpeg"}


def zoom_image(image, region=None, folder="output", compare_with="", compare_folder="", size=DEFAULT_SIZE):
    try:
        size = min(MAX_SIZE, max(MIN_SIZE, int(size)))
    except (TypeError, ValueError):
        raise ToolError(f"size is {MIN_SIZE}-{MAX_SIZE} pixels.")
    rel, path = _resolve_folder_image(image, folder)
    facts, item = _part(path, region, size)
    answer = {"image": rel, "folder": folder, **facts}
    extra = [item]
    if compare_with:
        other_folder = compare_folder or folder
        other_rel, other_path = _resolve_folder_image(compare_with, other_folder)
        other_facts, other_item = _part(other_path, region, size)
        answer["compare_with"] = {"image": other_rel, "folder": other_folder, **other_facts}
        answer["note"] = "Two pictures are attached: first image, then compare_with, the same region of each."
        extra.append(other_item)
    return answer, extra


_REGION = {"type": "object", "description": "Fractions 0-1 of the picture, as the user's marks give theirs; default the whole picture.",
           "properties": {name: {"type": "number", "minimum": 0, "maximum": 1} for name in ("x", "y", "width", "height")}}
_FOLDER = {"type": "string", "enum": ["output", "input", "temp"], "default": "output"}

LOOK_TOOLS = dict([
    _tool("zoom_image", "Look closer at a picture",
          "Part of a picture shown larger, attached: to check a hand, a face, a seam or a mark's area at full detail. "
          "folder: output (results), input (what LoadImage reads, e.g. inpaint_image), temp (a run's previews). "
          "compare_with: a second picture, the same region attached beside it (a before and an after). Reads only. "
          "Use it instead of cropping or comparing pictures with code of your own; change a picture only by running "
          "a ComfyUI workflow (inpaint and the like), never by editing its file.",
          zoom_image, {"image": {"type": "string", "description": "As search_images, get_image_info or run_status name it."},
                       "region": _REGION, "folder": _FOLDER,
                       "compare_with": {"type": "string", "description": "A second picture to show the same region of."},
                       "compare_folder": {"type": "string", "enum": ["output", "input", "temp"],
                                          "description": "compare_with's folder; default the same as folder."},
                       "size": {"type": "integer", "minimum": MIN_SIZE, "maximum": MAX_SIZE, "default": DEFAULT_SIZE}},
          ["image"]),
])
