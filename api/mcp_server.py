"""MCP endpoint: AI apps (Claude, Cursor, Cherry Studio…) use Anomalous's library as tools.

POST /anomalous/mcp speaks the Model Context Protocol's Streamable HTTP transport, both eras:
- modern (2026-07-28): stateless; every request carries its protocol version in `_meta` and
  the MCP-Protocol-Version / Mcp-Method / Mcp-Name headers, which must match the body;
- legacy (2025-03-26 to 2025-11-25): an `initialize` handshake first. No session is kept
  (sessions are optional there), so both eras are served the same stateless way.
Only this computer may connect: the peer must be loopback, no proxy header may be present,
and Host and Origin (when sent) must name a loopback host, which stops DNS rebinding.
Answers are always one JSON object; there are no server-initiated messages. The tools are
in mcp_tools.py (reading), mcp_actions.py (acting) and mcp_task_tools.py (the AI workbench's
begin_task and report); every call is kept as a step of a task (ai_tasks.py) for the AI
workbench page, starting in state "running" and updated on completion, with unread user
messages and panel answers attached to the next successful tool response, and pictures changed
outside Anomalous since the AI's previous call shown and told (ai_outside.py). POST
/anomalous/mcp/bridge is where the open ComfyUI page claims and answers canvas actions
(mcp_bridge.py).
"""

import asyncio
import base64
import time
import urllib.parse

from aiohttp import web

from . import action_catalog, ai_gates, ai_outside, ai_panels, ai_run_tracking, ai_task_canvas, ai_task_runs, ai_tasks, mcp_apps, mcp_bridge, mcp_prompts
from .local_guard import is_local as _is_local, loopback_host as _loopback_host
from .mcp_actions import ACTIONS
from .mcp_canvas_edit import CANVAS_TOOLS
from .mcp_model_use import MODEL_TOOLS
from .mcp_look import LOOK_TOOLS
from .mcp_situation import SITUATION_TOOLS
from .mcp_task_tools import TASK_TOOLS
from .mcp_tools import TOOLS as READ_TOOLS, call_tool

TOOLS = {**READ_TOOLS, **MODEL_TOOLS, **LOOK_TOOLS, **ACTIONS, **CANVAS_TOOLS, **TASK_TOOLS, **SITUATION_TOOLS, **mcp_apps.APP_TOOLS}
CAPABILITIES = {
    "tools": {"listChanged": False}, "prompts": {"listChanged": False}, "resources": {"listChanged": False},
    "extensions": {mcp_apps.EXTENSION: {"mimeTypes": [mcp_apps.MIME]}},  # the card in the conversation (mcp_apps.py)
}

MODERN_VERSIONS = ("2026-07-28",)
LEGACY_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26")
SERVER_INFO = {"name": "anomalous-model-browser", "title": "Anomalous Model Browser", "version": "1.0.0"}
INSTRUCTIONS = (
    "Tools over the user's ComfyUI library as Anomalous Model Browser keeps it: model files with "
    "their Civitai information, output images with their generation settings, combos (a model, "
    "LoRAs and a prompt), workflow recipes, saved prompts, generated audio, the scan status and "
    "the activity log; and tools that act on the workflow open in ComfyUI (get_situation gives flow chains; "
    "describe_canvas only for details) or build one where the user watches: find_nodes searches brief types; "
    "add_node wires in the same call (wire_from/wire_to; wire_to=ID splices it in front of that node, "
    "insert_after=ID behind it); "
    "connect_nodes needs only two IDs unless sockets are ambiguous. Reuse receipts instead of rereading "
    "the graph. new_workflow opens a tab only when needed. Tools also scan models or have an "
    "Anomalous TTS voice speak. Canvas changes "
    "are single Ctrl+Z steps and are logged as the AI's; nothing deletes files. Ids returned by "
    "one tool (model_id, image, node ids) are what the others take. For what no tool does, tell "
    "the user where in Anomalous to do it (the rail on the left: Models, Gallery, Workflows, "
    "Combos, Prompts, Voices). In a new chat on a task, or when unsure where things stand, call get_situation "
    "first: the task, the canvas in brief (what is still unwired) and the next step in one answer. "
    "The user watches your work in Anomalous's AI workbench: call begin_task "
    "with a short title when you start what they asked for (it continues the waiting or active task; "
    "new_task=true is only for a separate user request), and report to explain a choice, hand in "
    "pictures made another way, or end the task (done=true). The user can write to you or answer "
    "panel questions there: call get_answers to wait for or read them, and any unread user_messages "
    "or user_answers attached to a tool result must also be honoured. While you work on an Anomalous task, ask "
    "the user every question (a choice, a preference, yes or no) with ask_user, never in your own chat or its "
    "question form: the user watches and answers in Anomalous. Likewise write your explanations and replies "
    "there with report (reply_to answers their message or marks), not only in your chat. Show plans, workflow explanations "
    "and results in chronological order with show_panel; update_panel appends new content below what "
    "the user already saw. Use run_workflow for execution: it returns real state/results after a bounded wait. "
    "If you submit through /prompt or another tool, immediately call track_run with YOUR returned prompt_ids "
    "and task ID, or the workbench cannot observe it. For running results use run_status(wait_seconds=55); "
    "do not inspect output directories or resubmit to find out whether it finished. Change pictures only by "
    "running workflows, never with code of your own; if you do use another tool (a command, a script, files), "
    "say what you ran with log_outside."
)
LIST_TTL_MS = 300000
# Requests run tools in threads; a few at a time is plenty for one person's AI app.
_slots = asyncio.Semaphore(4)


PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS = -32700, -32600, -32601, -32602
HEADER_MISMATCH, UNSUPPORTED_VERSION = -32020, -32022


def _origin_ok(request):
    origin = request.headers.get("Origin")
    return origin is None or _loopback_host(urllib.parse.urlsplit(origin).hostname)


def _decode_header(value):
    """Mcp-Name values outside plain ASCII come as =?base64?…?=."""
    if value and value.startswith("=?base64?") and value.endswith("?="):
        try:
            return base64.b64decode(value[9:-2], validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            return None
    return value


def _error(id_, code, message, status=200, data=None):
    error = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    body = {"jsonrpc": "2.0", "error": error}
    if id_ is not None:
        body["id"] = id_
    return web.json_response(body, status=status)


def _result(id_, result, modern):
    if modern:
        result = {"resultType": "complete", **result}
    return web.json_response({"jsonrpc": "2.0", "id": id_, "result": result})


def _tool_list(modern):
    daily = ai_gates.tool_set() == "daily"  # the user's choice in the AI workbench; calls are not limited by it
    result = {"tools": [mcp_apps.with_card(tool["spec"]) for name, tool in TOOLS.items()
                        if not daily or name in action_catalog.DAILY or name in mcp_apps.APP_TOOLS]}
    if modern:
        result.update(ttlMs=LIST_TTL_MS, cacheScope="public")
    return result


def _initialize(params):
    requested = params.get("protocolVersion")
    return {
        "protocolVersion": requested if requested in LEGACY_VERSIONS else LEGACY_VERSIONS[0],
        "capabilities": CAPABILITIES,
        "serverInfo": SERVER_INFO,
        "instructions": INSTRUCTIONS,
    }


def _discover():
    return {
        "supportedVersions": list(MODERN_VERSIONS + LEGACY_VERSIONS),
        "capabilities": CAPABILITIES,
        "_meta": {"io.modelcontextprotocol/serverInfo": SERVER_INFO},
        "instructions": INSTRUCTIONS,
        "ttlMs": LIST_TTL_MS,
        "cacheScope": "public",
    }


def _modern_header_problem(request, method, params, version):
    """Why the mirrored headers do not match the body (2026-07-28), or None."""
    if request.headers.get("MCP-Protocol-Version") != version:
        return "MCP-Protocol-Version header missing or not the body's protocol version"
    if request.headers.get("Mcp-Method") != method:
        return "Mcp-Method header missing or not the body's method"
    if method in ("tools/call", "prompts/get", "resources/read"):
        name = params.get("uri") if method == "resources/read" else params.get("name")
        if _decode_header(request.headers.get("Mcp-Name")) != name:
            return "Mcp-Name header missing or not the body's name"
    return None


async def _call(params, request):
    name = params.get("name")
    raw_arguments = params.get("arguments") or {}
    if not isinstance(name, str) or name not in TOOLS or not isinstance(raw_arguments, dict):
        return None
    arguments = dict(raw_arguments)
    client = ai_tasks.client_of(request.headers, params)
    session = ai_tasks.session_of(request.headers, params)
    task_id = ai_tasks.task_of(request.headers, params, arguments)
    if "task" in arguments and "task" not in TOOLS[name]["spec"]["inputSchema"].get("properties", {}):
        arguments.pop("task", None)
    ctx = {"base_url": f"{request.scheme}://{request.host}", "client": client, "session": session, "task": task_id}  # loopback, checked in api_mcp
    started = time.time()
    read_only = bool(TOOLS[name]["spec"].get("annotations", {}).get("readOnlyHint", True))
    step_ref = await asyncio.to_thread(
        ai_tasks.begin_step, client, name, arguments, started, read_only, session=session, task_id=task_id,
    )
    active_task = step_ref[0] if step_ref else task_id
    if active_task:
        ctx["task"] = active_task
    outside = None
    if name not in mcp_apps.APP_TOOLS:  # the card's own calls do not reach the AI
        outside = await asyncio.to_thread(ai_outside.check, active_task or ai_tasks.active_task_id(client, session))
    canvas_call = ai_task_canvas.begin_call(active_task)  # the page works on the task's own tab
    try:
        # The user's gate first (ai_gates.py): it may wait for their OK, or answer for them.
        result = await asyncio.to_thread(ai_gates.check, name, arguments, step_ref)
        if result is None:
            async with _slots:
                result = await asyncio.to_thread(call_tool, TOOLS, name, arguments, ctx)
    except BaseException as error:
        failed_result = {"content": [{"type": "text", "text": f"{name} failed: {error}"}], "isError": True}
        await asyncio.to_thread(
            ai_tasks.finish_step, client, name, arguments, failed_result, started, read_only,
            step_ref=step_ref, session=session, task_id=active_task,
        )
        raise
    step = await asyncio.to_thread(
        ai_tasks.finish_step, client, name, arguments, result, started, read_only,
        step_ref=step_ref, session=session, task_id=active_task,
    )
    ai_task_canvas.tell(result, canvas_call)
    if name == "run_workflow" and step and step.get("state") == "running":
        ai_task_runs.watch(step["id"], result.get("structuredContent") or {})
        await asyncio.to_thread(ai_run_tracking.wait_for_receipt, result, client, session, active_task,
                                arguments.get("wait_seconds", 15), step["id"])
    # The user's news and the run's go to the AI, never to the card's own calls (they do not reach the AI).
    if name not in mcp_apps.APP_TOOLS and isinstance(result, dict) and not result.get("isError"):
        resolved_task = active_task or await asyncio.to_thread(ai_tasks.active_task_id, client, session=session)
        if name not in ("run_workflow", "run_status", "stop_run") and resolved_task:
            await asyncio.to_thread(ai_task_runs.tell, result, resolved_task)
    if name != "get_answers" and name not in mcp_apps.APP_TOOLS and isinstance(result, dict) and not result.get("isError"):
        await asyncio.to_thread(ai_panels.attach_pending, result, client, task_id=resolved_task or ("" if session else None))
    return ai_outside.tell(result, outside)


async def api_mcp(request):
    """POST /anomalous/mcp - one JSON-RPC request or notification per POST."""
    if request.method != "POST":
        return web.Response(status=405, headers={"Allow": "POST"})
    if not _is_local(request) or not _origin_ok(request):
        return _error(None, INVALID_REQUEST, "Only this computer may use the Anomalous MCP endpoint.", status=403)
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        return _error(None, PARSE_ERROR, "Body is not JSON", status=400)
    if not isinstance(body, dict) or body.get("jsonrpc") != "2.0" or not isinstance(body.get("method"), str):
        return _error(None, INVALID_REQUEST, "Expected one JSON-RPC 2.0 request (batches are not supported)", status=400)
    if "id" not in body:
        return web.Response(status=202)  # notifications (initialized, cancelled) need no answer
    id_, method = body["id"], body["method"]
    params = body.get("params") if isinstance(body.get("params"), dict) else {}

    if method == "initialize":
        return _result(id_, _initialize(params), modern=False)
    meta = params.get("_meta") if isinstance(params.get("_meta"), dict) else {}
    version = meta.get("io.modelcontextprotocol/protocolVersion")
    modern = version is not None
    if modern:
        if version not in MODERN_VERSIONS:
            return _error(id_, UNSUPPORTED_VERSION, "Unsupported protocol version", status=400,
                          data={"supported": list(MODERN_VERSIONS + LEGACY_VERSIONS), "requested": version})
        problem = _modern_header_problem(request, method, params, version)
        if problem:
            return _error(id_, HEADER_MISMATCH, f"Header mismatch: {problem}", status=400)
    else:
        header = request.headers.get("MCP-Protocol-Version")
        if header is not None and header not in LEGACY_VERSIONS:
            return _error(id_, INVALID_REQUEST, f"Unsupported protocol version {header}", status=400,
                          data={"supported": list(MODERN_VERSIONS + LEGACY_VERSIONS), "requested": header})

    if method == "server/discover" and modern:
        return _result(id_, _discover(), modern)
    if method == "ping":
        return _result(id_, {}, modern)
    if method == "tools/list":
        return _result(id_, _tool_list(modern), modern)
    if method == "prompts/list":
        return _result(id_, mcp_prompts.list_prompts(), modern)
    if method == "prompts/get":
        prompt = mcp_prompts.get_prompt(params.get("name"), params.get("arguments"))
        if prompt is None:
            return _error(id_, INVALID_PARAMS, f"Unknown prompt or missing arguments: {params.get('name')}")
        return _result(id_, prompt, modern)
    if method == "resources/list":
        return _result(id_, {"resources": mcp_apps.resources()}, modern)
    if method == "resources/read":
        resource = await asyncio.to_thread(mcp_apps.read, params.get("uri"))
        if resource is None:
            return _error(id_, INVALID_PARAMS, f"Unknown resource: {params.get('uri')}")
        return _result(id_, resource, modern)
    if method == "tools/call":
        result = await _call(params, request)
        if result is None:
            return _error(id_, INVALID_PARAMS, f"Unknown tool or bad arguments: {params.get('name')}")
        return _result(id_, result, modern)
    return _error(id_, METHOD_NOT_FOUND, f"Method not found: {method}", status=404 if modern else 200)


async def api_mcp_bridge(request):
    """POST /anomalous/mcp/bridge - the open page claims a canvas action ({id, claim: true} ->
    {granted}) and then answers it ({id, outcome: {ok, value} | {ok: false, error}})."""
    if not _is_local(request) or not _origin_ok(request):
        return web.json_response({"error": "This computer only"}, status=403)
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        body = None
    if not isinstance(body, dict) or not isinstance(body.get("id"), str):
        return web.json_response({"error": "Expected {id, claim} or {id, outcome}"}, status=400)
    if body.get("claim") is True:
        return web.json_response({"granted": mcp_bridge.claim(body["id"], body.get("capabilities"))})
    return web.json_response({"accepted": mcp_bridge.resolve(body["id"], body.get("outcome"))})


def register_routes(app):
    app.router.add_route("*", "/anomalous/mcp", api_mcp)
    app.router.add_post("/anomalous/mcp/bridge", api_mcp_bridge)
