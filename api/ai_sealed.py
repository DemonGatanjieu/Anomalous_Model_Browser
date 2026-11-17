"""What a private task (ai_privacy.py) keeps from the AI besides pictures: prompt text, picture
names, and model names while the user keeps those too. Each is sealed: kept in the task
(task["sealed"], {token: text}) and given to the AI as a token, "[P3]" for a text, "[img2]" for a
picture's name, "[M1]" for a model (ai_sealed_models.py). The AI writes the token where the text
goes (a prompt, a picture to load, a model to set, its own words around it) and expand() puts the
text back before the tool runs, so the canvas and the runs get it while the AI never reads it.

mask() seals what a tool's answer holds, in this order: every text input of a node (ComfyUI's node
list says which inputs are STRING: prompts, file name prefixes; numbers and choices stay), the
prompt fields of saved prompts, combos, workflows, models and changes (PROMPT_KEYS, and a few per
tool), what the user named (NAMED: the names and tags of combos, workflow cards and saved prompts;
a combo's name is its model's name and the start of its prompt unless they renamed it), the models
when asked to (`models`), picture file names anywhere, and last any sealed text wherever it still
shows up. A model's description stays home (only the paragraphs the user picked go, ai_model_choice.py).
In a task that is not private, mask(prompts=False) only names the models the user hides by token.
A text the user split in the Privacy Overview (ai_sealed_adjust.py) keeps its old token in
task["sealed_legacy"] for expand(), and task["sealed_views"] says how it reads now: its kept runs
as their own tokens, the words the user let through as written. Wherever the old text still shows
up it is given as that view (cover(), _hide()), so the words kept hidden never go out with it.
seal_answer() takes the user's prompt box (a "prompts" panel block, ui_ai_prompt_box.js): the
prompts and reference pictures, sealed, with the tokens the AI gets for them, and the gist: the
picture in words the user wrote for the AI to read, handed on as written but for the words they
marked to hide (seal_marked, also for a message they leave): those are tokens inside it.
"""

import json
import re

from . import ai_sealed_models, ai_tasks
from .ai_sealed_models import MODEL_FILE, WIDGET_KEYS
from .mcp_tools import tool_text

TOKEN = re.compile(r"\[(?:P|img|M)\d+\]")
WORD = re.compile(r"[^\W\d_]")  # a letter of any script
PICTURE = re.compile(r"[^\s\"'<>|*?,;()\[\]{}]*\.(?:png|jpe?g|webp|gif|bmp|mp4|webm|mov)\b", re.IGNORECASE)
# Fields whose text is a prompt, or holds one (a workflow's settings, a change's before and after).
PROMPT_KEYS = {"prompt", "prompts", "positive", "negative", "positive_prompt", "negative_prompt", "notes",
               "settings", "before", "after", "filename_prefix", "trigger_words", "trainedWords", "header_words",
               "tags", "in_cards", "recipe", "combo", "said_as", "opened", "workflow"}  # the last seven: names the user gave, where they stand alone
# ("opened": the tab a workflow opened on, named after the card and preset it came from; "workflow": the canvas
# a task works on, a tab named after the user's own workflow, as is the tab Anomalous makes for the task: canvas_tab)
NAMED = ("combos", "workflows", "prompts")  # lists of what the user named: each one's name and tags are theirs
TOOL_KEYS = {"get_model": {"user_notes"}, "place_combo": {"name"},
             **{tool: {"more_names"} for tool in ("list_combos", "list_workflows", "list_saved_prompts")}}
MIN_SEALED = 3  # shorter texts are not looked for elsewhere (they would match inside other words)
MAX_PROMPTS = 8
MAX_PROMPT = 4000
MAX_GIST = 1000
MARKED = re.compile("\u27e6([^\u27e6\u27e7]*)\u27e7")  # words the user marked to hide, the page's button (web/modules/ai_hide_mark.js)
MAX_PICTURES = 4
_loose = {}  # tokens of calls tied to no task, while this ComfyUI runs


class Seals:
    """The tokens of task `task_id` (None: the calls tied to no task); save() keeps new ones."""

    def __init__(self, task_id):
        self.task_id = task_id
        with ai_tasks._lock:
            task = ai_tasks._load().get(task_id) if task_id else None
            self.tokens = dict(task.get("sealed") or {}) if task else _loose
            self.legacy = dict(task.get("sealed_legacy") or {}) if task else {}
            views = dict(task.get("sealed_views") or {}) if task else {}
        self.texts = {text: token for token, text in self.tokens.items()}
        # A split text as it reads now, unless the user hid it whole again (then its token wins).
        self.views = {text: views[token] for token, text in self.legacy.items()
                      if isinstance(views.get(token), str) and text not in self.texts}
        self.changed = False

    def seal(self, text, kind="P"):
        known = self.texts.get(text)
        if known and known.startswith(f"[{kind}"):
            return known
        pattern = re.compile(rf"^\[{re.escape(kind)}(\d+)\]$")
        used = [int(m.group(1)) for k in (self.tokens.keys() | self.legacy.keys()) if (m := pattern.match(k))]
        token = f"[{kind}{1 + max(used, default=len(used))}]"
        self.tokens[token], self.texts[text] = text, token
        self.changed = True
        return token

    def cover(self, text):
        """`text` as the AI gets it: a split text's view, else its token."""
        return self.views.get(text) or self.seal(text)

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
    token in it, its text too). A model's token is its model_id, the name its loader lists it by among a
    node's values, and its card's name inside other words (ai_sealed_models.py)."""
    seals = Seals(task_id)
    tokens = {**seals.legacy, **seals.tokens}

    def put(match):
        token = match.group(0)
        return ai_sealed_models.named(tokens[token]) if token.startswith("[M") and token in tokens else tokens.get(token, token)

    def text(words, widget):
        if words.startswith("[M") and words in tokens:
            return ai_sealed_models.written(tokens[words], widget)
        for _ in range(3):
            words, before = TOKEN.sub(put, words), words
            if words == before:
                break
        return words

    def walk(item, widget=False):
        if isinstance(item, dict):
            return {key: walk(part, widget or key in WIDGET_KEYS) for key, part in item.items()}
        if isinstance(item, list):
            return [walk(part, widget) for part in item]
        return text(item, widget) if isinstance(item, str) else item
    return walk(value)


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
        return value if not _sealable(value) or value.lower().endswith(MODEL_FILE) else seals.cover(value)
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
    model_row = isinstance(value.get("model_id"), str)
    row_keys = keys | TOOL_KEYS["get_model"] if model_row else keys
    for key, item in value.items():
        if model_row and key == "description":
            continue  # its author's words stay home; the paragraphs the user picked go as "about_for_ai" (ai_model_choice.py)
        if key in ("settings", "inputs", "widgets") and isinstance(item, dict) and isinstance(node_type, str):
            out[key] = {name: seals.cover(text) if isinstance(text, str) and _sealable(text) and _text_input(info, node_type, name, text)
                        else _walk(text, seals, info, keys) for name, text in item.items()}
        elif key in row_keys and (isinstance(item, str) or isinstance(item, list) and all(isinstance(text, str) for text in item)):
            out[key] = seal_text(seals, item)
        elif key == "canvas_tab" and isinstance(item, dict) and isinstance(item.get("name"), str):
            out[key] = {**item, "name": seal_text(seals, item["name"])}  # its note names the tab too: hidden once this is sealed
        elif key in NAMED and isinstance(item, list):
            out[key] = [{**named, **{part: seal_text(seals, named[part]) for part in ("name", "filename") if part in named}}
                        if isinstance(named, dict) else named for named in _walk(item, seals, info, keys)]
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
    for split in sorted((item for item in seals.views if len(item) >= MIN_SEALED), key=len, reverse=True):
        if split in text:
            text = text.replace(split, seals.views[split])
    for sealed in sorted((item for item in seals.texts if len(item) >= MIN_SEALED), key=len, reverse=True):
        if sealed in text:
            text = text.replace(sealed, seals.texts[sealed])
    return text


def _hide_models(value, seals, models):
    if isinstance(models, dict):
        hides_all = bool(models.get("hides_all"))
        public_ids = models.get("public_ids") or ()
        private_ids = models.get("private_ids") or ()
        if not hides_all and not private_ids:
            return value
        return ai_sealed_models.hide(value, seals, only_ids=None if hides_all else private_ids, skip_ids=public_ids)
    return ai_sealed_models.hide(value, seals) if models else value


def mask(result, task_id, info, tool="", models=False, prompts=True):
    """Tool result `result` of a private task with its prompt text and picture names as tokens, and its
    models too when `models` says so (bool, or {hides_all, public_ids, private_ids}, ai_sealed_models.py).
    `prompts` False: only the models (a task that is not private, ai_privacy.guard)."""
    if not isinstance(result, dict):
        return result
    seals = Seals(task_id)
    data = result.get("structuredContent")
    masked = None

    def hidden(value):
        value = _hide_models(value, seals, models)
        return _strings(value, lambda text: _hide(seals, text)) if prompts else value

    def whole(value):
        return hidden(_walk(value, seals, info or {}, PROMPT_KEYS | TOOL_KEYS.get(tool, set())) if prompts else value)
    if isinstance(data, (dict, list)):
        masked = whole(data)
        result["structuredContent"] = masked
    content = []
    for item in result.get("content") or []:
        if isinstance(item, dict) and item.get("type") == "text":
            try:
                parsed = json.loads(item.get("text") or "")
            except ValueError:
                parsed = None
            # A text of the answer's data reads as it does; other data (the answer with a note added) is masked as data too,
            # so what is left out of an entry (a model's description) is left out there as well.
            text = (tool_text(masked) if masked is not None and parsed == data else tool_text(whole(parsed))
                    if isinstance(parsed, (dict, list)) else hidden(str(item.get("text") or "")))
            item = {**item, "text": text}
        content.append(item)
    if "content" in result:
        result["content"] = content
    seals.save()
    return result


def seal_marked(seals, text):
    """`text` with the words the user marked as tokens of `seals`; the rest stays for the AI to read."""
    return MARKED.sub(lambda match: seals.seal(match.group(1).strip()) if match.group(1).strip() else "", text)


def seal_answer(task_id, prompts, negative="", pictures=None, gist=""):
    """The user's prompt box: {prompts, negative, pictures} as tokens, the texts and picture names sealed
    in the task, the gist as the user wrote it for the AI (left out when empty), and a line saying them."""
    prompts = [str(item).strip() for item in (prompts if isinstance(prompts, list) else []) if str(item or "").strip()]
    gist = str(gist or "").strip()[:MAX_GIST]
    if not (prompts or gist) or len(prompts) > MAX_PROMPTS or any(len(item) > MAX_PROMPT for item in prompts):
        raise ValueError(f"Write the gist, or 1 to {MAX_PROMPTS} prompts of up to {MAX_PROMPT} characters")
    negative = str(negative or "").strip()[:MAX_PROMPT]
    named = []
    for picture in (pictures if isinstance(pictures, list) else [])[:MAX_PICTURES]:
        if isinstance(picture, dict) and isinstance(picture.get("filename"), str) and PICTURE.fullmatch(picture["filename"]):
            named.append("/".join(part for part in (str(picture.get("subfolder") or "").strip("/"), picture["filename"]) if part))
    seals = Seals(task_id)
    gist = seal_marked(seals, gist)
    answer = {"prompts": [seals.seal(item) for item in prompts], "negative": seals.seal(negative) if negative else "",
              "pictures": [seals.seal(item, "img") for item in named]}
    seals.save()
    answer["text"] = " ".join(answer["prompts"] + ([f"negative {answer['negative']}"] if negative else [])
                              + ([f"pictures {' '.join(answer['pictures'])}"] if named else [])) or "gist"
    if gist:
        answer["gist"] = gist
    return answer
