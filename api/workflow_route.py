"""A saved workflow's route in one line for the AI (list_workflows): its passes in the order they run,
each with the model file it draws with, the part of a split it runs, its redraw strength, an
enlargement before it and the control models patched in, then the picture nodes after the samplers.
So an AI picking a card sees "one pass" from "base, then a Tile redraw on a second model" without
opening it. Read from the serialized graph alone, as the workflow details' flow is on the page
(web/modules/recipe_flow.js); widget names come from ComfyUI's node types (`names` in tests)."""

import re

CONTROL = re.compile(r"lllite|controlnet|t2iadapter|ipadapter", re.I)
UPSCALE = re.compile(r"upscale|scaleby|imagescale", re.I)
SAVE = re.compile(r"^(SaveImage|PreviewImage)|save", re.I)
PLUMBING = re.compile(r"^(VAEDecode|VAEEncode|Reroute|Primitive|Note|MarkdownNote)")
LOADER_VALUE = re.compile(r"\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$", re.I)
WIDGET_KINDS = ("INT", "FLOAT", "STRING", "BOOLEAN", "COMBO")
SEEDS = ("seed", "noise_seed")


def widget_names(node_type):
    """A node type's widget names in the order its values are saved, or [] for a type not loaded."""
    import nodes  # ComfyUI's registry, filled once ComfyUI has loaded the packs

    cls = nodes.NODE_CLASS_MAPPINGS.get(node_type)
    try:
        spec = cls.INPUT_TYPES() if cls else {}
    except Exception:  # noqa: BLE001 - a pack's own code; its values stay unnamed
        return []
    names = []
    for group in ("required", "optional"):
        for name, item in (spec.get(group) or {}).items():
            kind = item[0] if isinstance(item, (list, tuple)) and item else item
            options = item[1] if isinstance(item, (list, tuple)) and len(item) > 1 and isinstance(item[1], dict) else {}
            if options.get("forceInput") or not (isinstance(kind, list) or kind in WIDGET_KINDS):
                continue
            names.append(name)
            if kind == "INT" and (options.get("control_after_generate") or name in SEEDS):
                names.append("control_after_generate")
    return names


def _values(node):
    values = node.get("widgets_values")
    return values if isinstance(values, list) else list((values or {}).values())


def _off(node):
    return node.get("mode") in (2, 4)


def _file(node):
    return next((value for value in _values(node) if isinstance(value, str) and LOADER_VALUE.search(value)), "")


def _short(file):
    return LOADER_VALUE.sub("", re.split(r"[\\/]", str(file))[-1])


def _sampler(node):
    names = {item.get("name") for item in node.get("inputs") or []}
    return {"model", "positive"} <= names and any("latent" in str(name) for name in names)


def route(workflow, names=widget_names):
    """[{model, loras, controls, steps, window, denoise, upscale, kind, state}] in the order the
    samplers run, and the picture nodes after them: (stages, after)."""
    nodes = {str(node.get("id")): node for node in (workflow or {}).get("nodes") or [] if isinstance(node, dict)}
    links = {}
    for link in (workflow or {}).get("links") or []:
        if isinstance(link, list) and len(link) >= 2:
            links[str(link[0])] = str(link[1])
        elif isinstance(link, dict):
            links[str(link.get("id"))] = str(link.get("origin_id"))
    source = lambda item: nodes.get(links.get(str(item.get("link")))) if item and item.get("link") is not None else None  # noqa: E731
    named = {}

    def value(node, name):
        if node["type"] not in named:
            named[node["type"]] = names(node["type"])
        at = named[node["type"]].index(name) if name in named[node["type"]] else -1
        values = _values(node)
        return values[at] if 0 <= at < len(values) else None

    def feeders(sampler):
        seen, before, todo = set(), set(), [sampler]
        while todo:
            current = todo.pop()
            for item in current.get("inputs") or []:
                if current is sampler and item.get("name") in ("positive", "negative"):
                    continue
                found = source(item)
                key = found and str(found["id"])
                if not found or key in seen or key in before:
                    continue
                if _sampler(found):
                    before.add(key)
                else:
                    seen.add(key)
                    todo.append(found)
        return seen, before

    def model_of(sampler):
        out = {"model": "", "loras": [], "controls": []}
        node = source(next((item for item in sampler.get("inputs") or [] if item.get("name") == "model"), None))
        for _hop in range(16):
            if not node:
                break
            if not _off(node):
                if re.search("lora", node["type"], re.I):
                    out["loras"].append(_short(_file(node)) or node["type"])
                elif CONTROL.search(node["type"]):
                    out["controls"].append(_short(_file(node)) or node.get("title") or node["type"])
                elif _file(node) and not any(item.get("name") == "model" for item in node.get("inputs") or []):
                    out["model"] = _short(_file(node))
                    break
            node = source(next((item for item in node.get("inputs") or [] if item.get("name") == "model"), None))
        return out

    samplers = [node for node in nodes.values() if _sampler(node)]
    fed = {str(node["id"]): feeders(node) for node in samplers}
    depth = {}

    def level(key, guard=0):
        if key not in depth:
            depth[key] = 0 if guard > 16 else 1 + max([level(item, guard + 1) for item in fed[key][1]] or [0])
        return depth[key]

    stages = []
    for node in sorted(samplers, key=lambda item: (level(str(item["id"])), int(item["id"]) if str(item["id"]).isdigit() else 0)):
        key = str(node["id"])
        steps, start, end = value(node, "steps"), value(node, "start_at_step"), value(node, "end_at_step")
        window = None if start is None or not isinstance(steps, int) else [start, min(end if isinstance(end, int) else steps, steps)]
        enlarge = next((nodes[item] for item in fed[key][0] if UPSCALE.search(nodes[item]["type"])), None)
        stages.append({**model_of(node), "steps": steps, "window": window, "denoise": value(node, "denoise"),
                       "upscale": (value(enlarge, "scale_by") or True) if enlarge else None,
                       "kind": "continue" if fed[key][1] else "base",
                       "state": "off" if _off(node) else "skipped" if window and window[0] >= window[1] else "run"})
    staged = set().union(*[fed[str(node["id"])][0] for node in samplers]) if samplers else set()
    after, todo = [], list(samplers)
    users = {}
    for node in nodes.values():
        for item in node.get("inputs") or []:
            found = source(item)
            if found:
                users.setdefault(str(found["id"]), []).append(node)
    seen = set()
    while todo:
        for user in users.get(str(todo.pop()["id"]), []):
            key = str(user["id"])
            if key in seen or key in staged or _sampler(user):
                continue
            seen.add(key)
            if not PLUMBING.search(user["type"]) and not SAVE.search(user["type"]) and not _off(user):
                after.append(user.get("title") or user["type"])
            todo.append(user)
    return stages, after


def line(workflow, names=widget_names):
    """The route as one line for the AI, or "" when it has no sampler."""
    stages, after = route(workflow, names)
    parts = []
    for stage in stages:
        if stage["state"] != "run":
            continue
        words = ["base" if stage["kind"] == "base" else "redraw" if stage["upscale"] else "continue"]
        if stage["upscale"]:
            words.insert(0, f"enlarge {stage['upscale']}x," if stage["upscale"] is not True else "enlarge,")
        if stage["window"]:
            words.append(f"steps {stage['window'][0]}-{stage['window'][1]}")
        elif isinstance(stage["steps"], int):
            words.append(f"{stage['steps']} steps")
        if isinstance(stage["denoise"], (int, float)) and stage["denoise"] < 1:
            words.append(f"denoise {stage['denoise']}")
        words.append(f"on {stage['model'] or 'its model'}")
        if stage["loras"]:
            words.append("+ LoRA " + ", ".join(dict.fromkeys(stage["loras"])))
        if stage["controls"]:
            words.append("with " + ", ".join(dict.fromkeys(stage["controls"])))
        parts.append(" ".join(words))
    if not parts:
        return ""
    passes = f"{len(parts)} pass{'es' if len(parts) > 1 else ''}: "
    return passes + " -> ".join(parts) + (f" -> then {', '.join(dict.fromkeys(after))}" if after else "")
