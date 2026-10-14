"""The plugin's proxy (net_proxy.py): which addresses are taken, that requests really go through
the saved proxy (a proxy on this computer answers them; nothing leaves it), that the scan process
gets it, and the names of failures the pages explain."""
import http.server
import json
import os
import socket
import ssl
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

import net_proxy  # noqa: E402


class Proxy(http.server.BaseHTTPRequestHandler):
    """Answers every request with the URL it was asked for, as a forwarding proxy sees it."""
    seen = []

    def do_GET(self):
        Proxy.seen.append(self.path)
        body = json.dumps({"asked": self.path}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class NetProxyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config = os.path.join(self.temp.name, "config.json")
        patcher = mock.patch.object(net_proxy, "CONFIG_PATH", self.config)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.temp.cleanup)

    def save(self, value):
        with open(self.config, "w", encoding="utf-8") as f:
            json.dump({"CIVITAI_API_KEY": "kept", net_proxy.CONFIG_KEY: value}, f)

    def test_addresses(self):
        self.assertEqual(net_proxy.normalize(""), "")
        self.assertEqual(net_proxy.normalize("  127.0.0.1:7890 "), "http://127.0.0.1:7890")
        self.assertEqual(net_proxy.normalize("HTTP://localhost:10809/"), "http://localhost:10809")
        self.assertEqual(net_proxy.normalize("https://proxy.lan:8443"), "https://proxy.lan:8443")
        self.assertEqual(net_proxy.normalize("[::1]:7897"), "http://[::1]:7897")
        for bad, why in (("socks5://127.0.0.1:7891", "socks"), ("127.0.0.1", "format"), ("127.0.0.1:0", "format"),
                         ("127.0.0.1:70000", "format"), ("http://a b:1", "format"), ("http://u:p@host:1", "format")):
            with self.assertRaises(ValueError) as caught:
                net_proxy.normalize(bad)
            self.assertEqual(str(caught.exception), why, bad)

    def test_saved_address_is_read_and_a_bad_one_ignored(self):
        self.assertEqual(net_proxy.configured(), "")  # no file
        self.save("127.0.0.1:7890")
        self.assertEqual(net_proxy.configured(), "http://127.0.0.1:7890")
        self.save("socks5://127.0.0.1:7891")
        self.assertEqual(net_proxy.configured(), "")

    def test_requests_go_through_the_saved_proxy(self):
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Proxy)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)  # runs first
        self.save(f"127.0.0.1:{server.server_address[1]}")
        Proxy.seen.clear()
        with net_proxy.urlopen(urllib.request.Request("http://civitai.invalid/api/v1/models?limit=1"), timeout=5) as response:
            self.assertEqual(json.loads(response.read())["asked"], "http://civitai.invalid/api/v1/models?limit=1")
        self.assertEqual(Proxy.seen, ["http://civitai.invalid/api/v1/models?limit=1"])

    def test_the_scan_process_gets_the_proxy(self):
        with mock.patch.dict(os.environ, {"HTTPS_PROXY": ""}, clear=False):
            self.assertEqual(net_proxy.child_env().get("HTTPS_PROXY"), "")  # nothing saved: unchanged
            self.save("127.0.0.1:7890")
            env = net_proxy.child_env()
        self.assertEqual((env["HTTP_PROXY"], env["HTTPS_PROXY"], env["https_proxy"]), ("http://127.0.0.1:7890",) * 3)

    def test_a_proxy_that_is_not_running_is_named_refused(self):
        with socket.socket() as probe:  # a port nothing listens on
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        self.save(f"127.0.0.1:{port}")
        with self.assertRaises(urllib.error.URLError) as caught:
            net_proxy.urlopen(urllib.request.Request("http://civitai.invalid/"), timeout=5)
        self.assertEqual(net_proxy.failure(caught.exception), "refused")

    def test_failure_names(self):
        cases = [
            (urllib.error.HTTPError("u", 503, "x", {}, None), "http:503"),
            (urllib.error.URLError(socket.timeout("timed out")), "timeout"),
            (TimeoutError(), "timeout"),
            (urllib.error.URLError(socket.gaierror(11001, "getaddrinfo failed")), "dns"),
            (urllib.error.URLError(ssl.SSLError(1, "bad handshake")), "ssl"),
            (urllib.error.URLError(ConnectionResetError(10054, "reset")), "reset"),
            (urllib.error.URLError(OSError("Tunnel connection failed: 403 Forbidden")), "proxy"),
            (urllib.error.URLError("something else"), "other"),
        ]
        for error, name in cases:
            self.assertEqual(net_proxy.failure(error), name, error)


if __name__ == "__main__":
    unittest.main()
