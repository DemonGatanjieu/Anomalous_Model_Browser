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

from . import ai_tasks, ai_toolbox, mcp_fill
from .mcp_actions import _action, _local, _page
from .mcp_tools import ToolError

MAX_FOUND = 20
MAX_SEARCH = 5
MAX_CHOICES_NAMED = 60
MAX_REMOVE = 30
MAX_WORKFLOW_NODES = 200
MAX_WORKFLOW_BYTES = 1_000_000
INFO_SECONDS = 120

_info = {"at": 0.0, "data": None}
_info_lock = threading.Lock()


def object_info(ctx):
    """ComfyUI's node definitions, as its own page reads them (kept a little while)."""
    with _info_lock:
        if _info["data"] is None or time.monotonic() - _info["at"] > INFO_SECONDS:
            status, data = _local(ctx, "GET", "/object_info", timeout=60)
            if status != 200 or not isinstance(data, dict):
                raise ToolError(f"ComfyUI's node list is unavailable ({status}).")
            _info.update(at=time.monotonic(), data=data)
        return _info["data"]


def forget_object_info():
    """After a model moved: the next look reads ComfyUI's lists anew."""
    with _info_lock:
        _info["data"] = None


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
    info = object_info(ctx)
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
    info = object_info(ctx)
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
    # Searching identifies candidates; don't repeat hundreds of model choices/settings for each.
    nodes = []
    for *_rest, name in scored[:MAX_SEARCH]:
        detail = _node(name, info[name], 0)
        nodes.append({"type": name, "display_name": str(detail["display_name"])[:80],
                      "source": str(detail["source"])[:80],
                      "description": detail["description"][:96],
                      "inputs": [f"{i['name'][:48]}:{i['type'][:48]}" for i in detail["inputs"][:8]],
                      "outputs": [f"{i['name'][:48]}:{i['type'][:48]}" for i in detail["outputs"][:8]],
                      **{k: detail[k] for k in ("paid", "deprecated") if k in detail},
                      **({"more_inputs": len(detail["inputs"]) - 8} if len(detail["inputs"]) > 8 else {})})
    for node in nodes:
        if ai_toolbox.chosen(picked, node["type"], info[node["type"]]):
            node["picked_by_user"] = True
    while len(nodes) > 1 and len(json.dumps(nodes, ensure_ascii=False)) > 3000:
        nodes.pop()
    return {"nodes": nodes, "total_matches": len(scored),
            "note": "Brief candidates; types=[chosen type] gives settings/choices and output slots when needed. "
                    "Narrow query for other matches. picked_by_user: preferred; paid: spends credits, use only when asked."}


def _id(value, what):
    if isinstance(value, bool) or not isinstance(value, (int, str)) or not str(value).strip() or len(str(value)) > 40:
        raise ToolError(f"{what} is a node id from describe_canvas or a tool's answer.")
    return value


def _type(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 200:
        raise ToolError("type is a node type, as find_nodes gives it (e.g. KSampler).")
    return value.strip()


def _next(answer):
    """The checklist's next step after a change (the page answers with what is still unwired)."""
    if isinstance(answer, dict):
        answer["next"] = ("Connect the new branch to an output; it does not reach one yet."
                          if answer.get("reaches_output") is False else
                          "Wire unwired inputs with connect_nodes; unique types need only the two node IDs."
                          if answer.get("unwired") else "No required input is unwired; run_workflow validates and runs the graph.")
    return answer


def _ids(value, label):
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    if not 1 <= len(items) <= 8:
        raise ToolError(f"{label} names 1 to 8 node IDs.")
    return [_id(item, label) for item in items]


def add_node(ctx, type, values=None, title="", near_node_id=None, insert_after=None, insert_type=None,
             wire_from=None, wire_to=None, replace=False):
    if not isinstance(replace, bool):
        raise ToolError("replace must be true or false.")
    if insert_type is not None and (insert_after is None or not isinstance(insert_type, str) or not 0 < len(insert_type) <= 60):
        raise ToolError("insert_type names a through type (e.g. IMAGE) and needs insert_after.")
    wiring = {"wire_from": _ids(wire_from, "wire_from"), "wire_to": _ids(wire_to, "wire_to"), "replace": replace}
    if insert_after is not None:
        wiring.update(insert_after=_id(insert_after, "insert_after"), insert_type=insert_type)
    _allowed(ctx, [_type(type)])
    return _next(_page("add_node", {"type": _type(type), "values": mcp_fill.flat_values(values), "title": str(title or "")[:120],
                                    "near_node_id": None if near_node_id is None else _id(near_node_id, "near_node_id"), **wiring}))


def _api_nodes(nodes, canvas_refs=False):
    """A workflow (or group) in ComfyUI's API form, checked for shape and size; the page checks the rest.
    With canvas_refs a link may name a canvas node as "#12", an output by slot or name, and a node wire_to."""
    if not isinstance(nodes, dict) or not 0 < len(nodes) <= MAX_WORKFLOW_NODES:
        raise ToolError(f"nodes is a workflow in ComfyUI's API form: {{id: {{class_type, inputs}}}}, up to {MAX_WORKFLOW_NODES} nodes.")
    if len(json.dumps(nodes, ensure_ascii=False)) > MAX_WORKFLOW_BYTES:
        raise ToolError("That workflow is too large.")
    for key, spec in nodes.items():
        if (len(key) > 40 or not isinstance(spec, dict) or not isinstance(spec.get("class_type"), str)
                or not isinstance(spec.get("inputs", {}), dict)):
            raise ToolError(f"Node {key[:40]}: each node is {{class_type, inputs: {{name: value or [node id, output slot]}}}}.")
        _type(spec["class_type"])
        mcp_fill.flat_values({name: value for name, value in spec.get("inputs", {}).items() if not isinstance(value, list)})
        if not canvas_refs:
            continue
        if key.startswith("#"):
            raise ToolError(f"Node {key[:40]}: a key of the group cannot start with #, which names canvas nodes.")
        for name, value in spec.get("inputs", {}).items():
            if isinstance(value, list) and (len(value) != 2 or not isinstance(value[0], (str, int)) or isinstance(value[1], bool)
                                            or not isinstance(value[1], (str, int)) or len(str(value[1])) > 100):
                raise ToolError(f"Node {key[:40]}, input {name[:100]}: a link is [a key of this group or \"#<canvas node id>\", output slot or name].")
            if isinstance(value, list) and isinstance(value[1], str) and value[1].strip().isdigit():
                value[1] = int(value[1])
        if spec.get("wire_to") is not None:
            spec["wire_to"] = _ids(spec["wire_to"], f"{key[:40]}.wire_to")
    return nodes


def add_nodes(ctx, nodes, near_node_id=None, replace=False):
    if not isinstance(replace, bool):
        raise ToolError("replace must be true or false.")
    _api_nodes(nodes, canvas_refs=True)
    _allowed(ctx, [spec["class_type"] for spec in nodes.values()])
    return _next(_page("add_nodes", {"nodes": nodes, "replace": replace,
                                     "near_node_id": None if near_node_id is None else _id(near_node_id, "near_node_id")}, timeout=60))


def connect_nodes(ctx, from_node_id, to_node_id, input=None, output=None, replace=None):
    if output is not None and (isinstance(output, bool) or not isinstance(output, (int, str)) or len(str(output)) > 100):
        raise ToolError("output is the output's slot number or its name.")
    output = int(output) if isinstance(output, str) and output.strip().isdigit() else output
    if input is not None and (not isinstance(input, str) or not input or len(input) > 100):
        raise ToolError("input is the input's name, as add_node, find_nodes or describe_canvas give it.")
    if replace is not None and not isinstance(replace, bool):
        raise ToolError("replace must be true or false.")
    # Preserve the old explicit-input form's default output and replacement behaviour.
    if input is not None and output is None:
        output = 0
    return _next(_page("connect_nodes", {"from_node_id": _id(from_node_id, "from_node_id"), "output": output,
                                         "to_node_id": _id(to_node_id, "to_node_id"), "input": input, "replace": replace}))


def set_values(ctx, node_id=None, values=None):
    if node_id is None:
        return _page("set_values", {"node_id": None, "values": mcp_fill.node_values(values)})
    if not values:
        raise ToolError("values is an object {setting name: value}.")
    return _page("set_values", {"node_id": _id(node_id, "node_id"), "values": mcp_fill.flat_values(values)})


def remove_nodes(ctx, node_ids):
    if not isinstance(node_ids, list) or not 0 < len(node_ids) <= MAX_REMOVE:
        raise ToolError(f"node_ids lists 1 to {MAX_REMOVE} node ids.")
    return _next(_page("remove_nodes", {"node_ids": [_id(item, "node_ids") for item in node_ids]}))


def new_workflow(ctx, name="", nodes=None):
    if nodes is not None:
        _api_nodes(nodes)
        _allowed(ctx, [spec["class_type"] for spec in nodes.values()])
    return _page("new_workflow", {"name": str(name or "")[:60], "nodes": nodes}, timeout=60)


def open_workflow(ctx, workflow):
    filename, name = mcp_fill.saved_workflow(workflow)
    return _page("open_workflow", {"filename": filename, "name": name}, timeout=60)


_NODE_ID = {"type": "integer", "description": "A node id."}
_VALUES = {"type": "object", "description": "{setting: value}; a choice exactly as listed."}
_NEIGHBOURS = {"oneOf": [_NODE_ID, {"type": "array", "items": _NODE_ID, "minItems": 1, "maxItems": 8}]}

CANVAS_TOOLS = dict([
    _action("find_nodes", "Look up node types",
            "Node types, built in and custom. query: up to 5 brief candidates; types=[...]: their inputs, "
            "choices, ranges and outputs.",
            find_nodes, {"query": {"type": "string"}, "types": {"type": "array", "items": {"type": "string"}, "maxItems": MAX_FOUND}},
            read_only=True),
    _action("add_node", "Add a node",
            "Adds a node, wired in the same call: wire_from feeds it, wire_to takes its output (an input already "
            "fed is spliced, its old source now feeding the new node: a ControlNet or LoRA before a KSampler); "
            "insert_after=ID splices it behind a node. Same type or same socket name wires itself; anything "
            "ambiguous changes nothing and lists the choices; replace:true replaces what it cannot splice. One "
            "Ctrl+Z step. Several nodes wired to each other (an inpaint or upscale branch): add_nodes, in one call.",
            add_node, {"type": {"type": "string", "description": "A node type from find_nodes, e.g. KSampler."},
                       "values": _VALUES, "title": {"type": "string"}, "near_node_id": _NODE_ID,
                       "insert_after": _NODE_ID, "insert_type": {"type": "string", "description": "Through type, only if asked (e.g. IMAGE)."},
                       "wire_from": _NEIGHBOURS, "wire_to": _NEIGHBOURS, "replace": {"type": "boolean"}}, ["type"]),
    _action("add_nodes", "Add a group of nodes",
            "Adds a group of nodes in one call, as one block, in ComfyUI's API form: {\"a\": {\"class_type\": "
            "\"VAEEncode\", \"inputs\": {\"pixels\": [\"#12\", 0], \"vae\": [\"#4\", \"VAE\"]}}, \"b\": {..., \"inputs\": "
            "{\"samples\": [\"a\", 0]}, \"wire_to\": 15}}. A link names a key of the group or a canvas node \"#id\", and "
            "an output slot or name; wire_to as in add_node. Checked first; one Ctrl+Z step; the answer maps keys "
            "to node ids.",
            add_nodes, {"nodes": {"type": "object"}, "near_node_id": _NODE_ID, "replace": {"type": "boolean"}}, ["nodes"]),
    _action("connect_nodes", "Wire two nodes",
            "Wires two nodes: every unique matching type, and same-type sockets of the same name (positive to "
            "positive). Anything ambiguous (a lone CONDITIONING into positive or negative, wildcards) changes "
            "nothing and lists the choices; then give output and input. replace:true lets it replace wires. One "
            "Ctrl+Z step.",
            connect_nodes, {"from_node_id": _NODE_ID, "output": {"type": "string", "description": "Optional output slot number or name."},
                            "to_node_id": _NODE_ID, "input": {"type": "string"}, "replace": {"type": "boolean"}},
            ["from_node_id", "to_node_id"]),
    _action("set_values", "Change a node's settings",
            "Changes settings of any node, a third party's too, checked against what each takes: {setting: value} "
            "goes to the one node that has it; name the node when several do: {\"12\": {\"denoise\": 0.5}}; or "
            "node_id with its settings. Prompts: set_prompt; models: set_model. One Ctrl+Z step.",
            set_values, {"node_id": _NODE_ID, "values": _VALUES}, ["values"], destructive=True),
    _action("remove_nodes", "Remove nodes",
            "Removes nodes from the open workflow, with their wires. One Ctrl+Z step.",
            remove_nodes, {"node_ids": {"type": "array", "items": _NODE_ID, "maxItems": MAX_REMOVE}}, ["node_ids"],
            destructive=True),
    _action("new_workflow", "Start a new workflow",
            "Opens a new workflow tab, the user's open one untouched: blank, or built from nodes in ComfyUI's API "
            "form ({\"1\": {\"class_type\": \"CLIPTextEncode\", \"inputs\": {\"text\": \"...\", \"clip\": [\"2\", 1]}}}: a value "
            "or [node id, output slot]). Checked before it opens; the answer maps your ids to node ids.",
            new_workflow, {"name": {"type": "string"}, "nodes": {"type": "object"}}),
    _action("open_workflow", "Open a saved workflow",
            "Opens one of the user's saved workflows (list_workflows names them) in a new tab, leaving the open one "
            "as it was, to run it or build on it with add_node, connect_nodes and set_values.",
            open_workflow, {"workflow": {"type": "string", "description": "A workflow name from list_workflows."}}, ["workflow"]),
])
