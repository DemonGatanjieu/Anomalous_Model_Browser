"""Per-task privacy overrides and retroactive prompt/model controls (api/ai_privacy.py,
web/modules/ui_ai_privacy_overview.js):
- `model_rule`: per-task `privacy_models` toggle, or one model shown / hidden by name (kept with the
  model for every task, ai_model_choice.py), restoring/moving `[M*]` tokens between `sealed` and `sealed_legacy`.
- `split_prompt`: let some words of a `[P*]` text through: `parts` spell the text exactly, each
  kept run gets its own token, and the old text reads as its view (`sealed_views`, ai_sealed.py).
- `seal_message_phrase`: retroactively seal an unsealed phrase on a step as `[P*]`.
Pending notices arrive via begin_task / get_situation (`mark_seen`) or ai_panels._collect (`kind=privacy_adjust`)."""

import os
import re
import time

from . import ai_model_choice, ai_privacy, ai_sealed, ai_tasks
from .ai_sealed import WORD
from .mcp_tools import ToolError

MAX_ADJUST_QUEUE = 12
MAX_EXPOSED = 20
USER_WORDS = {"user_message", "user_route", "user_marks", "user_pictures", "user_toolbox"}  # steps that keep the user's own words


def _next_token(sealed, legacy, kind="P"):
    pattern = re.compile(rf"^\[{re.escape(kind)}(\d+)\]$")
    used = [int(m.group(1)) for k in (sealed.keys() | legacy.keys()) if (m := pattern.match(k))]
    return f"[{kind}{1 + max(used, default=len(used))}]"


def _find_token(mapping, value, kind):
    for tok, val in mapping.items():
        if tok.startswith(f"[{kind}") and val == value:
            return tok
    return ""


def _queue_adjust(task, line):
    if not line:
        return
    queue = [str(item) for item in (task.get("privacy_adjust_pending") or []) if item]
    queue.append(line)
    task["privacy_adjust_pending"] = queue[-MAX_ADJUST_QUEUE:]


def model_lists(task):
    """{public_models, private_models, model_words}: the models of `task` the user chose to show or hide by
    name, and the trigger words of its models (their tokens show under the model), for the page."""
    ids = [value for token, value in {**(task.get("sealed_legacy") or {}), **(task.get("sealed") or {})}.items() if token.startswith("[M")]
    ids += [item if isinstance(item, str) else (item or {}).get("model_id") or (item or {}).get("id")
            for item in ((task.get("toolbox") or {}).get("models") or [])]
    ids += [item.get("model_id") for item in task.get("about") or [] if isinstance(item, dict) and item.get("type") == "model"]
    marks = ai_model_choice.marks_of(ids)
    return {"public_models": marks["shown"], "private_models": marks["hidden"], "model_words": ai_model_choice.words_of(ids)}


def _apply_model_rule(task, payload):
    override = task.get("privacy_models")
    hides_all = override if isinstance(override, bool) else ai_privacy.hides_models()
    if "privacy_models" in payload:
        val = payload["privacy_models"]
        if val is not None and not isinstance(val, bool):
            raise ValueError("privacy_models must be true, false, or null")
        if val is None:
            task.pop("privacy_models", None)
        else:
            task["privacy_models"] = val
        hides_all = val if isinstance(val, bool) else ai_privacy.hides_models()
        _queue_adjust(task, f"User set model-name hiding for this task to {'hidden ([M*] tokens)' if hides_all else 'visible'}.")
    if "model_id" not in payload:
        return
    mid = str(payload.get("model_id") or "").strip()[:300]
    if not mid:
        raise ValueError("model_id is required")
    hidden = payload.get("hidden")
    if hidden is not None and not isinstance(hidden, bool):
        raise ValueError("hidden must be true, false, or null")
    try:  # kept with the model, for every task (ai_model_choice.py)
        ai_model_choice.choose(mid, name="" if hidden is None else "hidden" if hidden else "shown")
    except ToolError as error:
        raise ValueError(str(error)) from error

    effective_hidden = hidden if isinstance(hidden, bool) else hides_all
    sealed = dict(task.get("sealed") or {})
    legacy = dict(task.get("sealed_legacy") or {})
    notes = dict(task.get("sealed_notes") or {})
    if effective_hidden:
        tok = _find_token(sealed, mid, "M")
        if not tok:
            tok = _find_token(legacy, mid, "M")
            if tok:
                legacy.pop(tok, None)
            else:
                tok = _next_token(sealed, legacy, "M")
            sealed[tok] = mid
        _queue_adjust(task, f"User kept a model private as token {tok}. Use {tok} going forward.")
    else:
        moved = [tok for tok, val in list(sealed.items()) if tok.startswith("[M") and val == mid]
        for tok in moved:
            legacy[tok] = sealed.pop(tok)
            notes.pop(tok, None)
        short = os.path.basename(mid.split(":", 2)[-1].replace("\\", "/")) or mid
        _queue_adjust(task, f"User allowed model {short} by name (previous [M*] tokens still work).")
    _save_maps(task, sealed, legacy, notes)


def _runs(parts, original):
    """[(text, hidden)] from the page's `parts` ({text, hide}): they spell `original` exactly, neighbours of
    one kind joined, the spaces around a hidden run left out of it."""
    if not isinstance(parts, list) or not parts:
        raise ValueError("parts is a list of {text, hide}")
    pieces = []
    for part in parts:
        if not isinstance(part, dict) or not isinstance(part.get("text"), str):
            raise ValueError("parts is a list of {text, hide}")
        pieces.append((part["text"], part.get("hide") is True))
    if "".join(text for text, _ in pieces) != original:
        raise ValueError("The parts do not spell the hidden text.")
    runs = []
    for text, hidden in pieces:
        if hidden:
            core = text.strip()
            lead, trail = text[:len(text) - len(text.lstrip())], text[len(text.rstrip()):]
            pieces_here = [(lead, False), (core, True), (trail, False)]
        else:
            pieces_here = [(text, False)]
        for piece, kind in pieces_here:
            if not piece:
                continue
            if runs and runs[-1][1] == kind:
                runs[-1] = (runs[-1][0] + piece, kind)
            else:
                runs.append((piece, kind))
    return runs


def _apply_split_prompt(task, payload):
    sealed = dict(task.get("sealed") or {})
    legacy = dict(task.get("sealed_legacy") or {})
    notes = dict(task.get("sealed_notes") or {})
    views = dict(task.get("sealed_views") or {})
    token = str(payload.get("token") or "").strip()
    if not token.startswith("[P") or token not in sealed:
        raise ValueError(f"Unknown active prompt token: {token}")
    original = sealed[token]
    runs = _runs(payload.get("parts"), original)
    shown = "".join(text for text, hidden in runs if not hidden)
    if not WORD.search(shown):
        raise ValueError("Pick at least one word to let through.")

    old_note = notes.pop(token, "")
    legacy[token] = sealed.pop(token)
    view, kept = "", []
    for text, hidden in runs:
        if not hidden:
            view += text
            continue
        tok = _find_token(sealed, text, "P") or _next_token(sealed, legacy, "P")
        sealed[tok] = text
        kept.append(tok)
        view += tok
        if old_note and tok not in notes:
            notes[tok] = old_note
            task["sealed_notes_dirty"] = True
    # The view stands for the old token where the user wrote it: other views, their messages (not the
    # notes Anomalous wrote, whose "[P1]" is an example, nor the AI's own calls).
    views = {old: written.replace(token, view) for old, written in views.items()}
    views[token] = view
    task["sealed_views"] = views
    for step in task.get("steps") or []:
        if step.get("tool") in USER_WORDS and isinstance(step.get("text"), str):
            step["text"] = step["text"].replace(token, view).replace(f"\u27e6{original}\u27e7", view)
        parts = step.get("sealed_parts")
        if isinstance(parts, list) and any(part.get("token") == token for part in parts):
            step["sealed_parts"] = [part for part in parts if part.get("token") != token] + [
                {"token": tok, "text": sealed[tok]} for tok in kept]
    exposed = list(task.get("exposed_prompts") or [])
    exposed.append({"at": time.time(), "from": token, "kept": kept, "view": view, "text": shown.strip(" ,，\n")[:400]})
    task["exposed_prompts"] = exposed[-MAX_EXPOSED:]
    _queue_adjust(task, f"User let some words of hidden text {token} through. It now reads: {view} "
                        f"(the words still hidden stay as their tokens; {token} still works).")
    _save_maps(task, sealed, legacy, notes)


def _apply_seal_phrase(task, payload):
    sealed = dict(task.get("sealed") or {})
    legacy = dict(task.get("sealed_legacy") or {})
    notes = dict(task.get("sealed_notes") or {})
    step_id = str(payload.get("step_id") or "").strip()
    phrase = str(payload.get("phrase") or "").strip()[:ai_sealed.MAX_PROMPT]
    if len(phrase) < 2:
        raise ValueError("Select at least 2 characters to hide.")
    tok = _find_token(sealed, phrase, "P") or _next_token(sealed, legacy, "P")
    sealed[tok] = phrase
    if step_id:
        for step in task.get("steps") or []:
            if step.get("id") != step_id:
                continue
            parts = list(step.get("sealed_parts") or [])
            if not any(part.get("token") == tok and part.get("text") == phrase for part in parts):
                parts.append({"token": tok, "text": phrase})
                step["sealed_parts"] = parts
            break
    _queue_adjust(task, f"User additionally sealed a phrase from earlier messages as {tok}. Stop repeating that raw text and use {tok}.")
    _save_maps(task, sealed, legacy, notes)


def _save_maps(task, sealed, legacy, notes):
    task["sealed"] = sealed
    if legacy:
        task["sealed_legacy"] = legacy
    else:
        task.pop("sealed_legacy", None)
    if notes:
        task["sealed_notes"] = notes
    else:
        task.pop("sealed_notes", None)


def apply_rule(task_id, payload):
    """Apply `{action: model_rule | split_prompt | seal_message_phrase, ...}` to `task_id`."""
    if not isinstance(payload, dict):
        raise ValueError("Expected JSON object")
    action = str(payload.get("action") or "").strip()
    with ai_tasks._lock:
        tasks = ai_tasks._load()
        task = tasks.get(task_id)
        if not task:
            raise LookupError("not_found")
        if action == "model_rule":
            _apply_model_rule(task, payload)
        elif action == "split_prompt":
            _apply_split_prompt(task, payload)
        elif action == "seal_message_phrase":
            _apply_seal_phrase(task, payload)
        else:
            raise ValueError(f"Unknown privacy rule action: {action}")
        task["updated"] = time.time()
        ai_tasks._save(task)
        snapshot = {
            "privacy_models": task.get("privacy_models") if isinstance(task.get("privacy_models"), bool) else ai_privacy.hides_models(),
            "privacy_models_source": "task" if isinstance(task.get("privacy_models"), bool) else "default",
            "sealed": dict(task.get("sealed") or {}),
            "sealed_legacy": dict(task.get("sealed_legacy") or {}),
            "sealed_views": dict(task.get("sealed_views") or {}),
            "sealed_notes": dict(task.get("sealed_notes") or {}),
            **model_lists(task),
            "exposed_prompts": list(task.get("exposed_prompts") or []),
        }
    ai_tasks._notify(task_id)
    return snapshot


def mark_seen(task_id):
    """Pop any pending `privacy_adjust_pending` lines when AI starts or inspects situation."""
    with ai_tasks._lock:
        tasks = ai_tasks._load()
        task = tasks.get(task_id)
        if not task:
            return []
        pending = list(task.pop("privacy_adjust_pending", None) or [])
        if pending:
            ai_tasks._save(task)
        return pending


def take_pending(task):
    """Called under `ai_tasks._lock` (ai_panels._collect): pop pending privacy updates or None."""
    pending = list(task.pop("privacy_adjust_pending", None) or []) if isinstance(task, dict) else []
    if not pending:
        return None
    now = time.time()
    return {
        "id": f"priv_{int(now * 1000)}",
        "task": task["id"],
        "kind": "privacy_adjust",
        "at": now,
        "updates": pending,
        "text": "User adjusted privacy settings for hidden items in Privacy Overview: " + " | ".join(pending),
    }
