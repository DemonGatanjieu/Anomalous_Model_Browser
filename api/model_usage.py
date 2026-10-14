"""When each model and node pack here was last used (the models page's Tidy tab, "Not used lately").

GET /anomalous/usage/check -> {models, packs, seen}
    Evidence, read only when the user asks: the PNG outputs (their prompt names model files and
    node types; image_search.cached_record; an image's time is when they were used) and the saved
    ComfyUI workflows, recipes, combos and parameter sets (any string naming a model file, any
    node type, any SHA-256). A model counts as used when its path, its file name (two files of
    one name: both count, the safe side) or its scanned SHA-256 appears.
    models: those not used in the last 30 days, with {type, root, rel, size, name, version,
        preview_url, last_used (seconds or null), outputs, saved (saved files naming it)}.
    packs: node packs in custom_nodes with nodes, {name, nodes, last_used, outputs, saved}.
    seen: {outputs, saved, capped} what was read (capped: some images or files were not).

What the outputs and saved files cannot show (a workflow dropped in and never saved, a model
used through the API) is said on the page; nothing here deletes or disables anything.
"""

import asyncio
import json
import os
import re
import time

import folder_paths
from aiohttp import web

from .backup import part_dirs
from .image_search import MODEL_FILE, cached_record
from .model_placement import _card, _known_hash, library

RECENT_SECONDS = 30 * 24 * 3600  # used within this: not listed
MAX_IMAGES = 100_000
MAX_SAVED = 20_000
MAX_JSON_BYTES = 20 * 1024 * 1024
SAVED_PARTS = ("comfy_workflows", "recipes", "combos", "parameters")
SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")


def _refs(value):
    ref = str(value).replace("\\", "/").strip().lower()
    return {ref, ref.rsplit("/", 1)[-1]}


class Evidence:
    """Per model reference / hash / node type: how many outputs and saved files, and the latest time."""

    def __init__(self):
        self.outputs, self.saved, self.last = {}, {}, {}
        self.seen = {"outputs": 0, "saved": 0, "capped": False}

    def add(self, keys, when=None):
        for key in keys:
            if when is None:
                self.saved[key] = self.saved.get(key, 0) + 1
            else:
                self.outputs[key] = self.outputs.get(key, 0) + 1
                self.last[key] = max(self.last.get(key, 0), when)

    def of(self, keys):
        keys = [key for key in keys if key]
        last = max((self.last.get(key, 0) for key in keys), default=0)
        return {"last_used": last or None, "outputs": max((self.outputs.get(key, 0) for key in keys), default=0),
                "saved": max((self.saved.get(key, 0) for key in keys), default=0)}


def _walk_json(value, found):
    """Model references ('m:'), SHA-256s ('h:') and node types ('t:') anywhere in saved JSON."""
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            for key in ("type", "class_type"):
                if isinstance(item.get(key), str) and item[key]:
                    found.add("t:" + item[key])
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
        elif isinstance(item, str):
            if MODEL_FILE.search(item):
                found.update("m:" + ref for ref in _refs(item))
            elif SHA256.match(item):
                found.add("h:" + item.upper())


def _read_saved(evidence):
    dirs = part_dirs()
    for part in SAVED_PARTS:
        base = dirs.get(part)
        if not base or not os.path.isdir(base):
            continue
        for current, folders, names in os.walk(base):
            folders[:] = [name for name in folders if not name.startswith(".")]
            for name in names:
                if not name.lower().endswith(".json"):
                    continue
                if evidence.seen["saved"] >= MAX_SAVED:
                    evidence.seen["capped"] = True
                    return
                path = os.path.join(current, name)
                try:
                    if os.path.getsize(path) > MAX_JSON_BYTES:
                        continue
                    with open(path, encoding="utf-8") as f:
                        data = json.load(f)
                except (OSError, ValueError):
                    continue
                found = set()
                _walk_json(data, found)
                evidence.seen["saved"] += 1
                evidence.add(found)


def _read_outputs(evidence):
    base = folder_paths.get_output_directory()
    for current, folders, names in os.walk(base):
        folders[:] = [name for name in folders if not name.startswith(".")]
        for name in names:
            if not name.lower().endswith(".png"):
                continue
            if evidence.seen["outputs"] >= MAX_IMAGES:
                evidence.seen["capped"] = True
                return
            path = os.path.join(current, name)
            try:
                when = os.stat(path).st_mtime
            except OSError:
                continue
            record = cached_record(path, when)
            if not record:
                continue
            evidence.seen["outputs"] += 1
            keys = {"m:" + ref for ref in record["models"]} | {"h:" + sha for sha in record["hashes"]}
            keys |= {"t:" + node_type for node_type in record.get("types", ())}
            evidence.add(keys, when)


def _packs():
    """{pack folder name: [node types]} for the node packs in custom_nodes."""
    import nodes  # ComfyUI's registry, filled once ComfyUI has loaded the packs

    packs = {}
    for node_type, cls in getattr(nodes, "NODE_CLASS_MAPPINGS", {}).items():
        module = str(getattr(cls, "RELATIVE_PYTHON_MODULE", "") or "")
        if module.startswith("custom_nodes."):
            packs.setdefault(module.split(".", 2)[1], []).append(node_type)
    return packs


def check(now=None):
    now = time.time() if now is None else now
    evidence = Evidence()
    _read_saved(evidence)
    _read_outputs(evidence)

    models = []
    for item in library():
        keys = ["m:" + ref for ref in _refs(item["rel"])]
        sha = _known_hash(item)
        if sha:
            keys.append("h:" + sha.upper())
        use = evidence.of(keys)
        if use["last_used"] and now - use["last_used"] < RECENT_SECONDS:
            continue
        models.append({"type": item["type"], "root": item["root"], "rel": item["rel"], "size": item["size"],
                       **_card(item), **use})

    packs = []
    for name, types in sorted(_packs().items(), key=lambda entry: entry[0].lower()):
        uses = [evidence.of(["t:" + node_type]) for node_type in types]
        last = max((use["last_used"] or 0 for use in uses), default=0)
        packs.append({"name": name, "nodes": len(types), "last_used": last or None,
                      "outputs": sum(use["outputs"] for use in uses), "saved": max((use["saved"] for use in uses), default=0)})
    return {"models": models, "packs": packs, "seen": evidence.seen, "now": now}


async def api_check(request):
    return web.json_response(await asyncio.to_thread(check))


def register_routes(app):
    app.router.add_get("/anomalous/usage/check", api_check)
