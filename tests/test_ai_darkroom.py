"""The darkroom helper (api/ai_darkroom.py): only a server on this computer is taken, it rewrites a
prompt as asked, and its word on a picture is cut down to the allowed checks. A stand-in server
answers as a local model would. Temporary folders only."""
import http.server
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import ai_darkroom, mcp_actions  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402

SETTING = os.path.join(tempfile.mkdtemp(prefix="amb_darkroom_"), "ai_darkroom.json")
PICTURE = {"type": "image", "data": "aGVsbG8=", "mimeType": "image/png"}


class Model(http.server.BaseHTTPRequestHandler):
    reply, asked = "", []

    def log_message(self, *args):
        pass

    def _send(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send({"data": [{"id": "tiny-vl"}, {"id": "tiny-text"}]})

    def do_POST(self):
        Model.asked.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        self._send({"choices": [{"message": {"content": Model.reply}}]})


class DarkroomTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Model)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}/v1"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        Model.asked.clear()
        if os.path.exists(SETTING):
            os.remove(SETTING)
        patcher = mock.patch.object(ai_darkroom, "_path", lambda: SETTING)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_only_a_server_on_this_computer_is_taken(self):
        for url in ("http://example.com/v1", "http://192.168.1.5:11434/v1", "http://user@127.0.0.1:11434/v1", "ftp://127.0.0.1/v1", ""):
            with self.subTest(url=url), self.assertRaises(ValueError):
                ai_darkroom.save(url, "tiny-text")
        self.assertIsNone(ai_darkroom.settings())
        self.assertEqual(ai_darkroom.save(self.url + "/", " tiny-vl ", True), {"url": self.url, "model": "tiny-vl", "vision": True})
        with open(SETTING, "w", encoding="utf-8") as kept:  # a file changed by hand to point elsewhere is not used
            json.dump({"url": "http://example.com/v1", "model": "x"}, kept)
        self.assertIsNone(ai_darkroom.settings())
        self.assertIsNone(ai_darkroom.note())

    def test_the_servers_of_this_computer_are_found(self):
        self.assertEqual(ai_darkroom.models(self.url), ["tiny-vl", "tiny-text"])
        with mock.patch.object(ai_darkroom, "PORTS", (self.server.server_address[1], 9)):
            self.assertEqual(ai_darkroom.found(), [{"url": self.url, "models": ["tiny-vl", "tiny-text"]}])

    def test_it_rewrites_a_prompt_as_asked(self):
        with self.assertRaisesRegex(ToolError, "no local helper"):
            ai_darkroom.write("a barn", "at night")
        ai_darkroom.save(self.url, "tiny-text")
        Model.reply = "<think>night, keep the barn</think>\n`red barn, snow, night sky`"
        self.assertEqual(ai_darkroom.write("red barn, snow", "make it night"), "red barn, snow, night sky")
        sent = Model.asked[0]
        self.assertEqual(sent["model"], "tiny-text")
        self.assertIn("red barn, snow", sent["messages"][1]["content"])
        self.assertIn("make it night", sent["messages"][1]["content"])
        with mock.patch.object(mcp_actions, "_page", side_effect=lambda action, body: body) as page:
            mcp_actions.set_prompt({}, "red barn, snow", rewrite="make it night")
        self.assertEqual(page.call_args[0][1]["text"], "red barn, snow, night sky", "the canvas gets what the helper wrote")
        self.assertIn("rewrite", ai_darkroom.note())
        self.assertNotIn("zoom_image", ai_darkroom.note(), "a helper that sees no pictures is not said to")

    def test_its_word_on_a_picture_is_only_the_allowed_checks(self):
        def result():
            return {"content": [{"type": "text", "text": "{}"}, dict(PICTURE)], "structuredContent": {"image": "a.png"}, "isError": False}
        self.assertNotIn("local_check", ai_darkroom.check_picture(result())["structuredContent"], "no helper, nothing added")
        ai_darkroom.save(self.url, "tiny-text")
        self.assertNotIn("local_check", ai_darkroom.check_picture(result())["structuredContent"], "one that sees no pictures is not shown any")
        ai_darkroom.save(self.url, "tiny-vl", True)
        Model.reply = 'Here: {"sharpness": "soft", "hands": "wrong", "face": "lovely canarywords", "describe": "canarywords in a barn", "framing": "ok"}'
        checked = ai_darkroom.check_picture(result())
        self.assertEqual(checked["structuredContent"]["local_check"], {"sharpness": "soft", "hands": "wrong", "framing": "ok"})
        self.assertNotIn("canarywords", json.dumps(checked), "what it says besides is dropped")
        self.assertEqual(json.loads(checked["content"][0]["text"]), checked["structuredContent"])
        self.assertTrue(Model.asked[-1]["messages"][0]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,"))
        Model.reply = "I cannot tell"
        self.assertIn("no usable answer", ai_darkroom.check_picture(result())["structuredContent"]["local_check"])
        ai_darkroom.save("http://127.0.0.1:9/v1", "gone", True)
        self.assertIn("did not answer", ai_darkroom.check_picture(result())["structuredContent"]["local_check"])
        self.assertIn("zoom_image", ai_darkroom.note())


if __name__ == "__main__":
    unittest.main()
