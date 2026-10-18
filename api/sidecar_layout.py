"""Settings → Models → "Side files": where the files only this plugin uses sit beside each model
(model_sidecars.py), and putting the ones already there in place.

GET  /anomalous/sidecars/plan?layout=beside|hidden -> {layout, moves, duplicates, models}
    What putting them in `layout` would do over every model folder: side files to move, and
    Civitai pictures kept twice (a copy kept aside that is the cover as well) that can go.
POST /anomalous/sidecars/apply {layout} -> {layout, moved, deduped, failed: [names], more}
    Saves the setting first (new files go there at once), drops the extra Civitai copies to the
    Recycle Bin once the cover is noted as Civitai's, then moves each file, never over another:
    one that cannot move stays where it is and is still read there. Empty .amb folders go when
    the files move back beside the models. This computer only (a POST, local_guard.py).
"""

import asyncio
import json
import os

from aiohttp import web

from .backup import _models
from .path_utils import atomic_write_json
from .trash import move_to_trash, trash_failure

try:
    from .. import model_sidecars as sidecars
except ImportError:
    import model_sidecars as sidecars

FAILED_SHOWN = 20


def _work(layout):
    """(moves {from: to}, duplicates [(base, cover, copies kept aside)], models looked at)."""
    moves, duplicates, models = {}, {}, 0
    for _type, _root, path, _rel in _models():
        models += 1
        base = os.path.splitext(path)[0]
        for found, suffix in sidecars.existing(base, sidecars.OWN_SUFFIXES):
            wanted = sidecars.hidden_path(base, suffix) if layout == 'hidden' else base + suffix
            if found != wanted:
                moves[found] = wanted
        kept = sidecars.backups(base)
        if kept and base not in duplicates and sidecars.find(base, '.info'):
            covers = [base + suffix for suffix in sidecars.ACTIVE_COVER_SUFFIXES if os.path.isfile(base + suffix)]
            cover = next((c for c in covers if any(sidecars.same_file(c, copy) for copy in kept)), None)
            if cover:
                duplicates[base] = (cover, kept)
    return moves, duplicates, models


def plan(layout):
    moves, duplicates, models = _work(layout)
    dropped = {copy for _cover, kept in duplicates.values() for copy in kept}
    return {"layout": layout, "moves": len([path for path in moves if path not in dropped]),
            "duplicates": len(dropped), "models": models}


def _save_layout(layout):
    try:
        with open(sidecars.CONFIG_PATH, encoding='utf-8') as f:
            config = json.load(f)
    except (OSError, ValueError):
        config = {}
    if not isinstance(config, dict):
        config = {}
    config['SIDECAR_LAYOUT'] = layout
    atomic_write_json(sidecars.CONFIG_PATH, config)


def apply(layout):
    _save_layout(layout)
    moves, duplicates, _models_seen = _work(layout)
    failed = []
    dropped = []
    for base, (cover, kept) in duplicates.items():
        try:
            if sidecars.note_cover_hash(base, cover):
                dropped += kept
        except OSError as error:
            failed.append(f"{os.path.basename(base)}: {error}")
    deduped = 0
    if dropped:
        try:
            move_to_trash(*dropped)
            deduped = len(dropped)
        except Exception as error:  # noqa: BLE001 - kept, and said why
            failed.append(trash_failure(error))
    folders = set()
    moved = 0
    for source, destination in moves.items():
        if source in dropped or not os.path.isfile(source):
            continue
        try:
            if os.path.exists(destination):
                raise FileExistsError(os.path.basename(destination))
            if sidecars.is_hidden(destination):
                sidecars.make_hidden_dir(os.path.dirname(os.path.dirname(destination)))
            os.replace(source, destination)
            moved += 1
            folders.add(os.path.dirname(source))
        except OSError as error:
            failed.append(f"{os.path.basename(source)}: {error}")
    for folder in folders:
        if os.path.basename(folder) == sidecars.HIDDEN_DIR:
            sidecars.drop_empty_hidden_dir(os.path.dirname(folder))
    return {"layout": layout, "moved": moved, "deduped": deduped,
            "failed": failed[:FAILED_SHOWN], "more": max(0, len(failed) - FAILED_SHOWN)}


def _layout_of(value):
    return value if value in sidecars.LAYOUTS else None


async def api_plan(request):
    layout = _layout_of(request.query.get('layout'))
    if not layout:
        return web.json_response({"error": "bad_layout"}, status=400)
    return web.json_response(await asyncio.to_thread(plan, layout))


async def api_apply(request):
    try:
        data = await request.json()
    except ValueError:
        data = None
    layout = _layout_of(data.get('layout')) if isinstance(data, dict) else None
    if not layout:
        return web.json_response({"error": "bad_layout"}, status=400)
    return web.json_response(await asyncio.to_thread(apply, layout))


def register_routes(app):
    app.router.add_get('/anomalous/sidecars/plan', api_plan)
    app.router.add_post('/anomalous/sidecars/apply', api_apply)
