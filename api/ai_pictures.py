"""Pictures the user hands the AI working on a task (the gallery card's menu, the image inspector's
✦): a user step with the pictures (shown on the timeline like the AI's own), which the AI gets as
a message (kind "pictures", ai_panels._collect) with each picture attached as a 512 px copy and
what made it in a few words (brief(): models, LoRAs, prompts, size, sampler; read from the
picture's own workflow by ai_run_map.py), so nothing needs describing. Pictures handed one after
another before the AI looked join one step. mark_gone() tells the page which of a task's
pictures were deleted since.
"""

import json
import os
import time
import uuid

from . import ai_run_map, ai_tasks
from .image_search import read_png_text
from .mcp_tools import ToolError, _resolve_image

MAX_PICTURES = 8


class PicturesError(ValueError):
    pass


def brief(path):
    """What made the picture at `path`, from its own workflow: {models, loras, positive, negative, size, sampler} or {}."""
    try:
        prompt = json.loads((read_png_text(path) if path.lower().endswith(".png") else {}).get("prompt") or "null")
        shape = ai_run_map.map_of(prompt) if isinstance(prompt, dict) else None
    except (OSError, ValueError):
        shape = None
    if not shape:
        return {}
    out = {}
    for box in shape["boxes"]:
        facts = box["facts"]
        if box["role"] == "model" and facts.get("file"):
            out.setdefault("models", []).append(facts["file"])
        elif box["role"] == "lora" and facts.get("file"):
            out.setdefault("loras", []).append(f"{facts['file']} ({facts.get('strength', '?')})")
        elif box["role"] == "prompt" and facts.get("text"):
            out.setdefault("negative" if facts.get("polarity") == "negative" else "positive", facts["text"])
        elif box["role"] == "sampler":
            out["sampler"] = {key: facts[key] for key in ("steps", "cfg", "sampler_name", "scheduler", "denoise") if key in facts}
        if facts.get("width") and "size" not in out:
            out["size"] = f"{facts['width']}x{facts['height']}"
    return out


def mark_gone(task):
    """Marks each output picture `task` shows (results, panels, marks) that is no longer in the output
    folder, deleted or moved: "gone": true, so the page says so instead of a broken picture."""
    root = ai_tasks.folder_paths.get_output_directory()

    def walk(value):
        if isinstance(value, dict):
            if value.get("folder") == "output" and value.get("filename") and \
                    not os.path.isfile(os.path.join(root, value.get("subfolder") or "", value["filename"])):
                value["gone"] = True
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk((task or {}).get("steps"))
    return task


def hand(task_id, images, text="", now=None):
    """Hands output pictures `images` ("subfolder/name.png") to task `task_id`'s AI. Returns the step."""
    if not isinstance(images, list) or not 1 <= len(images) <= MAX_PICTURES:
        raise PicturesError(f"Hand 1 to {MAX_PICTURES} pictures")
    pictures = []
    for image in images:
        try:
            rel = _resolve_image(image)[0]
        except ToolError as error:
            raise PicturesError(str(error))
        subfolder, _, filename = rel.rpartition("/")
        picture = {"type": "image", "folder": "output", "filename": filename, "subfolder": subfolder}
        if picture not in pictures:
            pictures.append(picture)
    now = time.time() if now is None else now
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        if not task or task.get("ended"):
            raise PicturesError("No such open task")
        last = task["steps"][-1] if task["steps"] else None
        if last and last.get("tool") == "user_pictures" and not last.get("delivered") and not text:
            step = last  # the AI has not looked yet: one step with all of them
            step["results"] = (step["results"] + [item for item in pictures if item not in step["results"]])[:MAX_PICTURES]
            step["at"] = now
        else:
            step = {"id": uuid.uuid4().hex[:10], "at": now, "ms": 0, "tool": "user_pictures", "kind": "user", "ok": True,
                    "state": "done", "summary": "user_pictures", "delivered": False, "results": pictures,
                    "text": ai_tasks._short(str(text or "").strip(), 1000)}
            task["steps"].append(step)
            del task["steps"][:-ai_tasks.MAX_STEPS]
        task["updated"] = max(task.get("updated", 0), now)
        ai_tasks._save(task)
    ai_tasks._notify(task_id)
    return step


def message_of(step):
    """The AI's message for a pictures step: the pictures' paths and what made each; their files go
    in "_pictures" for ai_marks.image_items to attach."""
    paths, briefs, files = [], [], []
    for item in step.get("results") or []:
        rel = "/".join(part for part in (item.get("subfolder"), item["filename"]) if part)
        try:
            path = _resolve_image(rel)[1]
        except ToolError:
            continue  # deleted since: the rest still go
        paths.append(rel)
        briefs.append({"image": rel, **brief(path)})
        files.append(path)
    words = step.get("text") or "The user handed you these pictures in Anomalous."
    return {"kind": "pictures", "text": words, "images": paths, "made_with": briefs, "_pictures": files}
