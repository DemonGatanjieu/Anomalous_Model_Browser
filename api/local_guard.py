"""What only this computer may do. ComfyUI started with --listen lets other devices on the
network open the page: they may look (lists, searches, pictures, covers), but every change
under /anomalous/ (writing, moving and deleting files, downloads, scans, translations, backups,
version switches, saved settings) answers only requests from the computer ComfyUI runs on
(AGENTS.md 安全底线, rule 4). One middleware decides it for all routes: a request other than
GET is local-only unless it is a read sent as POST (OPEN_POSTS); a GET is open unless it is not
a plain read (LOCAL_GETS). A request is local when it comes from a loopback address, through no
proxy, naming a loopback host; checking the Host also keeps out a page that reached this server
under another name (DNS rebinding)."""

import ipaddress
import urllib.parse

from aiohttp import web

PREFIX = "/anomalous/"
PROXY_HEADERS = ("Forwarded", "X-Forwarded-For", "X-Real-IP", "X-Forwarded-Host")
LOCAL_NAMES = ("localhost",)
# Reads sent as POST (their lists are long): open to other devices too. They write nothing.
OPEN_POSTS = frozenset({
    "/anomalous/resolve_paths_to_previews",
    "/anomalous/resolve_hash_batch",
    "/anomalous/inspect_image_material",
})
# GETs that are more than a read: a backup of all your data, a call to GitHub, your folders.
LOCAL_GETS = frozenset({
    "/anomalous/backup/file",
    "/anomalous/version/releases",
    "/anomalous/import/folders",
    "/anomalous/civitai_check",
})
# Routes that answer other devices themselves (MCP replies in JSON-RPC).
OWN_CHECK = frozenset({"/anomalous/mcp"})
READS = ("GET", "HEAD", "OPTIONS")
MESSAGE = ("只能在运行 ComfyUI 的电脑上操作，别的设备只能浏览。"
           " Only the computer ComfyUI runs on can do this; other devices can only look.")


def loopback_host(name):
    if not name:
        return False
    name = name.strip("[]").lower()
    if name in LOCAL_NAMES:
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def is_local(request):
    """The request comes from this computer, directly, and names a loopback host."""
    if not loopback_host(request.remote or ""):
        return False
    if any(header in request.headers for header in PROXY_HEADERS):
        return False
    return loopback_host(urllib.parse.urlsplit("//" + request.headers.get("Host", "")).hostname)


def needs_local(method, path):
    """Whether a request to `path` with `method` must come from this computer."""
    if not path.startswith(PREFIX) or path in OWN_CHECK:
        return False
    if method.upper() in READS:
        return path in LOCAL_GETS
    return path not in OPEN_POSTS


def refusal():
    return web.json_response({"status": "error", "success": False, "error": "local_only", "code": "local_only",
                              "message": MESSAGE}, status=403)


@web.middleware
async def local_only_middleware(request, handler):
    if needs_local(request.method, request.path) and not is_local(request):
        return refusal()
    return await handler(request)


async def api_access(request):
    """GET /anomalous/access - whether this page may change things: {"local": bool}."""
    return web.json_response({"local": is_local(request)})
