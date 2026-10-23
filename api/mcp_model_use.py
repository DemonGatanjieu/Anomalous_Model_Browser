"""Where a model loads, for the AI: search_models and get_model (mcp_tools.py finds the files)
say which node types list each file among their choices (ComfyUI's /object_info, kept a little
while by mcp_canvas_edit.py), and, when a file's header says it is another kind than the folder
it is in (model_placement.py, the models page's Tidy view), where it belongs and that nothing
loads it where it is. So the AI picks the right node at once, or has the model moved, instead of
searching ComfyUI itself. move_model moves one model with its covers and notes as Tidy does,
behind the "files" gate (the user says yes first unless they let it go ahead)."""

import os
import threading

import folder_paths

from . import mcp_canvas_edit, mcp_tools, model_placement
from .mcp_actions import _action
from .mcp_tools import _LIMIT, _QUERY, ToolError
from .model_constants import MODEL_EXTENSIONS
from .model_import import Refused, import_types

MAX_LOADERS = 6

_lock = threading.Lock()
_index = {"of": None, "inputs": [], "by_choice": {}}


def _plain(name):
    return str(name).replace("\\", "/")


def _choices(conf):
    if not isinstance(conf, list) or not conf:
        return None
    if isinstance(conf[0], list):
        return conf[0]
    options = conf[1] if len(conf) > 1 and isinstance(conf[1], dict) else {}
    return options.get("options") if conf[0] == "COMBO" and isinstance(options.get("options"), list) else None


def _built(info):
    """The drop-downs of model files in node definitions `info`: [(node type, choices)] and choice -> their places."""
    with _lock:
        if _index["of"] is info:
            return _index
        inputs, by_choice = [], {}
        for node_type, item in info.items():
            for section in ("required", "optional"):
                for conf in ((item.get("input") or {}).get(section) or {}).values():
                    listed = [_plain(choice) for choice in _choices(conf) or [] if isinstance(choice, str)]
                    if not any(choice.lower().endswith(MODEL_EXTENSIONS) for choice in listed):
                        continue
                    for choice in listed:
                        by_choice.setdefault(choice, []).append(len(inputs))
                    inputs.append((node_type, frozenset(listed)))
        _index.update(of=info, inputs=inputs, by_choice=by_choice)
        return _index


def _folder(folder_type):
    return frozenset(_plain(name) for name in folder_paths.get_filename_list(folder_type))


def _readers(ctx, folder_type, rel=None):
    """Node types with a drop-down of the whole folder `folder_type` (one that lists `rel`, when given)."""
    index = _built(mcp_canvas_edit.object_info(ctx))
    folder = _folder(folder_type)
    if not folder:
        return []
    places = index["by_choice"].get(_plain(rel), []) if rel else range(len(index["inputs"]))
    found = []
    for at in places:
        node_type, choices = index["inputs"][at]
        if folder <= choices and node_type not in found:
            found.append(node_type)
    return found[:MAX_LOADERS]


def _about(ctx, model):
    """`model` (from mcp_tools) with what loads it: loaded_by, or belongs_in and placement when it is misfiled."""
    folder_type, root, base_dir, path = mcp_tools._resolve_model(model["model_id"])
    rel = os.path.relpath(path, base_dir).replace(os.sep, "/")
    home = model_placement.belongs(model_placement.one(folder_type, root, rel, path))
    if not home or home["works"]:
        model["loaded_by"] = _readers(ctx, folder_type, rel)
        return model
    kind, to = home["kind"], home["to"]
    readers = _readers(ctx, kind)
    words = (f"Its header says it is a {kind} file, but it is in {folder_type}: the nodes listing it there cannot load it"
             + (f"; {', '.join(readers)} load {kind} files." if readers else "."))
    there = os.path.join(folder_paths.get_folder_paths(kind)[to["root"]], *to["rel"].split("/"))
    if os.path.isfile(there):
        words += (f" A file of the same name is already in {kind} (model_id {kind}:{to['root']}:{to['rel']}): use that one. "
                  "If it is the same file, this copy is extra; the user can recycle it in Anomalous's models page (Tidy).")
    else:
        words += f" move_model with to_type {kind} moves it there (the user confirms first)."
    model.update(belongs_in=kind, placement=words)
    return model


def search_models(ctx, query="", type="", base_model="", source="", limit=20):
    found = mcp_tools.search_models(query, type, base_model, source, limit)
    for model in found["models"]:
        _about(ctx, model)
    return found


def get_model(ctx, model_id, include_cover=False):
    detail, extra = mcp_tools.get_model(model_id, include_cover)
    return _about(ctx, detail), extra


def move_model(ctx, model_id, to_type):
    folder_type, root, base_dir, path = mcp_tools._resolve_model(model_id)
    rel = os.path.relpath(path, base_dir).replace(os.sep, "/")
    item = model_placement.one(folder_type, root, rel, path)
    home = model_placement.belongs(item)
    to_type = str(to_type or "")
    if to_type == folder_type:
        raise ToolError(f"It is in {to_type} already.")
    if to_type not in import_types():
        raise ToolError(f"to_type is one of {', '.join(import_types())}.")
    to = home["to"] if home and home["kind"] == to_type else model_placement.home_for(item, to_type)
    if not to:
        raise ToolError(f"This ComfyUI has no {to_type} folder.")
    if os.path.exists(os.path.join(folder_paths.get_folder_paths(to_type)[to["root"]], *to["rel"].split("/"))):
        raise ToolError(f"A file of the same name is already in {to_type} (model_id {to_type}:{to['root']}:{to['rel']}); "
                        "nothing was moved. Use that one; the user can recycle an extra copy in Anomalous's models page (Tidy).")
    try:
        moved = model_placement.move({"type": folder_type, "root": root, "rel": rel,
                                      "to_type": to_type, "to_root": to["root"], "to_rel": to["rel"]})
    except Refused as error:
        raise ToolError(f"Not moved ({error.code}).")
    mcp_canvas_edit.forget_object_info()
    answer = {"moved": {"from": f"{folder_type}/{rel}", "to": f"{moved['type']}/{moved['rel']}"},
              "model_id": f"{moved['type']}:{moved['root']}:{moved['rel']}",
              "loaded_by": _readers(ctx, moved["type"], moved["rel"])}
    if moved["left"]:
        answer["left_behind"] = moved["left"]  # covers or notes that could not go along
    return answer


MODEL_TOOLS = dict([
    _action("search_models", "Search models",
            "Find model files (checkpoints, LoRAs, VAEs…) by name, trigger word or base model. Returns model_id for "
            "get_model, and loaded_by: the node types whose drop-down lists the file (use one of them). A file in the "
            "wrong folder for what it is comes with belongs_in and placement instead: nothing loads it where it is.",
            search_models, {
                "query": _QUERY,
                "type": {"type": "string", "description": "ComfyUI models folder, e.g. checkpoints, loras, vae, diffusion_models, model_patches."},
                "base_model": {"type": "string", "description": "Part of the base model name, e.g. SDXL, Pony, Flux, SD 1.5."},
                "source": {"type": "string", "enum": ["civitai", "inferred_from_file", "not_scanned"],
                           "description": "Where the model's information came from."},
                "limit": _LIMIT}, read_only=True),
    _action("get_model", "Model details",
            "Everything known about one model: Civitai name and link, trigger words, base model, description, "
            "the user's own name and notes, and loaded_by (or belongs_in and placement) as in search_models. "
            "include_cover attaches its cover picture.",
            get_model, {"model_id": {"type": "string", "description": "From search_models."},
                        "include_cover": {"type": "boolean", "default": False}}, ["model_id"], read_only=True),
    _action("move_model", "Move a model to its folder",
            "Moves a model the user has in the wrong models folder (search_models says belongs_in) to where it loads, "
            "with its covers and notes, as Anomalous's Tidy view does; never over a file. The answer gives its new "
            "model_id and loaded_by; the canvas lists it from then on.",
            move_model, {"model_id": {"type": "string", "description": "From search_models."},
                         "to_type": {"type": "string", "description": "The models folder to move it to: belongs_in from search_models."}},
            ["model_id", "to_type"], destructive=True),
])
