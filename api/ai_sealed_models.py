"""Model names of a private task as tokens, while the user keeps those too (ai_privacy.hides_models):
a file name, its folder, the name on its card and its pages can say as much as a prompt does. Each
model of the library is one token ("[M1]", sealed in the task as its model_id, ai_sealed.py) however
a tool's answer writes it: its model_id, the name a loader lists it by, its file name inside a text;
its card's name where a name stands (NAME_KEYS), and inside a text when it is more than one plain
word (a model called "Anima" is not taken out of every sentence about Anima). A model's own entry
(anything with a model_id) loses what tells it apart (ENTRY_DROPS); its type, base model, author's
settings and the user's note for the AI stay, to pick by. A model file the library does not have
(one a workflow names) is a token of its own. written() and named() are the way back: the model_id
where a tool takes one, the loader's name among a node's values, the card's name inside the AI's words."""

import os
import re

from . import ai_toolbox_catalog

MODEL_FILE = (".safetensors", ".gguf", ".ckpt", ".pt", ".pth", ".bin", ".sft", ".onnx")
MODEL_ID = re.compile(r"[\w-]+:\d+:.+")
LOOSE = re.compile(r"[^\s\"'<>|*?,;()\[\]{}]+\.(?:safetensors|gguf|ckpt|pth|pt|bin|sft|onnx)\b", re.IGNORECASE)
ENTRY_DROPS = ("name", "file", "folder", "rel", "cover", "civitai_name", "version", "civitai_url", "download_link", "sha256")
NAME_KEYS = {"name", "names", "more_names", "model", "models", "main_model", "loras", "label", "labels"}
PLAIN_KEYS = {"type", "kind", "base", "base_model", "baseModel", "family", "source"}  # never a model's name
WIDGET_KEYS = {"values", "settings", "inputs", "widgets", "widgets_values"}  # a node's values: models by their loader's names
MAX_NAME = 260


def _library():
    """The library's models [{id, name, file}] as the materials picker lists them (read at most every few seconds)."""
    return ai_toolbox_catalog.everything()["models"]


def _distinct(name):
    """Whether card name `name` is looked for inside a text: not one plain word, which a sentence may use as itself."""
    return len(name) >= 4 and not (name.isascii() and name.isalpha())


def _cut(words):
    """The model whose card name begins with `words`, a name a tool cut short (mcp_fit.NAME), or None."""
    return next((model["id"] for model in _library() if str(model["name"] or "").startswith(words)), None) if len(words) >= 20 else None


def _gather(value, out):
    if isinstance(value, dict):
        for key, item in value.items():
            out.append(str(key))
            _gather(item, out)
    elif isinstance(value, list):
        for item in value:
            _gather(item, out)
    elif isinstance(value, str):
        out.append(value)


def _forms(blob, only_ids=None, skip_ids=()):
    """What the strings of an answer (`blob`) may call the library's models: {form: model_id} for anywhere
    in a text, {name: model_id} for where a name stands. Only the models `blob` can be naming."""
    anywhere, names = {}, {}
    skip = set(skip_ids or ())
    only = set(only_ids) if only_ids is not None else None
    seen = set()
    for model in _library():
        mid = model["id"]
        seen.add(mid)
        if mid in skip or (only is not None and mid not in only):
            continue
        shown, stem = str(model["name"] or ""), os.path.splitext(model["file"])[0]
        if not any(form and form in blob for form in (shown, stem, model["file"], mid)):
            continue
        place = mid.split(":", 2)[2]
        for form in (mid, place, place.replace("/", "\\"), model["file"]):
            anywhere.setdefault(form, mid)
        for form in (shown, stem):
            if form:
                names.setdefault(form, mid)
                if _distinct(form):
                    anywhere.setdefault(form, mid)
    for mid in only or ():
        if mid in seen or mid in skip:
            continue
        place = mid.split(":", 2)[2] if MODEL_ID.fullmatch(mid) else mid
        base = os.path.basename(place.replace("\\", "/"))
        stem = os.path.splitext(base)[0]
        for form in (mid, place, place.replace("/", "\\"), base):
            if form and form in blob:
                anywhere.setdefault(form, mid)
        if stem and _distinct(stem) and stem in blob:
            anywhere.setdefault(stem, mid)
    return anywhere, names


def _skip_files(skip_ids):
    files = set()
    if not skip_ids:
        return files
    skip = set(skip_ids)
    for item in skip:
        text = str(item or "")
        if text:
            place = text.split(":", 2)[2] if MODEL_ID.fullmatch(text) else text
            for form in (text, place, place.replace("/", "\\"), os.path.basename(place.replace("\\", "/"))):
                if form:
                    files.add(form.lower())
    for model in _library():
        if model["id"] not in skip:
            continue
        place = model["id"].split(":", 2)[2]
        for form in (model["file"], place, place.replace("/", "\\")):
            if form:
                files.add(form.lower())
    return files


def hide(value, seals, only_ids=None, skip_ids=()):
    """Tool answer `value` (its data, or a text of it) with every scoped model as its token of `seals`."""
    strings = []
    _gather(value, strings)
    blob = "\n".join(strings)
    anywhere, names = _forms(blob, only_ids=only_ids, skip_ids=skip_ids)
    skip = set(skip_ids or ())
    only = set(only_ids) if only_ids is not None else None
    hide_loose = only is None
    allowed_loose = _skip_files(skip_ids)
    found = sorted((form for form in anywhere if form in blob), key=len, reverse=True)
    # A form counts where it stands by itself: "anima.safetensors" is not taken out of "my_anima.safetensors".
    known = re.compile(r"(?<![\w.-])(?:" + "|".join(re.escape(form) for form in found) + r")(?!\w)") if found else None

    def model_is_hidden(mid):
        if mid in skip:
            return False
        return True if only is None else (mid in only)

    def loose_token(word):
        if word.lower() in allowed_loose:
            return word
        return seals.seal(word, "M") if hide_loose else word

    def text(words, key):
        if key in PLAIN_KEYS:
            return words
        whole = anywhere.get(words) or ((names.get(words) or _cut(words)) if key in NAME_KEYS and only is None else None)
        if whole and whole not in skip:
            return seals.seal(whole, "M")
        if words.lower() in allowed_loose:
            return words
        swapped = known.sub(lambda match: seals.seal(anywhere[match.group(0)], "M"), words) if known else words
        if hide_loose and swapped == words and words.lower().endswith(MODEL_FILE) and len(words) <= MAX_NAME and "\n" not in words and ": " not in words:
            return loose_token(words)  # a model file the library does not have, spaces in its name and all
        return LOOSE.sub(lambda match: loose_token(match.group(0)), swapped) if hide_loose else swapped

    def walk(item, key=""):
        if isinstance(item, dict):
            if item.get("kind") == "ways" and isinstance(item.get("details"), dict):
                return {name: walk(part, name) if name in ("said_as", "user_note") else part for name, part in item.items()}
            mid = item.get("model_id")
            entry = isinstance(mid, str) and model_is_hidden(mid)
            return {text(name, "") if isinstance(name, str) else name: walk(part, name)
                    for name, part in item.items() if not (entry and name in ENTRY_DROPS)}
        if isinstance(item, list):
            return [walk(part, key) for part in item]
        return text(item, key) if isinstance(item, str) else item
    return walk(value)


def written(text, widget):
    """What the token of the model sealed as `text` puts into a call: the name its loader lists it by among
    a node's values (`widget`), else the model_id the tools take."""
    return text.split(":", 2)[2].replace("/", os.sep) if widget and MODEL_ID.fullmatch(text) else text


def named(text):
    """The card's name of the model sealed as `text`, for where the AI wrote its token inside its own words."""
    found = next((model for model in _library() if model["id"] == text), None)
    return str(found["name"] or found["file"]) if found else text
