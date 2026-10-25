"""Marks the user draws on a picture to tell the AI where to change it (the AI workbench's marker,
web/modules/ui_ai_marker.js): boxes, circles, arrows and free lines, each with a note. The page
sends the picture with the marks drawn on it (a PNG) and the marks themselves; this keeps the
PNG in the ComfyUI user folder (anomalous/ai_marks/<task>/<step>.png, never the output folder, so
the gallery stays the user's pictures) and adds a "user_marks" step to the task. The AI gets it
like a message (ai_panels._collect, kind "marks": the notes with where each mark is, in
fractions of the picture) and, attached to the same answer, the marked picture as a thumbnail
(image_items), so an AI that can see pictures sees the marks. Only an output picture can be
marked; the PNG is checked (signature, size, dimensions) before it is kept.
The user also says how to change the picture (MODES), and the AI reads that choice first, as the
user's: leave it to the AI, change only the marked areas, or make the whole picture anew. For
"only the marked areas" the page sends a mask (the marker's "repaint" brush, and the boxes,
circles and lines; white where to repaint), and the picture is also written to ComfyUI's input
folder as anomalous_inpaint_<step>.png with that area as its alpha, so LoadImage gives the
picture and the area as its MASK for an inpaint workflow; the AI gets the file name with the marks.
"""

import base64
import io
import os
import re
import time
import uuid

import folder_paths

from . import ai_tasks
from .mcp_tools import _image_content

MAX_PNG_BYTES = 8 * 1024 * 1024
MAX_EDGE = 4096
MAX_MARKS = 20
MAX_NOTE = 300
SHAPES = ("box", "circle", "arrow", "pen")
MODES = {
    "auto": "How to change it is up to you: say in report which way you took (repaint only the marked areas, "
            "or make the picture anew) and why.",
    "local": "The user chose: change ONLY the marked areas and keep everything else exactly as it is. Repaint "
             "them from inpaint_image (inpaint_note says how); do not make the whole picture anew.",
    "whole": "The user chose: make the whole picture anew with these changes (its own model and prompt, "
             "changed as the notes say; a new seed or img2img). Do not repaint only a part of it.",
}
FILE_NAME = re.compile(r"[0-9a-f]{10}\.png")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class MarksError(ValueError):
    pass


def path_of(task_id, name):
    """The kept PNG `name` of task `task_id`, or None (only names this module makes)."""
    if not FILE_NAME.fullmatch(str(name)):
        return None
    path = os.path.join(ai_tasks.marks_dir(task_id), name)
    return path if os.path.isfile(path) else None


def _png(data_url):
    text = str(data_url or "")
    if not text.startswith("data:image/png;base64,"):
        raise MarksError("Expected the marked picture as a PNG data URL")
    try:
        data = base64.b64decode(text.split(",", 1)[1], validate=True)
    except (ValueError, IndexError):
        raise MarksError("The marked picture is not valid base64")
    if len(data) > MAX_PNG_BYTES or not data.startswith(PNG_SIGNATURE):
        raise MarksError("The marked picture is not a PNG of a usable size")
    from PIL import Image

    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG" or max(image.size) > MAX_EDGE:
                raise MarksError("The marked picture is too large")
            image.verify()
    except MarksError:
        raise
    except Exception:  # noqa: BLE001 - whatever PIL says, it is not a picture to keep
        raise MarksError("The marked picture cannot be read")
    return data


def _fraction(value):
    try:
        return min(1.0, max(0.0, round(float(value), 4)))
    except (TypeError, ValueError):
        raise MarksError("Mark positions are fractions of the picture")


def _clean(marks, masked=False):
    if not isinstance(marks, list) or (not marks and not masked) or len(marks) > MAX_MARKS:
        raise MarksError(f"Between 1 and {MAX_MARKS} marks")
    out = []
    for mark in marks:
        if not isinstance(mark, dict) or mark.get("shape") not in SHAPES:
            raise MarksError(f"Each mark is one of {', '.join(SHAPES)}")
        x, y, w, h = (_fraction(mark.get(key, 0)) for key in ("x", "y", "w", "h"))
        out.append({"shape": mark["shape"], "x": x, "y": y, "w": min(w, 1 - x), "h": min(h, 1 - y),
                    "note": ai_tasks._short(str(mark.get("note") or "").strip(), MAX_NOTE)})
    return out


def _words(marks, text, mode="auto"):
    """The message the AI reads: how to change the picture, the user's words, then each mark with where it is."""
    lines = [MODES[mode]] + ([text] if text else [])
    for number, mark in enumerate(marks, 1):
        where = (f"x {round(mark['x'] * 100)}–{round((mark['x'] + mark['w']) * 100)}%, "
                 f"y {round(mark['y'] * 100)}–{round((mark['y'] + mark['h']) * 100)}% of the picture")
        lines.append(f"Mark {number} ({mark['shape']}, {where}): {mark['note'] or '(no note)'}")
    return "\n".join(lines)


def _inpaint_file(picture, mask, step_id):
    """The picture with mask `mask` (PNG bytes, white where to repaint) as its alpha, in ComfyUI's
    input folder (a new file, never one that is there): its name for LoadImage."""
    from PIL import Image, ImageOps

    source = os.path.join(folder_paths.get_output_directory(), picture["subfolder"], picture["filename"])
    try:
        with Image.open(source) as original, Image.open(io.BytesIO(mask)) as drawn:
            area = drawn.convert("L").resize(original.size, Image.NEAREST).point(lambda value: 255 if value > 127 else 0)
            if not area.getbbox():
                raise MarksError("The repaint area is empty")
            out = original.convert("RGB")
            out.putalpha(ImageOps.invert(area))  # ComfyUI's LoadImage: MASK = 1 - alpha
    except MarksError:
        raise
    except Exception:  # noqa: BLE001 - a picture PIL cannot read cannot be repainted either
        raise MarksError("The picture cannot be read for repainting")
    name = f"anomalous_inpaint_{step_id}.png"
    with open(os.path.join(folder_paths.get_input_directory(), name), "xb") as target:  # never replaces a file
        out.save(target, "PNG")
    return name


def save(task_id, image, png, marks, text="", now=None, mask=None, mode=None):
    """Keeps the marked picture and adds the user's marks to the task, with how to change it (a
    key of MODES; without one, "local" when there is a mask, as the page sent before there was a
    choice). For "local", `mask` (a PNG data URL) also makes the picture ready to repaint
    (_inpaint_file); the other ways keep no mask. Returns the step."""
    mode = mode or ("local" if mask else "auto")
    if mode not in MODES:
        raise MarksError(f"How to change it is one of {', '.join(MODES)}")
    if mode != "local":
        mask = None
    elif not mask:
        raise MarksError("Changing only the marked areas needs a box, circle, line or painted area")
    try:
        picture = ai_tasks._output_media(image)
    except (ValueError, OSError):
        picture = None
    if not picture:
        raise MarksError("Only a picture in the output folder can be marked")
    data = _png(png)
    mask = _png(mask) if mask else None
    marks = _clean(marks, masked=mask is not None)
    text = ai_tasks._short(str(text or "").strip(), 2000)
    step_id = uuid.uuid4().hex[:10]
    now = time.time() if now is None else now
    if not ai_tasks.get_task(task_id):
        raise MarksError("No such task")
    inpaint = _inpaint_file(picture, mask, step_id) if mask else None  # outside the lock: a picture takes a moment
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        if not task:
            raise MarksError("No such task")
        os.makedirs(ai_tasks.marks_dir(task_id), exist_ok=True)
        with open(os.path.join(ai_tasks.marks_dir(task_id), f"{step_id}.png"), "xb") as target:  # a new name: never replaces
            target.write(data)
        step = {"id": step_id, "at": now, "ms": 0, "tool": "user_marks", "kind": "user", "ok": True, "state": "done",
                "summary": "user_marks", "text": _words(marks, text, mode), "note": text, "image": picture, "marks": marks, "mode": mode,
                "marked": f"{step_id}.png", "delivered": False, "results": [], **({"inpaint": inpaint} if inpaint else {})}
        task["steps"].append(step)
        del task["steps"][:-ai_tasks.MAX_STEPS]
        task["updated"] = max(task.get("updated", 0), now)
        ai_tasks._save(task)
    ai_tasks._notify(task_id)
    return step


def image_items(messages):
    """MCP image items of the marked pictures among `messages` and of the pictures the user handed
    over (ai_pictures.py), their thumbnails, taking their private "_marked" / "_pictures" paths off
    the messages."""
    items = []
    for message in messages:
        for path in [message.pop("_marked", None), *message.pop("_pictures", [])]:
            item = _image_content(path) if path else None
            if item:
                items.append(item)
    return items
