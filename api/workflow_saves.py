"""Saves of a workflow (the bar under the canvas, web/modules/ui_snapshot_bar.js): whole workflows kept
while the user works on one, a group for each canvas. A group is a folder of the store, named by the key
the workflow carries in its extra: index.json says what its saves are and each save's workflow is a file of
its own, so keeping one writes that file and a small index. Saves outlive their canvas: a closed tab or a
deleted file leaves them here, and only the user removes them, to the Recycle Bin. The page names a save's
runs (prompt ids); reading the group finds their pictures in ComfyUI's history and keeps the names, so a
page reloaded during a run loses nothing. It keeps them by output node too, previews as well: going back to
a save puts them on those nodes. Pictures stay where ComfyUI saved them; one gone is not shown.
A save becomes something else only as a workflow card, made by the page from its workflow (AD-023)."""

import asyncio
import json
import os
import re
import threading
import time
import uuid

import folder_paths
from aiohttp import web

from .path_utils import atomic_write_json, resolve_within
from .recipe_constants import MAX_RECIPE_BYTES
from .trash import TrashUnavailable, move_to_trash, trash_failure

INDEX = "index.json"
MAX_SAVES = 50  # of a group: past that the user removes some, nothing goes by itself
MAX_GROUPS = 2000  # read for a list
MAX_PICTURES = 200  # kept of a save, the newest
MAX_ON_NODE = 16  # of an output node at a save, the newest: a full round of runs
MAX_CHANGES = 40
MAX_RUNS = 16  # of a save at a time; web/modules/snapshot_plan.js MAX_COUNT
MAX_WAITING = 200
KEY = re.compile(r"^[0-9a-f-]{8,40}$")
SAVE_ID = re.compile(r"^[0-9a-f]{12}$")
PICTURES = (".png", ".jpg", ".jpeg", ".webp")
FULL = f"这个工作流的存档满了（最多 {MAX_SAVES} 个），删掉一些再存 / This workflow has {MAX_SAVES} saves, the most it takes: remove some first."

_lock = threading.Lock()


class SavesFull(Exception):
    pass


def saves_dir():
    return os.path.join(folder_paths.get_user_directory(), "workflows", "anomalous_saves")


def _folder(key):
    if not isinstance(key, str) or not KEY.match(key):
        raise ValueError("Invalid key")
    return os.path.join(saves_dir(), key)


def _workflow_file(key, save_id):
    if not isinstance(save_id, str) or not SAVE_ID.match(save_id):
        raise ValueError("Invalid save")
    return os.path.join(_folder(key), f"{save_id}.json")


def _read(key):
    try:
        with open(os.path.join(_folder(key), INDEX), encoding="utf-8") as file:
            return json.load(file)
    except FileNotFoundError:
        return None


def _write(group):
    group["updated"] = time.time()
    atomic_write_json(os.path.join(_folder(group["key"]), INDEX), group)


def _groups():
    root = saves_dir()
    if not os.path.isdir(root):
        return []
    found = []
    for name in sorted(os.listdir(root))[:MAX_GROUPS]:
        try:
            group = _read(name) if KEY.match(name) else None
        except (OSError, ValueError):
            continue
        if group:
            found.append(group)
    return found


def _save_of(group, save_id):
    for save in (group or {}).get("saves") or []:
        if save["id"] == save_id:
            return save
    raise LookupError("No such save")


def _queue():
    from server import PromptServer
    return PromptServer.instance.prompt_queue


def _run_outputs(record):
    """The pictures of a finished run by the node that shows them: {node: pictures}."""
    found = {}
    for node, output in (record.get("outputs") or {}).items():
        pictures = [{"filename": image["filename"], "subfolder": image.get("subfolder") or "", "type": image.get("type") or "output"}
                    for image in output.get("images") or [] if str(image.get("filename") or "").lower().endswith(PICTURES)]
        if pictures:
            found[str(node)] = pictures
    return found


def _run_pictures(record):
    """What a finished run made: the pictures it saved, or with none saved those it previewed."""
    found = [picture for pictures in _run_outputs(record).values() for picture in pictures]
    return [picture for picture in found if picture["type"] == "output"] or found


def _collect(group):
    """Moves the pictures of finished runs into their saves; whether anything changed. The queue is asked
    first: a run leaves it straight into the history, so one in neither was taken off the queue or went
    with a restart, and is forgotten."""
    if not any(save["waiting"] for save in group["saves"]):
        return False
    running, pending = _queue().get_current_queue()
    queued = {item[1] for item in [*running, *pending]}
    changed = False
    for save in group["saves"]:
        for run in list(save["waiting"]):
            if run["id"] in queued:
                continue
            record = _queue().get_history(prompt_id=run["id"]).get(run["id"])
            save["pictures"].extend(picture for picture in _run_pictures(record or {}) if picture not in save["pictures"])
            del save["pictures"][:-MAX_PICTURES]
            for node, pictures in _run_outputs(record or {}).items():
                on_node = save.setdefault("outputs", {}).setdefault(node, [])
                on_node.extend(picture for picture in pictures if picture not in on_node)
                del on_node[:-MAX_ON_NODE]
            save["waiting"].remove(run)
            changed = True
    return changed


def _there(picture):
    folder = folder_paths.get_directory_by_type(picture["type"])
    if not folder:
        return False
    try:
        return os.path.isfile(resolve_within(folder, picture["subfolder"], picture["filename"]))
    except ValueError:
        return False


def _view(group):
    """A group as the page shows it."""
    saves = [{"id": save["id"], "at": save["at"], "count": save["count"], "changes": save["changes"],
              "pictures": [picture for picture in save["pictures"] if _there(picture)], "running": len(save["waiting"])}
             for save in group["saves"]]
    return {"key": group["key"], "title": group.get("title") or "", "path": group.get("path") or "", "saves": saves}


def _outputs(save):
    """What a save's output nodes made, the newest first: no picture that is gone, no node left without one."""
    shown = {node: [picture for picture in reversed(pictures) if _there(picture)] for node, pictures in (save.get("outputs") or {}).items()}
    return {node: pictures for node, pictures in shown.items() if pictures}


def read_group(key, path=""):
    """The group of `key`, or the newest one of the workflow file `path`; None when there is none."""
    with _lock:
        group = _read(key) if key else None
        if group is None and path:
            group = max((item for item in _groups() if item.get("path") == path), key=lambda item: item["updated"], default=None)
        if group is None:
            return None
        if _collect(group):
            _write(group)
        shown = _view(group)
        for view, save in zip(shown["saves"], group["saves"]):
            view["outputs"] = _outputs(save)
        return shown


def list_groups():
    """Every group, the newest first: what it is called and its newest picture."""
    with _lock:
        groups = sorted(_groups(), key=lambda item: item["updated"], reverse=True)
    listed = []
    for group in groups:
        shown = _view(group)
        pictures = [picture for save in shown["saves"] for picture in save["pictures"]]
        listed.append({"key": shown["key"], "title": shown["title"], "path": shown["path"], "updated": group["updated"],
                       "count": len(shown["saves"]), "cover": pictures[-1] if pictures else None})
    return listed


def add_save(key, workflow, title, path, changes):
    with _lock:
        group = _read(key) or {"key": key, "created": time.time(), "saves": []}
        if len(group["saves"]) >= MAX_SAVES:
            raise SavesFull()
        save_id = uuid.uuid4().hex[:12]
        os.makedirs(_folder(key), exist_ok=True)
        atomic_write_json(_workflow_file(key, save_id), workflow, MAX_RECIPE_BYTES)
        group["saves"].append({"id": save_id, "at": time.time(), "count": 1, "changes": changes, "pictures": [], "waiting": []})
        group.update(title=title, path=path)
        _write(group)
        return _view(group)


def read_workflow(key, save_id):
    with open(_workflow_file(key, save_id), encoding="utf-8") as file:
        return json.load(file)


def set_count(key, save_id, count):
    with _lock:
        group = _read(key)
        _save_of(group, save_id)["count"] = max(1, min(MAX_RUNS, int(count)))
        _write(group)
        return _view(group)


def note_runs(key, save_id, prompt_ids):
    with _lock:
        group = _read(key)
        save = _save_of(group, save_id)
        save["waiting"].extend({"id": str(prompt_id)} for prompt_id in prompt_ids)
        del save["waiting"][:-MAX_WAITING]
        _write(group)
        return _view(group)


def remove_save(key, save_id, next_changes=None):
    """Moves the save to the Recycle Bin; the group as it stands then, None when that was its last.
    `next_changes`: what the save after it changes from the one it now follows."""
    with _lock:
        group = _read(key)
        save = _save_of(group, save_id)
        move_to_trash(_workflow_file(key, save_id))
        at = group["saves"].index(save)
        group["saves"].remove(save)
        if next_changes is not None and at < len(group["saves"]):
            group["saves"][at]["changes"] = next_changes
        if group["saves"]:
            _write(group)
            return _view(group)
        os.remove(os.path.join(_folder(key), INDEX))  # our own list of nothing
        os.rmdir(_folder(key))
        return None


def remove_group(key):
    """Moves a whole group to the Recycle Bin."""
    with _lock:
        if _read(key) is None:
            raise LookupError("No such group")
        move_to_trash(_folder(key))


def _changes(value):
    """What the page says changed from the save before, short strings only."""
    if not isinstance(value, list):
        return []
    return [{str(name)[:40]: str(text)[:200] for name, text in item.items()} for item in value[:MAX_CHANGES] if isinstance(item, dict)]


async def _answer(work, *args):
    """`work` off the event loop, its answer as JSON; what went wrong as a line for the page."""
    try:
        return web.json_response(await asyncio.to_thread(work, *args))
    except SavesFull:
        return web.json_response({"message": FULL}, status=409)
    except (TrashUnavailable, OSError) as error:
        return web.json_response({"message": trash_failure(error)}, status=500)
    except (LookupError, TypeError, ValueError) as error:
        return web.json_response({"message": str(error)}, status=400)


async def _body(request):
    try:
        body = await request.json()
    except ValueError:
        body = None
    return body if isinstance(body, dict) else {}


async def api_group(request):
    """GET /anomalous/saves/group?key&path - the open canvas's saves."""
    query = request.query
    return await _answer(lambda: {"group": read_group(query.get("key") or "", query.get("path") or "")})


async def api_list(request):
    """GET /anomalous/saves - every group."""
    return await _answer(lambda: {"groups": list_groups()})


async def api_workflow(request):
    """GET /anomalous/saves/workflow?key&id - one save's whole workflow."""
    query = request.query
    return await _answer(lambda: {"workflow": read_workflow(query.get("key"), query.get("id"))})


async def api_add(request):
    """POST /anomalous/saves/add {key, workflow, title, path, changes}."""
    body = await _body(request)
    if not isinstance(body.get("workflow"), dict):
        return web.json_response({"message": "Expected a workflow"}, status=400)
    title, path = str(body.get("title") or "")[:200], str(body.get("path") or "")[:1024]
    return await _answer(lambda: {"group": add_save(body.get("key"), body["workflow"], title, path, _changes(body.get("changes")))})


async def api_update(request):
    """POST /anomalous/saves/update {key, id, count}."""
    body = await _body(request)
    return await _answer(lambda: {"group": set_count(body.get("key"), body.get("id"), body.get("count"))})


async def api_ran(request):
    """POST /anomalous/saves/ran {key, id, prompt_ids}: runs of a save just queued."""
    body = await _body(request)
    return await _answer(lambda: {"group": note_runs(body.get("key"), body.get("id"), list(body.get("prompt_ids") or []))})


async def api_remove(request):
    """POST /anomalous/saves/remove {key, id, changes}."""
    body = await _body(request)
    changes = None if body.get("changes") is None else _changes(body["changes"])
    return await _answer(lambda: {"group": remove_save(body.get("key"), body.get("id"), changes)})


async def api_remove_group(request):
    """POST /anomalous/saves/remove_group {key}."""
    body = await _body(request)
    return await _answer(lambda: remove_group(body.get("key")) or {"removed": True})
