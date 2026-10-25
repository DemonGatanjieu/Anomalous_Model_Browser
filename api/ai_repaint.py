"""Where to repaint a picture the user marked, as the AI proposes it and the user agrees on the AI
workbench (the propose_repaint_area tool, mcp_task_tools.py).

The user's marks (ai_marks.py) are rough, and the AI sees the marked picture: it may move, reshape,
grow and soften the area: `areas` (boxes or ellipses as fractions of the picture, x/y the top left
as in the marks), `grow` (pixels added around each) and `feather` (pixels of soft edge). Anomalous
draws the user's area and the AI's over the picture into the task's marks folder and puts both side
by side on a panel (block "area") with three answers: the AI's, the user's own, or marking it
again; a line of their own says what to change. When the user picks an area, the picture goes
into ComfyUI's input folder with that area as its alpha (ai_marks.write_inpaint), so LoadImage
gives the picture and the area as its MASK; the answer the AI reads carries the file's name and a
short note of the usual repaint nodes. How to build the repaint on the canvas stays the AI's.
"""

import os
import uuid

import folder_paths

from . import ai_marks, ai_panels, ai_tasks

SHAPES = ("box", "ellipse")
MAX_AREAS = 8
MAX_GROW = 256
MAX_FEATHER = 128
PREVIEW_EDGE = 1024
TINT = (255, 64, 64)
CHOICES = (  # id, label for the AI, the page's words
    ("ai", "Use the AI's area", "aiRepaintUseAi"),
    ("mine", "Use the user's own marks", "aiRepaintUseMine"),
    ("again", "Mark it again", "aiRepaintAgain"),
)
AGAIN_NOTE = "The user marks the picture again: wait for their new marks with get_answers, then propose again."
WORDS_NOTE = "The user said what to change about the area: propose_repaint_area again with it."


class RepaintError(ValueError):
    pass


def _number(value, low, high, what):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        raise RepaintError(f"{what} is a number from {low} to {high}")
    return value


def _areas(areas):
    if not isinstance(areas, list) or not 0 < len(areas) <= MAX_AREAS:
        raise RepaintError(f"areas lists 1 to {MAX_AREAS} areas")
    out = []
    for at, area in enumerate(areas):
        where = f"areas[{at}]"
        if not isinstance(area, dict) or area.get("shape", "box") not in SHAPES:
            raise RepaintError(f"{where} is {{shape: box | ellipse, x, y, w, h}}")
        x, y = (_number(area.get(key), 0, 1, f"{where}.{key}") for key in ("x", "y"))
        w, h = (_number(area.get(key), 0.005, 1, f"{where}.{key}") for key in ("w", "h"))
        out.append({"shape": area.get("shape", "box"), "x": round(x, 4), "y": round(y, 4),
                    "w": round(min(w, 1 - x), 4), "h": round(min(h, 1 - y), 4)})
    return out


def _from_marks(marks):
    """The user's marks as areas: a circle an ellipse in its box, a line or an arrow the box around it."""
    return [{"shape": "ellipse" if mark["shape"] == "circle" else "box", **{key: mark[key] for key in ("x", "y", "w", "h")}}
            for mark in marks if mark["w"] > 0 and mark["h"] > 0]


def area_image(size, areas, grow=0, feather=0):
    """An "L" image of `size`, white over `areas` grown by `grow` pixels, `feather` pixels soft at the edge."""
    from PIL import Image, ImageDraw, ImageFilter

    width, height = size
    area = Image.new("L", size, 0)
    draw = ImageDraw.Draw(area)
    for shape in areas:
        box = [shape["x"] * width - grow, shape["y"] * height - grow,
               (shape["x"] + shape["w"]) * width + grow, (shape["y"] + shape["h"]) * height + grow]
        (draw.ellipse if shape["shape"] == "ellipse" else draw.rectangle)(box, fill=255)
    return area.filter(ImageFilter.GaussianBlur(feather / 2)) if feather else area


def _user_area(marks_step):
    """How to make the user's own area: what they painted when they asked for only the marked areas, else their marks."""
    painted = marks_step.get("inpaint")
    if painted:
        def from_painted(size):
            from PIL import Image, ImageOps

            with Image.open(os.path.join(folder_paths.get_input_directory(), painted)) as kept:
                return ImageOps.invert(kept.getchannel("A")).resize(size)
        return from_painted
    areas = _from_marks(marks_step.get("marks") or [])
    if not areas:
        raise RepaintError("These marks hold no area to repaint")
    return lambda size: area_image(size, areas)


def _preview(task_id, picture, area_of):
    """The picture, made small, with the area tinted, kept in the task's marks folder: its name."""
    from PIL import Image

    try:
        with Image.open(ai_marks.picture_path(picture)) as original:
            base = original.convert("RGB")
    except OSError:
        raise RepaintError("The marked picture cannot be read")
    base.thumbnail((PREVIEW_EDGE, PREVIEW_EDGE))
    area = area_of(base.size).point(lambda value: value * 55 // 100)
    shown = Image.composite(Image.new("RGB", base.size, TINT), base, area)
    name = f"{uuid.uuid4().hex[:10]}.png"
    os.makedirs(ai_tasks.marks_dir(task_id), exist_ok=True)
    with open(os.path.join(ai_tasks.marks_dir(task_id), name), "xb") as target:
        shown.save(target, "PNG")
    return name


def propose(client, title, marks_id, areas=None, grow=12, feather=8, note="", session=""):
    """Shows the user their area and the AI's for marks `marks_id`; returns the panel to wait on."""
    with ai_tasks._lock:
        found = next(((task, step) for task in ai_tasks._load().values() for step in task.get("steps") or []
                      if step.get("id") == marks_id and step.get("tool") == "user_marks"), None)
    if not found:
        raise RepaintError("marks is the id of the user's marks (user_messages[].id, kind marks)")
    task, marks_step = found
    grow = int(_number(grow, 0, MAX_GROW, "grow"))
    feather = int(_number(feather, 0, MAX_FEATHER, "feather"))
    shapes = _areas(areas) if areas else _from_marks(marks_step.get("marks") or [])
    if not shapes:
        raise RepaintError("These marks hold no area: give areas")
    picture = marks_step["image"]
    with_edges = {"grow": grow, "feather": feather}
    try:
        from PIL import Image

        with Image.open(ai_marks.picture_path(picture)) as original:
            scale = min(1, PREVIEW_EDGE / max(original.size))  # grow and feather are pixels of the whole picture
    except OSError:
        raise RepaintError("The marked picture cannot be read")
    yours = _preview(task["id"], picture, _user_area(marks_step))
    ai = _preview(task["id"], picture, lambda size: area_image(size, shapes, grow * scale, feather * scale))
    blocks = [{"type": "area", "yours": yours, "ai": ai, **with_edges}]
    if note:
        blocks.append({"type": "text", "text": note})
    blocks.append({"type": "choices", "id": "answer", "other": True,
                   "options": [{"id": key, "label": label, "label_key": words, **({"recommended": True} if key == "ai" else {})}
                               for key, label, words in CHOICES]})
    try:
        return ai_panels.show(client, title, blocks, session=session, task_id=task["id"], tool="propose_repaint_area",
                              extra={"repaint": {"marks": marks_id, "areas": shapes, **with_edges}})
    except ai_panels.PanelError as error:
        raise RepaintError(str(error))


def prepare(task_id, step_id, choice, text, skip=False):
    """What the user's answer to a repaint panel brings the AI, made before it is recorded: the repaint
    picture for an area picked (inpaint_image and its note; "your call" takes the AI's), else what to
    do now; {} for other panels."""
    step = next((item for item in (ai_tasks.get_task(task_id) or {}).get("steps") or [] if item.get("id") == step_id), None)
    asked = (step or {}).get("repaint")
    if not asked:
        return {}
    picked = "ai" if skip else (choice[0] if isinstance(choice, list) and choice else choice)
    if picked not in ("ai", "mine"):
        return {"note": WORDS_NOTE if str(text or "").strip() and not picked else AGAIN_NOTE}
    marks_step = next((item for task in ai_tasks._load().values() for item in task.get("steps") or []
                       if item.get("id") == asked["marks"]), None)
    if not marks_step:
        raise RepaintError("The marks are gone")
    area_of = (_user_area(marks_step) if picked == "mine"
               else lambda size: area_image(size, asked["areas"], asked["grow"], asked["feather"]))
    try:
        name = ai_marks.write_inpaint(marks_step["image"], area_of, uuid.uuid4().hex[:10])
    except ai_marks.MarksError as error:
        raise RepaintError(str(error))
    return {"inpaint_image": name, "note": ai_panels.INPAINT_NOTE}


def discard(prepared):
    """The repaint picture `prepare` made, when the answer was refused after all (the plugin's own file)."""
    if prepared.get("inpaint_image"):
        try:
            os.remove(os.path.join(folder_paths.get_input_directory(), prepared["inpaint_image"]))
        except OSError:
            pass
