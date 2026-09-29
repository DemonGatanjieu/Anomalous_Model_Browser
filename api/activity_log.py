"""Activity log: what Anomalous changed, newest first, kept in the ComfyUI user folder.

Two sources feed it. The middleware records this plugin's own write requests
(and Anomalous_TTS's) after they succeed: files such as models, covers, recipes,
materials, notes, presets, images and audio. The browser posts the canvas changes
it made (`POST /anomalous/activity`). Only the newest MAX_ENTRIES are kept and long
values are shortened, so the file stays small. Recording never fails a request:
the log is a convenience, not part of the action.
"""

import asyncio
import json
import logging
import os
import threading
import time
import uuid

from aiohttp import web
import folder_paths

from .path_utils import atomic_write_json

MAX_ENTRIES = 500
MAX_VALUE_CHARS = 400
MAX_CHANGES = 60

# Write routes worth a line in the log → the action id the browser has words for.
ROUTE_ACTIONS = {
    '/anomalous/delete_model': 'model_delete',
    '/anomalous/update_metadata': 'model_edit',
    '/anomalous/set_custom_cover': 'model_cover',
    '/anomalous/upload_custom_cover': 'model_cover',
    '/anomalous/clean_civitai_info': 'model_info_clean',
    '/anomalous/scan': 'scan',
    '/anomalous/scan_all': 'scan',
    '/anomalous/save_recipe': 'recipe_save',
    '/anomalous/update_recipe': 'recipe_edit',
    '/anomalous/delete_recipe': 'recipe_delete',
    '/anomalous/restore_recipe_version': 'recipe_restore',
    '/anomalous/set_recipe_gallery_cover': 'recipe_cover',
    '/anomalous/import_recipe_package_commit': 'recipe_import',
    '/anomalous/save_image_material': 'material_save',
    '/anomalous/save_parameter_material': 'material_save',
    '/anomalous/save_prompt_note_material': 'material_save',
    '/anomalous/save_prompt_plan': 'material_save',
    '/anomalous/update_material': 'material_edit',
    '/anomalous/delete_material': 'material_delete',
    '/anomalous/save_notebook': 'note_save',
    '/anomalous/delete_notebook': 'note_delete',
    '/anomalous/save_parameter': 'preset_save',
    '/anomalous/rename_parameter': 'preset_rename',
    '/anomalous/delete_parameter': 'preset_delete',
    '/anomalous/delete_gallery_image': 'image_delete',
    '/anomalous/delete_audio_gallery': 'audio_delete',
    '/anomalous/save_audio_preview': 'audio_save',
    '/anomalous/clear_cache': 'cache_clear',
    '/anomalous_tts/import/commit': 'voice_import',
    '/anomalous_tts/settings': 'voice_settings',
    '/anomalous_tts/storage': 'voice_storage',
}
# Request fields that name what was changed, in order of preference.
TARGET_FIELDS = ('name', 'character', 'filename', 'target_filename', 'recipe_filename',
                 'notebook_filename', 'new_name', 'path', 'file', 'target')

_lock = threading.RLock()
_entries = None


def log_path():
    user_dir = folder_paths.get_user_directory() if hasattr(folder_paths, 'get_user_directory') else None
    if not user_dir:
        user_dir = os.path.join(folder_paths.base_path, 'user')
    directory = os.path.join(user_dir, 'anomalous')
    os.makedirs(directory, exist_ok=True)
    return os.path.join(directory, 'activity_log.json')


def _load():
    global _entries
    if _entries is None:
        try:
            with open(log_path(), encoding='utf-8') as source:
                data = json.load(source)
            _entries = [entry for entry in data if isinstance(entry, dict)] if isinstance(data, list) else []
        except (OSError, ValueError):
            _entries = []
    return _entries


def _short(value):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text if len(text) <= MAX_VALUE_CHARS else text[:MAX_VALUE_CHARS] + '…'


def add_entry(source, action, target='', detail=None):
    """Append one entry (newest first) and save. Returns the entry."""
    entry = {
        'id': uuid.uuid4().hex[:12],
        'time': time.time(),
        'source': source,
        'action': action,
        'target': _short(target or ''),
    }
    if detail:
        entry['detail'] = detail
    with _lock:
        entries = _load()
        entries.insert(0, entry)
        del entries[MAX_ENTRIES:]
        atomic_write_json(log_path(), entries)
    return entry


def list_entries(limit=100, source=None):
    with _lock:
        entries = _load()
        picked = [entry for entry in entries if not source or entry.get('source') == source]
        return picked[:limit]


def clear():
    global _entries
    with _lock:
        _entries = []
        atomic_write_json(log_path(), [])


def _target_of(body):
    if not isinstance(body, dict):
        return ''
    for field in TARGET_FIELDS:
        value = body.get(field)
        if isinstance(value, str) and value.strip():
            return os.path.basename(value.strip().rstrip('/\\')) or value.strip()
    return ''


def _failed(response):
    """True when a response reports failure, including the 200 + {"status": "error"} style."""
    if response.status >= 300:
        return True
    if getattr(response, 'content_type', '') != 'application/json' or not getattr(response, 'body', None):
        return False
    try:
        data = json.loads(response.body)
    except (TypeError, ValueError):
        return False
    return isinstance(data, dict) and (data.get('success') is False or data.get('ok') is False
                                       or data.get('status') in ('error', 'failed'))


async def _request_body(request):
    """The body the handler already read (aiohttp caches it); {} when it was not JSON or a form."""
    try:
        if request.content_type == 'application/json':
            return await request.json()
        if request.content_type in ('multipart/form-data', 'application/x-www-form-urlencoded'):
            return dict(await request.post())
    except (ValueError, UnicodeDecodeError, RuntimeError):
        pass
    return {}


@web.middleware
async def activity_middleware(request, handler):
    response = await handler(request)
    action = ROUTE_ACTIONS.get(request.path) if request.method == 'POST' else None
    if action and not _failed(response):
        try:
            target = _target_of(await _request_body(request))
            await asyncio.get_running_loop().run_in_executor(None, add_entry, 'file', action, target)
        except Exception:  # noqa: BLE001 - the log must never fail the action it records
            logging.getLogger(__name__).warning('Anomalous activity log: could not record %s', request.path, exc_info=True)
    return response


def _clean_changes(changes):
    cleaned = []
    for change in changes[:MAX_CHANGES]:
        if not isinstance(change, dict):
            continue
        item = {key: _short(change[key]) for key in ('kind', 'node', 'type', 'widget', 'before', 'after')
                if key in change and change[key] is not None}
        if item.get('kind') in ('changed', 'added', 'removed', 'opened'):
            cleaned.append(item)
    return cleaned


async def api_get_activity(request):
    try:
        limit = max(1, min(MAX_ENTRIES, int(request.query.get('limit', '100'))))
    except ValueError:
        limit = 100
    source = request.query.get('source') or None
    entries = await asyncio.get_running_loop().run_in_executor(None, list_entries, limit, source)
    return web.json_response({'entries': entries})


async def api_post_activity(request):
    """Canvas changes from the browser: {changes: [...], total, workflow}."""
    try:
        body = await request.json()
    except ValueError:
        return web.json_response({'error': 'Invalid JSON body'}, status=400)
    if not isinstance(body, dict) or not isinstance(body.get('changes'), list):
        return web.json_response({'error': 'changes must be a list'}, status=400)
    changes = _clean_changes(body['changes'])
    if not changes:
        return web.json_response({'error': 'No recognizable changes'}, status=400)
    total = body.get('total') if isinstance(body.get('total'), int) else len(changes)
    detail = {'changes': changes, 'total': max(total, len(changes))}
    entry = await asyncio.get_running_loop().run_in_executor(
        None, add_entry, 'canvas', 'canvas', body.get('workflow') if isinstance(body.get('workflow'), str) else '', detail)
    return web.json_response({'entry': entry})


async def api_clear_activity(request):
    await asyncio.get_running_loop().run_in_executor(None, clear)
    return web.json_response({'ok': True})


def register_routes(app):
    if hasattr(app, 'middlewares') and activity_middleware not in app.middlewares:
        app.middlewares.append(activity_middleware)
    app.router.add_get('/anomalous/activity', api_get_activity)
    app.router.add_post('/anomalous/activity', api_post_activity)
    app.router.add_post('/anomalous/activity/clear', api_clear_activity)
