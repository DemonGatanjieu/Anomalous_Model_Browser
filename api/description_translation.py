"""The model details' "Translate" (web/modules/ui_detail.js): its author's text from Civitai in the window's
language, paragraph by paragraph through the providers prompts use (translation_routes.translate_chain: DeepL
with a saved key, Google, MyMemory), a few at a time. A long paragraph goes in pieces cut at sentences; a piece
none of them takes is cut again into ones MyMemory takes. What came back is kept in user/anomalous/translations,
a file per text and language named by their hash, so the same text opens translated at once and offline, and
nothing is written beside the models. POST /anomalous/translate_description {paragraphs: [text], target}
-> {paragraphs, engine, kept} or {error}."""

import asyncio
import hashlib
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor

from aiohttp import web

from . import ai_tasks, translation_routes
from .path_utils import atomic_write_json

MAX_PARAGRAPHS = 400
MAX_CHARS = 30000
PIECE = 1500  # characters a free provider takes in one go
SMALL = 450  # what MyMemory takes
WORKERS = 4
TARGETS = ("zh-CN", "en")
SENTENCE = re.compile(r"(?<=[.!?。！？])\s+")


def _folder():
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "translations")


def _key(paragraphs, target):
    return hashlib.sha256(("\n".join([target, *paragraphs])).encode("utf-8")).hexdigest()[:32]


def _kept(key):
    try:
        with open(os.path.join(_folder(), f"{key}.json"), encoding="utf-8") as source:
            data = json.load(source)
        return data if isinstance(data, dict) and isinstance(data.get("paragraphs"), list) else None
    except (OSError, ValueError):
        return None


def pieces(text, size):
    """`text` cut at sentence ends (or, past that, anywhere) into pieces of at most `size` characters."""
    out, now = [], ""
    for sentence in SENTENCE.split(text):
        while len(sentence) > size:
            out += [now] if now else []
            out.append(sentence[:size])
            sentence, now = sentence[size:], ""
        if now and len(now) + 1 + len(sentence) > size:
            out.append(now)
            now = sentence
        else:
            now = f"{now} {sentence}".strip()
    return out + ([now] if now else [])


def _join(parts, target):
    return ("" if target == "zh-CN" else " ").join(part.strip() for part in parts)


def _piece(text, target, engines):
    """One piece in `target`, cut smaller for MyMemory when the providers that take long ones did not answer."""
    try:
        translated, engine, _why = translation_routes.translate_chain(text, target)
    except Exception:  # noqa: BLE001 - a piece too long for MyMemory: in small ones
        if len(text) <= SMALL:
            raise
        return _join([_piece(small, target, engines) for small in pieces(text, SMALL)], target)
    engines.add(engine)
    return translated


def _paragraph(text, target, engines):
    return _join([_piece(piece, target, engines) for piece in pieces(text, PIECE)], target)


def translate(paragraphs, target):
    """The paragraphs in `target`, kept for next time; raises when a provider answered none."""
    if (not isinstance(paragraphs, list) or not 0 < len(paragraphs) <= MAX_PARAGRAPHS
            or any(not isinstance(item, str) for item in paragraphs)):
        raise ValueError(f"paragraphs is a list of 1 to {MAX_PARAGRAPHS} texts")
    if target not in TARGETS:
        raise ValueError(f"target is one of {', '.join(TARGETS)}")
    paragraphs = [item.strip() for item in paragraphs]
    if sum(len(item) for item in paragraphs) > MAX_CHARS:
        raise ValueError(f"The text is over {MAX_CHARS} characters")
    key = _key(paragraphs, target)
    kept = _kept(key)
    if kept:
        return {**kept, "kept": True}
    engines = set()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        done = list(pool.map(lambda item: _paragraph(item, target, engines) if item else "", paragraphs))
    answer = {"paragraphs": done, "engine": ", ".join(sorted(engines)), "target": target, "at": time.time()}
    os.makedirs(_folder(), exist_ok=True)
    atomic_write_json(os.path.join(_folder(), f"{key}.json"), answer)
    return {**answer, "kept": False}


async def api_translate_description(request):
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        return web.json_response({"error": "Expected {paragraphs, target}"}, status=400)
    try:
        return web.json_response(await asyncio.to_thread(translate, body.get("paragraphs"), body.get("target")))
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)
    except Exception as error:  # noqa: BLE001 - every provider failed: the page says why, the original stays
        return web.json_response({"error": str(error)[:300] or type(error).__name__}, status=502)
