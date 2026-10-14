"""When each model and node pack here was last used (the models page's Tidy tab, "Not used lately").

GET /anomalous/usage/check -> {models, packs, seen, now, ledger_since}
    Evidence, read only when the user asks:
    - the run record (usage_ledger.py): every run since it started, kept or not, and every
      workflow opened on the page (the open tabs are noted just before a check);
    - the outputs from before that: PNG images (their prompt names model files and node types;
      image_search.cached_record) and FLAC / Ogg sounds (audio_metadata), dated by the file;
    - the saved ComfyUI workflows, recipes, combos and parameter sets (any string naming a model
      file, any node type, any SHA-256).
    A model counts as used when its path, its file name (two files of one name: both count, the
    safe side) or its scanned SHA-256 appears.
    Nothing new is judged: a model or pack counts as idle since its last use or since it came
    here (`added`: the file's or folder's creation date), whichever is later.
    models: idle for 30 days or more, with {type, root, rel, size, name, version, preview_url,
        last_used (seconds or null), outputs, runs, opened, saved (saved files naming it), added}.
    packs: the node packs in custom_nodes but this plugin and ComfyUI Manager, {name, nodes,
        last_used, outputs, runs, opened, saved, added, web (it adds to ComfyUI's page too), feeds (packs
        whose nodes take a kind of thing only its nodes make), words (what to search the Manager
        for)}; a pack of no nodes only works on the page or the server, nothing here can tell.
    seen: {outputs, saved, capped} what was read (capped: some outputs or files were not).
    ledger_since: when the run record started (null: nothing run since).

What none of this can show (a workflow from before the record, dropped in and never saved) is
said on the page; nothing here deletes or disables anything.
"""

import asyncio
import json
import os
import re
import time

import folder_paths
from aiohttp import web

from . import usage_ledger
from .audio_metadata import read_audio_tags
from .backup import part_dirs
from .image_search import MODEL_FILE, cached_record
from .model_placement import _card, _known_hash, library

RECENT_SECONDS = 30 * 24 * 3600  # used or added within this: not listed
MAX_IMAGES = 100_000  # outputs read at most, images and sounds
MAX_SAVED = 20_000
MAX_JSON_BYTES = 20 * 1024 * 1024
SAVED_PARTS = ("comfy_workflows", "recipes", "combos", "parameters")
SOUNDS = (".flac", ".ogg", ".opus")
SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOT_LISTED = {os.path.basename(PLUGIN_DIR).lower(), "comfyui-manager"}  # the tools doing the tidying
FEEDS_SHOWN = 3
# Words left out of what the Manager is searched for: its search wants all words, in order, in
# one of a pack's title, author or description, and pack folders carry these where titles do not.
SEARCH_NOISE = {"comfyui", "comfy", "custom", "customnodes", "node", "nodes", "pack", "main", "master"}


def _refs(value):
    ref = str(value).replace("\\", "/").strip().lower()
    return {ref, ref.rsplit("/", 1)[-1]}


def _arrived(stat, changed=True):
    """When a file or folder came here: its creation date, or its last change when that is later
    (`changed`; a copied file keeps its old change date, a folder's changes with every update)."""
    born = getattr(stat, "st_birthtime", None) or stat.st_ctime
    return max(born, stat.st_mtime) if changed else born


class Evidence:
    """Per model reference / hash / node type: how many outputs, runs, openings and saved files,
    and the latest time."""

    def __init__(self):
        self.outputs, self.runs, self.opened, self.saved, self.last = {}, {}, {}, {}, {}
        self.seen = {"outputs": 0, "saved": 0, "capped": False}

    def add(self, keys, when=None):
        for key in keys:
            if when is None:
                self.saved[key] = self.saved.get(key, 0) + 1
            else:
                self.outputs[key] = self.outputs.get(key, 0) + 1
                self.last[key] = max(self.last.get(key, 0), when)

    def add_noted(self, counts, key, when, count):
        """A run record entry; `counts` is self.runs or self.opened."""
        counts[key] = counts.get(key, 0) + count
        self.last[key] = max(self.last.get(key, 0), when)

    def of(self, keys):
        keys = [key for key in keys if key]
        last = max((self.last.get(key, 0) for key in keys), default=0)
        return {"last_used": last or None,
                **{kind: max((counts.get(key, 0) for key in keys), default=0)
                   for kind, counts in (("outputs", self.outputs), ("runs", self.runs), ("opened", self.opened), ("saved", self.saved))}}


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


def _sound_keys(path):
    """What a sound's embedded prompt names, as evidence keys; empty without one."""
    try:
        prompt = json.loads(read_audio_tags(path).get("prompt") or "null")
    except (OSError, ValueError):
        return set()
    if not isinstance(prompt, dict):
        return set()
    types, models = usage_ledger.prompt_uses(prompt)
    return {"t:" + node_type for node_type in types} | {"m:" + ref for model in models for ref in _refs(model)}


def _read_outputs(evidence):
    base = folder_paths.get_output_directory()
    for current, folders, names in os.walk(base):
        folders[:] = [name for name in folders if not name.startswith(".")]
        for name in names:
            lower = name.lower()
            if not lower.endswith((".png",) + SOUNDS):
                continue
            if evidence.seen["outputs"] >= MAX_IMAGES:
                evidence.seen["capped"] = True
                return
            path = os.path.join(current, name)
            try:
                when = os.stat(path).st_mtime
            except OSError:
                continue
            if lower.endswith(SOUNDS):
                keys = _sound_keys(path)
            else:
                record = cached_record(path, when)
                if not record:
                    continue
                keys = {"m:" + ref for ref in record["models"]} | {"h:" + sha for sha in record["hashes"]}
                keys |= {"t:" + node_type for node_type in record.get("types", ())}
            if not keys:
                continue
            evidence.seen["outputs"] += 1
            evidence.add(keys, when)


def _read_ledger(evidence):
    """Every run and opened workflow since the record started; its start, or None."""
    ledger = usage_ledger.read()
    for names, counts in ((ledger, evidence.runs), (ledger["opened"], evidence.opened)):
        for node_type, (when, count) in names["types"].items():
            evidence.add_noted(counts, "t:" + node_type, when, count)
        for model, (when, count) in names["models"].items():
            for ref in _refs(model):
                evidence.add_noted(counts, "m:" + ref, when, count)
    return ledger["started"]


def _io_types(cls):
    """(kinds of thing a node takes, kinds it makes); combo lists and '*' left out."""
    taken, made = set(), set()
    try:
        inputs = cls.INPUT_TYPES() or {}
        for group in ("required", "optional"):
            for spec in (inputs.get(group) or {}).values():
                kind = spec[0] if isinstance(spec, (list, tuple)) and spec else spec
                if isinstance(kind, str):
                    taken.add(kind)
    except Exception:  # noqa: BLE001 - a pack's own code; it only means "takes nothing known"
        pass
    try:
        made = {kind for kind in (cls.RETURN_TYPES or ()) if isinstance(kind, str)}
    except Exception:  # noqa: BLE001
        pass
    return taken - {"*"}, made - {"*"}


def _search_words(name):
    words = [word for word in re.split(r"[\s_.\-]+", name.lower()) if word and word not in SEARCH_NOISE]
    return " ".join(words) or name.lower()


def _packs():
    """[{name, path, dir, types, web, feeds}] for the node packs ComfyUI loaded from custom_nodes."""
    import nodes  # ComfyUI's registry, filled once ComfyUI has loaded the packs

    roots = []
    try:
        roots = [os.path.normcase(os.path.realpath(root)) for root in folder_paths.get_folder_paths("custom_nodes") or []]
    except Exception:  # noqa: BLE001
        pass
    packs = {}
    for module, directory in (getattr(nodes, "LOADED_MODULE_DIRS", {}) or {}).items():
        real = os.path.normcase(os.path.realpath(directory))
        name = os.path.splitext(os.path.basename(module))[0]
        if real in roots:  # a single .py file in custom_nodes
            packs[name] = {"name": name, "path": os.path.join(directory, name + ".py"), "dir": None, "types": []}
        elif os.path.normcase(os.path.realpath(os.path.dirname(directory))) in roots:
            packs[name] = {"name": name, "path": directory, "dir": real, "types": []}

    io, core = {}, set()
    for node_type, cls in (getattr(nodes, "NODE_CLASS_MAPPINGS", {}) or {}).items():
        module = str(getattr(cls, "RELATIVE_PYTHON_MODULE", "") or "")
        taken, made = _io_types(cls)
        pack = module.split(".", 2)[1] if module.startswith("custom_nodes.") else None
        if pack in packs:
            packs[pack]["types"].append(node_type)
            io.setdefault(pack, [set(), set()])
            io[pack][0] |= taken
            io[pack][1] |= made
        elif pack is None:
            core |= taken | made

    web_dirs = [os.path.normcase(os.path.realpath(path)) for path in (getattr(nodes, "EXTENSION_WEB_DIRS", {}) or {}).values()]
    for name, pack in packs.items():
        pack["web"] = bool(pack["dir"]) and any(path == pack["dir"] or path.startswith(pack["dir"] + os.sep) for path in web_dirs)
        own = io.get(name, [set(), set()])[1] - core
        pack["feeds"] = sorted((other for other, (taken, _) in io.items() if other != name and own & taken), key=str.lower)
    return [pack for name, pack in packs.items() if name.lower() not in NOT_LISTED]


def check(now=None):
    now = time.time() if now is None else now
    evidence = Evidence()
    ledger_since = _read_ledger(evidence)
    _read_saved(evidence)
    _read_outputs(evidence)

    models = []
    for item in library():
        keys = ["m:" + ref for ref in _refs(item["rel"])]
        sha = _known_hash(item)
        if sha:
            keys.append("h:" + sha.upper())
        use = evidence.of(keys)
        added = _arrived(item["stat"]) if item.get("stat") else None
        if now - max(use["last_used"] or 0, added or 0) < RECENT_SECONDS:
            continue
        models.append({"type": item["type"], "root": item["root"], "rel": item["rel"], "size": item["size"],
                       "added": added, **_card(item), **use})

    packs = []
    for pack in sorted(_packs(), key=lambda entry: entry["name"].lower()):
        uses = [evidence.of(["t:" + node_type]) for node_type in pack["types"]]
        try:
            added = _arrived(os.stat(pack["path"]), changed=False)
        except OSError:
            added = None
        packs.append({"name": pack["name"], "nodes": len(pack["types"]), "added": added, "web": pack["web"],
                      "feeds": pack["feeds"][:FEEDS_SHOWN], "words": _search_words(pack["name"]),
                      "last_used": max((use["last_used"] or 0 for use in uses), default=0) or None,
                      **{kind: max((use[kind] for use in uses), default=0) for kind in ("outputs", "runs", "opened", "saved")}})
    return {"models": models, "packs": packs, "seen": evidence.seen, "now": now, "ledger_since": ledger_since}


async def api_check(request):
    return web.json_response(await asyncio.to_thread(check))


def register_routes(app):
    app.router.add_get("/anomalous/usage/check", api_check)
