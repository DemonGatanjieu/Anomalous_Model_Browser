"""The MCP tools that build a workflow on the canvas the user sees: add_node, connect_nodes,
set_values, remove_nodes and new_workflow (a new tab, blank or built from a workflow in
ComfyUI's API form) run in the open page like mcp_actions.py's canvas tools
(web/modules/mcp_canvas_edit.js: each one Ctrl+Z step, in the activity log as the AI's, so the
AI workbench shows what it changed), and find_nodes reads the node types this ComfyUI has
from its own /object_info. Arguments are checked here for shape and size; the page checks
them against the nodes themselves before anything changes."""

import json
import threading
import time

from . import ai_tasks, ai_toolbox
from .mcp_actions import _action, _local, _page
from .mcp_tools import ToolError, _limit

MAX_FOUND = 20
MAX_CHOICES = 12
MAX_CHOICES_NAMED = 60
MAX_VALUES = 60
MAX_TEXT = 20000
MAX_REMOVE = 30
MAX_WORKFLOW_NODES = 200
MAX_WORKFLOW_BYTES = 1_000_000
INFO_SECONDS = 120

_info = {"at": 0.0, "data": None}
_info_lock = threading.Lock()


def _object_info(ctx):
    """ComfyUI's node definitions, as its own page reads them (kept a little while)."""
    with _info_lock:
        if _info["data"] is None or time.monotonic() - _info["at"] > INFO_SECONDS:
            status, data = _local(ctx, "GET", "/object_info", timeout=60)
            if status != 200 or not isinstance(data, dict):
                raise ToolError(f"ComfyUI's node list is unavailable ({status}).")
            _info.update(at=time.monotonic(), data=data)
        return _info["data"]


def _input(name, conf, required, choices):
    kind, options = (conf + [None, None])[:2] if isinstance(conf, list) else (conf, None)
    options = options if isinstance(options, dict) else {}
    out = {"name": name, "required": required}
    listed = kind if isinstance(kind, list) else options.get("options") if kind == "COMBO" else None
    if isinstance(listed, list):
        out["type"] = "choice"
        out["choices"] = [str(item) for item in listed[:choices]]
        if len(listed) > choices:
            out["choices_count"] = len(listed)
    else:
        out["type"] = str(kind)
    for key in ("default", "min", "max", "multiline"):
        if key in options and isinstance(options[key], (str, int, float, bool)):
            out[key] = options[key] if not isinstance(options[key], str) else options[key][:200]
    if options.get("forceInput"):
        out["socket_only"] = True
    return out


def _picked(ctx):
    """What the user picked for this task (ai_toolbox.py): its node types and packs come first in every search."""
    return ai_toolbox.effective(ai_tasks.get_task(ctx["task"])) if ctx.get("task") else None


def _allowed(ctx, types):
    """Refuses node types the user's "only" picks leave out, before the page is asked."""
    if not ctx.get("task"):
        return
    info = _object_info(ctx)
    refused = ai_toolbox.refused(ctx["task"], types, info)
    if refused:
        box = ai_toolbox.effective(ai_tasks.get_task(ctx["task"])) or {}
        allowed = [*(box.get("nodes") or []), *(f"every node of the pack {pack}" for pack in box.get("packs") or [])]
        raise ToolError(f"For this task the user allowed only these node types (and ComfyUI's built-in ones): "
                        f"{', '.join(allowed) or 'none'}. Not allowed: {', '.join(refused)}. "
                        "If you need one, ask the user in the AI workbench (show_panel) instead.")


def _node(type_name, info, choices):
    inputs = []
    for section, required in (("required", True), ("optional", False)):
        for name, conf in ((info.get("input") or {}).get(section) or {}).items():
            inputs.append(_input(name, conf, required, choices))
    names = info.get("output_name") or info.get("output") or []
    outputs = [{"slot": slot, "name": str(name), "type": str(kind)}
               for slot, (name, kind) in enumerate(zip(names, info.get("output") or []))]
    source = ai_toolbox.source_of(info)
    return {"type": type_name, "display_name": info.get("display_name") or type_name, "category": info.get("category") or "",
            "source": source, "description": str(info.get("description") or "")[:300], "inputs": inputs, "outputs": outputs,
            **({"paid": True} if source == "api" else {}), **({"deprecated": True} if info.get("deprecated") else {})}


def find_nodes(ctx, query="", types=None):
    info = _object_info(ctx)
    if types:
        missing = [name for name in types if name not in info]
        found = [_node(name, info[name], MAX_CHOICES_NAMED) for name in types if name in info][:MAX_FOUND]
        return {"nodes": found, **({"not_found": missing} if missing else {})}
    words = str(query or "").lower().split()
    if not words:
        raise ToolError("Give query (words in a node's name, category or description) or types.")
    picked = _picked(ctx)
    scored = []
    for name, item in info.items():
        haystack = " ".join(str(part or "") for part in (name, item.get("display_name"), item.get("category"), item.get("description"))).lower()
        if all(word in haystack for word in words):
            label = f"{name} {item.get('display_name') or ''}".lower()
            scored.append((not ai_toolbox.chosen(picked, name, item), 0 if name.lower() == " ".join(words) else 1 if all(w in label for w in words) else 2,
                           bool(item.get("deprecated")), ai_toolbox.source_of(item) == "api", len(name), name))
    scored.sort()
    nodes = [_node(name, info[name], MAX_CHOICES) for *_rest, name in scored[:MAX_FOUND]]
    for node in nodes:
        if ai_toolbox.chosen(picked, node["type"], info[node["type"]]):
            node["picked_by_user"] = True
    return {"nodes": nodes, "total_matches": len(scored),
            "note": "Inputs of type choice take one of their choices; others are sockets fed by connect_nodes "
                    "or settings set by values. types=[...] gives a node's full choice lists. picked_by_user: the user "
                    "wants these used; paid: a Comfy API node that spends the user's credits, use it only when asked."}


def _id(value, what):
    if isinstance(value, bool) or not isinstance(value, (int, str)) or not str(value).strip() or len(str(value)) > 40:
        raise ToolError(f"{what} is a node id from describe_canvas or a tool's answer.")
    return value


def _values(values):
    if values is None:
        return {}
    if not isinstance(values, dict) or len(values) > MAX_VALUES:
        raise ToolError(f"values is an object {{setting name: value}} of up to {MAX_VALUES} settings.")
    for name, value in values.items():
        if len(name) > 100 or not (isinstance(value, (bool, int, float)) or (isinstance(value, str) and len(value) <= MAX_TEXT)):
            raise ToolError(f"The value of {name[:100]} is a number, true/false or text of up to {MAX_TEXT} characters.")
    return values


def _type(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 200:
        raise ToolError("type is a node type, as find_nodes gives it (e.g. KSampler).")
    return value.strip()


def add_node(ctx, type, values=None, title="", near_node_id=None):
    _allowed(ctx, [_type(type)])
    return _page("add_node", {"type": _type(type), "values": _values(values), "title": str(title or "")[:120],
                              "near_node_id": None if near_node_id is None else _id(near_node_id, "near_node_id")})


def connect_nodes(ctx, from_node_id, to_node_id, input, output=0):
    if isinstance(output, bool) or not isinstance(output, (int, str)) or len(str(output)) > 100:
        raise ToolError("output is the output's slot number or its name.")
    output = int(output) if isinstance(output, str) and output.strip().isdigit() else output
    if not isinstance(input, str) or not input or len(input) > 100:
        raise ToolError("input is the input's name, as add_node, find_nodes or describe_canvas give it.")
    return _page("connect_nodes", {"from_node_id": _id(from_node_id, "from_node_id"), "output": output,
                                   "to_node_id": _id(to_node_id, "to_node_id"), "input": input})


def set_values(ctx, node_id, values):
    if not values:
        raise ToolError("values is an object {setting name: value}.")
    return _page("set_values", {"node_id": _id(node_id, "node_id"), "values": _values(values)})


def remove_nodes(ctx, node_ids):
    if not isinstance(node_ids, list) or not 0 < len(node_ids) <= MAX_REMOVE:
        raise ToolError(f"node_ids lists 1 to {MAX_REMOVE} node ids.")
    return _page("remove_nodes", {"node_ids": [_id(item, "node_ids") for item in node_ids]})


def new_workflow(ctx, name="", nodes=None):
    if nodes is not None:
        if not isinstance(nodes, dict) or not 0 < len(nodes) <= MAX_WORKFLOW_NODES:
            raise ToolError(f"nodes is a workflow in ComfyUI's API form: {{id: {{class_type, inputs}}}}, up to {MAX_WORKFLOW_NODES} nodes.")
        if len(json.dumps(nodes, ensure_ascii=False)) > MAX_WORKFLOW_BYTES:
            raise ToolError("That workflow is too large.")
        for key, spec in nodes.items():
            if (len(key) > 40 or not isinstance(spec, dict) or not isinstance(spec.get("class_type"), str)
                    or not isinstance(spec.get("inputs", {}), dict)):
                raise ToolError(f"Node {key[:40]}: each node is {{class_type, inputs: {{name: value or [node id, output slot]}}}}.")
            _type(spec["class_type"])
            _values({name: value for name, value in spec.get("inputs", {}).items() if not isinstance(value, list)})
        _allowed(ctx, [spec["class_type"] for spec in nodes.values()])
    return _page("new_workflow", {"name": str(name or "")[:60], "nodes": nodes}, timeout=60)


def open_workflow(ctx, name):
    from .mcp_tools import list_workflows

    name = str(name or "").strip()
    found = [item for item in list_workflows(name, _limit(50))["workflows"] if item["name"] == name] if name else []
    if not found:
        raise ToolError(f"No saved workflow called {name}; list_workflows names them.")
    from .recipe_store import _list_recipes, get_recipes_dir
    filename = next((recipe["filename"] for recipe in _list_recipes(get_recipes_dir())
                     if (recipe["data"].get("name") or recipe["filename"]) == name), None)
    return _page("open_workflow", {"filename": filename, "name": name}, timeout=60)


_NODE_ID = {"type": "integer", "description": "A node id from describe_canvas or a tool's answer."}
_VALUES = {"type": "object", "description": "{setting name: value}; a choice takes one of its choices exactly."}

CANVAS_TOOLS = dict([
    _action("find_nodes", "Look up node types",
            "The node types this ComfyUI has (built in and custom nodes): type, category, each input (a socket, or a "
            "setting with its choices, default and range) and each output with its slot. query searches names, "
            "categories and descriptions; types gives those nodes in full. Look here before add_node or new_workflow.",
            find_nodes, {"query": {"type": "string"}, "types": {"type": "array", "items": {"type": "string"}, "maxItems": MAX_FOUND}},
            read_only=True),
    _action("add_node", "Add a node",
            "Adds one node to the open workflow, where the user sees it: right of near_node_id, or right of the "
            "workflow; nothing it would cover. values sets its settings. The answer gives its node_id, inputs and "
            "outputs for connect_nodes. One Ctrl+Z step.",
            add_node, {"type": {"type": "string", "description": "A node type from find_nodes, e.g. KSampler."},
                       "values": _VALUES, "title": {"type": "string"}, "near_node_id": _NODE_ID}, ["type"]),
    _action("connect_nodes", "Wire two nodes",
            "Wires output `output` (slot number or name) of from_node_id to input `input` of to_node_id, replacing "
            "what fed that input before (the answer says so). Types must fit. One Ctrl+Z step.",
            connect_nodes, {"from_node_id": _NODE_ID, "output": {"type": "string", "default": "0", "description": "The output's slot number or name."},
                            "to_node_id": _NODE_ID, "input": {"type": "string"}},
            ["from_node_id", "to_node_id", "input"]),
    _action("set_values", "Change a node's settings",
            "Sets settings of one node (steps, cfg, a sampler, a size, a file choice…), checked against what each "
            "takes. For prompts set_prompt, for models set_model find the right ones. One Ctrl+Z step.",
            set_values, {"node_id": _NODE_ID, "values": _VALUES}, ["node_id", "values"], destructive=True),
    _action("remove_nodes", "Remove nodes",
            "Removes nodes from the open workflow, with their wires. One Ctrl+Z step.",
            remove_nodes, {"node_ids": {"type": "array", "items": _NODE_ID, "maxItems": MAX_REMOVE}}, ["node_ids"],
            destructive=True),
    _action("new_workflow", "Start a new workflow",
            "Opens a new workflow tab in ComfyUI, leaving the user's open one as it was: blank, or built and laid "
            "out from nodes, a workflow in ComfyUI's API form ({\"1\": {\"class_type\": \"CheckpointLoaderSimple\", "
            "\"inputs\": {\"ckpt_name\": \"x.safetensors\"}}, \"2\": {\"class_type\": \"CLIPTextEncode\", \"inputs\": "
            "{\"text\": \"...\", \"clip\": [\"1\", 1]}}}: a value or [node id, output slot]). Everything is checked "
            "before the tab opens. The answer maps your ids to the canvas's node ids.",
            new_workflow, {"name": {"type": "string"}, "nodes": {"type": "object"}}),
    _action("open_workflow", "Open a saved workflow",
            "Opens one of the user's saved workflows (list_workflows names them) in a new tab, leaving the open one "
            "as it was, to run it or build on it with add_node, connect_nodes and set_values.",
            open_workflow, {"name": {"type": "string", "description": "A workflow name from list_workflows."}}, ["name"]),
])
