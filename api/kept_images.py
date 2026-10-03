"""What each output image was kept as (GET /anomalous/kept_images), for the gallery's star:
the Workflow Recipe whose source image it is, the combo made from it (a notebook file with
`source_image`), the saved prompt taken from it (a prompt plan material whose source names
the image). Each is {filename, name}, or null when the image was not kept as that."""

import asyncio

from aiohttp import web

from .material_store import _list_materials, get_materials_dir
from .notebooks import _list_notebooks
from .recipe_store import _list_recipes, get_recipes_dir

KINDS = ("recipe", "combo", "prompt")


def _kept_images():
    kept = {}

    def mark(image, kind, filename, name):
        if not isinstance(image, dict) or not isinstance(image.get("filename"), str) or not image["filename"]:
            return
        subfolder = image.get("subfolder") if isinstance(image.get("subfolder"), str) else ""
        entry = kept.setdefault((subfolder, image["filename"]), dict.fromkeys(KINDS))
        if entry[kind] is None:
            entry[kind] = {"filename": filename, "name": str(name or "")}

    for recipe in _list_recipes(get_recipes_dir()):
        mark(recipe["data"].get("source_image"), "recipe", recipe["filename"], recipe["data"].get("name"))
    for note in _list_notebooks():
        mark(note["data"].get("source_image"), "combo", note["filename"], note["name"])
    for material in _list_materials(get_materials_dir()):
        if material.get("kind") == "prompt_plan":
            mark(material.get("source_image"), "prompt", material["filename"], material.get("name"))
    return [{"subfolder": subfolder, "filename": filename, **entry} for (subfolder, filename), entry in kept.items()]


async def api_kept_images(request):
    try:
        images = await asyncio.to_thread(_kept_images)
    except (OSError, ValueError):
        return web.json_response({"status": "error", "message": "Could not list kept images"}, status=500)
    return web.json_response({"status": "success", "images": images})
