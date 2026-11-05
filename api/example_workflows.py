"""The example workflows Anomalous ships (api/examples/<id>.json), because a new install has no cards of
its own: plans (title), each in a version per model family (version) with a note (about). Most use only
ComfyUI's own nodes; a version may need a pack (packs) or a model, and says so. The Workflows page shows
them as one card (web/modules/ui_recipe_examples.js); list_workflows gives those that can run here to an
AI when no saved workflow fits, which opens and runs them like saved ones (file name "example:<id>").
A file names no model and no picture: read() fills in ones that are here. Read only."""

import asyncio
import json
import os

import folder_paths
from aiohttp import web

from . import workflow_route

FOLDER = os.path.join(os.path.dirname(__file__), "examples")
PREFIX = "example:"
ORDER = ("text_to_picture", "two_pass", "two_pass_anima", "two_pass_anima_tile", "picture_to_picture", "repaint")
LOADERS = ("CheckpointLoaderSimple", "UNETLoader", "CLIPLoader", "VAELoader", "AnimaLLLiteApply_sdscripts")
FAMILIES = {"sd": ("SDXL", "SD 1.x"), "anima": ("anima",)}  # what the examples' settings suit
FOR_MODELS = {"sd": "SDXL, SD 1.5", "anima": "Anima"}
LOOK_AT = 40  # files looked at for a model of a family
PICTURES = (".png", ".jpg", ".jpeg", ".webp")


def _load():
    examples = {}
    for key in ORDER:
        with open(os.path.join(FOLDER, f"{key}.json"), encoding="utf-8") as file:
            examples[key] = json.load(file)
    return examples


EXAMPLES = _load()


def _here():
    """The loaders' drop-downs, in the form reference_blocks reads /object_info; a node type not here is left out."""
    import nodes

    return {kind: {"input": nodes.NODE_CLASS_MAPPINGS[kind].INPUT_TYPES()} for kind in LOADERS if kind in nodes.NODE_CLASS_MAPPINGS}


def _model(info, kind, field, family):
    """The first file loader `kind` offers of `family` (those named for it looked at first), or ""."""
    from . import model_advice, reference_blocks

    names = sorted(reference_blocks._choices(info, kind, field), key=lambda name: family not in name.lower())
    return next((name for name in names[:LOOK_AT] if model_advice.family(model_advice._main_base(name)) in FAMILIES[family]), "")


def _picture():
    """A picture in ComfyUI's input folder, its own example if that is there, else ""."""
    try:
        names = sorted(name for name in os.listdir(folder_paths.get_input_directory()) if name.lower().endswith(PICTURES))
    except OSError:
        return ""
    return "example.png" if "example.png" in names else names[0] if names else ""


def _fills(info):
    """{node type: the file it takes here} for the examples' loaders, "" for what is not here."""
    from . import reference_blocks

    checkpoints = reference_blocks._choices(info, "CheckpointLoaderSimple", "ckpt_name")
    fills = {"CheckpointLoaderSimple": _model(info, "CheckpointLoaderSimple", "ckpt_name", "sd") or next(iter(checkpoints), ""),
             "UNETLoader": _model(info, "UNETLoader", "unet_name", "anima"), "LoadImage": _picture()}
    for kind, field, marks in reference_blocks.BLOCKS["picture"]["variants"]["anima"]["files"].values():
        fills[kind] = reference_blocks._file_like(info, kind, field, marks) or ""
    try:
        fills["AnimaLLLiteApply_sdscripts"] = reference_blocks._lllite(info, "tile")
    except reference_blocks.MissingModel:
        fills["AnimaLLLiteApply_sdscripts"] = ""
    return fills


def _lacks(example, info, fills):
    """What `example` needs and this ComfyUI lacks: [{pack}] or [{model: the loader's type}]."""
    packs = [{"pack": pack} for kind, pack in (example.get("packs") or {}).items() if kind not in info]
    kinds = {node["type"] for node in example["workflow"]["nodes"]}
    return packs + [{"model": kind} for kind in LOADERS if kind in kinds and kind in info and not fills.get(kind)]


def read(example_id):
    """Example `example_id` on files that are here (those missing stay blank), or None when there is no such example."""
    example = EXAMPLES.get(example_id)
    if not example:
        return None
    fills = _fills(_here())
    workflow = json.loads(json.dumps(example["workflow"]))
    for node in workflow["nodes"]:
        if node["type"] in fills:
            node["widgets_values"][0] = fills[node["type"]]
    return {"name": example["name"], "workflow": workflow}


def listing():
    """What the page's window shows of each example, and what it lacks here."""
    info = _here()
    fills = _fills(info)
    return [{"id": key, "title": item["title"], "version": item["version"], "about": item["about"], "recommended": bool(item.get("recommended")),
             "lacks": _lacks(item, info, fills)} for key, item in EXAMPLES.items()]


def for_ai():
    """The examples that can run here, as list_workflows gives saved workflows."""
    info = _here()
    fills = _fills(info)
    return [{"name": item["name"], "example": True, "for_models": FOR_MODELS[item["family"]], "route": workflow_route.line(item["workflow"]), "notes": item["ai"]}
            for item in EXAMPLES.values() if not _lacks(item, info, fills)]


def file_of(name):
    """The file name open_workflow and run_workflow take for the example called `name`, or None."""
    return next((PREFIX + key for key, item in EXAMPLES.items() if item["name"] == name), None)


async def api_examples(request):
    """GET /anomalous/example_workflows: the list; ?id=<id>: one, in `data` as /anomalous/recipe_full gives a card."""
    if "id" not in request.query:
        return web.json_response({"examples": await asyncio.to_thread(listing)})
    data = await asyncio.to_thread(read, request.query["id"])
    return web.json_response({"data": data}) if data else web.json_response({"error": "not_found"}, status=404)
