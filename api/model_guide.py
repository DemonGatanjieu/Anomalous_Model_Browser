"""What using a model takes besides its file, for the model details (GET /anomalous/model_guide)
and the AI's get_model: the settings of its author's example pictures (model_advice), the words
its own header suggests when Civitai gave no trigger words (header_words.py: kept by the scan,
else read now), and, by its base model family (model_profiles.json), the files a drawing model
loaded in parts needs beside it, with the one this ComfyUI has by that name, and notes for the AI.
The page names a model by type, folder index, subfolder and file name, never by a path."""

import asyncio
import json
import os
import re

import folder_paths
from aiohttp import web

from . import model_advice
from .metadata import get_metadata
from .model_constants import MODEL_EXTENSIONS
from .path_utils import model_file_within, resolve_folder_subdir

try:
    from ..header_words import of_file as header_words_of
except ImportError:  # loaded outside the package (tests)
    from header_words import of_file as header_words_of

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "model_profiles.json"), encoding="utf-8") as _source:
    FAMILIES = json.load(_source)["families"]
PART_FOLDERS = ("diffusion_models", "unet")  # a checkpoint carries its text encoders and VAE


def profile(base):
    """The family whose marks start `base` (a base model name), else None."""
    lowered = str(base or "").strip().lower()
    return next((family for family in FAMILIES if lowered and lowered.startswith(tuple(family["marks"]))), None)


def _plain(name):
    return re.sub(r"[^a-z0-9]", "", os.path.splitext(os.path.basename(name))[0].lower())


def _found(part):
    """The first file in the part's folder with one of its names in its own, "" when none."""
    try:
        listed = folder_paths.get_filename_list(part["folder"])
    except KeyError:
        return ""
    for name in listed:
        plain = _plain(name)
        if any(plain == wanted or (len(wanted) > 3 and wanted in plain) for wanted in part["names"]):
            return name
    return ""


def parts(folder_type, base):
    """[{"folder", "file", "found"}]: what a drawing model loaded in parts needs beside it; [] for others."""
    family = profile(base)
    if folder_type not in PART_FOLDERS or not family:
        return []
    return [{"folder": part["folder"], "file": part["file"], "found": _found(part)} for part in family.get("parts", [])]


def words(path, folder_type, meta):
    """What a LoRA's header suggests when Civitai gave no trigger words: kept by the scan, else read now."""
    if folder_type != "loras" or meta.get("trainedWords"):
        return []
    return list(meta.get("headerWords") or []) or header_words_of(path)


def usage(folder_type, base):
    """For the AI: the family's notes and the files it needs here, {} when nothing is known."""
    family = profile(base)
    if not family:
        return {}
    found = {"family": family["family"]}
    needed = parts(folder_type, base)
    if needed:
        found["needs"] = [f"{part['folder']}: {part['file']}" + (f" (here: {part['found']})" if part["found"] else " (none here by that name)")
                          for part in needed]
    if family.get("notes"):
        found["notes"] = family["notes"]
    return found


def guide(path, folder_type):
    meta = get_metadata(path)
    base = meta.get("baseModel") or meta.get("base_guess") or ""
    return {"examples": model_advice.example_settings(path, folder_type, meta.get("hash", "")),
            "words": words(path, folder_type, meta), "parts": parts(folder_type, base)}


async def api_model_guide(request):
    query = request.query
    folder_type = query.get("type", "")
    try:
        _base, folder = resolve_folder_subdir(folder_type, int(query.get("path_idx", 0)), query.get("subfolder", ""))
        path = model_file_within(folder, query.get("filename", ""))
    except (ValueError, KeyError):
        return web.json_response({"error": "bad request"}, status=400)
    if not path.lower().endswith(MODEL_EXTENSIONS) or not os.path.isfile(path):
        return web.json_response({"error": "not found"}, status=404)
    return web.json_response(await asyncio.to_thread(guide, path, folder_type))
