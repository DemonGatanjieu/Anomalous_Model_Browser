"""Covers of the voice characters (the Voices page's cards, web/modules/voice_covers.js): a picture the user picks
for a character, from the gallery or the computer, cropped square and made small by the page and checked and
made again here (no metadata kept). One per character's name: its versions ("角色/日配", "角色/中配") share it.
Kept in user/anomalous/voice_covers, a PNG per name by its hash and index.json naming them, never in
Anomalous_TTS's character folders. A cover taken away goes to the Recycle Bin (trash.py).
GET /anomalous/voice_covers -> {covers: {name: stamp}}; GET /anomalous/voice_cover?name= -> the PNG;
POST /anomalous/voice_cover {name, image: data URL} -> {stamp}; POST /anomalous/voice_cover/remove {name}."""

import asyncio
import base64
import hashlib
import io
import json
import os
import threading
import time

from aiohttp import web
from PIL import Image

from . import ai_tasks
from .path_utils import atomic_write_json

SIZE = 256
MAX_BYTES = 8 * 1024 * 1024
MAX_NAME = 200
INDEX = "index.json"

_lock = threading.Lock()


class CoverError(ValueError):
    pass


def _folder():
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "voice_covers")


def base_name(character):
    """The character's name without its version ("角色/日配" -> "角色")."""
    name = str(character or "").strip()
    return name.rsplit("/", 1)[0].strip() if "/" in name else name


def _file(name):
    return os.path.join(_folder(), hashlib.sha1(name.encode("utf-8")).hexdigest()[:20] + ".png")


def _index():
    try:
        with open(os.path.join(_folder(), INDEX), encoding="utf-8") as source:
            data = json.load(source)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def covers():
    """{name: stamp} of the covers there are; a stamp changes with the picture."""
    return {name: stamp for name, stamp in _index().items() if os.path.isfile(_file(name))}


def _checked(name):
    name = base_name(name)
    if not name or len(name) > MAX_NAME:
        raise CoverError("name is a character's name")
    return name


def set_cover(character, data_url):
    """Keeps the picture in `data_url` as `character`'s cover: a square, SIZE across, made again as a PNG."""
    name = _checked(character)
    if not isinstance(data_url, str) or "," not in data_url or not data_url.startswith("data:image/"):
        raise CoverError("image is a picture as a data URL")
    try:
        raw = base64.b64decode(data_url.split(",", 1)[1], validate=True)
    except (ValueError, TypeError) as error:
        raise CoverError("The picture could not be read") from error
    if len(raw) > MAX_BYTES:
        raise CoverError("The picture is too big")
    try:
        with Image.open(io.BytesIO(raw)) as source:
            source.load()
            picture = source.convert("RGBA" if "A" in source.getbands() else "RGB")
    except Exception as error:  # noqa: BLE001 - whatever it is, it is no picture to keep
        raise CoverError("The picture could not be read") from error
    side = min(picture.size)
    left, top = (picture.width - side) // 2, (picture.height - side) // 2
    picture = picture.crop((left, top, left + side, top + side)).resize((SIZE, SIZE), Image.LANCZOS)
    os.makedirs(_folder(), exist_ok=True)
    stamp = str(int(time.time() * 1000))
    with _lock:
        target = _file(name)
        temp = f"{target}.tmp"
        picture.save(temp, "PNG")
        os.replace(temp, target)
        index = _index()
        index[name] = stamp
        atomic_write_json(os.path.join(_folder(), INDEX), index)
    return {"name": name, "stamp": stamp}


def remove_cover(character):
    name = _checked(character)
    from .trash import move_to_trash

    with _lock:
        if os.path.isfile(_file(name)):
            move_to_trash(_file(name))
        index = _index()
        index.pop(name, None)
        if os.path.isdir(_folder()):
            atomic_write_json(os.path.join(_folder(), INDEX), index)
    return {"name": name}


async def _body(request):
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise CoverError("Expected a JSON object")
    return body


async def api_list(request):
    return web.json_response({"covers": await asyncio.to_thread(covers)})


async def api_get(request):
    name = base_name(request.query.get("name", ""))
    path = _file(name) if name else ""
    if not name or not os.path.isfile(path):
        return web.json_response({"error": "No cover"}, status=404)
    return web.FileResponse(path, headers={"Cache-Control": "no-cache"})


async def api_set(request):
    try:
        body = await _body(request)
        return web.json_response(await asyncio.to_thread(set_cover, body.get("name"), body.get("image")))
    except CoverError as error:
        return web.json_response({"error": str(error)}, status=400)


async def api_remove(request):
    try:
        body = await _body(request)
        return web.json_response(await asyncio.to_thread(remove_cover, body.get("name")))
    except CoverError as error:
        return web.json_response({"error": str(error)}, status=400)
    except Exception as error:  # noqa: BLE001 - no Recycle Bin here (trash.py): it stays, and the page says why
        return web.json_response({"error": str(error)[:300]}, status=500)
