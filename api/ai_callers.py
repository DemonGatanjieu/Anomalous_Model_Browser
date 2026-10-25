"""Who is calling Anomalous's MCP endpoint (mcp_server.py), for the AI workbench's record
(ai_tasks.py): a short name for the AI app, the session it runs when it keeps several, and a task
it names. Each comes from the request's headers or metadata and is cleaned to a short plain word."""

import re


_CLIENT_NAMES = (
    ("claude-code", "Claude Code"), ("claude", "Claude"), ("cursor", "Cursor"), ("cherry", "Cherry Studio"),
    ("windsurf", "Windsurf"), ("codex", "Codex"), ("gemini", "Gemini"), ("vscode", "VS Code"), ("cline", "Cline"),
)


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
