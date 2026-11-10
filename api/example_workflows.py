"""The example workflows Anomalous ships (api/examples/<id>.json), because a new install has no cards of
its own: plans (title), each in a version per model family (version) with a note (about). Most use only
ComfyUI's own nodes; a version may need a pack (packs) or a model, and says so. The Workflows page shows
them as one card (web/modules/ui_recipe_examples.js); list_workflows gives those that can run here to an
AI when no saved workflow fits, which opens and runs them like saved ones (file name "example:<id>").
A file names no model and no picture: read() fills in ones that are here, for a version with a Tile a model
the Tile fits (lllite_fit.py). What holds for a whole model family (Anima: several pictures are several
runs) is written once: for an AI in model_profiles.json, added to each of the family's notes; for the
user under the plan's heading (the page's words for `family`). Read only."""

import asyncio
import json
import os

import folder_paths
from aiohttp import web

from . import lllite_fit, model_guide, workflow_route

FOLDER = os.path.join(os.path.dirname(__file__), "examples")
PREFIX = "example:"
ORDER = ("text_to_picture", "two_pass", "two_pass_anima", "two_pass_anima_tile", "two_pass_anima_character", "picture_to_picture", "repaint")
LOADERS = ("CheckpointLoaderSimple", "UNETLoader", "CLIPLoader", "VAELoader", "AnimaLLLiteApply_sdscripts")
FAMILIES = {"sd": ("SDXL", "SD 1.x"), "anima": ("anima",)}  # what the examples' settings suit
FOR_MODELS = {"sd": "SDXL, SD 1.5", "anima": "Anima"}
PROFILES = {"anima": "Anima"}  # the model_profiles.json family whose notes hold for every example of a family
LOOK_AT = 40  # files looked at for a model of a family
MAX_WITH_SETTINGS = 3  # saved workflows listed in full for an AI: an AI app files a long answer away, unread
SHORT_NOTES = 120  # characters of a card's notes in a longer list
PICTURES = (".png", ".jpg", ".jpeg", ".webp")


def _load():
    examples = {}
    for key in ORDER:
        with open(os.path.join(FOLDER, f"{key}.json"), encoding="utf-8") as file:
            examples[key] = json.load(file)
    return examples


EXAMPLES = _load()


def _here():
    """The loaders' drop-downs, in the form reference_blocks reads /object_info, and the nodes of the packs the
    examples need (whether they are here); a node type not here is left out."""
    import nodes

    kinds = set(LOADERS) | {kind for example in EXAMPLES.values() for kind in example.get("packs") or {}}
    return {kind: {"input": nodes.NODE_CLASS_MAPPINGS[kind].INPUT_TYPES()} for kind in kinds if kind in nodes.NODE_CLASS_MAPPINGS}


def _model(info, kind, field, family, fits=lambda name: True):
    """The first file loader `kind` offers of `family` (those named for it looked at first) that `fits`, or ""."""
    from . import model_advice, reference_blocks

    names = sorted(reference_blocks._choices(info, kind, field), key=lambda name: family not in name.lower())
    return next((name for name in names[:LOOK_AT] if model_advice.family(model_advice._main_base(name)) in FAMILIES[family] and fits(name)), "")


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
    packs = [{"pack": pack} for pack in dict.fromkeys(pack for kind, pack in (example.get("packs") or {}).items() if kind not in info)]
    kinds = {node["type"] for node in example["workflow"]["nodes"]}
    return packs + [{"model": kind} for kind in LOADERS if kind in kinds and kind in info and not fills.get(kind)]


def read(example_id):
    """Example `example_id` on files that are here (those missing stay blank), or None when there is no such example."""
    example = EXAMPLES.get(example_id)
    if not example:
        return None
    info = _here()
    fills = dict(_fills(info))
    tile = fills.get("AnimaLLLiteApply_sdscripts")
    if tile and any(node["type"] == "AnimaLLLiteApply_sdscripts" for node in example["workflow"]["nodes"]):
        # a Tile made for the 2B models stops the run on a larger one: open on one it fits, when there is one
        fills["UNETLoader"] = _model(info, "UNETLoader", "unet_name", "anima", lambda name: not lllite_fit.problem(name, tile)) or fills["UNETLoader"]
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
             "family": item["family"], "lacks": _lacks(item, info, fills)} for key, item in EXAMPLES.items()]


def _notes(item):
    """An example's note for an AI, with what model_profiles.json says of its family."""
    family = model_guide.profile(PROFILES.get(item["family"])) or {}
    return " ".join([item["ai"], *family.get("notes", [])])


def for_ai():
    """The examples that can run here, as list_workflows gives saved workflows."""
    info = _here()
    fills = _fills(info)
    return [{"name": item["name"], "title": item["title"]["zh"], "example": True, "for_models": FOR_MODELS[item["family"]],
             "route": workflow_route.line(item["workflow"]), "notes": _notes(item)}
            for item in EXAMPLES.values() if not _lacks(item, info, fills)]


def _short(card):
    """A saved workflow in a longer list: what tells it apart."""
    shown = {key: value for key, value in card.items() if value and key not in ("settings", "saved")}
    return {**shown, "notes": shown["notes"][:SHORT_NOTES]} if "notes" in shown else shown


def answer(found, fits, limit):
    """What list_workflows gives: the saved workflows `found`, cut short when they are many, or else the examples
    that `fits`. The other examples go by name, so an AI with no card for the job knows of them."""
    examples = for_ai()
    fitting = [] if found else [item for item in examples if fits(item)]
    if len(found) > MAX_WITH_SETTINGS:
        found = [_short(card) for card in found]
    listed = found or fitting
    others = [item["name"] for item in examples if item not in fitting]
    return {"total_matches": len(listed), "workflows": listed[:limit], **({"examples": others} if others else {})}


def file_of(name):
    """The file name open_workflow and run_workflow take for the example called `name`, or None."""
    return next((PREFIX + key for key, item in EXAMPLES.items() if item["name"] == name), None)


async def api_examples(request):
    """GET /anomalous/example_workflows: the list; ?id=<id>: one, in `data` as /anomalous/recipe_full gives a card."""
    if "id" not in request.query:
        return web.json_response({"examples": await asyncio.to_thread(listing)})
    data = await asyncio.to_thread(read, request.query["id"])
    return web.json_response({"data": data}) if data else web.json_response({"error": "not_found"}, status=404)
