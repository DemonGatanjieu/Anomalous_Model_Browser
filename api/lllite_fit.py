"""Whether an Anima ControlNet-LLLite fits the drawing model it is put on, before a run. An LLLite file
holds modules for each block of the model it was trained on (lllite_dit_blocks_<n>_…: 28 blocks for the 2B
Anima models); on a model with more blocks (40 for the 2.9B ones) ComfyUI-Anima-LLLite stops the run with
"depth_embed slices missing". Both counts are read from the files' headers, so nothing is told by a
model's name or size. The page (web/modules/lllite_fit.js) asks with the LLLite nodes a run would send
and the model each is put on; the AI's run is then refused with what to change. An example with a Tile
opens on a model the Tile fits (example_workflows.py). A file whose header cannot tell is not judged.
POST /anomalous/lllite_fit {uses: [{model, lllite}]} -> {problems: [{model, lllite, blocks, made_for}]}."""

import asyncio
import os
import re

import folder_paths
from aiohttp import web

try:
    from ..model_kind import read_head
except ImportError:  # loaded outside the package (tests)
    from model_kind import read_head

MODEL_FOLDERS = ("diffusion_models", "unet", "checkpoints")
MAX_USES = 20
MODEL_BLOCK = re.compile(r"(?:^|\.)blocks\.(\d+)\.")
LLLITE_BLOCK = re.compile(r"^lllite_dit_blocks_(\d+)_")


def _path(folders, name):
    for folder in folders:
        try:
            path = folder_paths.get_full_path(folder, name)
        except (KeyError, TypeError):
            path = None
        if path and os.path.isfile(path):
            return path
    return None


def _blocks(path, pattern):
    """How many blocks the names in the header of `path` count (by `pattern`); 0 when it cannot tell."""
    fmt, header = read_head(path) if path else (None, None)
    if fmt != "safetensors" or not header:
        return 0
    return len({int(found.group(1)) for key in header if (found := pattern.search(key))})


def problem(model, lllite):
    """{model, lllite, blocks, made_for} when LLLite file `lllite` (as its node names it) has no modules for
    some blocks of drawing model `model` (as its loader names it), else None."""
    made_for = _blocks(_path(("controlnet",), lllite), LLLITE_BLOCK)
    blocks = _blocks(_path(MODEL_FOLDERS, model), MODEL_BLOCK)
    if not made_for or blocks <= made_for:
        return None
    short = lambda name: os.path.basename(str(name).replace("\\", "/"))  # noqa: E731
    return {"model": short(model), "lllite": short(lllite), "blocks": blocks, "made_for": made_for}


def check(uses):
    found = []
    for use in uses[:MAX_USES]:
        if isinstance(use, dict) and isinstance(use.get("model"), str) and isinstance(use.get("lllite"), str):
            odd = problem(use["model"], use["lllite"])
            if odd:
                found.append(odd)
    return found


async def api_check(request):
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict) or not isinstance(body.get("uses"), list):
        return web.json_response({"error": "Expected {uses}"}, status=400)
    return web.json_response({"problems": await asyncio.to_thread(check, body["uses"])})
