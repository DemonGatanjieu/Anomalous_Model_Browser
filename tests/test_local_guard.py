"""Only this computer may change things: one middleware in front of every /anomalous/ route."""
import asyncio
import json
import sys
import unittest
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import make_mocked_request

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import local_guard


def ask(method, path, remote="127.0.0.1", host="127.0.0.1:8188", **headers):
    """Runs the middleware for one request; the handler answers 200 "done"."""
    async def handler(request):
        return web.Response(text="done")

    request = make_mocked_request(method, path, headers={"Host": host, **headers},
                                  transport=_Transport(remote))
    response = asyncio.run(local_guard.local_only_middleware(request, handler))
    return response.status, response.text


class _Transport:
    def __init__(self, remote):
        self.remote = remote

    def get_extra_info(self, name, default=None):
        return (self.remote, 50000) if name == "peername" else default


class LocalGuardTests(unittest.TestCase):
    def test_changes_from_another_device_are_refused(self):
        for path in ("/anomalous/delete_model", "/anomalous/backup/export", "/anomalous/translate",
                     "/anomalous/save_config", "/anomalous/version/switch", "/anomalous/download/start"):
            status, text = ask("POST", path, remote="192.168.1.20", host="192.168.1.5:8188")
            self.assertEqual(status, 403, path)
            self.assertEqual(json.loads(text)["code"], "local_only")

    def test_the_lan_address_counts_as_another_device_even_from_this_computer(self):
        self.assertEqual(ask("POST", "/anomalous/delete_model", remote="127.0.0.1", host="192.168.1.5:8188")[0], 403)
        self.assertEqual(ask("POST", "/anomalous/delete_model", host="evil.example:8188")[0], 403)  # DNS rebinding
        self.assertEqual(ask("POST", "/anomalous/delete_model", **{"X-Forwarded-For": "8.8.8.8"})[0], 403)  # a proxy

    def test_this_computer_may_change_things(self):
        for host in ("127.0.0.1:8188", "localhost:8188", "[::1]:8188"):
            self.assertEqual(ask("POST", "/anomalous/delete_model", host=host)[0], 200, host)

    def test_other_devices_may_look(self):
        lan = {"remote": "192.168.1.20", "host": "192.168.1.5:8188"}
        for path in ("/anomalous/models", "/anomalous/image", "/anomalous/gallery_images", "/anomalous/recipes"):
            self.assertEqual(ask("GET", path, **lan)[0], 200, path)
        for path in local_guard.OPEN_POSTS:
            self.assertEqual(ask("POST", path, **lan)[0], 200, path)
        for path in local_guard.LOCAL_GETS:
            self.assertEqual(ask("GET", path, **lan)[0], 403, path)
        self.assertEqual(ask("POST", "/prompt", **lan)[0], 200)  # not ours to decide
        self.assertEqual(ask("POST", "/anomalous/mcp", **lan)[0], 200)  # answers in JSON-RPC itself

    def test_the_page_learns_whether_it_may_change_things(self):
        async def run(remote, host):
            request = make_mocked_request("GET", "/anomalous/access", headers={"Host": host}, transport=_Transport(remote))
            return json.loads((await local_guard.api_access(request)).text)

        self.assertEqual(asyncio.run(run("127.0.0.1", "127.0.0.1:8188")), {"local": True})
        self.assertEqual(asyncio.run(run("192.168.1.20", "192.168.1.5:8188")), {"local": False})


if __name__ == "__main__":
    unittest.main()
