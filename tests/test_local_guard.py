"""Only this computer may change things: one middleware in front of every /anomalous/ route;
other devices too when the server has the allow_remote_changes file (cloud servers)."""
import asyncio
import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

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

        self.assertEqual(asyncio.run(run("127.0.0.1", "127.0.0.1:8188")), {"local": True, "changes": True})
        lan = asyncio.run(run("192.168.1.20", "192.168.1.5:8188"))
        self.assertEqual((lan["local"], lan["changes"]), (False, False))
        self.assertIn(local_guard.REMOTE_FILE, lan["command"])
        self.assertTrue(lan["command"].startswith("echo off >" if os.name == "nt" else "touch "))
        with mock.patch.object(local_guard, "REMOTE_CHANGES", True):
            cloud = asyncio.run(run("10.0.0.7", "u123.cloud.example:8443"))
            self.assertEqual((cloud["local"], cloud["changes"]), (False, True))
            self.assertTrue(cloud["command"].startswith("del " if os.name == "nt" else "rm -f "))

    def test_the_command_survives_a_folder_with_spaces(self):
        with mock.patch.object(local_guard, "REMOTE_FILE", "/root/my comfy/custom_nodes/AMB/allow_remote_changes"),                 mock.patch.object(local_guard.os, "name", "posix"):
            self.assertEqual(local_guard.switch_command(), "touch '/root/my comfy/custom_nodes/AMB/allow_remote_changes'")


class RemoteChangesTests(unittest.TestCase):
    def test_the_file_on_the_server_lets_other_devices_change_things(self):
        proxied = {"remote": "10.0.0.7", "host": "u123.cloud.example:8443", "X-Forwarded-For": "203.0.113.9"}
        self.assertEqual(ask("POST", "/anomalous/scan_all", **proxied)[0], 403)
        with mock.patch.object(local_guard, "REMOTE_CHANGES", True):
            for path in ("/anomalous/scan_all", "/anomalous/delete_model", "/anomalous/save_config"):
                self.assertEqual(ask("POST", path, **proxied)[0], 200, path)
            self.assertEqual(ask("GET", "/anomalous/backup/file", **proxied)[0], 200)
            request = make_mocked_request("POST", "/anomalous/mcp", headers={"Host": "u123.cloud.example:8443"},
                                          transport=_Transport("10.0.0.7"))
            self.assertFalse(local_guard.is_local(request))  # MCP checks is_local itself, unchanged

    def test_it_is_read_when_the_plugin_starts(self):
        def load():  # a copy of the module, so the one the routes use stays as it is
            spec = importlib.util.spec_from_file_location("local_guard_copy", local_guard.__file__)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module

        self.assertEqual(Path(local_guard.REMOTE_FILE).parent, PLUGIN)
        self.assertFalse(load().REMOTE_CHANGES)
        real = os.path.isfile
        with mock.patch("os.path.isfile", lambda path: path == local_guard.REMOTE_FILE or real(path)):
            self.assertTrue(load().REMOTE_CHANGES)


if __name__ == "__main__":
    unittest.main()
