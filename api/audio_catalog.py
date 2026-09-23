"""Audio and Voice catalog scanning, voice ingestion, and streaming service.

Voice files follow the ComfyUI-F5-TTS multi-voice layout: `Character.wav` +
`Character.txt` is the main sample, `Character.<voice>.wav` + `.txt` are the
variants addressed as `{<voice>}` in the speech text. An optional
`<stem>.orig.txt` keeps the native-script transcript for display.
"""

import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from urllib.parse import quote

import folder_paths
from aiohttp import web

from .audio_metadata import generation_info
from .path_utils import resolve_within

AUDIO_EXTENSIONS = {'.wav', '.mp3', '.flac', '.ogg', '.opus', '.m4a'}
AUDIO_CONTENT_TYPES = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.m4a': 'audio/mp4',
}
AUDIO_ROOTS = {
    "input": lambda: folder_paths.get_input_directory(),
    "output": lambda: folder_paths.get_output_directory(),
    "temp": lambda: folder_paths.get_temp_directory(),
}
PREVIEW_LIMIT = 30
SAVED_PREVIEW_SUBFOLDER = "audio"
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
FFMPEG_TIMEOUT_SECONDS = 120
VOICE_SCAN_SUBDIRS = ("F5-TTS", "audio", "")
DEFAULT_VOICE_SUBFOLDER = "F5-TTS"
MAIN_VOICE = "main"
RESERVED_VOICE_NAMES = {"orig"}
WORKFLOW_TEMPLATE_NAME = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
# Revalidate instead of forbidding caches: overwritten voices get a new ?v=mtime URL.
AUDIO_CACHE_HEADERS = {"Cache-Control": "no-cache"}


def _audio_url(rel_path, dir_type="input", version=None):
    url = f"/anomalous/audio_stream?path={quote(rel_path, safe='/')}"
    if dir_type != "input":
        url += f"&type={dir_type}"
    if version is not None:
        url += f"&v={int(version)}"
    return url


def parse_voice_name(filename):
    """Split a voice file name the way ComfyUI-F5-TTS does.

    `Arona.wav` is the main voice of Arona; `Arona.happy.wav` is the `{happy}`
    variant that F5-TTS loads beside a selected `Arona.wav` sample.
    """
    stem, _ = os.path.splitext(filename)
    main_stem, sep, voice = stem.partition('.')
    return main_stem, (voice if sep and voice else MAIN_VOICE)


def _read_text_file(path):
    try:
        with open(path, 'r', encoding='utf-8-sig', errors='ignore') as f:
            return f.read().strip()
    except OSError:
        return ""


def _read_associated_text(audio_path):
    """Return (display_text, synthesis_text); .orig.txt holds the native script when present."""
    stem, _ = os.path.splitext(audio_path)
    synthesis = _read_text_file(stem + '.txt') if os.path.isfile(stem + '.txt') else ""
    original = _read_text_file(stem + '.orig.txt') if os.path.isfile(stem + '.orig.txt') else ""
    return (original or synthesis), synthesis


def _slice_record(directory, name, relative_prefix):
    full_path = os.path.join(directory, name)
    stem, ext = os.path.splitext(name)
    main_stem, voice = parse_voice_name(name)
    display_text, synthesis_text = _read_associated_text(full_path)
    stat = os.stat(full_path)
    rel_path = "/".join(part for part in (relative_prefix, name) if part)
    return {
        "id": stem,
        "filename": name,
        "extension": ext.lower(),
        "relative_path": rel_path,
        "folder": relative_prefix,
        "group": "/".join(part for part in (relative_prefix, main_stem) if part),
        "character": main_stem,
        "emotion": voice,
        "is_main": voice == MAIN_VOICE,
        "text": display_text,
        "synthesis_text": synthesis_text,
        # ComfyUI-F5-TTS only lists and loads samples that have a .txt transcript.
        "has_transcript": os.path.isfile(os.path.join(directory, stem + '.txt')),
        "size_bytes": stat.st_size,
        "syntax_tag": f"{{{voice}}}",
        "audio_url": _audio_url(rel_path, "input", stat.st_mtime),
    }


def _scan_single_audio_dir(directory, relative_prefix=""):
    """Scan one directory for audio files, preferring .wav when several share a stem."""
    if not os.path.isdir(directory):
        return []
    try:
        entries = sorted(os.listdir(directory))
    except OSError:
        return []

    chosen = {}
    for name in entries:
        stem, ext = os.path.splitext(name)
        ext = ext.lower()
        if ext not in AUDIO_EXTENSIONS or not os.path.isfile(os.path.join(directory, name)):
            continue
        if stem in chosen and chosen[stem][1] == '.wav':
            continue
        chosen[stem] = (name, ext)

    slices = []
    for name, _ in chosen.values():
        try:
            slices.append(_slice_record(directory, name, relative_prefix))
        except OSError:
            continue
    return slices


def _group_voice_slices(all_slices):
    """One group per F5-TTS main sample: `<folder>/<Character>` plus its `.variant` files."""
    groups = {}
    for s in all_slices:
        group = groups.setdefault(s["group"], {
            "group": s["group"],
            "character": s["character"],
            "folder": s["folder"],
            "main_relative_path": None,
            "slices": [],
            "total_slices": 0,
        })
        group["slices"].append(s)
        group["total_slices"] += 1
        if s["is_main"]:
            group["main_relative_path"] = s["relative_path"]

    for group in groups.values():
        main = next((s for s in group["slices"] if s["is_main"]), None)
        group["has_main"] = main is not None
        group["slices"].sort(key=lambda s: (not s["is_main"], s["emotion"]))
        for s in group["slices"]:
            # F5-TTS builds variant paths with the main sample's extension.
            s["tag_usable"] = bool(main and s["has_transcript"] and main["has_transcript"]
                                   and (s["is_main"] or s["extension"] == main["extension"]))
    return list(groups.values())


def _collect_voice_slices(input_dir):
    """Scan the folders ComfyUI-F5-TTS lists samples from."""
    all_slices = []
    for sub in VOICE_SCAN_SUBDIRS:
        all_slices.extend(_scan_single_audio_dir(os.path.join(input_dir, sub) if sub else input_dir, sub))
    return all_slices


async def api_get_audio_voices(request):
    """GET /anomalous/audio_voices - Return voice groups (main sample plus variants)."""
    all_slices = await asyncio.to_thread(_collect_voice_slices, folder_paths.get_input_directory())
    return web.json_response({
        "success": True,
        "characters": _group_voice_slices(all_slices),
        "total_slices": len(all_slices),
    })


async def api_serve_audio(request):
    """GET /anomalous/audio_stream?path=...&type=input|output|temp - Stream an audio file."""
    rel_path = request.query.get("path", "").strip("/\\")
    dir_type = request.query.get("type", "input")
    if not rel_path:
        return web.Response(status=400, text="Missing audio path")
    if dir_type not in AUDIO_ROOTS:
        return web.Response(status=400, text="Unknown audio folder")

    base_dir = AUDIO_ROOTS[dir_type]()
    try:
        resolved_path = resolve_within(base_dir, rel_path)
    except ValueError:
        return web.Response(status=403, text="Forbidden path")

    ext = os.path.splitext(resolved_path)[1].lower()
    if ext not in AUDIO_EXTENSIONS:
        return web.Response(status=415, text="Not an audio file")
    if not os.path.isfile(resolved_path):
        return web.Response(status=404, text="Audio file not found")

    return web.FileResponse(resolved_path, headers={"Content-Type": AUDIO_CONTENT_TYPES[ext], **AUDIO_CACHE_HEADERS})


def _collect_audio_files(root_dir, dir_type):
    """Scan a folder tree for audio files, newest first."""
    audios = []
    if not os.path.isdir(root_dir):
        return audios

    for root, _, files in os.walk(root_dir):
        for name in files:
            if os.path.splitext(name)[1].lower() not in AUDIO_EXTENSIONS:
                continue
            try:
                stat = os.stat(os.path.join(root, name))
            except OSError:
                continue
            subfolder = os.path.relpath(root, root_dir)
            clean_sub = "" if subfolder == "." else subfolder.replace(os.sep, '/')
            rel_path = "/".join(part for part in (clean_sub, name) if part)
            audios.append({
                "filename": name,
                "subfolder": clean_sub,
                "size_bytes": stat.st_size,
                "mtime": stat.st_mtime,
                "audio_url": _audio_url(rel_path, dir_type, stat.st_mtime),
            })
    audios.sort(key=lambda a: a["mtime"], reverse=True)
    return audios


_info_cache = {}


def _cached_generation_info(path, mtime, size):
    """Generation info keyed by (mtime, size) so unchanged files are parsed once."""
    cached = _info_cache.get(path)
    if cached and cached[0] == (mtime, size):
        return cached[1]
    info = generation_info(path)
    if len(_info_cache) > 5000:
        _info_cache.clear()
    _info_cache[path] = ((mtime, size), info)
    return info


def _attach_generation_info(root_dir, items):
    for item in items:
        path = os.path.join(root_dir, item["subfolder"], item["filename"])
        item["generation"] = _cached_generation_info(path, item["mtime"], item["size_bytes"])
    return items


def _search_text(item):
    speech = (item.get("generation") or {}).get("speech") or ""
    return f"{item['subfolder']}/{item['filename']}\n{speech}".lower()


def _gallery_page(output_dir, page, limit, query):
    all_audios = _collect_audio_files(output_dir, "output")
    if query:
        # Searching reads every file's comments once; the cache keeps later searches cheap.
        _attach_generation_info(output_dir, all_audios)
        all_audios = [item for item in all_audios if query in _search_text(item)]
    total = len(all_audios)
    start = (page - 1) * limit
    items = all_audios[start:start + limit]
    if not query:
        _attach_generation_info(output_dir, items)
    return items, total, start + limit < total


def _positive_int(value, default, maximum=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    number = max(1, number)
    return min(maximum, number) if maximum else number


async def api_get_audio_gallery(request):
    """GET /anomalous/audio_gallery?page=1&limit=50&q=text - Generated audio in output, with the speech that produced it."""
    page = _positive_int(request.query.get("page"), 1)
    limit = _positive_int(request.query.get("limit"), 40, 100)
    query = request.query.get("q", "").strip().lower()

    items, total, has_more = await asyncio.to_thread(_gallery_page, folder_paths.get_output_directory(), page, limit, query)
    return web.json_response({
        "success": True,
        "audios": items,
        "total": total,
        "page": page,
        "has_more": has_more,
    })


def _list_previews(temp_dir):
    items = _collect_audio_files(temp_dir, "temp")[:PREVIEW_LIMIT]
    return _attach_generation_info(temp_dir, items)


async def api_get_audio_previews(request):
    """GET /anomalous/audio_previews - Unsaved preview audio in ComfyUI's temp folder (cleared on restart)."""
    items = await asyncio.to_thread(_list_previews, folder_paths.get_temp_directory())
    return web.json_response({"success": True, "audios": items})


def _save_preview(temp_dir, output_dir, subfolder, filename):
    source = resolve_within(temp_dir, subfolder, filename)
    ext = os.path.splitext(filename)[1].lower()
    if ext not in AUDIO_EXTENSIONS:
        raise ValueError("Only audio files can be saved")
    if not os.path.isfile(source):
        raise FileNotFoundError(filename)

    dest_dir = resolve_within(output_dir, SAVED_PREVIEW_SUBFOLDER)
    os.makedirs(dest_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(os.path.getmtime(source)))
    for counter in range(1, 1000):
        name = f"Preview_{stamp}_{counter:02}{ext}"
        target = os.path.join(dest_dir, name)
        try:
            # O_EXCL: never overwrite an existing file in the library.
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0))
        except FileExistsError:
            continue
        try:
            with os.fdopen(fd, "wb") as out, open(source, "rb") as src:
                shutil.copyfileobj(src, out)
        except Exception:
            try:
                os.remove(target)
            except OSError:
                pass
            raise
        stat = os.stat(target)
        rel_path = f"{SAVED_PREVIEW_SUBFOLDER}/{name}"
        item = {
            "filename": name,
            "subfolder": SAVED_PREVIEW_SUBFOLDER,
            "size_bytes": stat.st_size,
            "mtime": stat.st_mtime,
            "audio_url": _audio_url(rel_path, "output", stat.st_mtime),
        }
        return _attach_generation_info(output_dir, [item])[0]
    raise FileExistsError("No free file name")


async def api_save_audio_preview(request):
    """POST /anomalous/save_audio_preview {filename, subfolder} - Copy a temp preview into output/audio."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "Invalid JSON payload"}, status=400)
    filename = str(data.get("filename", "")).strip()
    subfolder = str(data.get("subfolder", "")).strip().strip("/\\")
    if not filename or os.path.basename(filename) != filename:
        return web.json_response({"success": False, "error": "Invalid filename"}, status=400)
    try:
        item = await asyncio.to_thread(
            _save_preview, folder_paths.get_temp_directory(), folder_paths.get_output_directory(), subfolder, filename)
    except ValueError as e:
        return web.json_response({"success": False, "error": str(e)}, status=403)
    except FileNotFoundError:
        return web.json_response({"success": False, "code": "missing", "error": "Preview no longer exists"}, status=404)
    except OSError as e:
        return web.json_response({"success": False, "error": f"Failed to save: {e}"}, status=500)
    return web.json_response({"success": True, "audio": item})


async def api_delete_audio_gallery(request):
    """POST /anomalous/delete_audio_gallery - Delete one generated audio file."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "Invalid JSON payload"}, status=400)

    filename = str(data.get("filename", "")).strip()
    subfolder = str(data.get("subfolder", "")).strip().strip("/\\")
    if not filename or os.path.basename(filename) != filename:
        return web.json_response({"success": False, "error": "Invalid filename"}, status=400)
    if os.path.splitext(filename)[1].lower() not in AUDIO_EXTENSIONS:
        return web.json_response({"success": False, "error": "Only audio files can be deleted here"}, status=415)

    try:
        target = resolve_within(folder_paths.get_output_directory(), subfolder, filename)
    except ValueError:
        return web.json_response({"success": False, "error": "Forbidden path"}, status=403)

    if not os.path.isfile(target):
        return web.json_response({"success": False, "error": "File not found"}, status=404)
    try:
        await asyncio.to_thread(os.remove, target)
    except OSError as e:
        return web.json_response({"success": False, "error": f"Failed to delete: {e}"}, status=500)
    return web.json_response({"success": True})


def _read_workflow_template(name):
    plugin_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    filename = f"{name}_multivoice_workflow.json"
    for wf_path in (os.path.join(folder_paths.base_path, filename), os.path.join(plugin_dir, "workflows", filename)):
        if os.path.isfile(wf_path):
            with open(wf_path, 'r', encoding='utf-8') as f:
                return json.load(f)
    return None


async def api_get_audio_template_workflow(request):
    """GET /anomalous/audio_template_workflow?name=arona - Return a local multi-voice workflow template."""
    name = request.query.get("name", "arona").strip().lower()
    if not WORKFLOW_TEMPLATE_NAME.match(name):
        return web.json_response({"success": False, "error": "Invalid template name"}, status=400)
    try:
        workflow = await asyncio.to_thread(_read_workflow_template, name)
    except (OSError, ValueError) as e:
        return web.json_response({"success": False, "error": f"Failed to read workflow: {e}"}, status=500)
    if workflow is None:
        return web.json_response({
            "success": False,
            "code": "template_missing",
            "error": f"{name}_multivoice_workflow.json not found",
        }, status=404)
    return web.json_response({"success": True, "workflow": workflow})


def _ffmpeg_executable():
    """Prefer ffmpeg on PATH, then the copies shipped beside the portable Python."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    python_dir = os.path.dirname(sys.executable)
    for candidate in (os.path.join(python_dir, "ffmpeg.exe"), os.path.join(python_dir, "Scripts", "ffmpeg.exe")):
        if os.path.isfile(candidate):
            return candidate
    return None


def _convert_to_pcm_wav(src_path, dst_path):
    """Convert audio to 16-bit 24kHz mono PCM WAV. Returns an error message or None."""
    ffmpeg = _ffmpeg_executable()
    if not ffmpeg:
        return "ffmpeg not found"
    cmd = [ffmpeg, "-y", "-i", src_path, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", dst_path]
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=FFMPEG_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        return "ffmpeg timed out"
    except (OSError, subprocess.CalledProcessError) as e:
        return f"ffmpeg failed: {e}"
    return None


def _sanitize_character(part):
    """'.' separates the main sample from its variants, so it cannot appear in names."""
    cleaned = re.sub(r'[^\w-]', '', str(part or '').strip())
    return cleaned or "Voice"


def _sanitize_emotion(part):
    cleaned = re.sub(r'[^\w-]+', '_', str(part or '').strip()).strip('_-').lower()
    return cleaned or MAIN_VOICE


def voice_base_name(character, emotion):
    """`Arona` for the main voice, `Arona.happy` for a variant (ComfyUI-F5-TTS layout)."""
    return character if emotion == MAIN_VOICE else f"{character}.{emotion}"


def _voice_targets(dest_dir, base_name):
    """Every file that belongs to one voice stem, including audio in other formats."""
    targets = {ext: os.path.join(dest_dir, base_name + ext) for ext in AUDIO_EXTENSIONS}
    targets[".txt"] = os.path.join(dest_dir, base_name + ".txt")
    targets[".orig.txt"] = os.path.join(dest_dir, base_name + ".orig.txt")
    return targets


def _commit_voice_files(plan):
    """Apply {final_path: staged_path_or_None} as one unit; restore previous files on failure."""
    token = uuid.uuid4().hex[:8]
    backups = {}
    placed = []
    try:
        for final_path in plan:
            if os.path.exists(final_path):
                backup = f"{final_path}.bak-{token}"
                os.replace(final_path, backup)
                backups[final_path] = backup
        for final_path, staged in plan.items():
            if staged is not None:
                os.replace(staged, final_path)
                placed.append(final_path)
    except Exception:
        for final_path in placed:
            try:
                os.remove(final_path)
            except OSError:
                pass
        for final_path, backup in backups.items():
            try:
                os.replace(backup, final_path)
            except OSError:
                pass
        raise
    for backup in backups.values():
        try:
            os.remove(backup)
        except OSError:
            pass


def _write_staged_text(dest_dir, text):
    fd, path = tempfile.mkstemp(prefix=".voice-", suffix=".txt.tmp", dir=dest_dir)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(text)
    return path


def _ingest_voice(dest_dir, base_name, ext, audio_bytes, text, original_text, overwrite):
    """Stage every file first, then swap them in together so a failure keeps the previous voice."""
    os.makedirs(dest_dir, exist_ok=True)
    targets = _voice_targets(dest_dir, base_name)
    existing = [path for path in targets.values() if os.path.exists(path)]
    if existing and not overwrite:
        return {"status": 409, "code": "exists", "error": f"{base_name} already exists"}

    staged = []
    try:
        fd, raw_path = tempfile.mkstemp(prefix=".voice-", suffix=ext, dir=dest_dir)
        staged.append(raw_path)
        with os.fdopen(fd, 'wb') as f:
            f.write(audio_bytes)

        audio_path = raw_path
        if ext != '.wav':
            wav_path = raw_path[:-len(ext)] + '.wav'
            staged.append(wav_path)
            error = _convert_to_pcm_wav(raw_path, wav_path)
            if error:
                return {"status": 422, "code": "convert_failed", "error": f"Could not convert to WAV ({error}); existing files were kept"}
            audio_path = wav_path

        plan = {path: None for path in existing}
        plan[targets['.wav']] = audio_path
        if text:
            text_path = _write_staged_text(dest_dir, text)
            staged.append(text_path)
            plan[targets['.txt']] = text_path
        if original_text and original_text != text:
            orig_path = _write_staged_text(dest_dir, original_text)
            staged.append(orig_path)
            plan[targets['.orig.txt']] = orig_path

        _commit_voice_files(plan)
        return {"status": 200, "filename": base_name + '.wav'}
    finally:
        for path in staged:
            if os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass


async def api_upload_audio_voice(request):
    """POST /anomalous/upload_audio_voice - Ingest a voice sample with its transcript."""
    try:
        data = await request.post()
    except Exception as e:
        return web.json_response({"success": False, "error": f"Invalid multipart payload: {e}"}, status=400)

    audio_field = data.get("audio")
    if audio_field is None or not hasattr(audio_field, "file"):
        return web.json_response({"success": False, "error": "Audio file is required"}, status=400)

    ext = os.path.splitext(getattr(audio_field, "filename", "") or "")[1].lower()
    if ext not in AUDIO_EXTENSIONS:
        return web.json_response({
            "success": False,
            "error": f"Unsupported audio format '{ext}'. Supported: {', '.join(sorted(AUDIO_EXTENSIONS))}",
        }, status=415)

    audio_bytes = audio_field.file.read(MAX_UPLOAD_BYTES + 1)
    if len(audio_bytes) > MAX_UPLOAD_BYTES:
        return web.json_response({"success": False, "error": "Audio file exceeds 100MB limit"}, status=413)

    character = _sanitize_character(data.get("character"))
    emotion = _sanitize_emotion(data.get("emotion"))
    if emotion in RESERVED_VOICE_NAMES:
        return web.json_response({"success": False, "error": f"'{emotion}' is reserved"}, status=400)
    text = str(data.get("text", "")).strip()
    original_text = str(data.get("original_text", "")).strip()
    overwrite = str(data.get("overwrite", "")).lower() in ("1", "true", "yes")
    target_sub = str(data.get("target_subfolder", DEFAULT_VOICE_SUBFOLDER)).strip().strip("/\\")

    input_dir = folder_paths.get_input_directory()
    try:
        dest_dir = resolve_within(input_dir, target_sub)
    except ValueError:
        return web.json_response({"success": False, "error": "Forbidden target folder"}, status=403)
    if os.path.realpath(dest_dir) == os.path.realpath(input_dir):
        target_sub = ""

    base_name = voice_base_name(character, emotion)
    try:
        result = await asyncio.to_thread(_ingest_voice, dest_dir, base_name, ext, audio_bytes, text, original_text, overwrite)
    except OSError as e:
        return web.json_response({"success": False, "error": f"Failed to save voice: {e}"}, status=500)
    if result["status"] != 200:
        return web.json_response({"success": False, "code": result["code"], "error": result["error"]}, status=result["status"])

    rel_prefix = os.path.relpath(dest_dir, input_dir).replace(os.sep, "/")
    return web.json_response({
        "success": True,
        "slice": _slice_record(dest_dir, result["filename"], "" if rel_prefix == "." else rel_prefix),
        "main_missing": emotion != MAIN_VOICE and not os.path.isfile(os.path.join(dest_dir, f"{character}.wav")),
    })
