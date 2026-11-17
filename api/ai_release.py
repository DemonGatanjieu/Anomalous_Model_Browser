"""Pictures the user lets the AI of a private task see, and only those (the privacy notes' plan A): a part of a
picture the user boxed in the marker (ai_marks.py) and ticked "show the AI this part", or a stand-in picture
made with the task's last workflow and a harmless prompt. The AI never picks what to cut (no tool takes
coordinates from it), so no number of calls puts a whole picture together.

Each is drawn anew from pixels and kept as a plain PNG in the task's marks folder (ai_tasks.marks_dir), no
text in it: nothing of the workflow, the prompt or the models travels with it, and nothing from brief()
goes along. A part keeps a margin around the box (MARGIN of the box's size on each side, for how light and
shapes join the rest) with the box itself framed in a dashed red line; the repaint area the user drew is
not touched. These are the only pictures guard() lets through in a private task (RELEASED marks them on
their way, ai_marks.image_items); the privacy overview lists them.
"""

import json
import os
import time
import urllib.error
import urllib.request
import uuid

from . import ai_tasks
from .image_search import read_png_text

MARGIN = 0.25  # of the box's width and height, on each side
MAX_EDGE = 768  # a released picture's longest side
RELEASED = "_amb_released"  # on an MCP image item: a picture the user released; taken off before it leaves
HARMLESS = "a still life of a ceramic vase with fresh flowers and a few apples on a wooden table by a window, soft daylight"
TEXT_INPUTS = ("text", "text_g", "text_l", "clip_l", "t5xxl", "prompt", "string", "value")
STANDIN_WAIT_SECONDS = 300
POLL_SECONDS = 1.0


class ReleaseError(ValueError):
    """Why a picture cannot be released; `code` names it for the page's words (aiStandinError_<code>)."""

    def __init__(self, message, code=""):
        super().__init__(message)
        self.code = code


def _plain_png(image):
    """`image` as PNG bytes drawn from its pixels alone (no text chunks, no EXIF), at most MAX_EDGE px."""
    import io

    from PIL import Image

    pixels = image.convert("RGB")
    pixels.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    clean = Image.new("RGB", pixels.size)
    clean.paste(pixels)
    out = io.BytesIO()
    clean.save(out, "PNG")
    return out.getvalue()


def _dashed_box(draw, box, color=(255, 64, 64), width=3, dash=12):
    x0, y0, x1, y1 = box
    for start, end, fixed, horizontal in ((x0, x1, y0, True), (x0, x1, y1, True), (y0, y1, x0, False), (y0, y1, x1, False)):
        for at in range(int(start), int(end), dash * 2):
            stop = min(at + dash, end)
            draw.line([(at, fixed), (stop, fixed)] if horizontal else [(fixed, at), (fixed, stop)], fill=color, width=width)


def crop(picture_path, mark):
    """The part of the picture at `picture_path` that box `mark` (fractions x, y, w, h) holds, with its
    margin and the box framed: (PNG bytes, the box's share of the picture)."""
    from PIL import Image, ImageDraw

    try:
        with Image.open(picture_path) as original:
            width, height = original.size
            box = (mark["x"] * width, mark["y"] * height, (mark["x"] + mark["w"]) * width, (mark["y"] + mark["h"]) * height)
            if box[2] - box[0] < 4 or box[3] - box[1] < 4:
                raise ReleaseError("The box is too small to show")
            pad_x, pad_y = (box[2] - box[0]) * MARGIN, (box[3] - box[1]) * MARGIN
            outer = (max(0, box[0] - pad_x), max(0, box[1] - pad_y), min(width, box[2] + pad_x), min(height, box[3] + pad_y))
            part = original.convert("RGB").crop(tuple(round(v) for v in outer))
    except ReleaseError:
        raise
    except Exception:  # noqa: BLE001 - a picture PIL cannot read cannot be shown either
        raise ReleaseError("The picture cannot be read")
    _dashed_box(ImageDraw.Draw(part), (box[0] - outer[0], box[1] - outer[1], box[2] - outer[0] - 1, box[3] - outer[1] - 1))
    return _plain_png(part), round(mark["w"] * mark["h"], 4)


def _keep(task_id, name, data):
    os.makedirs(ai_tasks.marks_dir(task_id), exist_ok=True)
    with open(os.path.join(ai_tasks.marks_dir(task_id), name), "xb") as target:  # a new name: never replaces
        target.write(data)


def keep_crops(task_id, step_id, picture_path, marks):
    """Cuts and keeps the parts of the released boxes among `marks`: [{file, box, area}]."""
    out = []
    for number, mark in enumerate((mark for mark in marks if mark.get("release")), 1):
        data, area = crop(picture_path, mark)
        name = f"{step_id}_r{number}.png"
        _keep(task_id, name, data)
        out.append({"file": name, "box": {key: mark[key] for key in ("x", "y", "w", "h")}, "area": area})
    return out


CROP_WORDS = ("The user let you see {count} part(s) of this picture (attached), cut out with a margin around each and "
              "the boxed area framed by a dashed red line: only to judge that spot (light, colour, how it joins the "
              "rest) and as a look reference. The picture itself stays private: it runs from the local original.")


# ---------------------------------------------------------------- a stand-in picture

def _last_picture(task):
    """The newest output picture of `task` whose own workflow (its PNG's prompt) can be read: (path, prompt)."""
    root = ai_tasks.folder_paths.get_output_directory()
    for step in reversed(task.get("steps") or []):
        for item in reversed(step.get("results") or []):
            if item.get("type") != "image" or item.get("folder", "output") != "output" or not str(item.get("filename", "")).lower().endswith(".png"):
                continue
            path = os.path.join(root, item.get("subfolder") or "", item["filename"])
            try:
                prompt = json.loads((read_png_text(path) or {}).get("prompt") or "null")
            except (OSError, ValueError):
                continue
            if isinstance(prompt, dict) and prompt:
                return path, prompt
    raise ReleaseError("This task has no picture of its own with a workflow inside to make a stand-in from", "no_picture")


def _linked(value):
    return isinstance(value, list) and len(value) == 2 and isinstance(value[0], (str, int))


def harmless(prompt):
    """A copy of API-format `prompt` that draws HARMLESS with the same models, LoRAs, sampler, size and seed:
    the positive prompt's text replaced, one picture, previewed (not saved). Refused when it reads any
    picture (a stand-in would carry the original's look) or has no positive prompt to replace."""
    nodes = json.loads(json.dumps(prompt))
    for node in nodes.values():
        kind = str(node.get("class_type", ""))
        if "LoadImage" in kind or "LoadVideo" in kind or "ImageLoader" in kind:
            raise ReleaseError("This workflow reads a picture: a stand-in would show the original's look", "reads_picture")
    replaced = set()

    def replace(node_id, depth=0):
        node = nodes.get(str(node_id))
        if not node or depth > 4 or str(node_id) in replaced:
            return
        replaced.add(str(node_id))
        inputs = node.get("inputs") or {}
        texts = [key for key in TEXT_INPUTS if key in inputs]
        for key in texts:
            if isinstance(inputs[key], str):
                inputs[key] = HARMLESS
            elif _linked(inputs[key]):
                replace(inputs[key][0], depth + 1)
        if not texts:  # a combine or a pass-through: the conditioning behind it, not its models
            for key, value in inputs.items():
                if _linked(value) and ("conditioning" in key or key == "positive"):
                    replace(value[0], depth + 1)

    for node in nodes.values():
        if _linked((node.get("inputs") or {}).get("positive")):
            replace(node["inputs"]["positive"][0])
    if not any(isinstance((nodes[n].get("inputs") or {}).get(key), str) and nodes[n]["inputs"][key] == HARMLESS
               for n in replaced for key in TEXT_INPUTS):
        raise ReleaseError("No positive prompt to replace was found in this workflow", "no_prompt")
    for node in nodes.values():
        inputs = node.get("inputs") or {}
        if "batch_size" in inputs and "Latent" in str(node.get("class_type", "")):
            inputs["batch_size"] = 1
        if node.get("class_type") == "SaveImage":
            node["class_type"] = "PreviewImage"
            node["inputs"] = {"images": inputs.get("images")}
    return nodes


def _local(base_url, method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(base_url + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read() or b"null")
        except ValueError:
            return error.code, None
    except (urllib.error.URLError, OSError) as error:
        raise ReleaseError(f"Could not reach ComfyUI's own server: {error}", "unreachable")


def standin(task_id, base_url):
    """Runs the stand-in of `task_id`'s last picture on this ComfyUI and keeps it as a "user_standin" step
    (the AI gets it with the next answer, with what it is): the step."""
    from PIL import Image

    task = ai_tasks.get_task(task_id)
    if not task:
        raise ReleaseError("No such task")
    _path, prompt = _last_picture(task)
    status, data = _local(base_url, "POST", "/prompt", {"prompt": harmless(prompt), "client_id": "anomalous-standin"})
    prompt_id = (data or {}).get("prompt_id")
    if status != 200 or not prompt_id:
        raise ReleaseError(f"ComfyUI refused the stand-in: {json.dumps((data or {}).get('node_errors') or (data or {}).get('error') or status, ensure_ascii=False)[:300]}", "refused")
    deadline = time.monotonic() + STANDIN_WAIT_SECONDS
    picture = None
    while time.monotonic() < deadline and not picture:
        time.sleep(POLL_SECONDS)
        _status, history = _local(base_url, "GET", f"/history/{prompt_id}")
        record = (history or {}).get(prompt_id) or {}
        state = record.get("status") or {}
        if state.get("status_str") == "error":
            raise ReleaseError("The stand-in run failed: see the ComfyUI console", "failed")
        if state.get("completed"):
            images = [item for output in (record.get("outputs") or {}).values() for item in output.get("images") or []]
            if not images:
                raise ReleaseError("The stand-in run made no picture", "failed")
            picture = images[0]
    if not picture:
        raise ReleaseError("The stand-in is still running (ComfyUI is busy); try again in a moment", "busy")
    root = ai_tasks.folder_paths.get_temp_directory() if picture.get("type") == "temp" else ai_tasks.folder_paths.get_output_directory()
    with Image.open(os.path.join(root, picture.get("subfolder") or "", picture["filename"])) as made:
        data = _plain_png(made)
    step_id = uuid.uuid4().hex[:10]
    name = f"{step_id}_s.png"
    _keep(task_id, name, data)
    now = time.time()
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        if not task:
            raise ReleaseError("No such task")
        step = {"id": step_id, "at": now, "ms": 0, "tool": "user_standin", "kind": "user", "ok": True, "state": "done",
                "summary": "user_standin", "text": STANDIN_WORDS, "released": [{"file": name, "kind": "standin"}],
                "delivered": False, "results": []}
        task["steps"].append(step)
        del task["steps"][:-ai_tasks.MAX_STEPS]
        task["updated"] = max(task.get("updated", 0), now)
        ai_tasks._save(task)
    ai_tasks._notify(task_id)
    return step


STANDIN_WORDS = ("The user let you see a stand-in picture (attached): made with this task's last workflow - the same models, "
                 "LoRAs, sampler, size and seed - but a harmless prompt (a still life of flowers and apples). Use it only to "
                 "judge the look: exposure, colour, style. It is not the real picture, which stays private.")


def released_items(task):
    """Every picture released in `task`: [{step, file, kind, at}] for the privacy overview's list."""
    out = []
    for step in task.get("steps") or []:
        for item in step.get("released") or []:
            out.append({"step": step["id"], "file": item["file"], "kind": item.get("kind", "crop"), "at": step.get("at", 0)})
    return out
