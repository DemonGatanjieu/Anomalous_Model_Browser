"""Who is calling Anomalous's MCP endpoint (mcp_server.py), for the AI workbench's record
(ai_tasks.py): a short name for the AI app, the session it runs when it keeps several, and a task
it names. Each comes from the request's headers or metadata and is cleaned to a short plain word.
And when each app last called since ComfyUI started (note, latest): the Connect guide's sign that one has come."""

import re
import time


_CLIENT_NAMES = (
    ("claude-code", "Claude Code"), ("claude", "Claude"), ("cursor", "Cursor"), ("cherry", "Cherry Studio"),
    ("windsurf", "Windsurf"), ("codex", "Codex"), ("gemini", "Gemini"), ("vscode", "VS Code"), ("cline", "Cline"),
)


# AI apps that read files and run commands by themselves, by a word of what they call themselves.
_READS_DISK = ("claude code", "claude-code", "cursor", "windsurf", "codex", "gemini", "antigravity", "vs code", "vscode",
               "cline", "roo", "kilo", "copilot", "trae", "zed", "opencode", "goose", "aider")


def reads_disk(client):
    """Whether AI app `client` (a task's) is known to open files and run commands by itself: privacy mode filters
    what Anomalous sends it, not what it opens on its own (the output folder, the task records)."""
    lowered = str(client or "").lower()
    return any(word in lowered for word in _READS_DISK)


MAX_SEEN = 40
_seen = {}  # app -> when it last called, since ComfyUI started


def note(client, now=None):
    """The app `client` just called the endpoint."""
    _seen[client] = time.time() if now is None else now
    if len(_seen) > MAX_SEEN:
        _seen.pop(min(_seen, key=_seen.get))


def latest():
    """{client, at} of the app that called last since ComfyUI started, or None."""
    if not _seen:
        return None
    client = max(_seen, key=_seen.get)
    return {"client": client, "at": _seen[client]}


def client_of(headers, params):
    """A short name for the AI app making a call: the client info it sends, else its User-Agent."""
    meta = params.get("_meta") if isinstance(params.get("_meta"), dict) else {}
    info = meta.get("io.modelcontextprotocol/clientInfo")
    raw = info.get("name") if isinstance(info, dict) and isinstance(info.get("name"), str) else ""
    if not raw:
        raw = (headers.get("User-Agent") or "").split(" ")[0].split("/")[0]
    lowered = raw.lower()
    for key, name in _CLIENT_NAMES:
        if key in lowered:
            return name
    clean = re.sub(r"[^\w .-]", "", raw).strip()[:40]
    return clean or "AI"


def session_of(headers, params):
    """An optional session key when one app runs multiple MCP sessions at once."""
    meta = params.get("_meta") if isinstance(params.get("_meta"), dict) else {}
    raw = headers.get("Mcp-Session-Id") or headers.get("X-Anomalous-Session") or meta.get("sessionId") or meta.get("conversationId") or ""
    return re.sub(r"[^\w .:-]", "", str(raw)).strip()[:64] if isinstance(raw, str) else ""


def task_of(headers, params, arguments=None):
    """An explicit task id from headers, request metadata or tool arguments."""
    meta = params.get("_meta") if isinstance(params.get("_meta"), dict) else {}
    arg_task = arguments.get("task") if isinstance(arguments, dict) else None
    raw = arg_task or headers.get("X-Anomalous-Task") or meta.get("anomalous/task") or meta.get("task") or ""
    return re.sub(r"[^\w-]", "", str(raw)).strip()[:64] if isinstance(raw, str) else ""
