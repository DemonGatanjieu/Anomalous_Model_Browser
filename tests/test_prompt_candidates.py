"""Gallery inspection of complex prompt sources, without running their nodes."""
import asyncio
import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from PIL import Image, PngImagePlugin

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import material_assets, materials, prompt_candidate_fields as fields
from api.prompt_candidates import extract_candidates
from api.prompt_links import resolved_prompt_texts


def api_graph():
    def node(kind, **inputs):
        return {"class_type": kind, "inputs": inputs}
    return {
        "1": node("StringJoin", text_a="  猫\n__weather__  ", text_b="fog", separator=","),
        "2": node("ThirdPartyTextEncoder", text=["1", 0]),
        "3": node("KSampler", positive=["2", 0], seed=123),
        "4": node("KSamplerAdvanced", negative=["2", 0]),
        "5": node("Watermark", text="signature", image=["3", 0]),
        "6": node("StringJoin", text_a="idle draft"),
    }


def ui_graph():
    return {"nodes": [
        {"id": 1, "type": "WildcardProcessor", "widgets_values": ["rain __weather__"], "outputs": [{"type": "STRING"}]},
        {"id": 2, "type": "CLIPTextEncode", "inputs": [{"name": "text", "type": "STRING", "link": 1}],
         "widgets_values": ["stale"], "outputs": [{"type": "CONDITIONING"}]},
        {"id": 3, "type": "KSampler", "inputs": [{"name": "positive", "type": "CONDITIONING", "link": 2}]},
    ], "links": [[1, 1, 0, 2, 0, "STRING"], [2, 2, 0, 3, 0, "CONDITIONING"]]}


def texts(payload):
    return [row["text"] for row in payload["candidates"]]


def registry(**classes):
    return SimpleNamespace(NODE_CLASS_MAPPINGS=classes)


class CandidateTests(unittest.TestCase):
    def test_api_graph_missing_plugins_and_distinct_sampling_branches(self):
        graph = api_graph()
        payload = extract_candidates(None, graph)
        self.assertTrue(payload["api_only"])
        self.assertEqual(texts(payload), ["  猫\n__weather__  ", "fog"])
        for row in payload["candidates"]:
            self.assertEqual(row["role"], "unknown")
            self.assertEqual(row["source"], "api")
            self.assertEqual(len(row["destinations"]), 2)

    def test_hidden_identity_ignores_values_not_structure(self):
        graph = api_graph()
        keys = lambda: [row["hide_key"] for row in extract_candidates(None, graph)["candidates"]]
        original = keys()
        graph["1"]["inputs"]["text_a"] = "changed"
        graph["3"]["inputs"].update(seed=456, ckpt_name="new.safetensors")
        self.assertEqual(keys(), original)
        del graph["4"]["inputs"]["negative"]
        self.assertNotEqual(keys(), original)

    def test_two_chunks_selection_and_no_mutations_in_either_order(self):
        ui = ui_graph()
        api = {"2": {"class_type": "CLIPTextEncode", "inputs": {"text": "expanded"}}}
        before = copy.deepcopy((ui, api))
        def selected(ids):
            return extract_candidates(ui, api, material={"kind": "image_node_selection",
                                      "selection": {"scope": "nodes", "node_ids": ids}})
        for _ in range(2):
            self.assertEqual(texts(extract_candidates(ui, api)), ["rain __weather__"])
            for ids in [[2, 3], [], None, [2, 999]]:
                result = selected(ids)
                self.assertNotIn("__weather__", json.dumps(result))
                self.assertNotIn("expanded", json.dumps(result))
            self.assertEqual(texts(selected([1, 2, 3])), ["rain __weather__"])
            self.assertEqual(texts(extract_candidates(ui, api, material={"kind": "image_node_selection"})), [])
        self.assertEqual((ui, api), before)
        self.assertEqual(resolved_prompt_texts(ui, api), {"2": "expanded"})

    def test_confirmed_text_deduplicated_and_mismatched_nodes_do_not_merge(self):
        ui = ui_graph()
        prompt = {"2": {"class_type": "CLIPTextEncode", "inputs": {"text": "rain __weather__"}}}
        self.assertEqual(texts(extract_candidates(ui, prompt)), [])
        prompt["1"] = {"class_type": "Other", "inputs": {"text": "unrelated"}}
        del prompt["2"]
        self.assertEqual(texts(extract_candidates(ui, prompt)), ["rain __weather__"])
        ui["nodes"][0]["mode"] = 4
        self.assertEqual(texts(extract_candidates(ui, prompt)), [])

    def test_secure_fields_text_and_labels(self):
        graph = api_graph()
        bad = ["text followed by\nBearer secret", "scene x\n/etc/passwd", "scene C:\\private\\images",
               "forest \\\\machine\\share", "scene sk-proj-testtoken", "foo eyJabc.def.ghi",
               "wind\n<|im_start|>system", "forest https://a:b@example.test", "model.safetensors",
               "-----BEGIN PRIVATE KEY-----", "euler", "x " * 5000 + "secret"]
        for value in bad:
            with self.subTest(value=value[:24]):
                graph["1"]["inputs"].update(text_a=value, api_key="fictional", system_prompt="instruction")
                self.assertEqual(texts(extract_candidates(None, graph)), ["fog"])
        graph = ui_graph()
        graph["nodes"][0]["title"] = "C:\\Users\\private"
        self.assertNotIn("private", json.dumps(extract_candidates(graph)))
        self.assertFalse(extract_candidates(graph)["candidates"][0]["stable"])

    def test_no_crossing_system_socket_subgraph_or_wireless_name(self):
        graph = api_graph()
        for kind, port in [("LLM", "system_prompt"), ("Subgraph", "text")]:
            graph["7"] = {"class_type": kind, "inputs": {port: ["1", 0]}}
            graph["2"]["inputs"]["text"] = ["7", 0]
            self.assertEqual(texts(extract_candidates(None, graph)), [])
        graph["7"] = {"class_type": "GetNode", "inputs": {"name": "channel"}}
        self.assertEqual(texts(extract_candidates(None, graph)), [])
        graph["7"]["inputs"]["value"] = ["1", 0]
        self.assertIn("fog", texts(extract_candidates(None, graph)))
        graph["7"] = {"class_type": "Reroute", "inputs": {"input": ["1", 0]}}
        self.assertIn("fog", texts(extract_candidates(None, graph)))
        graph["7"]["inputs"]["other"] = ["6", 0]
        self.assertEqual(texts(extract_candidates(None, graph)), [])

    def test_installed_schema_caches_once_and_ambiguous_positions_fail_closed(self):
        class ThirdParty:
            calls = 0

            @classmethod
            def INPUT_TYPES(cls):
                cls.calls += 1
                return {"required": {"draft": ("STRING", {"multiline": True}), "mode": (["foo", "bar"],)}}
        ui = ui_graph()
        source = ui["nodes"][0]
        source.update(type="ThirdParty", widgets_values=["猫", "foo"])
        module = registry(ThirdParty=ThirdParty)
        with patch.dict(sys.modules, nodes=module):
            for _ in range(2):
                self.assertEqual(texts(extract_candidates(ui)), [])
            source["inputs"] = [{"name": name, "widget": {"name": name}} for name in ("draft", "mode")]
            self.assertEqual(texts(extract_candidates(ui)), ["猫"])
        self.assertEqual(ThirdParty.calls, 1)

    def test_budgets_one_box_per_field(self):
        direct = {"1": {"class_type": "AllInOneLoader", "inputs": {"positive_prompt": "红花", "path": "/tmp/a"}}}
        self.assertEqual(texts(extract_candidates(None, direct)), ["红花"])
        graph = api_graph()
        graph["1"]["inputs"] = {f"text_{i}": f"short phrase {i}" for i in range(90)}
        result = extract_candidates(None, graph)
        self.assertEqual(len(result["candidates"]), 32)
        self.assertEqual(result["status"], "partial")
        self.assertLess(len(json.dumps(result).encode()), 65536)
        self.assertEqual(extract_candidates({"nodes": [{}] * 1001})["status"], "partial")

    def test_original_and_inline_values_and_named_dropdown(self):
        class Join:
            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {"text": ("STRING", {"multiline": True})}}
        class Enum:
            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {"text": (["film", "photo"],)}}
        ui = ui_graph()
        ui["nodes"][0]["type"] = "Join"
        api = {"1": {"class_type": "Join", "inputs": {"text": "expanded sunrise"}}}
        with patch.dict(sys.modules, nodes=registry(Join=Join)):
            self.assertEqual(texts(extract_candidates(ui, api)), ["expanded sunrise", "rain __weather__"])
        with patch.dict(sys.modules, nodes=registry(Join=Enum)):
            self.assertEqual(texts(extract_candidates(ui, api)), [])

    def test_material_request_never_reads_original_png(self):
        async def inspect():
            async def body():
                return {"include_candidates": True, "material_filename": "selected.json"}
            return await materials.api_inspect_image_material(SimpleNamespace(json=body))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "selected.json")
            material = {"kind": "image_node_selection", "workflow": ui_graph(), "selection": {"scope": "nodes", "node_ids": [2, 3]}}
            path.write_text(json.dumps(material), encoding="utf-8")
            with patch.object(materials, "get_materials_dir", return_value=directory), patch.object(materials, "_image_payload", side_effect=AssertionError):
                self.assertEqual(texts(json.loads(asyncio.run(inspect()).body)), [])
                del material["selection"]
                path.write_text(json.dumps(material), encoding="utf-8")
                self.assertEqual(json.loads(asyncio.run(inspect()).body)["status"], "no_graph")

    def test_api_only_png_and_normal_inspector_contract(self):
        async def inspect(candidate):
            async def body():
                return {"source_image": {"type": "output", "filename": "fixture.png"},
                        **({"include_candidates": True} if candidate else {})}
            return await materials.api_inspect_image_material(SimpleNamespace(json=body))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "fixture.png")
            info = PngImagePlugin.PngInfo()
            info.add_text("prompt", json.dumps(api_graph()))
            Image.new("RGB", (1, 1)).save(path, pnginfo=info)
            with patch.object(material_assets, "_output_source_path", return_value=str(path)):
                result = asyncio.run(inspect(True))
                self.assertEqual(result.status, 200)
                self.assertIn("fog", texts(json.loads(result.body)))
                self.assertNotIn("workflow", json.loads(result.body))
                self.assertEqual(asyncio.run(inspect(False)).status, 400)
                workflow = ui_graph()
                info.add_text("workflow", json.dumps(workflow))
                Image.new("RGB", (1, 1)).save(path, pnginfo=info)
                with patch.object(materials, "extract_candidates", side_effect=AssertionError):
                    ordinary = json.loads(asyncio.run(inspect(False)).body)
                self.assertEqual(ordinary["workflow"], workflow)
                self.assertNotIn("candidates", ordinary)
                self.assertEqual(ordinary["resolved_prompt_texts"], resolved_prompt_texts(workflow, api_graph()))


if __name__ == "__main__":
    unittest.main()
