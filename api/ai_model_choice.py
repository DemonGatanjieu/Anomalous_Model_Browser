"""What the user lets an AI see of one model, chosen once and kept with the model (<model>.anomalous.json,
so it moves along when Tidy moves the file) for every task:
- `ai_name` "hidden": its names reach an AI as a token ([M1]) in any task, private or not (ai_privacy.guard),
  with its type, base model and the user's note for the AI; never its cover, its description or its
  trigger words in plain. "shown": by name, in private tasks too. Absent: the task decides (a private
  task's "unchosen models" switch, ai_privacy.hides_models_for).
- `ai_about`: the paragraphs of its author's description an AI may read where the rest of it stays home
  (its name hidden, or the task private; description_parts.py, mcp_tools.get_model "about_for_ai").
GET /anomalous/ai_model_choice?model_id= gives the description's paragraphs and the choice (the materials
window's detail, web/modules/ui_ai_model_lock.js); POST {model_id, filename, name?, about?} sets them."""

import asyncio
import os

from aiohttp import web

from . import ai_tasks, ai_toolbox_catalog, mcp_tools
from .activity_log import ACTIVITY_DETAIL
from .description_parts import MAX_PARTS, paragraphs
from .metadata import get_metadata
from .mcp_tools import ToolError
from .utils import atomic_write_json

try:
    from ..model_identity import USER_INFO_SUFFIX, read_json
    from ..model_sidecars import target
except ImportError:
    from model_identity import USER_INFO_SUFFIX, read_json
    from model_sidecars import target

NAMES = ("hidden", "shown")


def _path():
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "ai_model_choice.json")


def chosen():
    """Whether the user has chosen for any model (a hint kept beside the tasks): until then no AI call
    reads the library for it, so tasks cost what they did before."""
    return os.path.isfile(_path())


def _note_chosen():
    if not chosen():
        atomic_write_json(_path(), {"chosen": True})


def notice(models):
    """Models as the library lists them: a choice made in another install (a copied library) counts too."""
    if not chosen() and any(model.get("ai_name") in NAMES for model in models or []):
        _note_chosen()


def marks():
    """{"hidden": [model_id], "shown": [model_id]} over the whole library (the materials catalog, read
    at most every few seconds and anew after a change here)."""
    out = {"hidden": [], "shown": []}
    if not chosen():
        return out
    for model in ai_toolbox_catalog.everything()["models"]:
        if model.get("ai_name") in NAMES:
            out[model["ai_name"]].append(model["id"])
    return out


def marks_of(model_ids):
    """marks() for only `model_ids` (a task's models), read from their own files."""
    out = {"hidden": [], "shown": []}
    for model_id in dict.fromkeys(str(item) for item in model_ids or [] if item):
        try:
            name = get_metadata(mcp_tools._resolve_model(model_id)[3]).get("ai_name")
        except ToolError:
            continue
        if name in NAMES:
            out[name].append(model_id)
    if out["hidden"] or out["shown"]:
        _note_chosen()
    return out


def words_of(model_ids):
    """{model_id: its trigger words}, for the page to show the tokens of a hidden model's words under it."""
    out = {}
    for model_id in dict.fromkeys(str(item) for item in model_ids or [] if item):
        try:
            meta = get_metadata(mcp_tools._resolve_model(model_id)[3])
        except ToolError:
            continue
        words = [str(word) for word in (meta.get("trainedWords") or meta.get("headerWords") or []) if str(word).strip()]
        if words:
            out[model_id] = words
    return out


def view(model_id):
    """The model's choice and its description's paragraphs, for the page."""
    meta = get_metadata(mcp_tools._resolve_model(model_id)[3])
    return {"model_id": model_id, "name": meta.get("ai_name") or "", "paragraphs": paragraphs(meta.get("description")),
            "picked": list(meta.get("ai_about") or []), "note": meta.get("ai_note") or ""}


def choose(model_id, name=None, about=None):
    """Sets the model's `name` ("hidden" / "shown" / "" for the task to decide) and `about` (picked
    paragraphs; only ones its description has are kept). None leaves one as it is. Returns (before, after, view)."""
    if name is not None and name not in NAMES + ("",):
        raise ValueError("name is hidden, shown or empty")
    if about is not None and not (isinstance(about, list) and all(isinstance(text, str) for text in about)):
        raise ValueError("about is a list of the description's paragraphs")
    file_path = mcp_tools._resolve_model(model_id)[3]
    user_file = target(os.path.splitext(file_path)[0], USER_INFO_SUFFIX)
    if os.path.exists(user_file) and read_json(user_file) is None:
        raise ValueError(f"{os.path.basename(user_file)} is unreadable; nothing was changed.")
    data = read_json(user_file) or {"format": 1}
    before = {"ai_name": data.get("ai_name") or "", "ai_about": list(data.get("ai_about") or [])}
    if name is not None:
        data["ai_name"] = name
    if about is not None:
        wanted = set(about)
        data["ai_about"] = [part for part in paragraphs(get_metadata(file_path).get("description")) if part in wanted][:MAX_PARTS]
    for key in ("ai_name", "ai_about"):
        if not data.get(key):
            data.pop(key, None)
    atomic_write_json(user_file, data)
    if data.get("ai_name"):
        _note_chosen()
    ai_toolbox_catalog.forget()
    after = {"ai_name": data.get("ai_name") or "", "ai_about": list(data.get("ai_about") or [])}
    return before, after, view(model_id)


async def api_choice(request):
    """GET ?model_id= : {model_id, name, paragraphs, picked, note}; POST {model_id, filename, name?, about?}: the same after setting them."""
    try:
        if request.method == "GET":
            return web.json_response(await asyncio.to_thread(view, request.query.get("model_id", "")))
        try:
            body = await request.json()
        except (ValueError, UnicodeDecodeError):
            body = None
        if not isinstance(body, dict):
            return web.json_response({"error": "Expected {model_id, name?, about?}"}, status=400)
        before, after, answer = await asyncio.to_thread(choose, body.get("model_id"), body.get("name"), body.get("about"))
    except (ToolError, ValueError) as error:
        return web.json_response({"error": str(error)}, status=400)
    request[ACTIVITY_DETAIL] = {"fields": [{"field": key, "before": before[key], "after": after[key]}
                                           for key in after if before[key] != after[key]]}
    return web.json_response(answer)
