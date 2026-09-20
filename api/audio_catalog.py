"""Audio and Voice catalog scanning, metadata extraction, and streaming service."""

import os
import re
import folder_paths
from aiohttp import web
from .path_utils import resolve_within

AUDIO_EXTENSIONS = {'.wav', '.mp3', '.flac', '.ogg', '.m4a'}


def _parse_character_and_emotion(filename):
    """Parse character name and emotion tag from audio filename."""
    stem, _ = os.path.splitext(filename)
    parts = re.split(r'[-_.]', stem)
    if len(parts) >= 2:
        character = parts[0].capitalize()
        emotion = "_".join(parts[1:]).lower()
    else:
        character = "General"
        emotion = stem.lower()
    return character, emotion


def _read_associated_text(base_path):
    """Read companion prompt text file if present."""
    stem, _ = os.path.splitext(base_path)
    txt_path = stem + '.txt'
    if os.path.isfile(txt_path):
        try:
            with open(txt_path, 'r', encoding='utf-8', errors='ignore') as f:
                return f.read().strip()
        except Exception:
            return ""
    return ""


def _scan_single_audio_dir(directory, relative_prefix=""):
    """Scan a directory for audio files and group by character."""
    slices = []
    if not os.path.isdir(directory):
        return slices

    try:
        entries = sorted(os.listdir(directory))
    except OSError:
        return slices

    for name in entries:
        ext = os.path.splitext(name)[1].lower()
        if ext not in AUDIO_EXTENSIONS:
            continue

        full_path = os.path.join(directory, name)
        if not os.path.isfile(full_path):
            continue

        char_name, emotion = _parse_character_and_emotion(name)
        ref_text = _read_associated_text(full_path)
        file_size = os.path.getsize(full_path)
        rel_path = os.path.join(relative_prefix, name).replace("\\", "/")

        slices.append({
            "id": os.path.splitext(name)[0],
            "filename": name,
            "relative_path": rel_path,
            "character": char_name,
            "emotion": emotion,
            "text": ref_text,
            "size_bytes": file_size,
            "syntax_tag": f"{{{os.path.splitext(name)[0]}}}",
            "audio_url": f"/anomalous/audio_stream?path={rel_path}"
        })
    return slices


def _group_slices_by_character(all_slices):
    """Group flat slice list into character bundles."""
    char_map = {}
    for s in all_slices:
        cname = s["character"]
        if cname not in char_map:
            char_map[cname] = {
                "character": cname,
                "slices": [],
                "total_slices": 0
            }
        char_map[cname]["slices"].append(s)
        char_map[cname]["total_slices"] += 1
    return list(char_map.values())


async def api_get_audio_voices(request):
    """GET /anomalous/audio_voices - Return structured audio presets."""
    input_dir = folder_paths.get_input_directory()
    scan_targets = [
        (os.path.join(input_dir, "F5-TTS"), "F5-TTS"),
        (os.path.join(input_dir, "audio"), "audio"),
        (input_dir, "")
    ]

    all_slices = []
    seen_filenames = set()

    for dir_path, prefix in scan_targets:
        found = _scan_single_audio_dir(dir_path, relative_prefix=prefix)
        for item in found:
            if item["filename"] not in seen_filenames:
                seen_filenames.add(item["filename"])
                all_slices.append(item)

    grouped = _group_slices_by_character(all_slices)
    return web.json_response({
        "success": True,
        "characters": grouped,
        "total_slices": len(all_slices)
    })


async def api_serve_audio(request):
    """GET /anomalous/audio_stream?path=...&type=input|output - Stream audio file securely."""
    rel_path = request.query.get("path", "").strip("/\\")
    dir_type = request.query.get("type", "input")
    if not rel_path:
        return web.Response(status=400, text="Missing audio path")

    base_dir = folder_paths.get_output_directory() if dir_type == "output" else folder_paths.get_input_directory()
    try:
        resolved_path = resolve_within(base_dir, rel_path)
    except (ValueError, Exception):
        return web.Response(status=403, text="Forbidden path")

    if not os.path.isfile(resolved_path):
        return web.Response(status=404, text="Audio file not found")

    ext = os.path.splitext(resolved_path)[1].lower()
    content_types = {
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4'
    }
    content_type = content_types.get(ext, 'application/octet-stream')
    return web.FileResponse(
        resolved_path,
        headers={"Content-Type": content_type, "Accept-Ranges": "bytes"}
    )


def _collect_gallery_audios(output_dir):
    """Scan output folder for generated audio files."""
    audios = []
    if not os.path.isdir(output_dir):
        return audios

    for root, _, files in os.walk(output_dir):
        for name in files:
            ext = os.path.splitext(name)[1].lower()
            if ext not in AUDIO_EXTENSIONS:
                continue
            full_path = os.path.join(root, name)
            try:
                stat = os.stat(full_path)
                mtime = stat.st_mtime
                size = stat.st_size
            except OSError:
                continue

            subfolder = os.path.relpath(root, output_dir)
            clean_sub = "" if subfolder == "." else subfolder.replace(os.sep, '/')
            rel_url_path = os.path.join(clean_sub, name).replace("\\", "/")

            audios.append({
                "filename": name,
                "subfolder": clean_sub,
                "size_bytes": size,
                "mtime": mtime,
                "audio_url": f"/anomalous/audio_stream?path={rel_url_path}&type=output"
            })
    audios.sort(key=lambda a: a["mtime"], reverse=True)
    return audios


async def api_get_audio_gallery(request):
    """GET /anomalous/audio_gallery?page=1&limit=50 - List generated audio history."""
    output_dir = folder_paths.get_output_directory()
    page = max(1, int(request.query.get("page", 1)))
    limit = max(1, min(100, int(request.query.get("limit", 40))))

    all_audios = _collect_gallery_audios(output_dir)
    total = len(all_audios)
    start = (page - 1) * limit
    sliced = all_audios[start:start + limit]

    return web.json_response({
        "success": True,
        "audios": sliced,
        "total": total,
        "page": page,
        "has_more": start + limit < total
    })


async def api_delete_audio_gallery(request):
    """POST /anomalous/delete_audio_gallery - Delete a generated audio file."""
    try:
        data = await request.json()
    except Exception:
        return web.Response(status=400, text="Invalid JSON payload")

    filename = data.get("filename", "").strip()
    subfolder = data.get("subfolder", "").strip()
    if not filename:
        return web.Response(status=400, text="Missing filename")

    output_dir = folder_paths.get_output_directory()
    try:
        rel = os.path.join(subfolder, filename).replace("\\", "/") if subfolder else filename
        target = resolve_within(output_dir, rel)
    except Exception:
        return web.Response(status=403, text="Forbidden path")

    if os.path.isfile(target):
        try:
            os.remove(target)
            return web.json_response({"success": True})
        except OSError as e:
            return web.Response(status=500, text=f"Failed to delete: {e}")
    return web.Response(status=404, text="File not found")

