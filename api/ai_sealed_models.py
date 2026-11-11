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


def _forms(blob):
    """What the strings of an answer (`blob`) may call the library's models: {form: model_id} for anywhere
    in a text, {name: model_id} for where a name stands. Only the models `blob` can be naming."""
    anywhere, names = {}, {}
    for model in _library():
        shown, stem = str(model["name"] or ""), os.path.splitext(model["file"])[0]
        if not any(form and form in blob for form in (shown, stem)):
            continue
        place = model["id"].split(":", 2)[2]
        for form in (model["id"], place, place.replace("/", "\\"), model["file"]):
            anywhere.setdefault(form, model["id"])
        for form in (shown, stem):
            if form:
                names.setdefault(form, model["id"])
                if _distinct(form):
                    anywhere.setdefault(form, model["id"])
    return anywhere, names


def hide(value, seals):
    """Tool answer `value` (its data, or a text of it) with every model as its token of `seals`."""
    strings = []
    _gather(value, strings)
    blob = "\n".join(strings)
    anywhere, names = _forms(blob)
    found = sorted((form for form in anywhere if form in blob), key=len, reverse=True)
    # A form counts where it stands by itself: "anima.safetensors" is not taken out of "my_anima.safetensors".
    known = re.compile(r"(?<![\w.-])(?:" + "|".join(re.escape(form) for form in found) + r")(?!\w)") if found else None

    def text(words, key):
        if key in PLAIN_KEYS:
            return words
        whole = anywhere.get(words) or ((names.get(words) or _cut(words)) if key in NAME_KEYS else None)
        if whole:
            return seals.seal(whole, "M")
        swapped = known.sub(lambda match: seals.seal(anywhere[match.group(0)], "M"), words) if known else words
        if swapped == words and words.lower().endswith(MODEL_FILE) and len(words) <= MAX_NAME and "\n" not in words and ": " not in words:
            return seals.seal(words, "M")  # a model file the library does not have, spaces in its name and all
        return LOOSE.sub(lambda match: seals.seal(match.group(0), "M"), swapped)

    def walk(item, key=""):
        if isinstance(item, dict):
            entry = isinstance(item.get("model_id"), str)
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
