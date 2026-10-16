"""What only this computer may do. ComfyUI started with --listen lets other devices on the
network open the page: they may look (lists, searches, pictures, covers), but every change
under /anomalous/ (writing, moving and deleting files, downloads, scans, translations, backups,
version switches, saved settings) answers only requests from the computer ComfyUI runs on
(AGENTS.md 安全底线, rule 4). One middleware decides it for all routes: a request other than
GET is local-only unless it is a read sent as POST (OPEN_POSTS); a GET is open unless it is not
a plain read (LOCAL_GETS). A request is local when it comes from a loopback address, through no
proxy, naming a loopback host; checking the Host also keeps out a page that reached this server
under another name (DNS rebinding).

ComfyUI on a rented cloud server is only ever opened from another device. An empty file named
`allow_remote_changes` in the plugin's folder, made on that server, lets every device that can
open the page change things too (may_change); it is read once, when ComfyUI starts, and the
page cannot make or remove it. MCP keeps to this computer either way."""

import ipaddress
import os
import shlex
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
    "/anomalous/usage/check",  # reads every output and saved workflow
})
# Routes that answer other devices themselves (MCP replies in JSON-RPC).
OWN_CHECK = frozenset({"/anomalous/mcp"})
READS = ("GET", "HEAD", "OPTIONS")
REMOTE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "allow_remote_changes")
REMOTE_CHANGES = os.path.isfile(REMOTE_FILE)
if REMOTE_CHANGES:
    print("[Anomalous Browser] allow_remote_changes 文件存在：任何能打开页面的设备都能扫描、移动、删除模型和改设置。"
          " The allow_remote_changes file is there: every device that can open the page may change things.", flush=True)
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


def may_change(request):
    """The request may change things: it comes from this computer, or remote changes are allowed."""
    return REMOTE_CHANGES or is_local(request)


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
    if needs_local(request.method, request.path) and not may_change(request):
        return refusal()
    return await handler(request)


def switch_command():
    """The line to paste into the server's terminal that makes the allow_remote_changes file, or
    removes it when it is there. On Windows `echo off >` makes the file in cmd and PowerShell
    alike (only that it exists counts)."""
    if os.name == "nt":
        return f'del "{REMOTE_FILE}"' if REMOTE_CHANGES else f'echo off > "{REMOTE_FILE}"'
    return ("rm -f " if REMOTE_CHANGES else "touch ") + shlex.quote(REMOTE_FILE)


async def api_access(request):
    """GET /anomalous/access - whether this page is on this computer and whether it may change
    things: {"local": bool, "changes": bool}; for another device also "command", the line that
    turns remote changes on or off (it only runs where someone types it, on the server)."""
    local = is_local(request)
    answer = {"local": local, "changes": may_change(request)}
    if not local:
        answer["command"] = switch_command()
    return web.json_response(answer)
