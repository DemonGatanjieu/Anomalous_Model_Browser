"""What the scan page shows before a scan: how many models are matched on Civitai, unmatched or
new, and which ones the last two are (located like the scan report's models, so the page can
open them); also the model files a scan never reads (other formats than .safetensors), so the
page can say why they are not there, the models the user set to "don't scan", and the new ones
whose header looks like no drawing model (a voice model, say), for the page to ask about. The
components a drawing model loads (VAE, text encoders…) are counted and listed on their own too,
since many are not on Civitai and that is no fault; and some covers of the scanned models, for
the scan card's band of pictures. And for the scan page's picker, every model
a scan reads with its name, size, cover and state."""

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor

from aiohttp import web

from .folder_types import get_active_scan_paths
from .metadata import get_metadata
from .model_media import _preview_url_for_model
from .scan_report import locate_root

try:
    from ..model_identity import is_unmatched, scan_choice, sidecar_info, unmatched_reason
except ImportError:  # loaded outside the package (tests)
    from model_identity import is_unmatched, scan_choice, sidecar_info, unmatched_reason

MAX_LISTED = 2000  # models listed per kind; the counts stay exact
MAX_PICKABLE = 5000  # models the picker lists; its total stays exact
COVER_SAMPLE = 48  # covers the scan card's band gets (it shows as many as fit)
# Model files in other formats: listed as "not scanned" (scans read only .safetensors).
OTHER_MODEL_EXTENSIONS = (".ckpt", ".pt", ".pth", ".bin", ".gguf", ".onnx", ".sft", ".engine")
# Folders of the parts a drawing model loads: many are not on Civitai, and that is no fault.
COMPONENT_TYPES = ("vae", "clip", "text_encoders", "clip_vision", "upscale_models")
# What the picker needs of a model's metadata: its card badge (model_source.js) and its name.
PICKER_FIELDS = ("info_source", "unmatched_reason", "scan_choice", "not_drawing", "baseModel", "base_guess", "custom_name")
# New models' headers are read this many at a time: on a network drive (a NAS, a cloud server's
# model disk) each read waits on the network, and a thousand one after another take minutes.
# They are read through get_metadata, whose cache keeps them until the file changes (the page
# opened again reads none, and the picker after it finds them there).
HEAD_READERS = 16


def _walk():
    """Each model file in the active scan folders once, as ((type, path_idx), base_dir, path,
    other): the .safetensors files scans read, and (`other`) model files in other formats outside
    hidden folders (tools keep their working files there)."""
    seen = set()
    for base_dir in get_active_scan_paths():
        located = locate_root(base_dir) or ("", 0)
        for root, _dirs, files in os.walk(base_dir):
            hidden = any(part.startswith(".") for part in os.path.relpath(root, base_dir).split(os.sep) if part != ".")
            for filename in files:
                other = filename.lower().endswith(OTHER_MODEL_EXTENSIONS)
                if not filename.endswith(".safetensors") and not (other and not hidden):
                    continue
                path = os.path.join(root, filename)
                real = os.path.realpath(path)
                if real in seen:
                    continue
                seen.add(real)
                yield located, base_dir, path, other


def _looks_not_drawing(path):
    """Whether the header of a new model reads but names no drawing model kind."""
    return bool(get_metadata(path).get("not_drawing"))


def _summarize():
    """Counts the files the scanner handles (.safetensors in the active scan folders), each once.
    `pending`: unmatched models Civitai was never asked about (offline, or unreachable then),
    which the next online scan looks up. `skipped`: model files in other formats. `excluded`:
    models set to "don't scan", not in the other counts. A new model not chosen about whose
    header reads but names no drawing model kind carries `not_drawing` (counted too); only new
    models' headers are read. Models in a component folder carry `component` (counted too) and
    are listed again, matched ones as well, in `component_models` with their `state`
    (matched | unmatched | new); `components` counts them. `covers`: see `_covers`."""
    total = matched = 0
    unmatched, new, skipped, excluded, components, scanned, to_read = [], [], [], [], [], [], []
    for located, base_dir, path, other in _walk():
        item = {"type": located[0], "path_idx": located[1], "filename": os.path.basename(path),
                "rel": os.path.relpath(path, base_dir).replace(os.sep, "/")}
        if other:
            skipped.append(item)
            continue
        base = os.path.splitext(path)[0]
        choice = scan_choice(base)
        if choice == "skip":
            excluded.append(item)
            continue
        total += 1
        info = sidecar_info(base)
        if located[0] in COMPONENT_TYPES:
            item["component"] = True
            components.append(item)
        elif info is not None:
            scanned.append((located, base_dir, path))
        if info is not None and not is_unmatched(info):
            matched += 1
            item["state"] = "matched"
            continue
        if info is None:
            if not choice:
                to_read.append((item, path))
            item["state"] = "new"
            new.append(item)
        else:
            item.update(state="unmatched", reason=unmatched_reason(info), base=info.get("baseModel") or "")
            unmatched.append(item)
    if to_read:
        with ThreadPoolExecutor(max_workers=HEAD_READERS) as pool:
            for (item, _path), not_drawing in zip(to_read, pool.map(_looks_not_drawing, [path for _item, path in to_read])):
                if not_drawing:
                    item["not_drawing"] = True
    return {
        "total": total, "matched": matched, "unmatched": len(unmatched), "new": len(new),
        "pending": sum(item["reason"] in ("offline", "network") for item in unmatched),
        "damaged": sum(item["reason"] == "damaged" for item in unmatched),
        "not_drawing": sum(bool(item.get("not_drawing")) for item in new),
        "excluded": len(excluded), "excluded_models": excluded[:MAX_LISTED],
        "unmatched_models": unmatched[:MAX_LISTED], "new_models": new[:MAX_LISTED],
        "skipped": len(skipped), "skipped_models": skipped[:MAX_LISTED],
        "components": {
            "total": len(components),
            **{state: sum(item["state"] == state for item in components) for state in ("matched", "unmatched", "new")},
            "pending": sum(item.get("reason") in ("offline", "network") for item in components),
        },
        "component_models": components[:MAX_LISTED],
        "covers": _covers(scanned),
    }


def _modified(entry):
    try:
        return os.path.getmtime(entry[2])
    except OSError:
        return 0


def _covers(scanned):
    """Up to COVER_SAMPLE covers of the scanned models (components left out, they seldom have
    one), the newest model files first, as {name, preview_url}: the scan card's band of pictures."""
    covers = []
    for located, base_dir, path in sorted(scanned, key=_modified, reverse=True):
        url = _preview_url_for_model(located[0], located[1], base_dir, path)
        if url:
            covers.append({"name": os.path.splitext(os.path.basename(path))[0], "preview_url": url})
            if len(covers) >= COVER_SAMPLE:
                break
    return covers


def _pickable():
    """Every model a scan reads (the models set to "don't scan" too), located like the summary's,
    with its size, cover and what its card badge needs; `roots`: the name of each models folder
    they are in and of the folder holding it, to tell two folders of one type apart."""
    models, roots, total = [], {}, 0
    for located, base_dir, path, other in _walk():
        if other:
            continue
        total += 1
        if len(models) >= MAX_PICKABLE:
            continue
        key = f"{located[0]}|{located[1]}"
        if key not in roots:
            roots[key] = {"type": located[0], "path_idx": located[1], "name": os.path.basename(os.path.normpath(base_dir)),
                          "parent": os.path.basename(os.path.dirname(os.path.normpath(base_dir)))}
        meta = get_metadata(path)
        try:
            size = os.path.getsize(path)
        except OSError:
            size = 0
        models.append({
            "type": located[0], "path_idx": located[1], "filename": os.path.basename(path),
            "rel": os.path.relpath(path, base_dir).replace(os.sep, "/"), "size": size,
            "preview_url": _preview_url_for_model(located[0], located[1], base_dir, path),
            "metadata": {field: meta.get(field) for field in PICKER_FIELDS},
        })
    return {"models": models, "total": total, "roots": list(roots.values())}


async def api_scan_summary(request):
    """GET /anomalous/scan_summary - counts, and the unmatched and new models."""
    return web.json_response(await asyncio.to_thread(_summarize))


async def api_scan_pickable(request):
    """GET /anomalous/scan_pickable - the models the scan settings' picker lists."""
    return web.json_response(await asyncio.to_thread(_pickable))
