"""The user's choice to leave a model out of scans, or keep it in: POST /anomalous/scan_choice,
kept in each model's <model>.anomalous.json ("scan"; model_identity.scan_choice reads it). The
scan page asks it about new models that look like no drawing model; a model's details change it."""

import asyncio
import os

from aiohttp import web

from .local_guard import is_local as _is_local
from .path_utils import atomic_write_json, resolve_folder_subdir
from .utils import model_file_within

try:
    from ..model_identity import USER_INFO_SUFFIX, read_json
except ImportError:  # loaded outside the package (tests)
    from model_identity import USER_INFO_SUFFIX, read_json

MAX_CHOICE_FILES = 2000


def _set_scan_choice(targets, choice):
    """Writes the user's scan choice into each picked model's <model>.anomalous.json ("scan":
    "skip" or "scan"; "" removes it). `targets`: [{type, path_idx, subfolder, files}] as a scan
    takes them. Returns (models changed, file names left as they were: not found, not a
    .safetensors, or an unreadable .anomalous.json)."""
    if choice not in ("skip", "scan", "") or not isinstance(targets, list):
        raise ValueError("Invalid scan choice")
    picked = []
    for target in targets:
        names = target.get("files") if isinstance(target, dict) else None
        if not isinstance(names, list) or not all(isinstance(name, str) for name in names):
            raise ValueError("each target needs a list of file names")
        _, target_dir = resolve_folder_subdir(target.get("type"), int(target.get("path_idx", 0)), target.get("subfolder") or "/")
        picked += [(target_dir, name) for name in names]
    if len(picked) > MAX_CHOICE_FILES:
        raise ValueError("Too many models")
    changed, failed = 0, []
    for target_dir, name in picked:
        try:
            path = model_file_within(target_dir, name)
        except ValueError:
            failed.append(name)
            continue
        user_file = os.path.splitext(path)[0] + USER_INFO_SUFFIX
        user = read_json(user_file)
        if not name.endswith(".safetensors") or not os.path.isfile(path) or (user is None and os.path.exists(user_file)):
            failed.append(name)
            continue
        user = user or {"format": 1}
        if choice:
            user["scan"] = choice
        else:
            user.pop("scan", None)
        atomic_write_json(user_file, user)
        changed += 1
    return changed, failed


async def api_set_scan_choice(request):
    """POST /anomalous/scan_choice {targets, choice} - leave models out of scans ("skip"), keep
    them in ("scan"), or forget the choice (""). Only from this computer."""
    if not _is_local(request):
        return web.json_response({"status": "error", "message": "Only from this computer"}, status=403)
    try:
        data = await request.json()
        changed, failed = await asyncio.to_thread(_set_scan_choice, data.get("targets"), data.get("choice", ""))
    except (AttributeError, KeyError, TypeError, ValueError):
        return web.json_response({"status": "error", "message": "Invalid scan choice"}, status=400)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not save the choice"}, status=500)
    return web.json_response({"status": "success", "changed": changed, "failed": failed})
