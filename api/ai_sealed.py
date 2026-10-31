"""What a private task (ai_privacy.py) keeps from the AI besides pictures: prompt text and picture
names. Each is sealed: kept in the task (task["sealed"], {token: text}) and given to the AI as a
token, "[P3]" for a text and "[img2]" for a picture's name. The AI writes the token where the text
goes (a prompt, a picture to load, its own words around it) and expand() puts the text back before
the tool runs, so the canvas and the runs get it while the AI never reads it.

mask() seals what a tool's answer holds, in this order: every text input of a node (ComfyUI's node
list says which inputs are STRING: prompts, file name prefixes; model names, numbers and choices
stay), the prompt fields of saved prompts, combos, workflows, models and changes (PROMPT_KEYS, and
a few per tool), picture file names anywhere, and last any sealed text wherever it still shows up.
seal_answer() takes the user's prompt box (a "prompts" panel block, ui_ai_prompt_box.js): the
prompts and reference pictures, sealed, with the tokens the AI gets for them.
"""

import json
import re

from . import ai_tasks
from .mcp_tools import tool_text

TOKEN = re.compile(r"\[(?:P|img)\d+\]")
WORD = re.compile(r"[^\W\d_]")  # a letter of any script
PICTURE = re.compile(r"[^\s\"'<>|*?,;()\[\]{}]*\.(?:png|jpe?g|webp|gif|bmp|mp4|webm|mov)\b", re.IGNORECASE)
MODEL_FILE = (".safetensors", ".gguf", ".ckpt", ".pt", ".pth", ".bin", ".sft", ".onnx")
# Fields whose text is a prompt, or holds one (a workflow's settings, a change's before and after).
PROMPT_KEYS = {"prompt", "prompts", "positive", "negative", "positive_prompt", "negative_prompt", "notes",
               "settings", "before", "after", "filename_prefix", "trigger_words", "trainedWords"}
TOOL_KEYS = {"get_model": {"description", "user_notes"}}
MIN_SEALED = 3  # shorter texts are not looked for elsewhere (they would match inside other words)
MAX_PROMPTS = 8
MAX_PROMPT = 4000
MAX_PICTURES = 4
_loose = {}  # tokens of calls tied to no task, while this ComfyUI runs


class Seals:
    """The tokens of task `task_id` (None: the calls tied to no task); save() keeps new ones."""

    def __init__(self, task_id):
        self.task_id = task_id
        with ai_tasks._lock:
            task = ai_tasks._load().get(task_id) if task_id else None
            self.tokens = dict(task.get("sealed") or {}) if task else _loose
        self.texts = {text: token for token, text in self.tokens.items()}
        self.changed = False

    def seal(self, text, kind="P"):
        known = self.texts.get(text)
        if known and known.startswith(f"[{kind}"):
            return known
        token = f"[{kind}{1 + sum(1 for item in self.tokens if item.startswith(f'[{kind}'))}]"
        self.tokens[token], self.texts[text] = text, token
        self.changed = True
        return token

    def save(self):
        if not self.changed or not self.task_id:
            return
        with ai_tasks._lock:
            task = ai_tasks._load().get(self.task_id)
            if task:
                task["sealed"] = self.tokens
                ai_tasks._save(task)


def expand(task_id, value):
    """`value` (a tool's arguments) with every known token replaced by its text (a text sealed with a
    token in it, its text too)."""
    tokens = Seals(task_id).tokens

    def text(words):
        for _ in range(3):
            words, before = TOKEN.sub(lambda match: tokens.get(match.group(0), match.group(0)), words), words
            if words == before:
                break
        return words
    return _strings(value, text)


def _sealable(text):
    """Whether `text` holds words: not only tokens (sealed already), numbers or ids (a node's "6")."""
    return bool(WORD.search(TOKEN.sub("", text)))


def _text_input(info, node_type, key, value):
    """Whether input `key` of a `node_type` node is text the user wrote (STRING in ComfyUI's node list).
    A setting the page adds to a known node ("control_after_generate"): only words with a space in them;
    a node type it does not know: any string but a model file's name."""
    spec = (info.get(node_type) or {}).get("input")
    for group in ("required", "optional"):
        found = ((spec or {}).get(group) or {}).get(key)
        if found is not None:
            return isinstance(found, (list, tuple)) and bool(found) and found[0] == "STRING"
    if spec is not None:
        return any(mark in value for mark in (" ", ","))
    return not value.lower().endswith(MODEL_FILE)


def seal_text(seals, value):
    """A prompt field's value sealed (a string, or strings in a list); a model file's name stays."""
    if isinstance(value, str):
        return value if not _sealable(value) or value.lower().endswith(MODEL_FILE) else seals.seal(value)
    if isinstance(value, list):
        return [seal_text(seals, item) for item in value]
    return value


def _walk(value, seals, info, keys):
    if isinstance(value, list):
        return [_walk(item, seals, info, keys) for item in value]
    if not isinstance(value, dict):
        return value
    out = {}
    node_type = value.get("class_type") or value.get("type")
    for key, item in value.items():
        if key in ("settings", "inputs", "widgets") and isinstance(item, dict) and isinstance(node_type, str):
            out[key] = {name: seals.seal(text) if isinstance(text, str) and _sealable(text) and _text_input(info, node_type, name, text)
                        else _walk(text, seals, info, keys) for name, text in item.items()}
        elif key in keys and (isinstance(item, str) or isinstance(item, list) and all(isinstance(text, str) for text in item)):
            out[key] = seal_text(seals, item)
        else:
            out[key] = _walk(item, seals, info, keys)
    return out


def _strings(value, change):
    if isinstance(value, dict):
        return {key: _strings(item, change) for key, item in value.items()}
    if isinstance(value, list):
        return [_strings(item, change) for item in value]
    return change(value) if isinstance(value, str) else value


def _hide(seals, text):
    """`text` with every picture name in it, then every sealed text (longest first), as tokens."""
    text = PICTURE.sub(lambda match: seals.seal(match.group(0), "img"), text)
    for sealed in sorted((item for item in seals.texts if len(item) >= MIN_SEALED), key=len, reverse=True):
        if sealed in text:
            text = text.replace(sealed, seals.texts[sealed])
    return text


def mask(result, task_id, info, tool=""):
    """Tool result `result` of a private task with its prompt text and picture names as tokens."""
    if not isinstance(result, dict):
        return result
    seals = Seals(task_id)
    data = result.get("structuredContent")
    masked = None
    if isinstance(data, (dict, list)):
        masked = _strings(_walk(data, seals, info or {}, PROMPT_KEYS | TOOL_KEYS.get(tool, set())), lambda text: _hide(seals, text))
        result["structuredContent"] = masked
    content = []
    for item in result.get("content") or []:
        if isinstance(item, dict) and item.get("type") == "text":
            try:
                same = masked is not None and json.loads(item.get("text") or "") == data
            except ValueError:
                same = False
            item = {**item, "text": tool_text(masked) if same else _hide(seals, str(item.get("text") or ""))}
        content.append(item)
    if "content" in result:
        result["content"] = content
    seals.save()
    return result


def seal_answer(task_id, prompts, negative="", pictures=None):
    """The user's prompt box: {prompts, negative, pictures} as tokens, the texts and picture names sealed
    in the task, and a line saying them."""
    prompts = [str(item).strip() for item in (prompts if isinstance(prompts, list) else []) if str(item or "").strip()]
    if not prompts or len(prompts) > MAX_PROMPTS or any(len(item) > MAX_PROMPT for item in prompts):
        raise ValueError(f"Write 1 to {MAX_PROMPTS} prompts of up to {MAX_PROMPT} characters")
    negative = str(negative or "").strip()[:MAX_PROMPT]
    named = []
    for picture in (pictures if isinstance(pictures, list) else [])[:MAX_PICTURES]:
        if isinstance(picture, dict) and isinstance(picture.get("filename"), str) and PICTURE.fullmatch(picture["filename"]):
            named.append("/".join(part for part in (str(picture.get("subfolder") or "").strip("/"), picture["filename"]) if part))
    seals = Seals(task_id)
    answer = {"prompts": [seals.seal(item) for item in prompts], "negative": seals.seal(negative) if negative else "",
              "pictures": [seals.seal(item, "img") for item in named]}
    seals.save()
    answer["text"] = " ".join(answer["prompts"] + ([f"negative {answer['negative']}"] if negative else [])
                              + ([f"pictures {' '.join(answer['pictures'])}"] if named else []))
    return answer
