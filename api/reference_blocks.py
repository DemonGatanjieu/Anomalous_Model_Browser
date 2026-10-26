"""Ready-made blocks of nodes, distilled from workflows that do one thing well (a repaint that
crops around the marked area and stitches it back, an upscale, a ControlNet, face and hand
detailing): a light model names one (add_nodes block=…) and Anomalous builds it on the canvas,
spliced into the workflow there. Each block is a data file in api/blocks/ (<name>.json), so a
new way of working is a new file: what the AI is told (job, short, after), what the user's
panel shows (title, about, source, in both languages, web/modules/ui_ai_blocks.js), the packs
and models it needs, and its nodes, a group in ComfyUI's API form (mcp_canvas_edit.add_nodes)
whose links may name roles the page finds on the canvas by their sockets
(web/modules/canvas_roles.js): "$sampler" (the KSampler), "$decode" (the node decoding its
latent), "$save" (the output node its picture reaches), "$loader" (the sampler's model loader);
["$decode", 0] is that node's output, ["$sampler.positive", "*"] what feeds that input, a path
("$sampler.positive.clip") followed upstream. A node "like" a role takes its settings of the same
name; one that "replaces" a role takes its place, links and settings. The directory
(directory()) is what the AI is handed when it begins a task: the blocks this ComfyUI can run
and the user has not turned off (user/anomalous/ai_blocks.json), a few words each, by job.
"""

import json
import os
import re
import threading

FOLDER = os.path.join(os.path.dirname(__file__), "blocks")
TAKES = {"inpaint": "the picture with the area as its alpha (inpaint_image from propose_repaint_area or ask_user's answer)",
         "reference": "the picture to follow: one the user handed you (its path, as their message gives it) or one in the input folder",
         "picture": "the picture to work on: one the user handed you (its path, as their message gives it) or one in the input folder"}
# The words a ControlNet file's name has for what it follows; a union model follows all of them.
CONTROLS = {"pose": ("openpose", "pose"), "depth": ("depth",)}
ANY_CONTROL = ("union", "promax")
# The directory's headings, what an AI wants done; under each, its blocks with a few words apiece.
JOBS = {"repaint": "Repaint an area", "upscale": "Upscale", "follow": "Follow a given picture",
        "detail": "Fix faces and hands", "process": "Picture work"}
DIRECTORY_CHARS = 800  # what begin_task carries of it: past this, the blocks' names alone, however many are collected
_lock = threading.Lock()


def _load():
    """The blocks in api/blocks, by name, in the directory's order (job, then rank)."""
    found = {}
    for file in sorted(os.listdir(FOLDER)):
        if file.endswith(".json"):
            with open(os.path.join(FOLDER, file), encoding="utf-8") as source:
                found[file[:-5]] = json.load(source)
    jobs = list(JOBS)
    return dict(sorted(found.items(), key=lambda item: (jobs.index(item[1]["job"]) if item[1]["job"] in jobs else len(jobs),
                                                         item[1].get("rank", 99), item[0])))


BLOCKS = _load()


def _off_path():
    from . import ai_tasks

    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "ai_blocks.json")


def turned_off():
    """The blocks the user turned off in the panel: the AI is not offered them and add_nodes refuses them."""
    try:
        with open(_off_path(), encoding="utf-8") as file:
            return {name for name in json.load(file).get("off", []) if name in BLOCKS}
    except (OSError, ValueError, AttributeError):
        return set()


def set_on(name, on):
    """Turns block `name` on or off for the AI; the blocks now off."""
    from .path_utils import atomic_write_json

    if name not in BLOCKS:
        raise BlockError(f"No block {name!r}.")
    with _lock:
        off = turned_off() - {name} if on else turned_off() | {name}
        atomic_write_json(_off_path(), {"off": sorted(off)})
    return off


def _missing_models(block, info):
    """What models block needs that this ComfyUI lacks: [{"kind": "upscaler"|"detector"|"controlnet", "what": …}]."""
    missing = []
    if block.get("upscaler") and not _choices(info, "UpscaleModelLoader", "model_name"):
        missing.append({"kind": "upscaler"})
    for role, prefix in (block.get("detectors") or {}).items():
        if not any(prefix in name.lower() for name in _choices(info, "UltralyticsDetectorProvider", "model_name")):
            missing.append({"kind": "detector", "what": role})
    if block.get("control"):
        words = CONTROLS[block["control"]] + ANY_CONTROL
        if not any(any(word in name.lower() for word in words) and "lllite" not in name.lower()
                   for name in _choices(info, "ControlNetLoader", "control_net_name")):
            missing.append({"kind": "controlnet", "what": block["control"]})
    return missing


def status(info):
    """Every block as the user's panel shows it: its words, the packs it needs (installed or not), the
    models it lacks, whether it can run here and whether the user has it on."""
    off = turned_off()
    out = []
    for name, block in BLOCKS.items():
        packs = sorted(set(block["packs"].values()))
        lacking = {pack for kind, pack in block["packs"].items() if kind not in info}
        models = [] if lacking else _missing_models(block, info)
        extras = sorted({pack for kind, pack in (block.get("extras") or {}).items() if kind not in info})
        out.append({"name": name, "job": block["job"], "title": block["title"], "about": block["about"],
                    "source": block.get("source") or {}, "packs": [{"name": pack, "installed": pack not in lacking} for pack in packs],
                    "better_with": extras,
                    "models": models, "usable": not lacking and not models, "on": name not in off,
                    **({"instead": block["instead"]} if block.get("instead") else {})})
    return out


class BlockError(ValueError):
    pass


def directory(info=None):
    """{job: "block (a few words), …"} for the AI, short enough to stay in the chat: the blocks the
    user has on that this ComfyUI can run (with its node list `info`; without it, all of them), and a
    line for the rest, what they need, so the AI can say what to install."""
    off = turned_off()
    out = {heading: [] for heading in JOBS.values()}
    later = []
    for name, block in BLOCKS.items():
        if name in off:
            continue
        lacking = sorted({pack for kind, pack in block["packs"].items() if kind not in info}) if info is not None else []
        models = _missing_models(block, info) if info is not None and not lacking else []
        if lacking or models:
            later.append((name, ', '.join(lacking) or ', '.join(item['kind'] + ' model' for item in models)))
        else:
            out.setdefault(JOBS.get(block["job"], "Other"), []).append((name, block["short"]))

    def lines(words):  # "name (a few words)" while it fits, else the names alone
        listed = {heading: ", ".join(f"{name} ({why})" if words else name for name, why in names) for heading, names in out.items() if names}
        return {**listed, **({"Not here yet, needs": ", ".join(f"{name} ({why})" if words else name for name, why in later)} if later else {})}
    full = lines(True)
    return full if len(json.dumps(full, ensure_ascii=False)) <= DIRECTORY_CHARS else lines(False)


def _choices(info, kind, name):
    """The files node `kind`'s drop-down `name` offers, in either form ComfyUI's node list gives it
    ([[choices], {...}] or ["COMBO", {"options": [choices]}])."""
    try:
        spec = info[kind]["input"]["required"][name]
        found = spec[0] if isinstance(spec[0], list) else spec[1].get("options", []) if spec[0] == "COMBO" else []
    except (KeyError, IndexError, TypeError, AttributeError):
        found = []
    return [item for item in found if isinstance(item, str)]


def _detector(info, prefix):
    """The detector model file for `prefix` this ComfyUI has, preferring the larger kinds (m over s over n)."""
    found = sorted((name for name in _choices(info, "UltralyticsDetectorProvider", "model_name") if prefix in name.lower()),
                   key=lambda name: ("m." not in name, "s." not in name, name))
    if not found:
        raise BlockError(f"No {prefix.split('_')[0]} detector model in models/ultralytics/bbox ({prefix}*.pt): "
                         "ask the user to get one (ComfyUI-Manager's model list has them).")
    return found[0]


def _upscaler(info):
    """The upscale model file this ComfyUI has, preferring a 4× one, and how many times it enlarges."""
    files = _choices(info, "UpscaleModelLoader", "model_name")
    if not files:
        raise BlockError("No upscale model in models/upscale_models: ask the user to get one (4x-UltraSharp, "
                         "ComfyUI-Manager's model list has it).")
    times = {name: int(found.group(1) or found.group(2)) for name in files
             if (found := re.search(r"(?<![0-9])([1-8])x|x([1-8])(?![0-9])", name.lower()))}
    name = sorted(files, key=lambda item: (times.get(item) != 4, item.lower()))[0]
    return name, times.get(name, 4)


def _controlnet(info, kind, main, base_of):
    """The ControlNet file for `kind` (CONTROLS) whose base model (`base_of(name)`) is of the family of
    `main`, the canvas's model's: one for that kind before a union one, one of that very base first.
    LLLite files need their own loader."""
    from .model_advice import family

    wanted = family(main)
    files = [name for name in _choices(info, "ControlNetLoader", "control_net_name") if "lllite" not in name.lower()]
    own = [name for name in files if any(word in name.lower() for word in CONTROLS[kind])]
    union = [name for name in files if any(word in name.lower() for word in ANY_CONTROL) and name not in own]
    fitting = [name for name in own + union if not wanted or family(base_of(name)) == wanted]
    if not fitting:
        raise BlockError(f"No {kind} ControlNet{f' for {wanted} models' if wanted else ''} in models/controlnet: ask the "
                         "user to get one (Anomalous can download one they pick on Civitai).")
    return min(fitting, key=lambda name: (name in union, base_of(name).lower() != str(main).lower()))


def nodes_of(name, info, image=None, main_base=lambda: "", base_of=lambda name: ""):
    """Block `name` as add_nodes' group, its values filled in, or BlockError saying why not. A control
    block asks `main_base()` for the canvas's model's base model and `base_of` for each ControlNet's."""
    block = BLOCKS.get(name)
    if not block:
        raise BlockError(f"No block {name!r}; there are: {', '.join(BLOCKS)}.")
    if name in turned_off():
        raise BlockError(f"The user turned block {name} off in Anomalous (its 做法 panel): use another way, or ask them.")
    missing = sorted({pack for kind, pack in block["packs"].items() if kind not in info})
    if missing:
        instead = f" Use block {block['instead']} instead, or ask the user to install it with ComfyUI-Manager." if block.get("instead") else \
            " Ask the user to install it with ComfyUI-Manager."
        raise BlockError(f"Block {name} needs {', '.join(missing)}, not installed here.{instead}")
    if block.get("takes") and not (isinstance(image, str) and image.strip()):
        raise BlockError(f"Block {name} needs image: {TAKES[block['takes']]}.")
    fills = {"$image": (image or "").strip()}
    for role, prefix in (block.get("detectors") or {}).items():
        fills[f"${role}"] = _detector(info, prefix)
    if block.get("upscaler"):
        fills["$upscaler"], times = _upscaler(info)
        fills["$fit"] = round(block.get("upscale_by", 1) / times, 4)  # the model's 4× brought back to the block's size
    if block.get("control"):
        fills["$controlnet"] = _controlnet(info, block["control"], main_base(), base_of)
    # A node of a pack that only makes the block better (ColorMatch after an upscale) goes when the pack
    # is missing; a link "match|decode" takes the first of those nodes still there.
    nodes = {key: spec for key, spec in block["nodes"].items() if not spec.get("optional") or spec["class_type"] in info}
    link = lambda value: [next(key for key in value[0].split("|") if key in nodes), value[1]] if "|" in str(value[0]) else value  # noqa: E731
    return {key: {**{field: value for field, value in spec.items() if field != "optional"},
                  "inputs": {input: fills.get(value, value) if isinstance(value, str) else link(value) if isinstance(value, list) else value
                             for input, value in spec["inputs"].items()}} for key, spec in nodes.items()}


def roles_of(name):
    """The settings block `name` changes on canvas nodes it finds ({role: {setting: value}}), as the page applies them."""
    return BLOCKS[name].get("roles") or {}


def after(name):
    return BLOCKS[name]["after"]
