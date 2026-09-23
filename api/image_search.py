"""Search output images by the generation info embedded in them.

Reads only the PNG text chunks before the pixel data (ComfyUI `prompt` /
`workflow`, A1111/Forge `parameters`), caches one small record per file keyed by
its mtime, and matches every query term against it. Terms that look like a
hash also match model SHA256 values recorded in the workflow and, through the
scanned model index, the local model files that carry that hash.
"""

import json
import os
import re
import struct
import threading
import time
import zlib

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_CHUNK_BYTES = 32 * 1024 * 1024
MAX_CACHED_RECORDS = 60_000
MODEL_INDEX_SECONDS = 120
HASH_TERM = re.compile(r"^[0-9a-f]{8,64}$", re.IGNORECASE)
MODEL_FILE = re.compile(r"\.(safetensors|ckpt|pt|pth|bin|sft|gguf)$", re.IGNORECASE)
NUMERIC_KEYS = {"seed", "noise_seed", "steps", "cfg", "denoise", "width", "height"}

_record_cache = {}
_cache_lock = threading.Lock()
_model_index = {"expires": 0, "entries": {}}
_model_index_lock = threading.Lock()


def _decode_text(raw):
    """tEXt is Latin-1 by spec, but ComfyUI/PIL may store UTF-8 bytes in it."""
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1", "replace")


def read_png_text(path):
    """Text chunks that precede IDAT, as {keyword: text}. Pixel data is never read."""
    chunks = {}
    with open(path, "rb") as handle:
        if handle.read(8) != PNG_SIGNATURE:
            return chunks
        while True:
            header = handle.read(8)
            if len(header) < 8:
                break
            length, kind = struct.unpack(">I4s", header)
            if kind in (b"IDAT", b"IEND") or length > MAX_CHUNK_BYTES:
                break
            data = handle.read(length)
            handle.seek(4, os.SEEK_CUR)
            try:
                if kind == b"tEXt":
                    key, _, value = data.partition(b"\x00")
                    chunks[key.decode("latin-1")] = _decode_text(value)
                elif kind == b"zTXt":
                    key, _, rest = data.partition(b"\x00")
                    chunks[key.decode("latin-1")] = _decode_text(zlib.decompress(rest[1:]))
                elif kind == b"iTXt":
                    key, _, rest = data.partition(b"\x00")
                    compressed, rest = rest[0], rest[2:]
                    _, _, rest = rest.partition(b"\x00")  # language tag
                    _, _, text = rest.partition(b"\x00")  # translated keyword
                    chunks[key.decode("latin-1")] = (zlib.decompress(text) if compressed else text).decode("utf-8", "replace")
            except (zlib.error, IndexError, ValueError):
                continue
    return chunks


def _normalise_model_ref(value):
    ref = str(value).replace("\\", "/").strip().lower()
    return {ref, ref.rsplit("/", 1)[-1]}


def build_record(path):
    """Searchable text, recorded model hashes and referenced model files for one image."""
    name = os.path.basename(path)
    texts = [name]
    hashes = set()
    models = set()
    if path.lower().endswith(".png"):
        try:
            chunks = read_png_text(path)
        except OSError:
            chunks = {}
        prompt = _load_json(chunks.get("prompt"))
        if isinstance(prompt, dict):
            for node in prompt.values():
                if not isinstance(node, dict):
                    continue
                texts.append(str(node.get("class_type", "")))
                for key, value in (node.get("inputs") or {}).items():
                    if isinstance(value, str):
                        texts.append(value)
                        if MODEL_FILE.search(value):
                            models |= _normalise_model_ref(value)
                    elif isinstance(value, (int, float)) and not isinstance(value, bool) and key in NUMERIC_KEYS:
                        texts.append(f"{key}:{value} {value}")
        workflow = _load_json(chunks.get("workflow"))
        recorded = (workflow or {}).get("extra", {}).get("anomalous_hashes") if isinstance(workflow, dict) else None
        if isinstance(recorded, dict):
            for key, entry in recorded.items():
                sha = entry.get("hash") if isinstance(entry, dict) else entry
                if isinstance(sha, str) and sha:
                    hashes.add(sha.upper())
                model_name = str(key).split("_", 1)[-1]
                if MODEL_FILE.search(model_name):
                    models |= _normalise_model_ref(model_name)
        if chunks.get("parameters"):
            texts.append(chunks["parameters"])
    return {"text": "\n".join(texts).lower(), "hashes": hashes, "models": models}


def _load_json(raw):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def cached_record(path, mtime=None):
    """Record for one image; `mtime` from the gallery listing avoids a stat per file."""
    if mtime is None:
        try:
            mtime = os.stat(path).st_mtime
        except OSError:
            return None
    key = mtime
    with _cache_lock:
        cached = _record_cache.get(path)
        if cached and cached[0] == key:
            return cached[1]
    if not os.path.isfile(path):
        return None
    record = build_record(path)
    with _cache_lock:
        if len(_record_cache) >= MAX_CACHED_RECORDS:
            _record_cache.clear()
        _record_cache[path] = (key, record)
    return record


def _local_models_for_hash(term):
    """Model file refs whose scanned SHA256 starts with `term` (cached briefly)."""
    # Imported lazily: api.utils re-exports gallery_routes, which imports this module.
    from .model_resolution import collect_model_hash_index

    with _model_index_lock:
        if time.monotonic() >= _model_index["expires"]:
            _model_index["entries"] = collect_model_hash_index()
            _model_index["expires"] = time.monotonic() + MODEL_INDEX_SECONDS
        entries = _model_index["entries"]
    wanted = term.upper()
    refs = set()
    for key, value in entries.items():
        sha = str((value or {}).get("hash") or "").upper()
        if sha and sha.startswith(wanted):
            refs |= _normalise_model_ref(key)
    return refs


def parse_query(query):
    """Search terms: a list keeps each entry as one phrase; a string splits on whitespace."""
    raw = query if isinstance(query, (list, tuple)) else str(query or "").split()
    terms = []
    for term in raw:
        term = " ".join(str(term).lower().split())
        if term and term not in terms:
            terms.append(term)
    return terms


def filter_images(output_dir, images, query):
    """Keep gallery entries whose record matches every term (phrases may contain spaces)."""
    terms = parse_query(query)
    if not terms:
        return images
    hash_refs = {term: _local_models_for_hash(term) for term in terms if HASH_TERM.match(term)}
    matched = []
    for image in images:
        record = cached_record(os.path.join(output_dir, image.get("subfolder", ""), image["filename"]), image.get("mtime"))
        if record is None:
            continue
        if all(_term_matches(term, record, hash_refs) for term in terms):
            matched.append(image)
    return matched


def _term_matches(term, record, hash_refs):
    if term in record["text"]:
        return True
    if term in hash_refs:
        upper = term.upper()
        if any(sha.startswith(upper) for sha in record["hashes"]):
            return True
        return bool(hash_refs[term] & record["models"])
    return False
