"""Words a LoRA's own file suggests for the prompt, for a LoRA Civitai gives none: the trigger
phrase its maker wrote (modelspec.trigger_phrase), else the tags most of its training pictures
share (kohya's ss_tag_frequency), tags any picture could have left out. A guess, shown as one and
never mixed into Civitai's trainedWords. The scanner keeps them in the .info it writes
(anomalous_header_words); the model details and the AI read a LoRA scanned before that at once.
Reads the header only (model_kind.read_head). No imports from ComfyUI.
"""

import json

try:
    from .model_kind import classify, read_head
except ImportError:  # the standalone scanner imports this file on its own
    from model_kind import classify, read_head

MOST = 5
SHARE = 0.5  # in at least half as many pictures as the most used tag
LONGEST = 60
# Tags that say nothing of what a LoRA adds: how many people, framing, plain backgrounds, quality words.
GENERIC = frozenset((
    "1girl", "1boy", "2girls", "2boys", "3girls", "multiple girls", "multiple boys", "solo", "solo focus",
    "female focus", "male focus", "looking at viewer", "looking at another", "looking away", "simple background",
    "white background", "grey background", "gray background", "black background", "transparent background",
    "smile", "open mouth", "closed mouth", "parted lips", "blush", "upper body", "full body", "cowboy shot",
    "portrait", "close-up", "standing", "sitting", "long hair", "short hair", "medium hair", "very long hair",
    "breasts", "small breasts", "medium breasts", "large breasts", "outdoors", "indoors", "day", "night",
    "monochrome", "greyscale", "masterpiece", "best quality", "high quality", "highres", "absurdres",
    "lowres", "score_9", "score_8_up", "score_7_up",
))


def _split(text):
    return [part.strip() for part in str(text).split(",") if part.strip()]


def _counts(text):
    """{tag: how many training pictures have it} from ss_tag_frequency ({folder: {tag: count}})."""
    try:
        folders = json.loads(text or "{}")
    except ValueError:
        return {}
    counts = {}
    for tags in folders.values() if isinstance(folders, dict) else ():
        for tag, count in tags.items() if isinstance(tags, dict) else ():
            name = str(tag).strip()
            if name and isinstance(count, (int, float)) and not isinstance(count, bool):
                counts[name] = counts.get(name, 0) + count
    return counts


def from_meta(meta):
    """Up to MOST words from a safetensors header's __metadata__ (its values are strings)."""
    phrase = _split(meta.get("modelspec.trigger_phrase") or "")
    if phrase:
        return [word[:LONGEST] for word in phrase[:MOST]]
    counts = _counts(meta.get("ss_tag_frequency"))
    if not counts:
        return []
    least = max(counts.values()) * SHARE
    shared = [tag for tag, count in counts.items() if count >= least and len(tag) <= LONGEST
              and tag.lower().replace("_", " ") not in GENERIC and tag.lower() not in GENERIC]
    return sorted(shared, key=lambda tag: -counts[tag])[:MOST]


def of_file(path):
    """The words of a LoRA file's header; [] for other kinds, other formats and unreadable files."""
    fmt, header = read_head(path)
    if fmt != "safetensors" or not header or classify(fmt, header)["kind"] != "loras":
        return []
    meta = header.get("__metadata__")
    return from_meta(meta) if isinstance(meta, dict) else []
