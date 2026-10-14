"""What each run used and each opened workflow held, kept from the day this started (the Tidy
tab's "Not used lately").

ComfyUI keeps no lasting note of which nodes and models a run used: its history is gone after a
restart and its log names neither. So every prompt queued here passes `note_prompt` (ComfyUI's
on_prompt hook) on its way in, whether it makes an image, a sound, a video or nothing kept, and
the page posts what a workflow holds when it is opened (POST /anomalous/usage/opened {types,
models}, usage_notes.js; this computer only). Node types and model files go into
user/anomalous/usage_ledger.json with when each was last used and how often:
{started, types: {type: [last, runs]}, models: {ref: [last, runs]},
 opened: {types: {type: [last, times]}, models: {ref: [last, times]}}}.
It stays on this computer, is saved a few seconds after a note, and noting never stops a run.
"""

import json
import logging
import os
import threading
import time

import folder_paths
from aiohttp import web

from .image_search import MODEL_FILE
from .path_utils import atomic_write_json

SAVE_DELAY = 5.0  # seconds after a note: several in a row are saved once
MAX_NAMES = 20_000  # per kind; the longest unused go first
MAX_POSTED = 5_000  # names one opened workflow may post, per kind
MAX_NAME_CHARS = 512

_lock = threading.Lock()
_ledger = None
_timer = None


def ledger_path():
    user_dir = folder_paths.get_user_directory() if hasattr(folder_paths, "get_user_directory") else None
    if not user_dir:
        user_dir = os.path.join(folder_paths.base_path, "user")
    directory = os.path.join(user_dir, "anomalous")
    os.makedirs(directory, exist_ok=True)
    return os.path.join(directory, "usage_ledger.json")


def _names(data):
    """{type or ref: [last, count]} from the saved file, {} when it is not one."""
    return data if isinstance(data, dict) else {}


def _load():
    global _ledger
    if _ledger is None:
        data = {}
        try:
            with open(ledger_path(), encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            pass
        if not isinstance(data, dict):
            data = {}
        opened = data.get("opened") if isinstance(data.get("opened"), dict) else {}
        _ledger = {
            "started": data.get("started") if isinstance(data.get("started"), (int, float)) else None,
            "types": _names(data.get("types")),
            "models": _names(data.get("models")),
            "opened": {"types": _names(opened.get("types")), "models": _names(opened.get("models"))},
        }
    return _ledger


def _copy(ledger):
    return {"started": ledger["started"], "types": dict(ledger["types"]), "models": dict(ledger["models"]),
            "opened": {kind: dict(ledger["opened"][kind]) for kind in ("types", "models")}}


def _save():
    global _timer
    with _lock:
        _timer = None
        ledger = _load()
        for names in (ledger, ledger["opened"]):
            for kind in ("types", "models"):
                if len(names[kind]) > MAX_NAMES:
                    names[kind] = dict(sorted(names[kind].items(), key=lambda entry: entry[1][0], reverse=True)[:MAX_NAMES])
        snapshot = _copy(ledger)
    try:
        atomic_write_json(ledger_path(), snapshot)
    except (OSError, ValueError) as error:
        logging.warning("[Anomalous Browser] Could not save the usage record: %s", error)


def prompt_uses(prompt):
    """(node types, model file references) a queued prompt names."""
    types, models = set(), set()
    for node in prompt.values():
        if not isinstance(node, dict):
            continue
        if isinstance(node.get("class_type"), str) and node["class_type"]:
            types.add(node["class_type"])
        for value in (node.get("inputs") or {}).values():
            if isinstance(value, dict) and isinstance(value.get("lora"), str):
                value = value["lora"]  # a row of rgthree's Power Lora Loader
            if isinstance(value, str) and MODEL_FILE.search(value):
                models.add(value.replace("\\", "/").strip().lower())
    return types, models


def _note(types, models, when, opened):
    """Counts `types` and `models` as used at `when`, among the runs or the opened workflows."""
    global _timer
    with _lock:
        ledger = _load()
        if ledger["started"] is None:
            ledger["started"] = when
        names = ledger["opened"] if opened else ledger
        for kind, found in (("types", types), ("models", models)):
            for name in found:
                count = names[kind].get(name, [0, 0])[1]
                names[kind][name] = [when, count + 1]
        if _timer is None:
            _timer = threading.Timer(SAVE_DELAY, _save)
            _timer.daemon = True
            _timer.start()


def note(prompt, when=None):
    """Note what `prompt` (ComfyUI's API prompt) uses, as of `when`; saved shortly after."""
    if not isinstance(prompt, dict):
        return
    types, models = prompt_uses(prompt)
    _note(types, models, time.time() if when is None else when, opened=False)


def note_prompt(json_data):
    """ComfyUI's on_prompt hook: notes the run and hands the request on unchanged."""
    try:
        note((json_data or {}).get("prompt"))
    except Exception as error:  # noqa: BLE001 - a note must never stop a run
        logging.warning("[Anomalous Browser] Could not note a run's nodes and models: %s", error)
    return json_data


def _posted(values):
    """The names of a posted list: strings of a sane length, at most MAX_POSTED; None when not a list."""
    if not isinstance(values, list):
        return None
    return {value for value in values[:MAX_POSTED] if isinstance(value, str) and 0 < len(value) <= MAX_NAME_CHARS}


async def api_opened(request):
    try:
        data = await request.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        return web.json_response({"error": "bad_request"}, status=400)
    types, models = _posted(data.get("types")), _posted(data.get("models"))
    if types is None or models is None:
        return web.json_response({"error": "bad_request"}, status=400)
    models = {model.replace("\\", "/").strip().lower() for model in models if MODEL_FILE.search(model)}
    _note(types, models, time.time(), opened=True)
    return web.json_response({"noted": len(types) + len(models)})


def read():
    """The record as noted so far (a copy), shaped as the module docstring says."""
    with _lock:
        return _copy(_load())


def register_routes(app):
    app.router.add_post("/anomalous/usage/opened", api_opened)
