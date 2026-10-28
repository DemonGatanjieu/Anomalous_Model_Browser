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
# The models the ways recommend: where each comes from (links), its size, SHA256 and licence, the folder it goes in.
MODELS_FILE = os.path.join(os.path.dirname(__file__), "block_models.json")
TAKES = {"inpaint": "the picture with the area as its alpha (inpaint_image from propose_repaint_area or ask_user's answer)",
         "reference": "the picture to follow: one the user handed you (its path, as their message gives it) or one in the input folder",
         "picture": "the picture to work on: one the user handed you (its path, as their message gives it) or one in the input folder"}
# A block's second picture ("scene" in add_nodes), for a block that takes two.
SCENE = "scene: the picture to put it into, given the same ways"
# The words a ControlNet file's name has for what it follows; a union model follows all of them.
CONTROLS = {"pose": ("openpose", "pose"), "depth": ("depth",), "tile": ("tile",), "lineart": ("lineart", "mangaline", "manga_line")}
ANY_CONTROL = ("union", "promax")
# What a union ControlNet is told to follow (ComfyUI's SetUnionControlNetType).
UNION_TYPES = {"pose": "openpose", "depth": "depth", "tile": "tile", "lineart": "canny/lineart/anime_lineart/mlsd"}
# A ControlNet whose base model is not known yet (not scanned): its folder or name says it, as Anomalous sorts them.
NAMED_BASES = (("noob", "NoobAI"), ("illustrious", "Illustrious"), ("pony", "Pony"), ("sd_1.5", "SD 1.5"), ("sd15", "SD 1.5"),
               ("sdxl", "SDXL 1.0"), ("xl", "SDXL 1.0"))
# The uses an AI asks for (a block's "job"): add_nodes(use=…, want=…) and Anomalous picks the block,
# the best of that use this ComfyUI can run; a block's "want" is the word that asks for it instead.
JOBS = {"repaint": "Repaint an area", "new_background": "New background, the character kept", "upscale": "Upscale",
        "refine": "Redraw with another model", "follow": "Follow a given picture", "detail": "Fix faces and hands",
        "process": "Picture work"}
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
with open(MODELS_FILE, encoding="utf-8") as _source:
    MODELS = json.load(_source)


def _installed(model):
    """Whether recommended `model` is here: a file of its name or of its very size in its folder (a renamed copy)."""
    try:
        import folder_paths
        names = folder_paths.get_filename_list(model["folder"])
    except Exception:  # noqa: BLE001 - no ComfyUI (tests) or no such folder type
        return False
    if any(os.path.basename(name.replace("\\", "/")) == model["file"] for name in names):
        return True
    for name in names:
        path = folder_paths.get_full_path(model["folder"], name)
        try:
            if path and os.path.getsize(path) == model["size"]:
                return True
        except OSError:
            continue
    return False


def recommended(block):
    """Block's recommended models as the panel shows them, each with whether it is here."""
    return [{"id": key, **{field: MODELS[key][field] for field in ("title", "file", "folder", "subfolder", "size", "sha256", "license", "sources")},
             "base": MODELS[key].get("base", ""), "installed": _installed(MODELS[key])} for key in block.get("models") or [] if key in MODELS]


def tested_words(block):
    """How the block was tried, in a line for the AI ("about 77 s for SDXL at 832×1216 on a 6 GB card"), or ""."""
    tested = block.get("tested") or {}
    runs = [run for run in tested.get("runs") or [] if run.get("seconds")]
    if not runs:
        return ""
    each = "; ".join(f"about {run['seconds']} s for {run['model']} at {run['size']}" for run in runs)
    return f"Tried on a {tested.get('vram_gb')} GB card ({tested.get('gpu')}), a whole run with the picture made: {each}."


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
                    "better_with": extras, "recommended": recommended(block), "tested": block.get("tested") or {},
                    "models": models, "usable": not lacking and not models, "on": name not in off,
                    **({"instead": block["instead"]} if block.get("instead") else {})})
    return out


class BlockError(ValueError):
    pass


class MissingModel(BlockError):
    """A model the block needs is not in ComfyUI's lists (perhaps just downloaded: the lists are read again once)."""


def directory(info=None):
    """{use: "what it does (want: …)"} for the AI, a line a use, short enough to stay in the chat: the
    uses this ComfyUI can do now (with its node list `info`; without it, all), each with the words that
    ask for another of its blocks, and a line for the rest by what they need, so the AI can say what to install."""
    off = turned_off()
    ready, later = {}, {}
    for name, block in BLOCKS.items():
        if name in off:
            continue
        lacking = sorted({pack for kind, pack in block["packs"].items() if kind not in info}) if info is not None else []
        models = _missing_models(block, info) if info is not None and not lacking else []
        label = f"{block['job']} {block['want']}" if block.get("want") else block["job"]
        if lacking or models:
            later.setdefault(', '.join(lacking) or ', '.join(item['kind'] + ' model' for item in models), []).append(label)
        else:
            ready.setdefault(block["job"], []).append(block.get("want"))
    out = {}
    for use, heading in JOBS.items():
        if use in ready:
            wants = [want for want in ready[use] if want]
            out[use] = heading + (f" (want: {', '.join(wants)})" if wants else "")
    if later:
        out["Not here yet, needs"] = "; ".join(f"{need}: {', '.join(labels)}" for need, labels in later.items())
    return out


def pick(use, want=None, info=None, scene=False):
    """The block for `use` (and `want`): the first by rank this ComfyUI can run, else the first, whose
    build then says what it needs. Given a second picture (`scene`), the use's block that takes one."""
    names = [name for name, block in BLOCKS.items() if block["job"] == use]
    if not names:
        raise BlockError(f"No use {use!r}; there are: {', '.join(JOBS)}.")
    if want is None and scene:
        want = next((BLOCKS[name].get("want") for name in names if BLOCKS[name].get("scene")), None)
    chosen = [name for name in names if BLOCKS[name].get("want") == want]
    if not chosen:
        wants = [BLOCKS[name]["want"] for name in names if BLOCKS[name].get("want")]
        raise BlockError(f"{use} takes want: {', '.join(wants)}" + ("" if len(wants) == len(names) else ", or none") + ".")
    off = turned_off()
    runs = [name for name in chosen if name not in off and (info is None or (
        all(kind in info for kind in BLOCKS[name]["packs"]) and not _missing_models(BLOCKS[name], info)))]
    return (runs or chosen)[0]


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
        raise MissingModel(f"No {prefix.split('_')[0]} detector model in models/ultralytics/bbox ({prefix}*.pt): "
                         "ask the user to get one (ComfyUI-Manager's model list has them).")
    return found[0]


def _upscaler(info, wanted=2.0):
    """The upscale model file this ComfyUI has, the least enlarging one that reaches `wanted` (a 2× one
    for 1.25×: less work than 4× scaled back down), and how many times it enlarges."""
    files = _choices(info, "UpscaleModelLoader", "model_name")
    if not files:
        raise MissingModel("No upscale model in models/upscale_models: ask the user to get one (4x-UltraSharp, "
                         "ComfyUI-Manager's model list has it).")
    times = {name: int(found.group(1) or found.group(2)) for name in files
             if (found := re.search(r"(?<![0-9])([1-8])x|x([1-8])(?![0-9])", name.lower()))}
    enough = lambda item: times.get(item, 4) >= wanted  # noqa: E731
    name = sorted(files, key=lambda item: (not enough(item), times.get(item, 4) if enough(item) else -times.get(item, 4), item.lower()))[0]
    return name, times.get(name, 4)


def _controlnet(info, kind, main, base_of):
    """The ControlNet file for `kind` (CONTROLS) whose base model (`base_of(name)`) is of the family of
    `main`, the canvas's model's: one for that kind before a union one, one of that very base first.
    LLLite files need their own loader."""
    from .model_advice import family

    wanted = family(main)
    known = base_of
    base_of = lambda name: known(name) or next((base for word, base in NAMED_BASES if word in name.lower()), "")  # noqa: E731
    files = [name for name in _choices(info, "ControlNetLoader", "control_net_name")
             if "lllite" not in name.lower() and not name.lower().startswith("anima")]
    own = [name for name in files if any(word in name.lower() for word in CONTROLS[kind])]
    union = [name for name in files if any(word in name.lower() for word in ANY_CONTROL) and name not in own]
    fitting = [name for name in own + union if not wanted or family(base_of(name)) == wanted]
    if not fitting:
        raise MissingModel(f"No {kind} ControlNet{f' for {wanted} models' if wanted else ''} in models/controlnet: ask the "
                         "user to get one (Anomalous can download one they pick on Civitai).")
    return min(fitting, key=lambda name: (name in union, base_of(name).lower() != str(main).lower()))


def _told_its_type(nodes, kind):
    """`nodes` with a union ControlNet told what to follow: SetUnionControlNetType after its loader, its takers fed from that."""
    loader = next(key for key, spec in nodes.items() if spec["class_type"] == "ControlNetLoader")
    out = {key: {**spec, "inputs": {name: ["union_type", 0] if value == [loader, 0] else value for name, value in spec["inputs"].items()}}
           for key, spec in nodes.items()}
    out["union_type"] = {"class_type": "SetUnionControlNetType", "inputs": {"control_net": [loader, 0], "type": kind}}
    return out


def _lllite(info, kind):
    """The Anima ControlNet-LLLite file for `kind` (depth, pose, inpaint) in models/controlnet."""
    found = [name for name in _choices(info, "AnimaLLLiteApply_sdscripts", "lllite_name")
             if ("lllite" in name.lower() or name.lower().startswith("anima")) and kind in name.lower()]
    if not found:
        raise MissingModel(f"No Anima {kind} LLLite model in models/controlnet (anima-lllite-{kind}*.safetensors): ask the "
                         "user to get one.")
    return sorted(found)[-1]  # the newest version


def _variant(name, block, main_base):
    """`block` as it is built for the canvas's model: its variant for that model's family merged over it
    (on an Anima model an LLLite stands in for the ControlNet), else itself."""
    variants = block.get("variants") or {}
    if not variants:
        return block
    from .model_advice import family

    kind = family(main_base())
    return {**block, **variants[kind]} if kind in variants else block


def nodes_of(name, info, image=None, main_base=lambda: "", base_of=lambda name: ""):
    """Block `name` as add_nodes' group, its values filled in, or BlockError saying why not."""
    return build(name, info, image, main_base, base_of)["nodes"]


def build(name, info, image=None, main_base=lambda: "", base_of=lambda name: "", scene=None):
    """Block `name` built for this canvas: {nodes (add_nodes' group, its values filled in), roles, after},
    or BlockError saying why not. A block with variants or a ControlNet asks `main_base()` (once) for
    the canvas's model's base model, and `base_of` for each ControlNet's."""
    block = BLOCKS.get(name)
    if not block:
        raise BlockError(f"No block {name!r}; there are: {', '.join(BLOCKS)}.")
    asked = []
    def main():
        if not asked:
            asked.append(main_base())
        return asked[0]
    if name in turned_off():
        raise BlockError(f"The user turned block {name} off in Anomalous (its 做法 panel): use another way, or ask them.")
    def packs_here(block):
        missing = sorted({pack for kind, pack in block["packs"].items() if kind not in info})
        if missing:
            instead = f" Use block {block['instead']} instead, or ask the user to install it with ComfyUI-Manager." if block.get("instead") else \
                " Ask the user to install it with ComfyUI-Manager."
            raise BlockError(f"Block {name} needs {', '.join(missing)}, not installed here.{instead}")
    packs_here(block)  # before the page is asked which model the canvas has
    block = _variant(name, block, main)
    packs_here(block)
    if block.get("takes") and not (isinstance(image, str) and image.strip()):
        raise BlockError(f"Block {name} needs image: {TAKES[block['takes']]}.")
    if block.get("scene") and not (isinstance(scene, str) and scene.strip()):
        raise BlockError(f"Block {name} needs {SCENE}.")
    fills = {"$image": (image or "").strip(), "$scene": (scene or "").strip()}
    for role, prefix in (block.get("detectors") or {}).items():
        fills[f"${role}"] = _detector(info, prefix)
    if block.get("upscaler"):
        fills["$upscaler"], times = _upscaler(info, block.get("upscale_by", 2.0))
        fills["$fit"] = round(block.get("upscale_by", 1) / times, 4)  # the model's 4× brought back to the block's size
    nodes = dict(block["nodes"])
    if block.get("control"):
        fills["$controlnet"] = _controlnet(info, block["control"], main(), base_of)
        if any(word in fills["$controlnet"].lower() for word in ANY_CONTROL) and "SetUnionControlNetType" in info:
            nodes = _told_its_type(nodes, UNION_TYPES[block["control"]])
    if block.get("lllite"):
        fills["$lllite"] = _lllite(info, block["lllite"])
    # A node of a pack that only makes the block better (ColorMatch after an upscale) goes when the pack
    # is missing; a link "match|decode" takes the first of those nodes still there.
    nodes = {key: spec for key, spec in nodes.items() if not spec.get("optional") or spec["class_type"] in info}
    link = lambda value: [next(key for key in value[0].split("|") if key in nodes), value[1]] if "|" in str(value[0]) else value  # noqa: E731
    built = {key: {**{field: value for field, value in spec.items() if field != "optional"},
                   "inputs": {input: fills.get(value, value) if isinstance(value, str) else link(value) if isinstance(value, list) else value
                              for input, value in spec["inputs"].items()}} for key, spec in nodes.items()}
    return {"nodes": built, "roles": block.get("roles") or {}, "after": block["after"], "tested": tested_words(BLOCKS[name])}
