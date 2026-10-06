"""The MCP endpoint: both protocol eras, who may connect, and the read-only tools."""
import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from aiohttp.test_utils import make_mocked_request

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import lora_info, mcp_actions, mcp_bridge, mcp_server, mcp_tools  # noqa: E402

MODERN = "2026-07-28"


def meta(version=MODERN):
    return {"io.modelcontextprotocol/protocolVersion": version,
            "io.modelcontextprotocol/clientInfo": {"name": "test", "version": "1"},
            "io.modelcontextprotocol/clientCapabilities": {}}


def post(body, headers=None, remote="127.0.0.1", method="POST"):
    """Runs the endpoint on one request; returns (status, parsed body or None)."""
    transport = mock.Mock()
    transport.get_extra_info.side_effect = lambda key, default=None: (remote, 5555) if key == "peername" else default
    request = make_mocked_request(method, "/anomalous/mcp", transport=transport,
                                  headers={"Host": "127.0.0.1:8188", "Content-Type": "application/json", **(headers or {})})
    request.json = lambda: asyncio.sleep(0, body)
    response = asyncio.run(mcp_server.api_mcp(request))
    text = getattr(response, "text", None)
    return response.status, json.loads(text) if text else None


def modern_headers(method, name=None):
    headers = {"MCP-Protocol-Version": MODERN, "Mcp-Method": method}
    if name is not None:
        headers["Mcp-Name"] = name
    return headers


class ProtocolTests(unittest.TestCase):
    def test_legacy_clients_initialize_then_list_tools(self):
        status, body = post({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                             "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "c", "version": "1"}}})
        self.assertEqual(status, 200)
        self.assertEqual(body["result"]["protocolVersion"], "2025-06-18")
        self.assertIn("tools", body["result"]["capabilities"])
        self.assertEqual(post({"jsonrpc": "2.0", "method": "notifications/initialized"})[0], 202)
        status, body = post({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, {"MCP-Protocol-Version": "2025-06-18"})
        names = [tool["name"] for tool in body["result"]["tools"]]
        self.assertIn("search_models", names)
        self.assertNotIn("resultType", body["result"])  # legacy shape
        reading = [tool for tool in body["result"]["tools"] if tool["name"] in mcp_tools.TOOLS]
        self.assertTrue(reading and all(tool["annotations"]["readOnlyHint"] for tool in reading))
        # An unknown legacy version is answered with the latest one we speak.
        status, body = post({"jsonrpc": "2.0", "id": 3, "method": "initialize", "params": {"protocolVersion": "2030-01-01"}})
        self.assertEqual(body["result"]["protocolVersion"], "2025-11-25")

    def test_modern_requests_are_stateless_and_headers_must_match(self):
        status, body = post({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {"_meta": meta()}},
                            modern_headers("tools/list"))
        self.assertEqual(status, 200)
        self.assertEqual(body["result"]["resultType"], "complete")
        self.assertEqual(body["result"]["cacheScope"], "public")
        status, body = post({"jsonrpc": "2.0", "id": 2, "method": "server/discover", "params": {"_meta": meta()}},
                            modern_headers("server/discover"))
        self.assertIn(MODERN, body["result"]["supportedVersions"])
        # Header missing, or naming another tool than the body.
        status, body = post({"jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {"_meta": meta()}})
        self.assertEqual((status, body["error"]["code"]), (400, -32020))
        call = {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                "params": {"name": "scan_report", "arguments": {}, "_meta": meta()}}
        status, body = post(call, modern_headers("tools/call", "search_models"))
        self.assertEqual((status, body["error"]["code"]), (400, -32020))
        # A base64-encoded Mcp-Name is decoded before comparing.
        with mock.patch.object(mcp_tools, "_summarize", return_value=dict.fromkeys(
                ("total", "matched", "unmatched", "new", "pending"), 0) | {"unmatched_models": [], "new_models": []}), \
                mock.patch.object(mcp_tools, "last_scan_path", return_value="no such file"):
            status, body = post(call, modern_headers("tools/call", "=?base64?c2Nhbl9yZXBvcnQ=?="))
        self.assertEqual(status, 200)
        self.assertFalse(body["result"]["isError"])

    def test_versions_and_methods_we_do_not_speak(self):
        status, body = post({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {"_meta": meta("2030-01-01")}},
                            {"MCP-Protocol-Version": "2030-01-01", "Mcp-Method": "tools/list"})
        self.assertEqual((status, body["error"]["code"]), (400, -32022))
        self.assertIn(MODERN, body["error"]["data"]["supported"])
        status, body = post({"jsonrpc": "2.0", "id": 2, "method": "resources/list", "params": {"_meta": meta()}},
                            modern_headers("resources/list"))
        self.assertEqual((status, body["error"]["code"]), (404, -32601))
        self.assertEqual(post({}, method="GET")[0], 405)
        self.assertEqual(post([{"jsonrpc": "2.0", "id": 1, "method": "ping"}])[0], 400)  # no batches

    def test_only_this_computer_may_connect(self):
        ping = {"jsonrpc": "2.0", "id": 1, "method": "ping"}
        self.assertEqual(post(ping)[0], 200)
        self.assertEqual(post(ping, remote="192.168.1.20")[0], 403)
        self.assertEqual(post(ping, {"X-Forwarded-For": "8.8.8.8"})[0], 403)  # behind a proxy
        self.assertEqual(post(ping, {"Origin": "http://evil.example"})[0], 403)  # a web page
        self.assertEqual(post(ping, {"Host": "evil.example:8188"})[0], 403)  # DNS rebinding
        self.assertEqual(post(ping, {"Origin": "http://localhost:8188"})[0], 200)


class ToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(os.path.realpath(self.temp.name))  # the tools resolve short Windows names

    def tearDown(self):
        self.temp.cleanup()

    def test_search_and_detail_of_models(self):
        (self.root / "sub").mkdir()
        lora = self.root / "sub" / "neon_city.safetensors"
        lora.write_bytes(b"x")
        (self.root / "plain.ckpt").write_bytes(b"x")
        files = [("loras", 0, str(self.root), str(lora)), ("loras", 0, str(self.root), str(self.root / "plain.ckpt"))]
        metas = {str(lora): {"name": "Neon City", "baseModel": "SDXL 1.0", "trainedWords": ["neon"], "info_source": "civitai",
                             "description": "<p>Bright <b>lights</b></p>", "custom_notes": "mine"},
                 str(self.root / "plain.ckpt"): {"info_source": ""}}
        with mock.patch.object(mcp_tools, "_iter_search_models", return_value=files), \
                mock.patch.object(mcp_tools, "get_metadata", side_effect=lambda path: metas[path]), \
                mock.patch.object(mcp_tools, "resolve_folder_subdir", side_effect=lambda t, i, s: (str(self.root), str(self.root / s.strip("/")))):
            found = mcp_tools.call_tool(mcp_tools.TOOLS, "search_models", {"query": "neon sdxl"})["structuredContent"]
            self.assertEqual(found["total_matches"], 1)
            model = found["models"][0]
            self.assertEqual((model["model_id"], model["source"]), ("loras:0:sub/neon_city.safetensors", "civitai"))
            self.assertEqual(mcp_tools.call_tool(mcp_tools.TOOLS, "search_models", {"source": "not_scanned"})["structuredContent"]["total_matches"], 1)
            detail = mcp_tools.call_tool(mcp_tools.TOOLS, "get_model", {"model_id": model["model_id"]})["structuredContent"]
            self.assertEqual((detail["description"], detail["user_notes"]), ("Bright lights", "mine"))
            for bad in ("loras:0:../../secret.safetensors", "loras:0:sub/missing.safetensors", "nonsense"):
                result = mcp_tools.call_tool(mcp_tools.TOOLS, "get_model", {"model_id": bad})
                self.assertTrue(result["isError"], bad)

    def test_image_settings_come_from_the_png_and_stay_inside_output(self):
        from PIL import Image, PngImagePlugin
        prompt = {"3": {"class_type": "KSampler", "inputs": {"seed": 42, "model": ["4", 0]}},
                  "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sdxl/base.safetensors"}}}
        info = PngImagePlugin.PngInfo()
        info.add_text("prompt", json.dumps(prompt))
        Image.new("RGB", (8, 8)).save(self.root / "out.png", pnginfo=info)
        with mock.patch.object(mcp_tools.folder_paths, "get_output_directory", return_value=str(self.root)), \
                mock.patch.object(mcp_tools, "_kept_images", return_value=[{"subfolder": "", "filename": "out.png",
                                                                             "recipe": None, "combo": {"name": "C"}, "prompt": None}]):
            data = mcp_tools.call_tool(mcp_tools.TOOLS, "get_image_info", {"image": "out.png"})["structuredContent"]
            self.assertEqual(data["models_used"], ["sdxl/base.safetensors"])
            sampler = next(node for node in data["nodes"] if node["type"] == "KSampler")
            self.assertEqual(sampler["inputs"], {"seed": 42})  # links are left out
            self.assertEqual(data["kept_as"], {"combo": "C"})
            self.assertTrue(mcp_tools.call_tool(mcp_tools.TOOLS, "get_image_info", {"image": "../out.png"})["isError"])

    def test_bad_arguments_are_tool_errors(self):
        self.assertTrue(mcp_tools.call_tool(mcp_tools.TOOLS, "get_model", {})["isError"])
        self.assertTrue(mcp_tools.call_tool(mcp_tools.TOOLS, "search_models", {"delete": True})["isError"])


class BridgeTests(unittest.TestCase):
    """A canvas action waits for the one page that claims it."""

    def server(self, sockets=True):
        sent = []
        server = mock.Mock(sockets={"a": object()} if sockets else {})
        server.send_sync.side_effect = lambda event, data: sent.append(data)
        return server, sent

    def test_first_claim_wins_and_its_outcome_is_returned(self):
        server, sent = self.server()

        def page():
            while not sent:
                pass
            request_id = sent[0]["id"]
            self.assertTrue(mcp_bridge.claim(request_id))
            self.assertFalse(mcp_bridge.claim(request_id))  # a second tab
            self.assertTrue(mcp_bridge.resolve(request_id, {"ok": True, "value": {"nodes": 3}}))

        import threading
        with mock.patch.object(mcp_bridge, "_server", return_value=server):
            thread = threading.Thread(target=page)
            thread.start()
            value = mcp_bridge.ask_page("describe_canvas", timeout=5)
            thread.join()
        self.assertEqual(value, {"nodes": 3})
        self.assertEqual(sent[0]["action"], "describe_canvas")
        self.assertFalse(mcp_bridge.resolve(sent[0]["id"], {"ok": True}))  # nobody waits any more

    def test_no_page_or_no_answer_is_a_tool_error(self):
        server, _sent = self.server(sockets=False)
        with mock.patch.object(mcp_bridge, "_server", return_value=server):
            result = mcp_tools.call_tool(mcp_server.TOOLS, "describe_canvas", {}, {"base_url": "http://127.0.0.1:1"})
        self.assertTrue(result["isError"])
        self.assertIn("not open", result["content"][0]["text"])
        server, _sent = self.server()
        with mock.patch.object(mcp_bridge, "_server", return_value=server),                 mock.patch.object(mcp_bridge, "TIMEOUT_SECONDS", 0.05):
            with self.assertRaises(mcp_bridge.PageUnavailable):
                mcp_bridge.ask_page("describe_canvas", timeout=0.05)
        self.assertEqual(mcp_bridge._waiting, {})

    def test_a_refusal_from_the_page_reaches_the_ai(self):
        with mock.patch.object(mcp_actions, "ask_page", side_effect=mcp_bridge.PageRefused("Node 9 has no model drop-down.")),                 mock.patch.object(mcp_actions, "_resolve_model", return_value=("loras", 0, "/m", "/m/a.safetensors")):
            result = mcp_tools.call_tool(mcp_server.TOOLS, "set_model", {"node_id": 9, "model_id": "loras:0:a.safetensors"}, {})
        self.assertTrue(result["isError"])
        self.assertIn("Node 9", result["content"][0]["text"])

    def test_bridge_route_is_local_only(self):
        transport = mock.Mock()
        transport.get_extra_info.side_effect = lambda key, default=None: ("10.0.0.5", 1) if key == "peername" else default
        request = make_mocked_request("POST", "/anomalous/mcp/bridge", transport=transport, headers={"Host": "127.0.0.1:8188"})
        request.json = lambda: asyncio.sleep(0, {"id": "x", "claim": True})
        self.assertEqual(asyncio.run(mcp_server.api_mcp_bridge(request)).status, 403)


class ServerActionTests(unittest.TestCase):
    """Actions that go through this server's own routes."""
    CTX = {"base_url": "http://127.0.0.1:8188"}

    def test_scanning_picked_models_groups_them_by_folder(self):
        calls = []
        models = {"loras:0:a/x.safetensors": ("loras", 0, "/m", "/m/a/x.safetensors"),
                  "loras:0:a/y.safetensors": ("loras", 0, "/m", "/m/a/y.safetensors")}
        with mock.patch.object(mcp_actions, "_resolve_model", side_effect=lambda mid: models[mid]),                 mock.patch.object(mcp_actions.os.path, "relpath", side_effect=lambda f, b: f[len(b) + 1:]),                 mock.patch.object(mcp_actions, "_local", side_effect=lambda ctx, m, p, body=None, **k: calls.append(body) or (200, {"status": "ok"})):
            result = mcp_tools.call_tool(mcp_server.TOOLS, "scan_models", {"what": "models", "model_ids": list(models)}, self.CTX)
        self.assertFalse(result["isError"])
        self.assertEqual(calls[0]["targets"], [{"type": "loras", "path_idx": 0, "subfolder": "/a", "files": ["x.safetensors", "y.safetensors"]}])
        with mock.patch.object(mcp_actions, "_local", return_value=(409, {"status": "error"})):
            busy = mcp_tools.call_tool(mcp_server.TOOLS, "scan_models", {}, self.CTX)
        self.assertIn("already running", busy["content"][0]["text"])

    def test_speak_queues_the_tts_node_and_waits_for_the_file(self):
        posted = []

        def local(ctx, method, path, body=None, **kwargs):
            if path == "/anomalous_tts/characters":
                return 200, {"characters": [{"name": "Arona", "language": "ja", "emotions": {"happy": {}}}]}
            if path == "/prompt":
                posted.append(body)
                return 200, {"prompt_id": "p1"}
            return 200, {"p1": {"status": {"completed": True},
                                "outputs": {"2": {"audio": [{"subfolder": "audio/Arona", "filename": "Arona_00001.flac"}]}}}}

        with mock.patch.object(mcp_actions, "_local", side_effect=local),                 mock.patch.object(mcp_actions, "HISTORY_POLL_SECONDS", 0):
            data = mcp_tools.call_tool(mcp_server.TOOLS, "speak", {"character": "Arona", "text": "Sensei!", "seed": 7}, self.CTX)["structuredContent"]
            missing = mcp_tools.call_tool(mcp_server.TOOLS, "speak", {"character": "Nobody", "text": "hi"}, self.CTX)
        self.assertEqual(data["files"], ["audio/Arona/Arona_00001.flac"])
        node = posted[0]["prompt"]["1"]
        self.assertEqual((node["class_type"], node["inputs"]["text"], node["inputs"]["seed"]), ("AnomalousTTS_CharacterSpeech", "Sensei!", 7))
        self.assertEqual(posted[0]["prompt"]["2"]["inputs"]["filename_prefix"], "audio/Arona/Arona")
        self.assertTrue(missing["isError"])

    def test_acting_tools_are_marked_and_none_deletes(self):
        for name, tool in mcp_server.TOOLS.items():
            annotations = tool["spec"]["annotations"]
            self.assertNotIn("delete", name)
            if name in mcp_actions.ACTIONS and name not in ("describe_canvas", "check_workflow_models", "list_voices", "download_status"):
                self.assertFalse(annotations["readOnlyHint"], name)


class NodeComboTests(unittest.TestCase):
    def test_a_node_structure_combo_is_listed_by_slot(self):
        note = {"name": "Flux", "data": {"kind": "nodes", "values": {"s1": "Flux\\a.safetensors", "s2": "a cat"},
                 "structure": {"nodes": [{"type": "UNETLoader", "name": "UNet"}, {"type": "CLIPTextEncode"}],
                               "slots": [{"id": "s1", "kind": "model", "folder": "diffusion_models", "label": "Main"},
                                         {"id": "s2", "kind": "text", "label": "Positive"}]}}}
        with mock.patch.object(mcp_tools, "_list_notebooks", return_value=[note]):
            result = mcp_tools.list_combos("cat")
        combo = result["combos"][0]
        self.assertEqual(combo["models"], [{"slot": "Main", "folder": "diffusion_models", "file": "a.safetensors"}])
        self.assertEqual(combo["texts"], [{"slot": "Positive", "text": "a cat"}])
        self.assertEqual(combo["nodes"], ["UNet", "CLIPTextEncode"])


class DownloadToolTests(unittest.TestCase):
    def test_status_is_summarised(self):
        jobs = {"jobs": [{"rel": "Flux/a.safetensors", "type": "loras", "state": "running", "error": "", "received": 50,
                          "total": 200, "verified": False, "value": "Flux\a.safetensors"}]}
        with mock.patch.object(mcp_actions, "_local", return_value=(200, jobs)):
            result = mcp_actions.download_status({"base_url": "http://127.0.0.1:8188"})
        self.assertEqual(result["downloads"][0]["percent"], 25)
        self.assertEqual(result["downloads"][0]["file"], "Flux/a.safetensors")

    def test_download_model_needs_a_source_and_goes_through_the_page(self):
        with self.assertRaises(mcp_tools.ToolError):
            mcp_actions.download_model({}, "loras")
        with mock.patch.object(mcp_actions, "ask_page", return_value={"started": True}) as ask:
            mcp_actions.download_model({}, "loras", url="https://civitai.com/models/1?modelVersionId=2")
        action, args, _timeout = ask.call_args.args
        self.assertEqual((action, args["type"], args["folder"]), ("download_model", "loras", None))
        with mock.patch.object(mcp_actions, "ask_page", return_value={"started": []}) as ask:
            mcp_actions.download_missing_models({}, ["a.safetensors"])
        self.assertEqual(ask.call_args.args[:2], ("download_missing", {"names": ["a.safetensors"]}))


class LoraHeaderTests(unittest.TestCase):
    """add_lora wires the CLIP line only for LoRAs that train the text encoder."""

    def lora(self, keys):
        import struct
        header = json.dumps({"__metadata__": {}, **{key: {"dtype": "F16", "shape": [1], "data_offsets": [0, 2]} for key in keys}}).encode()
        path = Path(self.temp.name) / f"l{len(keys)}_{keys[0][:8]}.safetensors"
        path.write_bytes(struct.pack("<Q", len(header)) + header + b"\0\0")
        return str(path)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.temp.cleanup()

    def test_text_encoder_weights_are_told_from_the_header(self):
        self.assertTrue(lora_info.trains_text_encoder(self.lora(["lora_te_text_model.x.alpha", "lora_unet_a.alpha"])))
        self.assertTrue(lora_info.trains_text_encoder(self.lora(["lora_te1_x.alpha", "lora_te2_x.alpha"])))
        self.assertFalse(lora_info.trains_text_encoder(self.lora(["lora_unet_double_blocks.alpha"])))  # Flux
        self.assertFalse(lora_info.trains_text_encoder(self.lora(["diffusion_model.blocks.0.lora_A.weight"])))  # Anima
        self.assertTrue(lora_info.trains_text_encoder(str(Path(self.temp.name) / "old.ckpt")))  # unknown: assume it does


if __name__ == "__main__":
    unittest.main()
