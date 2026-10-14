"""GET /anomalous/civitai_check: whether this computer reaches Civitai now, through the proxy in
Settings -> Network when one is set (net_proxy.py); for Settings' "Test" button and the first-run
setup. One small request with the key, if one is set, so a key Civitai refuses is told apart.
It goes online, so it answers this computer only (local_guard LOCAL_GETS)."""

import asyncio
import time
import urllib.error
import urllib.request

from aiohttp import web

from .download_sources import civitai_headers

try:
    from ..net_proxy import configured, failure, urlopen
except ImportError:  # loaded outside the package (tests)
    from net_proxy import configured, failure, urlopen

PROBE_URL = "https://civitai.com/api/v1/models?limit=1"
TIMEOUT = 8


def check_civitai():
    """{reachable, key ('set' | 'none' | 'refused'), ms, error, failure (net_proxy.failure), proxy}."""
    headers = civitai_headers()
    key = "set" if "Authorization" in headers else "none"
    started = time.monotonic()

    def answer(reachable, key, error="", why=""):
        return {"reachable": reachable, "key": key, "ms": round((time.monotonic() - started) * 1000),
                "error": error, "failure": why, "proxy": configured()}
    try:
        with urlopen(urllib.request.Request(PROBE_URL, headers=headers), timeout=TIMEOUT) as response:
            response.read(1024)
        return answer(True, key)
    except urllib.error.HTTPError as error:
        # Civitai answered: the network is fine; 401/403 with a key means the key is refused.
        if error.code in (401, 403) and key == "set":
            return answer(True, "refused", f"HTTP {error.code}", failure(error))
        return answer(error.code < 500, key, f"HTTP {error.code}", failure(error))
    except (urllib.error.URLError, OSError, ValueError) as error:
        reason = getattr(error, "reason", None) or error
        return answer(False, key, str(reason)[:200], failure(error))


async def api_civitai_check(request):
    return web.json_response(await asyncio.to_thread(check_civitai))


def register_routes(app):
    app.router.add_get("/anomalous/civitai_check", api_civitai_check)
