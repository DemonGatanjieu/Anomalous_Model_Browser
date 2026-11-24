"""A workflow out of a picture file dropped on the Workflows page (ui_recipe_drop.js), to be kept as a
recipe there. ComfyUI writes the canvas's workflow into the pictures it saves: a PNG's "workflow" text
(and the run's "prompt"), a WebP's EXIF ("workflow:{...}" in Make, "prompt:{...}" in Model). Only the
UI workflow can become a recipe; a picture that carries the run alone is told apart (api_only), so the
page can say why. Nothing is kept here: the page saves the recipe itself (recipe_save.js persistRecipe).

POST /anomalous/inspect_workflow_file?name=<file name> with the picture's bytes: {status, workflow,
suggested_name}, or 400 {status: "error", code, message}. It reads what the user drops, so it is for
this computer only, as every POST that is not listed open (local_guard.py).
"""

import asyncio
import io
import os

from aiohttp import web
from PIL import Image

from .recipe_constants import MAX_NAME_LENGTH
from .recipe_images import _decode_embedded_json
from .workflow_schema import _validate_workflow

MAX_WORKFLOW_IMAGE_BYTES = 64 * 1024 * 1024
EXIF_TAGS = (0x010F, 0x010E, 0x0110)  # Make, ImageDescription, Model: where ComfyUI's WebP saver writes


class WorkflowImportError(ValueError):
    """Why a file gives no workflow: `code` is too_large, not_image, no_workflow, api_only or invalid_workflow."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _decoded(value):
    try:
        return _decode_embedded_json(value)
    except ValueError:  # not JSON, or not UTF-8
        return None


def _exif_texts(image):
    """{"workflow": text, "prompt": text} from the picture's EXIF; a text without a "name:" goes for the workflow."""
    texts = {}
    exif = image.getexif()
    for tag in EXIF_TAGS:
        value = exif.get(tag)
        if isinstance(value, bytes):
            value = value.decode("utf-8", "replace")
        if not isinstance(value, str):
            continue
        key, colon, rest = value.partition(":")
        key = key.strip().lower()
        if colon and key in ("workflow", "prompt"):
            texts.setdefault(key, rest)
        elif tag != 0x0110:
            texts.setdefault("workflow", value)
    return texts


def extract_workflow_from_image_bytes(raw_bytes, filename=""):
    """The UI workflow a picture carries: {"workflow", "suggested_name"} (the file name without its extension)."""
    if not raw_bytes or len(raw_bytes) > MAX_WORKFLOW_IMAGE_BYTES:
        raise WorkflowImportError("too_large", f"A picture up to {MAX_WORKFLOW_IMAGE_BYTES // (1024 * 1024)} MB")
    try:
        with Image.open(io.BytesIO(raw_bytes)) as image:
            exif = _exif_texts(image)
            workflow = _decoded(image.info.get("workflow")) or _decoded(exif.get("workflow"))
            prompt = _decoded(image.info.get("prompt")) or _decoded(exif.get("prompt"))
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise WorkflowImportError("not_image", "Not a picture that can be read") from error
    if not isinstance(workflow, dict) or not isinstance(workflow.get("nodes"), list):
        if prompt:
            raise WorkflowImportError("api_only", "The picture keeps only the run (API format), not the workflow")
        raise WorkflowImportError("no_workflow", "The picture carries no workflow")
    try:
        _validate_workflow(workflow)
    except ValueError as error:
        raise WorkflowImportError("invalid_workflow", str(error)) from error
    stem = os.path.splitext(os.path.basename(str(filename or "").replace("\\", "/")))[0].strip()
    return {"workflow": workflow, "suggested_name": stem[:MAX_NAME_LENGTH]}


async def api_inspect_workflow_file(request):
    try:
        if (request.content_length or 0) > MAX_WORKFLOW_IMAGE_BYTES:
            raise WorkflowImportError("too_large", f"A picture up to {MAX_WORKFLOW_IMAGE_BYTES // (1024 * 1024)} MB")
        raw = await request.read()
        found = await asyncio.to_thread(extract_workflow_from_image_bytes, raw, request.query.get("name", ""))
    except WorkflowImportError as error:
        return web.json_response({"status": "error", "code": error.code, "message": str(error)}, status=400)
    return web.json_response({"status": "success", **found})
