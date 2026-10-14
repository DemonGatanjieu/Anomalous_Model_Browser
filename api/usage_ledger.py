"""What each run used, kept from the day this started (the Tidy tab's "Not used lately").

ComfyUI keeps no lasting note of which nodes and models a run used: its history is gone after a
restart and its log names neither. So every prompt queued here passes `note_prompt` (ComfyUI's
on_prompt hook) on its way in, whether it makes an image, a sound, a video or nothing kept: its
node types and model files go into user/anomalous/usage_ledger.json, with when each was last
used and how often ({started, types: {type: [last, runs]}, models: {ref: [last, runs]}}).
It stays on this computer, is saved a few seconds after a run, and noting never stops a run.
"""

import json
import logging
import os
import threading
import time

import folder_paths

from .image_search import MODEL_FILE
from .path_utils import atomic_write_json

SAVE_DELAY = 5.0  # seconds after a run: several runs in a row are saved once
MAX_NAMES = 20_000  # per kind; the longest unused go first

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
        _ledger = {
            "started": data.get("started") if isinstance(data.get("started"), (int, float)) else None,
            "types": data.get("types") if isinstance(data.get("types"), dict) else {},
            "models": data.get("models") if isinstance(data.get("models"), dict) else {},
        }
    return _ledger


def _save():
    global _timer
    with _lock:
        _timer = None
        ledger = _load()
        for kind in ("types", "models"):
            if len(ledger[kind]) > MAX_NAMES:
                kept = sorted(ledger[kind].items(), key=lambda entry: entry[1][0], reverse=True)[:MAX_NAMES]
                ledger[kind] = dict(kept)
        snapshot = {"started": ledger["started"], "types": dict(ledger["types"]), "models": dict(ledger["models"])}
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


def note(prompt, when=None):
    """Note what `prompt` (ComfyUI's API prompt) uses, as of `when`; saved shortly after."""
    global _timer
    if not isinstance(prompt, dict):
        return
    when = time.time() if when is None else when
    types, models = prompt_uses(prompt)
    with _lock:
        ledger = _load()
        if ledger["started"] is None:
            ledger["started"] = when
        for kind, names in (("types", types), ("models", models)):
            for name in names:
                runs = ledger[kind].get(name, [0, 0])[1]
                ledger[kind][name] = [when, runs + 1]
        if _timer is None:
            _timer = threading.Timer(SAVE_DELAY, _save)
            _timer.daemon = True
            _timer.start()


def note_prompt(json_data):
    """ComfyUI's on_prompt hook: notes the run and hands the request on unchanged."""
    try:
        note((json_data or {}).get("prompt"))
    except Exception as error:  # noqa: BLE001 - a note must never stop a run
        logging.warning("[Anomalous Browser] Could not note a run's nodes and models: %s", error)
    return json_data


def read():
    """{started, types, models} as noted so far (a copy)."""
    with _lock:
        ledger = _load()
        return {"started": ledger["started"], "types": dict(ledger["types"]), "models": dict(ledger["models"])}
