"""Per-task privacy overrides and retroactive prompt/model controls (api/ai_privacy.py,
web/modules/ui_ai_privacy_overview.js):
- `model_rule`: per-task `privacy_models` toggle or per-model override (`public_models` /
  `private_models`), restoring/moving `[M*]` tokens between `sealed` and `sealed_legacy`.
- `split_prompt`: split `[P*]` into kept-hidden text (new `[P*]` token) + exposed plaintext.
- `seal_message_phrase`: retroactively seal an unsealed phrase on a step as `[P*]`.
Pending notices arrive via begin_task / get_situation (`mark_seen`) or ai_panels._collect (`kind=privacy_adjust`)."""

import os
import re
import time

from . import ai_privacy, ai_sealed, ai_tasks

MAX_ADJUST_QUEUE = 12
MAX_EXPOSED = 20


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
    pub = [item for item in (task.get("public_models") or []) if item != mid]
    priv = [item for item in (task.get("private_models") or []) if item != mid]
    if hidden is True:
        priv.append(mid)
    elif hidden is False:
        pub.append(mid)
    if pub:
        task["public_models"] = pub
    else:
        task.pop("public_models", None)
    if priv:
        task["private_models"] = priv
    else:
        task.pop("private_models", None)

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
        _queue_adjust(task, f"User allowed model {short} by name for this task (previous [M*] tokens still work).")
    _save_maps(task, sealed, legacy, notes)


def _apply_split_prompt(task, payload):
    sealed = dict(task.get("sealed") or {})
    legacy = dict(task.get("sealed_legacy") or {})
    notes = dict(task.get("sealed_notes") or {})
    token = str(payload.get("token") or "").strip()
    if not token.startswith("[P") or token not in sealed:
        raise ValueError(f"Unknown active prompt token: {token}")
    keep_text = str(payload.get("keep_text") or "").strip()[:ai_sealed.MAX_PROMPT]
    expose_text = str(payload.get("expose_text") or "").strip()[:ai_sealed.MAX_PROMPT]
    if not keep_text and not expose_text:
        raise ValueError("Keep at least one kept or exposed segment.")
    old_val = sealed[token]
    if keep_text == old_val and not expose_text:
        return

    old_note = notes.pop(token, "")
    legacy[token] = sealed.pop(token)
    new_token = ""
    if keep_text:
        new_token = _find_token(sealed, keep_text, "P") or _next_token(sealed, legacy, "P")
        sealed[new_token] = keep_text
        if old_note:
            notes[new_token] = old_note
            task["sealed_notes_dirty"] = True

    _rewrite_step_splits(task, token, old_val, new_token, keep_text, expose_text)
    if expose_text:
        exposed = list(task.get("exposed_prompts") or [])
        exposed.append({"at": time.time(), "from": token, "kept": new_token, "text": expose_text[:400]})
        task["exposed_prompts"] = exposed[-MAX_EXPOSED:]
    if new_token and expose_text:
        _queue_adjust(task, f"User split hidden text {token}: keep {new_token} hidden, and exposed this for you to read: {expose_text}")
    elif expose_text:
        _queue_adjust(task, f"User exposed earlier sealed text {token} for you to read: {expose_text}")
    _save_maps(task, sealed, legacy, notes)


def _rewrite_step_splits(task, token, old_val, new_token, keep_text, expose_text):
    marked_old = f"\u27e6{old_val}\u27e7"
    replacement = f"\u27e6{keep_text}\u27e7" if keep_text else ""
    if replacement and expose_text:
        replacement = f"{replacement}, {expose_text}"
    elif expose_text:
        replacement = expose_text
    for step in task.get("steps") or []:
        parts = step.get("sealed_parts")
        if isinstance(parts, list):
            next_parts = []
            for part in parts:
                if part.get("token") == token:
                    if new_token and keep_text:
                        next_parts.append({"token": new_token, "text": keep_text})
                else:
                    next_parts.append(part)
            if next_parts:
                step["sealed_parts"] = next_parts
            else:
                step.pop("sealed_parts", None)
        if isinstance(step.get("text"), str) and marked_old in step["text"]:
            step["text"] = step["text"].replace(marked_old, replacement)


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
            "sealed_notes": dict(task.get("sealed_notes") or {}),
            "public_models": list(task.get("public_models") or []),
            "private_models": list(task.get("private_models") or []),
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
