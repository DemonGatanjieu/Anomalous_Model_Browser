"""What Anomalous knows about using a model well, told to the AI so it need not guess:

- the settings its author's example pictures were made with (the Civitai record a scan keeps
  beside the file: images[].meta), summed up for get_model: how many pictures, the sampler and
  scheduler most used, the range of steps and CFG, the most used size and, for a LoRA, the
  weight it was used at: by its file hash, name or Civitai version, else the LoRA most of the
  pictures name (their names are the author's own files, and often an older version's);
- whether a LoRA suits the main model it is put on: add_lora and set_model compare their base
  models (the scan's, else what the file's header tells) and say so when the families differ
  (an SD 1.5 LoRA on an SDXL checkpoint does nothing useful) or, more softly, when two bases of one
  family differ (a Pony LoRA on an Illustrious checkpoint). A note only: the call is made;
- how large the main model is (main_params), for advice that depends on it (ai_skills.py).
"""

import json
import os
from collections import Counter

import folder_paths

from . import metadata

try:
    from ..model_kind import diffusion_params
except ImportError:  # loaded outside the package (tests)
    from model_kind import diffusion_params

# Base model names (Civitai's, or what model_kind.py infers) by the architecture their files share.
FAMILIES = (
    ("SDXL", ("sdxl", "pony", "illustrious", "noob")), ("SD 1.x", ("sd 1",)), ("SD 2.x", ("sd 2",)),
    ("SD 3", ("sd 3", "sd3")), ("Flux.1", ("flux.1", "flux 1", "chroma")), ("Flux.2", ("flux.2", "flux 2")),
)
# Bases trained far from their family's: a LoRA of one on another of the family loads but may look off.
OWN_WAYS = ("pony", "illustrious", "noob", "chroma")
MAIN_TYPES = ("checkpoints", "diffusion_models", "unet")
MAX_EXAMPLES = 20


def family(base):
    """The architecture family of a base model name ("" when none is known)."""
    lowered = str(base or "").strip().lower()
    if not lowered or lowered in ("other", "unknown"):
        return ""
    for name, marks in FAMILIES:
        if lowered.startswith(marks):
            return name
    return lowered


def base_of(file_path):
    """A model file's base model: the scan's, else what its header tells."""
    meta = metadata.get_metadata(file_path)
    return meta.get("baseModel") or meta.get("base_guess") or ""


def _main_base(value):
    """The base model of a main loader's choice (its drop-down value), or ""."""
    for folder_type in MAIN_TYPES:
        try:
            path = folder_paths.get_full_path(folder_type, value)
        except (KeyError, TypeError):
            path = None
        if path:
            return base_of(path)
    return ""


def main_params(value):
    """How many parameters the drawing model of a main loader's choice (its drop-down value) has, from
    its header; 0 when it is not found or its header cannot tell."""
    for folder_type in MAIN_TYPES:
        try:
            path = folder_paths.get_full_path(folder_type, value)
        except (KeyError, TypeError):
            path = None
        if path:
            return diffusion_params(path)
    return 0


def lora_paths(values):
    """The files of LoRA drop-down values that ComfyUI can find."""
    paths = []
    for value in values or []:
        try:
            path = folder_paths.get_full_path("loras", value)
        except (KeyError, TypeError):
            path = None
        if path:
            paths.append(path)
    return paths


def lora_note(lora_path, line):
    """A note when the LoRA at `lora_path` does not suit the main model of `line` (the page's
    {"model": the main loader's choice}), else None."""
    main = _main_base((line or {}).get("model") or "")
    lora = base_of(lora_path)
    if not main or not lora or main.lower() == lora.lower():
        return None
    if family(main) != family(lora):
        return (f"Base model clash: this LoRA is for {lora}, the main model ({line['model']}) is {main}; it will not "
                f"work as meant. Pick one with search_models(type='loras', base_model='{main}'), or remove it.")
    if lora.lower().startswith(OWN_WAYS) or main.lower().startswith(OWN_WAYS):
        return (f"This LoRA was made for {lora}, the main model is {main}: same family, so it loads, but it may "
                f"look weaker or off. search_models(type='loras', base_model='{main}') finds ones made for it.")
    return None


def _number(value):
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) < 1e6 else None


def _span(numbers):
    """'25' or '20–30' for a list of numbers, '' for none."""
    if not numbers:
        return ""
    low, high = min(numbers), max(numbers)
    say = lambda number: f"{number:g}"
    return say(low) if low == high else f"{say(low)}–{say(high)}"


def _common(values, total):
    """'euler (6 of 10)': the most used value and in how many of the `total` pictures."""
    counted = Counter(value for value in values if value)
    if not counted:
        return ""
    value, times = counted.most_common(1)[0]
    return str(value) if times == total else f"{value} ({times} of {total})"


def _loras(meta):
    """[(who, weight)] of the LoRAs one picture's settings name: who is a hash, a file name or "v<version>"."""
    found = []
    for item in meta.get("resources") or []:
        if isinstance(item, dict) and str(item.get("type", "")).lower() == "lora":
            found.append((str(item.get("hash") or item.get("name") or "").lower(), _number(item.get("weight"))))
    for item in meta.get("additionalResources") or []:
        if isinstance(item, dict) and str(item.get("type", "lora")).lower() == "lora":
            found.append((os.path.splitext(os.path.basename(str(item.get("name", ""))))[0].lower(), _number(item.get("strength"))))
    for item in meta.get("civitaiResources") or []:
        if isinstance(item, dict) and str(item.get("type", "")).lower() == "lora" and item.get("modelVersionId") is not None:
            found.append((f"v{item['modelVersionId']}", _number(item.get("weight"))))
    return [(who, weight) for who, weight in found if who and weight is not None]


def _lora_weights(metas, own):
    """The weights this LoRA was used at in its pictures: those naming it (`own`: its hash, file
    name, version), else the one LoRA most of them name; none when two are named as often."""
    per = [_loras(meta) for meta in metas]
    named = Counter(who for found in per for who in {who for who, _weight in found})
    mine = {who for who in named if who in own}
    if not mine:
        common = [(who, times) for who, times in named.most_common(2) if times * 5 >= len(metas) * 3]
        if common and (len(common) == 1 or common[0][1] > common[1][1]):
            mine = {common[0][0]}
    return [weight for found in per for who, weight in found if who in mine]


def _record(file_path):
    """The Civitai record kept beside the model (its .info), or None."""
    base_path = os.path.splitext(file_path)[0]
    info_base = metadata._info_base(file_path, base_path)
    for path in (metadata.find(info_base, ".info"), f"{info_base}.civitai.info"):
        if path and os.path.isfile(path):
            try:
                with open(path, encoding="utf-8") as handle:
                    data = json.load(handle)
            except (OSError, ValueError):
                continue
            if isinstance(data, dict) and isinstance(data.get("images"), list):
                return data
    return None


def author_examples(file_path, folder_type, sha256=""):
    """What the author's example pictures were made with, summed up; {} when nothing is kept."""
    record = _record(file_path)
    metas = [image.get("meta") for image in (record or {}).get("images") or []
             if isinstance(image, dict) and isinstance(image.get("meta"), dict)][:MAX_EXAMPLES]
    if not metas:
        return {}
    sizes = [meta.get("Size") or (f"{meta['width']}x{meta['height']}" if meta.get("width") and meta.get("height") else "")
             for meta in metas]
    found = {
        "pictures": len(metas),
        "sampler": _common([str(meta.get("sampler") or "") for meta in metas if str(meta.get("sampler")).lower() != "undefined"], len(metas)),
        "scheduler": _common([str(meta.get("scheduler") or meta.get("Schedule type") or "") for meta in metas], len(metas)),
        "steps": _span([n for n in (_number(meta.get("steps")) for meta in metas) if n is not None]),
        "cfg": _span([n for n in (_number(meta.get("cfgScale")) for meta in metas) if n is not None]),
        "size": _common([str(size) for size in sizes], len(metas)),
        "clip_skip": _span([n for n in (_number(meta.get("clipSkip") or meta.get("Clip skip")) for meta in metas) if n is not None]),
    }
    if folder_type == "loras":
        own = {(sha256 or "")[:10].lower(), os.path.splitext(os.path.basename(file_path))[0].lower(), f"v{record.get('id')}"} - {""}
        found["lora_weight"] = _span(_lora_weights(metas, own))
    return {key: value for key, value in found.items() if value}
