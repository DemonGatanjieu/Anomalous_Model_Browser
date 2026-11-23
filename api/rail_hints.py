"""GET /anomalous/rail_hints: which optional pages of the left rail were used before, so a browser
that ran an earlier version keeps them on the rail (web/modules/rail_pins.js asks once).

Read only and quick: it looks for one file of each kind, scans no model and reads at most
MAX_MATERIALS small files. It never creates a folder: the stores' own folder helpers do
(notebooks, materials, AI tasks, the activity log's folder), so their paths are built here
from the user directory, each beside the helper it mirrors."""

import asyncio
import json
import os

import folder_paths
from aiohttp import web

from .material_schema import _material_category, _material_summary
from .workflow_saves import INDEX, saves_dir

MAX_MATERIALS = 100  # read to tell saved prompts from a node's saved values
MAX_MATERIAL_BYTES = 1024 * 1024  # larger ones hold a whole workflow


def _json_files(directory):
    """The visible .json files in `directory`; none when it is missing or unreadable."""
    try:
        with os.scandir(directory) as entries:
            for entry in entries:
                if entry.name.endswith(".json") and not entry.name.startswith(".") and entry.is_file():
                    yield entry
    except OSError:
        return


def _any(directory):
    return next(_json_files(directory), None) is not None


def _materials(directory):
    """(prompts, assistant): a saved prompt, and a node's saved values, among the first materials.
    Whole workflows kept as materials count for neither (they belong to Workflows)."""
    prompts = assistant = False
    for index, entry in enumerate(_json_files(directory)):
        if index >= MAX_MATERIALS or (prompts and assistant):
            break
        try:
            if entry.stat().st_size > MAX_MATERIAL_BYTES:
                continue
            with open(entry.path, encoding="utf-8") as source:
                material = json.load(source)
            category = _material_category(_material_summary(entry.name, material)) if isinstance(material, dict) else None
        except (OSError, ValueError, TypeError, AttributeError, KeyError):
            continue  # a broken file says nothing
        prompts = prompts or category == "prompts"
        assistant = assistant or category == "params"
    return prompts, assistant


def _saves(directory):
    try:
        with os.scandir(directory) as entries:
            return any(entry.is_dir() and os.path.isfile(os.path.join(entry.path, INDEX)) for entry in entries)
    except OSError:
        return False


def collect_rail_hints():
    """{combos, prompts, ai, saves, assistant, scan}: each True when the user has something of it on disk."""
    user_dir = folder_paths.get_user_directory()
    workflows = os.path.join(user_dir, "workflows")
    prompts, assistant = _materials(os.path.join(workflows, "anomalous_materials"))  # material_store.get_materials_dir
    return {
        "combos": _any(os.path.join(workflows, "anomalous_notebooks")),  # notebooks.get_notebooks_dir
        "prompts": prompts,
        "ai": _any(os.path.join(user_dir, "anomalous", "ai_tasks")),  # ai_tasks.tasks_dir
        "saves": _saves(saves_dir()),
        "assistant": assistant,
        # scan_report.last_scan_path: written by a scan that ran (the scan page's summary is not: opening it writes one)
        "scan": os.path.isfile(os.path.join(user_dir, "anomalous", "last_scan.json")),
    }


async def api_rail_hints(request):
    return web.json_response(await asyncio.to_thread(collect_rail_hints))


def register_routes(app):
    app.router.add_get('/anomalous/rail_hints', api_rail_hints)
