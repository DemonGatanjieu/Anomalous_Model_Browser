"""The way from an MCP tool to the open ComfyUI page, for what only the page can do (the
canvas lives in the browser).

`ask_page` sends {id, action, args} as the "anomalous.mcp" event over ComfyUI's websocket
to every open ComfyUI page and waits. One page claims it (the first claim wins, visible
pages claim first: web/modules/mcp_bridge.js), does the action with Anomalous's own canvas
code and posts the outcome back; `claim` and `resolve` take those posts
(routes in mcp_server.py). With no page open, or none answering in time, the tool fails
with words the AI can pass on.
"""

import threading
import uuid

TIMEOUT_SECONDS = 30
MAX_WAITING = 20

_lock = threading.Lock()
_waiting = {}  # id -> {"event": Event, "claimed": bool, "outcome": dict | None}


class PageUnavailable(Exception):
    """No ComfyUI page took or finished the action."""


class PageRefused(Exception):
    """The page tried and said why it could not (missing node, wrong model type…)."""


def _server():
    from server import PromptServer  # ComfyUI's; imported late so tests can run without it
    return PromptServer.instance


def ask_page(action, args=None, timeout=TIMEOUT_SECONDS):
    """Runs `action` in the open ComfyUI page; its result value. Call from a worker thread."""
    server = _server()
    if not getattr(server, "sockets", None):
        raise PageUnavailable("ComfyUI is not open in a browser on this computer. Open it, then try again.")
    request_id = uuid.uuid4().hex
    entry = {"event": threading.Event(), "claimed": False, "outcome": None}
    with _lock:
        if len(_waiting) >= MAX_WAITING:
            raise PageUnavailable("Too many canvas actions are waiting; try again in a moment.")
        _waiting[request_id] = entry
    try:
        server.send_sync("anomalous.mcp", {"id": request_id, "action": action, "args": args or {}})
        if not entry["event"].wait(timeout):
            raise PageUnavailable("The ComfyUI page did not answer in time. Is it open and not frozen? "
                                  "If the action was taken late, check the canvas before repeating it.")
    finally:
        with _lock:
            _waiting.pop(request_id, None)
    outcome = entry["outcome"] or {}
    if not outcome.get("ok"):
        raise PageRefused(str(outcome.get("error") or "The page could not do that."))
    return outcome.get("value")


def claim(request_id):
    """True for the first page that asks to do request `request_id`."""
    with _lock:
        entry = _waiting.get(request_id)
        if entry is None or entry["claimed"]:
            return False
        entry["claimed"] = True
        return True


def resolve(request_id, outcome):
    """The claiming page's outcome: {ok, value} or {ok: false, error}. False when nobody waits."""
    with _lock:
        entry = _waiting.get(request_id)
        if entry is None or not entry["claimed"] or entry["outcome"] is not None:
            return False
        entry["outcome"] = outcome if isinstance(outcome, dict) else {"ok": False, "error": "Malformed answer"}
    entry["event"].set()
    return True
