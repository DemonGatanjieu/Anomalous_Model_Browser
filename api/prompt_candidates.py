"""A bounded, read-only view of text upstream of generation. No workflow or result cache."""
from collections import defaultdict, deque
import hashlib
import json
import re
import time

from .prompt_candidate_fields import LANGUAGE_NODE, MODEL_NODE, PRIVATE_NAME, field_values, safe_label, text_field
from .prompt_links import _is_prompt_node_type, has_linked_prompt_text, resolve_clip_prompt_text

VERSION = 1
MAX_NODES, MAX_EDGES, MAX_ITEMS, MAX_BYTES = 1000, 4000, 32, 64 * 1024
CONDS = {"positive", "negative", "conditioning", "cond", "cond1", "cond2"}
PROMPT_NAMES = {"positive", "positive_prompt", "text_positive", "negative", "negative_prompt",
                "text_negative", "image_prompt", "scene_description"}
REROUTES = {"reroute", "reroute (rgthree)", "rerouteprimitive"}


def _digest(value):
    return hashlib.sha256(json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def _key(value):
    return str(value) if type(value) in (int, str) and 0 < len(str(value)) <= 160 else None


def _records(value):
    return value if isinstance(value, list) else []


def _norm(text):
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()


def _ui_edges(workflow, nodes):
    raw = workflow.get("links", [])
    for link in raw.values() if isinstance(raw, dict) else _records(raw):
        if isinstance(link, list) and len(link) >= 5:
            lid, src, out, dst, slot = link[:5]
            kind = link[5] if len(link) > 5 else ""
        elif isinstance(link, dict):
            lid, src, out, dst, slot, kind = (link.get(k) for k in
                ("id", "origin_id", "origin_slot", "target_id", "target_slot", "type"))
        else:
            continue
        src, dst = _key(src), _key(dst)
        if src not in nodes or dst not in nodes or type(out) is not int or out < 0 or type(slot) is not int or slot < 0:
            continue
        ports = _records(nodes[dst].get("inputs"))
        outputs = _records(nodes[src].get("outputs"))
        if slot >= len(ports) or not isinstance(ports[slot], dict) or outputs and out >= len(outputs):
            continue
        port = ports[slot]
        if "link" in port and str(port["link"]) != str(lid):
            continue
        yield lid, src, out, dst, slot, str(port.get("name") or ""), str(port.get("type") or kind or "")


def _scope(workflow, prompt, material):
    selected = None
    if material is not None:
        selection = material.get("selection")
        if material.get("kind") == "image_node_selection" or isinstance(selection, dict) and selection.get("scope") == "nodes":
            ids = selection.get("node_ids") if isinstance(selection, dict) and selection.get("scope") == "nodes" else None
            if not isinstance(ids, list) or not ids or len(ids) > MAX_NODES or any(_key(i) is None for i in ids):
                raise ValueError("selection")
            selected = {_key(i) for i in ids}
            prompt = {}
    nodes = {}
    for node in _records(workflow.get("nodes")):
        if not isinstance(node, dict):
            continue
        key = _key(node.get("id"))
        if key is None or selected is not None and key not in selected:
            continue
        if key in nodes:
            raise ValueError("duplicate")
        nodes[key] = node
        if len(nodes) > MAX_NODES:
            raise OverflowError
    if selected is not None and set(nodes) != selected:
        raise ValueError("selection")
    api = {}
    if len(prompt) > MAX_NODES:
        raise OverflowError
    for key, entry in prompt.items():
        if not isinstance(entry, dict) or not isinstance(entry.get("class_type"), str) or not isinstance(entry.get("inputs"), dict):
            continue
        key = _key(key)
        if key is None or workflow and (key not in nodes or nodes[key].get("type") != entry["class_type"]):
            continue
        api[key] = entry
    return nodes, api, selected is not None


def _graph(nodes, api, workflow):
    inbound = defaultdict(list)
    link_index, shape = {}, []
    for lid, src, out, dst, slot, name, kind in _ui_edges(workflow, nodes):
        if len(shape) >= MAX_EDGES:
            raise OverflowError
        link_index[str(lid)] = [lid, src, out, dst, slot]
        inbound[dst].append((src, out, name, kind))
        shape.append((src, out, dst, slot, name))
    ui_shape = bool(workflow)
    count = len(shape)
    for dst, entry in api.items():
        for name, value in entry["inputs"].items():
            if not isinstance(value, list) or len(value) != 2:
                continue
            src, out = _key(value[0]), value[1]
            if src not in api or type(out) is not int or out < 0:
                continue
            count += 1
            if count > MAX_EDGES:
                raise OverflowError
            # An execution edge can bypass a virtual node. Preserve both provenance paths.
            outputs = _records(nodes.get(src, {}).get("outputs"))
            port = outputs[out] if out < len(outputs) and isinstance(outputs[out], dict) else {}
            edge = (src, out, name, str(port.get("type") or ""))
            if edge not in inbound[dst]:
                inbound[dst].append(edge)
            if not ui_shape:
                shape.append((src, out, dst, name))
    return inbound, link_index, shape


def extract_candidates(workflow=None, api_prompt=None, *, material=None):
    workflow = workflow if isinstance(workflow, dict) else {}
    prompt = api_prompt if isinstance(api_prompt, dict) else {}
    response = {"version": VERSION, "status": "complete", "api_only": not workflow and bool(prompt), "candidates": []}
    if material is None and len(_records(workflow.get("nodes"))) > MAX_NODES:
        return {**response, "status": "partial"}
    try:
        nodes, api, selected = _scope(workflow, prompt, material)
        inbound, links, shape = _graph(nodes, api, workflow)
    except ValueError:
        return {**response, "status": "no_graph"}
    except OverflowError:
        return {**response, "status": "partial"}
    kinds = {k: n.get("type") for k, n in nodes.items()}
    kinds.update({k: n["class_type"] for k, n in api.items()})
    kinds = {k: v for k, v in kinds.items() if isinstance(v, str) and len(v) <= 200}
    if not kinds:
        return {**response, "status": "no_graph"}
    scope = "selection" if selected else "root"
    structure = _digest([VERSION, scope, sorted(kinds.items()), sorted(shape)])
    active = {k for k in kinds if nodes.get(k, {}).get("mode") not in (2, 4)}
    subgraphs = {s.get("id") for s in _records((workflow.get("definitions") or {}).get("subgraphs"))
                 if isinstance(s, dict) and isinstance(s.get("id"), str)} if isinstance(workflow.get("definitions"), dict) else set()
    confirmed = set()
    sinks, encoders, integrated = [], [], []
    for key in sorted(active):
        kind = kinds[key].lower()
        names = set(api.get(key, {}).get("inputs", {}))
        names.update(name for _, _, name, _ in inbound[key])
        names.update(p["name"] for p in _records(nodes.get(key, {}).get("inputs"))
                     if isinstance(p, dict) and isinstance(p.get("name"), str))
        if _is_prompt_node_type(kind) and key in nodes:
            node = nodes[key]
            text = resolve_clip_prompt_text({"links": links}, node, nodes, api)
            if text:
                confirmed.add(_norm(text))
            if not has_linked_prompt_text(node):
                confirmed.update(_norm(v) for v in _records(node.get("widgets_values")) if isinstance(v, str))
        if ("sampler" in kind or "guider" in kind or {"latent_image", "model"} <= names) and CONDS & names:
            sinks.append(key)
        elif _is_prompt_node_type(kind) or "textencode" in kind:
            encoders.append(key)
        if ("loader" in kind or "pipeline" in kind or "allinone" in re.sub(r"[^a-z]", "", kind)
                or "sampler" in kind) and (PROMPT_NAMES & names or nodes.get(key, {}).get("widgets_values")):
            integrated.append(key)

    # Each origin is explored once per destination, capped even for pathological fan-out.
    todo = deque((k, "condition", k) for k in sinks)
    todo.extend((k, "encoder", k) for k in encoders if not sinks)
    todo.extend((k, "integrated", k) for k in integrated)
    reached, seen = defaultdict(set), set()
    while todo:
        key, path, dest = todo.popleft()
        if key not in active or (key, path, dest) in seen:
            continue
        seen.add((key, path, dest))
        if len(seen) > MAX_EDGES or len(todo) > MAX_EDGES:
            response["status"] = "partial"
            break
        kind = kinds[key].lower()
        if kinds[key] in subgraphs or "subgraph" in kind:
            continue
        if kind.endswith(("getnode", "setnode")):
            # Virtual channel names are not edges. Only trust an explicit execution input.
            values = api.get(key, {}).get("inputs", {})
            explicit = [v for name, v in values.items() if not PRIVATE_NAME.search(name)
                        and isinstance(v, list) and len(v) == 2 and _key(v[0]) in api
                        and type(v[1]) is int and v[1] >= 0]
            if len(explicit) == 1:
                todo.append((_key(explicit[0][0]), path, dest))
            continue
        if MODEL_NODE.search(kind):
            continue
        edges = inbound[key]
        if kind in REROUTES:
            if len(edges) == 1 and len(_records(nodes.get(key, {}).get("outputs"))) <= 1:
                todo.append((edges[0][0], path, dest))
            continue
        reached[key].add((path, dest))
        for src, _, name, wire in edges:
            name, wire = name.lower(), wire.upper()
            if PRIVATE_NAME.search(name) or LANGUAGE_NODE.search(kind) and name not in {
                    "user_prompt", "user_text", "image_prompt", "input_text", "source_text"}:
                continue
            if wire not in ("", "*", "STRING", "CONDITIONING"):
                continue
            cond_port = name in CONDS or bool(re.fullmatch(r"conditioning_?\d+", name))
            if path == "condition" and (wire == "CONDITIONING" or cond_port and wire != "STRING"):
                todo.append((src, "condition", dest))
            elif (wire == "STRING" or text_field(name)) and (wire != "CONDITIONING") and (
                    path != "condition" or key not in sinks or name in PROMPT_NAMES):
                todo.append((src, "text", dest))

    rows = response["candidates"]
    unique, size = set(confirmed), 0
    deadline = time.monotonic() + 0.04
    for key, routes in reached.items():
        entries = api.get(key, {}).get("inputs", {})
        node = nodes.get(key, {})
        connected = {name for _, _, name, _ in inbound[key]}
        connected.update(p["name"] for p in _records(node.get("inputs")) if isinstance(p, dict)
                         and isinstance(p.get("name"), str) and p.get("link") is not None)
        for name, source, value, stable in field_values(kinds[key], node, entries, connected, deadline):
            if all(path == "integrated" or key in sinks for path, _ in routes) and name.lower() not in PROMPT_NAMES:
                continue
            norm = _norm(value)
            if norm in unique:
                continue
            dests = sorted({dest for _, dest in routes})
            destinations = [f"{safe_label(kinds[d])} #{d}" if d.isascii() and d.isdecimal() and len(d) <= 10
                            else safe_label(kinds[d]) for d in dests[:8]]
            row = {"hide_key": _digest([structure, scope, key, name]), "stable": stable, "role": "unknown",
                   "title": safe_label(node.get("title")) or safe_label(kinds[key]), "field": safe_label(name),
                   "source": source, "destinations": destinations, "text": value}
            cost = len(json.dumps(row, ensure_ascii=True).encode())
            if size + cost > MAX_BYTES - 256 or len(rows) >= MAX_ITEMS:
                response["status"] = "partial"
                return response
            rows.append(row)
            unique.add(norm)
            size += cost
    return response
