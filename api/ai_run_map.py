"""The shape of a workflow run in a few boxes, so the user sees what the AI really ran: read from
the prompt ComfyUI queued (ai_task_runs.py keeps it on the run's step as "map"), never from
what the AI says. Plumbing (reroutes, primitives, notes) is left out and wired through; each
box has a role (model, lora, prompt, size, sampler, image, upscale, decode, save, other) and a
few facts the page words in the user's language (ui_ai_run_map.js); the links carry ComfyUI's
types. changes() says what differs from the run before it: a setting, a node added or gone.
"""

import os

from .model_constants import MODEL_EXTENSIONS

MAX_BOXES = 24  # what a stage diagram holds (ai_panels.MAX_NODES)
MAX_EDGES = 40
MAX_CHANGES = 10
HIDDEN = {"Reroute", "Note", "MarkdownNote", "PrimitiveNode", "PrimitiveInt", "PrimitiveFloat", "PrimitiveString",
          "PrimitiveStringMultiline", "PrimitiveBoolean"}
SEEDS = {"seed", "noise_seed"}
SAMPLER_FACTS = ("steps", "cfg", "sampler_name", "scheduler", "denoise")
TEXT_CHARS = 80
VALUE_CHARS = 60


def _linked(value):
    return isinstance(value, list) and len(value) == 2 and isinstance(value[0], (str, int))


def _literal(value):
    return isinstance(value, (str, int, float, bool)) and not isinstance(value, list)


def _file_name(value):
    return os.path.splitext(os.path.basename(str(value).replace("\\", "/")))[0]


def _output_type(class_type, index):
    """ComfyUI's type of output `index` of `class_type` ("MODEL", "LATENT"...), or ""."""
    try:
        import nodes
        types = getattr(nodes.NODE_CLASS_MAPPINGS.get(class_type), "RETURN_TYPES", None) or ()
        return str(types[int(index)]) if int(index) < len(types) else ""
    except Exception:  # noqa: BLE001 - no ComfyUI (tests) or an odd node: the link stays unnamed
        return ""


def _role(class_type, inputs):
    name = class_type.lower()
    if "lora_name" in inputs:
        return "lora"
    if _linked(inputs.get("latent_image")) or "sampler" in name and not name.endswith("select"):
        return "sampler"
    if name == "loadimage" or name.startswith("loadimage"):
        return "image"
    if "upscale" in name:
        return "upscale"
    if "loader" in name:
        return "model"
    if isinstance(inputs.get("text"), str) or "textencode" in name:
        return "prompt"
    if name.startswith("empty") and "latent" in name:
        return "size"
    if name.startswith("vaedecode"):
        return "decode"
    if name.startswith(("save", "preview")):
        return "save"
    return "other"


def _facts(role, inputs):
    literal = {key: value for key, value in inputs.items() if _literal(value)}
    facts = {}
    model = next((value for value in literal.values() if isinstance(value, str) and value.lower().endswith(MODEL_EXTENSIONS)), None)
    if model:
        facts["file"] = _file_name(model)[:VALUE_CHARS]
    if role == "lora":
        for key in ("strength_model", "strength"):
            if isinstance(literal.get(key), (int, float)):
                facts["strength"] = round(float(literal[key]), 3)
                break
    elif role == "prompt":
        text = next((value for key, value in literal.items() if isinstance(value, str) and key.startswith("text")), "")
        facts["text"] = " ".join(text.split())[:TEXT_CHARS]
    elif role == "sampler":
        facts.update({key: literal[key] for key in SAMPLER_FACTS if key in literal})
    elif role == "image":
        facts["file"] = str(literal.get("image") or "")[:VALUE_CHARS]
    elif role == "save":
        facts["prefix"] = str(literal.get("filename_prefix") or "")[:VALUE_CHARS]
    if all(isinstance(literal.get(key), (int, float)) and literal[key] > 0 for key in ("width", "height")):
        facts.update(width=int(literal["width"]), height=int(literal["height"]))
        if isinstance(literal.get("batch_size"), int) and literal["batch_size"] > 1:
            facts["batch"] = literal["batch_size"]
    if role == "other" and not facts:
        facts["values"] = [[key, str(value)[:VALUE_CHARS]] for key, value in literal.items()
                           if key not in SEEDS and str(value).strip()][:2]
    return facts


def map_of(prompt):
    """{"boxes": [{id, type, title, role, facts}], "links": [{from, to, type}], "params": {...}} of API prompt `prompt`."""
    nodes = {str(key): node for key, node in (prompt or {}).items() if isinstance(node, dict) and node.get("class_type")}
    shown = [key for key in nodes if nodes[key]["class_type"] not in HIDDEN]
    if len(shown) > MAX_BOXES:  # keep what makes the picture; drop the helpers first
        rank = {"other": 2, "save": 1}
        shown = sorted(shown, key=lambda key: rank.get(_role(nodes[key]["class_type"], nodes[key].get("inputs") or {}), 0))[:MAX_BOXES]
    keep = set(shown)

    def source(link, seen=()):
        """The shown node (and the output's type) a link comes from, wired through hidden nodes."""
        key, index = str(link[0]), link[1]
        if key in keep:
            return key, _output_type(nodes[key]["class_type"], index)
        node = nodes.get(key)
        if not node or key in seen:
            return None, ""
        upstream = next((value for value in (node.get("inputs") or {}).values() if _linked(value)), None)
        return source(upstream, (*seen, key)) if upstream else (None, "")

    boxes, links, params = [], [], {}
    for key in sorted(shown, key=lambda item: (len(item), item)):
        node = nodes[key]
        inputs = node.get("inputs") or {}
        role = _role(node["class_type"], inputs)
        boxes.append({"id": key, "type": node["class_type"][:80], "role": role, "facts": _facts(role, inputs),
                      "title": str((node.get("_meta") or {}).get("title") or node["class_type"])[:80]})
        for name, value in inputs.items():
            if _linked(value):
                found, kind = source(value)
                if found and found != key and len(links) < MAX_EDGES:
                    links.append({"from": found, "to": key, "type": kind or name.upper(), "input": name})
            elif _literal(value) and name not in SEEDS:
                params[f"{key}.{name}"] = str(value)[:300]
    _polarity(boxes, links)
    return {"boxes": boxes, "links": links, "params": params}


def _polarity(boxes, links):
    """Marks prompt boxes positive or negative by the sampler input they reach."""
    by_id = {box["id"]: box for box in boxes}
    feeds = {}
    for link in links:
        feeds.setdefault(link["from"], []).append(link)
    for box in boxes:
        if box["role"] != "prompt":
            continue
        todo, seen = [box["id"]], set()
        while todo and "polarity" not in box["facts"]:
            here = todo.pop()
            seen.add(here)
            for link in feeds.get(here, []):
                if link["input"] in ("positive", "negative") and by_id[link["to"]]["role"] == "sampler":
                    box["facts"]["polarity"] = link["input"]
                    break
                if link["to"] not in seen:
                    todo.append(link["to"])


def changes(before, after):
    """What differs in map `after` from map `before`: [{node, title, key, from, to}] or a node added / gone."""
    if not before or not after:
        return []
    titles = {box["id"]: box["title"] for box in before.get("boxes", [])}
    titles.update({box["id"]: box["title"] for box in after.get("boxes", [])})
    old_ids = {box["id"]: box["type"] for box in before.get("boxes", [])}
    new_ids = {box["id"]: box["type"] for box in after.get("boxes", [])}
    out = []
    for key, kind in new_ids.items():
        if old_ids.get(key) != kind:
            out.append({"node": key, "title": titles[key], "change": "added"})
    for key, kind in old_ids.items():
        if new_ids.get(key) != kind:
            out.append({"node": key, "title": titles[key], "change": "removed"})
    gone = {item["node"] for item in out}
    old, new = before.get("params", {}), after.get("params", {})
    for name in sorted(set(old) | set(new), key=lambda item: (len(item.split(".")[0]), item)):
        node, key = name.split(".", 1)
        if node not in gone and old.get(name) != new.get(name):
            out.append({"node": node, "title": titles.get(node, node), "key": key,
                        "from": (old.get(name) or "")[:VALUE_CHARS], "to": (new.get(name) or "")[:VALUE_CHARS]})
    return out[:MAX_CHANGES]
