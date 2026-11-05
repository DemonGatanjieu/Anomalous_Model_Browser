"""The example workflows Anomalous ships (api/examples/<id>.json): a few plain routes on ComfyUI's own
nodes, because a new install has no cards of its own. The Workflows page shows them as one card
(web/modules/ui_recipe_examples.js); list_workflows gives them to an AI when no saved workflow fits,
which opens and runs them like saved ones (file name "example:<id>"). A file names no model and no
picture: read() fills in ones that are here. Read only."""

import asyncio
import json
import os

import folder_paths
from aiohttp import web

from . import workflow_route

FOLDER = os.path.join(os.path.dirname(__file__), "examples")
PREFIX = "example:"
FAMILIES = ("SDXL", "SD 1.x")  # what the examples' settings suit
LOOK_AT = 40  # checkpoints looked at for one of those
PICTURES = (".png", ".jpg", ".jpeg", ".webp")
ORDER = ("text_to_picture", "two_pass", "picture_to_picture", "repaint")


def _load():
    examples = {}
    for key in ORDER:
        with open(os.path.join(FOLDER, f"{key}.json"), encoding="utf-8") as file:
            examples[key] = json.load(file)
    return examples


EXAMPLES = _load()


def _checkpoint():
    """A checkpoint the examples suit, else the first there is, else ""."""
    from . import model_advice

    names = folder_paths.get_filename_list("checkpoints")
    for name in names[:LOOK_AT]:
        if model_advice.family(model_advice.base_of(folder_paths.get_full_path("checkpoints", name))) in FAMILIES:
            return name
    return names[0] if names else ""


def _picture():
    """A picture in ComfyUI's input folder, its own example if that is there, else ""."""
    try:
        names = sorted(name for name in os.listdir(folder_paths.get_input_directory()) if name.lower().endswith(PICTURES))
    except OSError:
        return ""
    return "example.png" if "example.png" in names else names[0] if names else ""


def read(example_id):
    """Example `example_id` with a checkpoint and a picture that are here, `lacks_model` when there is no checkpoint; None when there is no such example."""
    example = EXAMPLES.get(example_id)
    if not example:
        return None
    workflow = json.loads(json.dumps(example["workflow"]))
    fill = {"CheckpointLoaderSimple": _checkpoint(), "LoadImage": _picture()}
    for node in workflow["nodes"]:
        if node["type"] in fill:
            node["widgets_values"][0] = fill[node["type"]]
    return {"name": example["name"], "title": example["title"], "workflow": workflow, "lacks_model": not fill["CheckpointLoaderSimple"]}


def listing():
    """What the page's window shows of each example."""
    return [{"id": key, "title": item["title"], "about": item["about"]} for key, item in EXAMPLES.items()]


def for_ai():
    """The examples as list_workflows gives saved workflows."""
    return [{"name": item["name"], "example": True, "route": workflow_route.line(item["workflow"]), "notes": item["ai"]} for item in EXAMPLES.values()]


def file_of(name):
    """The file name open_workflow and run_workflow take for the example called `name`, or None."""
    return next((PREFIX + key for key, item in EXAMPLES.items() if item["name"] == name), None)


async def api_examples(request):
    """GET /anomalous/example_workflows: the list; ?id=<id>: one, in `data` as /anomalous/recipe_full gives a card."""
    if "id" not in request.query:
        return web.json_response({"examples": listing()})
    data = await asyncio.to_thread(read, request.query["id"])
    return web.json_response({"data": data}) if data else web.json_response({"error": "not_found"}, status=404)
