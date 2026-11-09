"""Whether a prompt is in a language the canvas's drawing model can read, before a run. A family whose text
encoders read English words and tags only ("reads": "English" in model_profiles.json: SD 1.5, SDXL, Pony,
Illustrious, Flux, Chroma) draws a Chinese or Japanese prompt as if it were nearly empty, so the picture has
nothing to do with it and is whatever the model leans to. The page (web/modules/prompt_language.js) asks with
the model files its loaders name and the prompts a run or a job sheet would send; the AI's run is then refused
once, the user's job sheet asks once. A model whose base is not known is not judged.
POST /anomalous/prompt_language {models: [file name], texts: [prompt]} -> {family, model} or {}."""

import asyncio
import os
import re

import folder_paths
from aiohttp import web

from . import model_guide
from .metadata import get_metadata

FOLDERS = ("checkpoints", "diffusion_models", "unet")
MAX_ITEMS = 40
EAST_ASIAN = re.compile(r"[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]")
LATIN = re.compile(r"[A-Za-z]")


def foreign(text):
    """Whether `text` is mostly Chinese, Japanese or Korean: two such characters or more, and at least a third of
    its letters (a word in English is about five letters to a character's one)."""
    east = len(EAST_ASIAN.findall(str(text or "")))
    latin = len(LATIN.findall(str(text or "")))
    return east >= 2 and east * 5 >= (east * 5 + latin) / 3


def _family(name):
    """The profile of drawing model file `name` (as a loader names it), when its base is known."""
    for folder in FOLDERS:
        try:
            path = folder_paths.get_full_path(folder, name)
        except Exception:  # noqa: BLE001 - a folder type this ComfyUI does not have
            path = None
        if path and os.path.isfile(path):
            meta = get_metadata(path)
            return model_guide.profile(meta.get("baseModel") or meta.get("base_guess") or "")
    return None


def check(models, texts):
    """{family, model} when a prompt of `texts` is in a language a model of `models` cannot read, else {}."""
    if not any(foreign(text) for text in texts[:MAX_ITEMS] if isinstance(text, str)):
        return {}
    for name in models[:MAX_ITEMS]:
        family = _family(name) if isinstance(name, str) and name else None
        if family and family.get("reads") == "English":
            return {"family": family["family"], "model": os.path.basename(name.replace("\\", "/"))}
    return {}


async def api_check(request):
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict) or not isinstance(body.get("models"), list) or not isinstance(body.get("texts"), list):
        return web.json_response({"error": "Expected {models, texts}"}, status=400)
    return web.json_response(await asyncio.to_thread(check, body["models"], body["texts"]))
