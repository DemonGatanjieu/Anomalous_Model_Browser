"""Model metadata, physical rename, deletion, and sidecar lifecycle."""

import json
import os
import shutil

from aiohttp import web

try:
    from ..model_policies import is_physical_rename_protected
except ImportError:
    from model_policies import is_physical_rename_protected
from .model_constants import (
    CIVITAI_BACKUP_SUFFIXES, MEDIA_EXTENSIONS, MODEL_EXTENSIONS,
    PREVIEW_SUFFIXES, SIDECAR_SUFFIXES,
)
from .model_catalog import _resolve_paths_to_model_info_sync
from .trash import move_to_trash, trash_failure
from .utils import atomic_write_json
try:
    from ..model_identity import USER_INFO_SUFFIX, read_json
except ImportError:
    from model_identity import USER_INFO_SUFFIX, read_json
from .utils import require_filename, resolve_folder_subdir, resolve_within

def _first_existing_sidecar(base_path, suffixes):
    for suffix in suffixes:
        candidate = f"{base_path}{suffix}"
        if os.path.isfile(candidate):
            return candidate, suffix
    return None, None


def _reset_model_cover(base_path):
    """Restore a recoverable cover without destroying the only existing image."""
    backup_path, backup_suffix = _first_existing_sidecar(base_path, CIVITAI_BACKUP_SUFFIXES)
    original_path, _ = _first_existing_sidecar(base_path, MEDIA_EXTENSIONS)
    preview_paths = [
        f"{base_path}{suffix}"
        for suffix in PREVIEW_SUFFIXES
        if os.path.isfile(f"{base_path}{suffix}")
    ]

    if backup_path:
        media_ext = backup_suffix[len('.civitai_bak'):]
        restored_path = f"{base_path}.preview{media_ext}"
        temp_path = f"{restored_path}.anomalous_tmp"
        try:
            # Copy first. If the backup cannot be read, the active custom cover
            # remains untouched. os.replace then makes the actual restore atomic.
            shutil.copy2(backup_path, temp_path)
            os.replace(temp_path, restored_path)
            move_to_trash(*[path for path in preview_paths if path != restored_path])
        except Exception as exc:
            try:
                if os.path.isfile(temp_path):
                    os.remove(temp_path)
            except OSError:
                pass
            return False, 'restore_failed', str(exc)
        return True, 'civitai_backup', None

    if original_path:
        try:
            move_to_trash(*preview_paths)
        except Exception as exc:
            return False, 'restore_failed', trash_failure(exc)
        return True, 'original_cover', None

    if preview_paths:
        # There is no recoverable source. Keep the current cover instead of
        # turning a harmless Reset click into irreversible image loss.
        return False, 'preserved_current', 'No Civitai backup or original cover exists.'

    return True, 'no_cover', None


async def api_delete_model(request):
    try:
        data = await request.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        return web.json_response({"status": "error", "message": "Invalid request body"}, status=400)
    try:
        folder_type = data.get('type', 'checkpoints')
        subfolder = data.get('subfolder', '/')
        filename = data.get('filename', '')
        try:
            path_idx = int(data.get('path_idx', 0))
        except:
            path_idx = 0
            
        try:
            filename = require_filename(filename)
            _, target_dir = resolve_folder_subdir(folder_type, path_idx, subfolder)
            model_path = resolve_within(target_dir, filename)
        except (ValueError, KeyError):
            return web.json_response({"status": "error", "message": "Invalid request parameters"}, status=400)
        if not os.path.exists(model_path):
            return web.json_response({"status": "error", "message": "Model file not found"})
            
        base_name = os.path.splitext(filename)[0]
        # Sidecars are keyed by stem, not by the main model extension. If a
        # second real model shares this stem, preserve the shared sidecars for
        # the survivor instead of treating that model as cleanup debris.
        shared_stem_in_use = any(
            os.path.isfile(os.path.join(target_dir, base_name + model_ext))
            for model_ext in MODEL_EXTENSIONS if base_name + model_ext != filename
        )
        sidecars = [] if shared_stem_in_use else [
            os.path.join(target_dir, base_name + suffix) for suffix in SIDECAR_SUFFIXES
        ]
        # The model and its covers and info go to the Recycle Bin together, or nothing moves.
        try:
            moved = move_to_trash(model_path, *sidecars)
        except Exception as e:
            return web.json_response({"status": "error", "message": trash_failure(e)})
        deleted_files = [os.path.basename(path) for path in moved]

        # 前端期待的成功状态是 "success" 而不是 "ok"
        return web.json_response({
            "status": "success",
            "deleted": deleted_files,
            "sidecars_preserved": shared_stem_in_use,
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)


async def api_update_metadata(request):
    try:
        data = await request.json()
        folder_type = data.get('type', 'checkpoints')
        subfolder = data.get('subfolder', '/')
        raw_filename = data.get('filename', '')
        custom_name = data.get('custom_name', '')
        custom_notes = data.get('custom_notes', '')
        custom_source_url = data.get('custom_source_url', None)
        physical_rename_requested = data.get('physical_rename', False)
        try: path_idx = int(data.get('path_idx', 0))
        except: path_idx = 0

        # Normalize filename and subfolder if directory separators are included
        extracted_filename = raw_filename
        if isinstance(raw_filename, str) and ('/' in raw_filename or '\\' in raw_filename):
            if subfolder in (None, '', '/'):
                extracted_sub = os.path.dirname(raw_filename).replace('\\', '/')
                if extracted_sub:
                    subfolder = '/' + extracted_sub.strip('/')
            extracted_filename = os.path.basename(raw_filename)

        file_path = None
        target_dir = None
        filename = extracted_filename
        try:
            filename = require_filename(extracted_filename)
            _, target_dir = resolve_folder_subdir(folder_type, path_idx, subfolder)
            file_path = resolve_within(target_dir, filename)
        except (ValueError, KeyError):
            pass

        if not file_path or not os.path.exists(file_path):
            # Fallback: attempt to locate model across known model directories
            search_keys = [k for k in [raw_filename, extracted_filename] if k and isinstance(k, str)]
            fallback_resolved = _resolve_paths_to_model_info_sync(search_keys)
            resolved_info = fallback_resolved.get(raw_filename) or fallback_resolved.get(extracted_filename)
            if resolved_info:
                resolved_path = resolved_info.get("file_path")
                if resolved_path and os.path.exists(resolved_path):
                    file_path = resolved_path
                    target_dir = os.path.dirname(file_path)
                    folder_type = resolved_info.get("type", folder_type)
                    path_idx = resolved_info.get("path_idx", path_idx)
                    filename = resolved_info.get("filename", filename)

        if not file_path or not os.path.exists(file_path):
            return web.json_response({"status": "error", "message": "Model not found"})

        physical_rename_skipped = physical_rename_requested and is_physical_rename_protected(
            folder_type=folder_type,
            folder_path=target_dir,
        )
        physical_rename = physical_rename_requested and not physical_rename_skipped
            
        base_name = os.path.splitext(file_path)[0]
        model_ext = os.path.splitext(file_path)[1]
        # The user's edits have a file of their own (<model>.anomalous.json): a scan never
        # writes it, and other tools that rewrite .civitai.info cannot lose them.
        user_file = base_name + USER_INFO_SUFFIX
        if os.path.exists(user_file) and read_json(user_file) is None:
            return web.json_response({"status": "error", "message": f"{os.path.basename(user_file)} is unreadable; nothing was changed."})
        user_data = read_json(user_file) or {"format": 1}
        if 'custom_name' in data:
            user_data["custom_name"] = str(custom_name)
        if 'custom_notes' in data:
            user_data["custom_notes"] = str(custom_notes)
        if custom_source_url is not None:
            user_data["source_url"] = str(custom_source_url).strip()
        
        reset_cover = data.get('reset_cover', False)
        cover_reset = None
        cover_reset_source = None
        cover_reset_warning = None
        if reset_cover:
            cover_reset, cover_reset_source, cover_reset_warning = _reset_model_cover(base_name)

        atomic_write_json(user_file, user_data)
            
        new_filename = filename
        
        if physical_rename and custom_name:
            import re
            safe_name = re.sub(r'[<>:"/\\|?*]', '_', custom_name).strip(' .')
            if not safe_name:
                return web.json_response({"status": "error", "message": "The physical filename cannot be empty."}, status=400)
            new_file_path = os.path.join(target_dir, f"{safe_name}{model_ext}")
            
            if new_file_path != file_path and not os.path.exists(new_file_path):
                os.rename(file_path, new_file_path)
                
                for suffix in SIDECAR_SUFFIXES:
                    old_sidecar = f"{base_name}{suffix}"
                    if os.path.isfile(old_sidecar):
                        os.rename(old_sidecar, os.path.join(target_dir, f"{safe_name}{suffix}"))

                new_filename = f"{safe_name}{model_ext}"
            elif os.path.exists(new_file_path) and new_file_path != file_path:
                return web.json_response({"status": "error", "message": "A file with the target physical name already exists."})
            
        response_data = {
            "status": "success",
            "new_filename": new_filename,
            "physical_rename_skipped": physical_rename_skipped,
        }
        if reset_cover:
            response_data.update({
                "cover_reset": cover_reset,
                "cover_reset_source": cover_reset_source,
                "cover_reset_warning": cover_reset_warning,
            })
        return web.json_response(response_data)
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})
