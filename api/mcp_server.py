"""MCP endpoint: AI apps (Claude, Cursor, Cherry Studio…) use Anomalous's library as tools.

POST /anomalous/mcp speaks the Model Context Protocol's Streamable HTTP transport, both eras:
- modern (2026-07-28): stateless; every request carries its protocol version in `_meta` and
  the MCP-Protocol-Version / Mcp-Method / Mcp-Name headers, which must match the body;
- legacy (2025-03-26 to 2025-11-25): an `initialize` handshake first. No session is kept
  (sessions are optional there), so both eras are served the same stateless way.
Only this computer may connect: the peer must be loopback, no proxy header may be present,
and Host and Origin (when sent) must name a loopback host, which stops DNS rebinding.
Answers are always one JSON object; there are no server-initiated messages. The tools are
in mcp_tools.py (reading) and mcp_actions.py (acting); POST /anomalous/mcp/bridge is where
the open ComfyUI page claims and answers canvas actions (mcp_bridge.py).
"""

import asyncio
import base64
import ipaddress
import urllib.parse

from aiohttp import web

from . import mcp_bridge
from .mcp_actions import ACTIONS
from .mcp_tools import TOOLS as READ_TOOLS, call_tool

TOOLS = {**READ_TOOLS, **ACTIONS}

MODERN_VERSIONS = ("2026-07-28",)
LEGACY_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26")
SERVER_INFO = {"name": "anomalous-model-browser", "title": "Anomalous Model Browser", "version": "1.0.0"}
INSTRUCTIONS = (
    "Tools over the user's ComfyUI library as Anomalous Model Browser keeps it: model files with "
    "their Civitai information, output images with their generation settings, combos (a model, "
    "LoRAs and a prompt), workflow recipes, saved prompts, generated audio, the scan status and "
    "the activity log; and tools that act on the workflow open in ComfyUI (read it with "
    "describe_canvas first), scan models, or have an Anomalous TTS voice speak. Canvas changes "
    "are single Ctrl+Z steps and are logged as the AI's; nothing deletes files. Ids returned by "
    "one tool (model_id, image, node ids) are what the others take. For what no tool does, tell "
    "the user where in Anomalous to do it (the rail on the left: Models, Gallery, Workflows, "
    "Combos, Prompts, Voices)."
)
LIST_TTL_MS = 300000
# Requests run tools in threads; a few at a time is plenty for one person's AI app.
_slots = asyncio.Semaphore(4)

PROXY_HEADERS = ("Forwarded", "X-Forwarded-For", "X-Real-IP", "X-Forwarded-Host")
LOCAL_NAMES = ("localhost",)

PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS = -32700, -32600, -32601, -32602
HEADER_MISMATCH, UNSUPPORTED_VERSION = -32020, -32022


def _loopback_host(name):
    if not name:
        return False
    name = name.strip("[]").lower()
    if name in LOCAL_NAMES:
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def _is_local(request):
    """The request comes from this computer, directly, and names a loopback host."""
    if not _loopback_host(request.remote or ""):
        return False
    if any(header in request.headers for header in PROXY_HEADERS):
        return False
    return _loopback_host(urllib.parse.urlsplit("//" + request.headers.get("Host", "")).hostname)


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
    result = {"tools": [tool["spec"] for tool in TOOLS.values()]}
    if modern:
        result.update(ttlMs=LIST_TTL_MS, cacheScope="public")
    return result


def _initialize(params):
    requested = params.get("protocolVersion")
    return {
        "protocolVersion": requested if requested in LEGACY_VERSIONS else LEGACY_VERSIONS[0],
        "capabilities": {"tools": {"listChanged": False}},
        "serverInfo": SERVER_INFO,
        "instructions": INSTRUCTIONS,
    }


def _discover():
    return {
        "supportedVersions": list(MODERN_VERSIONS + LEGACY_VERSIONS),
        "capabilities": {"tools": {"listChanged": False}},
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
    arguments = params.get("arguments") or {}
    if name not in TOOLS or not isinstance(arguments, dict):
        return None
    ctx = {"base_url": f"{request.scheme}://{request.host}"}  # loopback, checked in api_mcp
    async with _slots:
        result = await asyncio.to_thread(call_tool, TOOLS, name, arguments, ctx)
    return result


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
        return web.json_response({"granted": mcp_bridge.claim(body["id"])})
    return web.json_response({"accepted": mcp_bridge.resolve(body["id"], body.get("outcome"))})


def register_routes(app):
    app.router.add_route("*", "/anomalous/mcp", api_mcp)
    app.router.add_post("/anomalous/mcp/bridge", api_mcp_bridge)
