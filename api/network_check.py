"""GET /anomalous/civitai_check: whether this computer reaches Civitai now, for the first-run setup
before an online scan (web/modules/ui_first_run.js). One small request with the key, if one is
set, so a key Civitai refuses is told apart. It goes online, so it answers this computer only
(local_guard LOCAL_GETS)."""

import asyncio
import time
import urllib.error
import urllib.request

from aiohttp import web

from .download_sources import civitai_headers

PROBE_URL = "https://civitai.com/api/v1/models?limit=1"
TIMEOUT = 8


def check_civitai():
    """{reachable, key ('set' | 'none' | 'refused'), ms, error}."""
    headers = civitai_headers()
    key = "set" if "Authorization" in headers else "none"
    started = time.monotonic()
    try:
        with urllib.request.urlopen(urllib.request.Request(PROBE_URL, headers=headers), timeout=TIMEOUT) as response:
            response.read(1024)
        return {"reachable": True, "key": key, "ms": round((time.monotonic() - started) * 1000), "error": ""}
    except urllib.error.HTTPError as error:
        # Civitai answered: the network is fine; 401/403 with a key means the key is refused.
        if error.code in (401, 403) and key == "set":
            return {"reachable": True, "key": "refused", "ms": round((time.monotonic() - started) * 1000), "error": f"HTTP {error.code}"}
        return {"reachable": error.code < 500, "key": key, "ms": round((time.monotonic() - started) * 1000), "error": f"HTTP {error.code}"}
    except (urllib.error.URLError, OSError, ValueError) as error:
        reason = getattr(error, "reason", None) or error
        return {"reachable": False, "key": key, "ms": round((time.monotonic() - started) * 1000), "error": str(reason)[:200]}


async def api_civitai_check(request):
    return web.json_response(await asyncio.to_thread(check_civitai))


def register_routes(app):
    app.router.add_get("/anomalous/civitai_check", api_civitai_check)
