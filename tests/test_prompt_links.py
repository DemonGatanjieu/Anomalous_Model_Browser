import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from PIL import Image, PngImagePlugin

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import material_assets, materials
from api.material_schema import _extract_workflow_params, _prompt_groups_from_roles, _prompt_roles_for_workflow
from api.prompt_links import resolve_clip_prompt_text, resolved_prompt_texts


def linked_workflow(source_type="PrimitiveString", reroutes=()):
    source = {"id": 1, "type": source_type, "widgets_values": ["  linked text\n"], "outputs": [{"type": "STRING"}]}
    nodes, links = [source], []
    previous_id = 1
    for node_id, node_type in enumerate(reroutes, 2):
        nodes.append({"id": node_id, "type": node_type, "inputs": [{"link": node_id - 1}]})
        links.append([node_id - 1, previous_id, 0, node_id, 0, "STRING"])
        previous_id = node_id
    clip = {"id": 100, "type": "CLIPTextEncode", "title": "Positive", "widgets_values": ["stale"],
            "inputs": [{"name": "TeXt", "type": "STRING", "link": previous_id}]}
    nodes.append(clip)
    links.append([previous_id, previous_id, 0, 100, 0, "STRING"])
    return {"nodes": nodes, "links": links}, clip, source


class PromptLinkTests(unittest.IsolatedAsyncioTestCase):
    def test_unlinked_uses_own_text_and_keeps_legacy_multi_widget_list(self):
        clip = {"id": 1, "type": "CLIPTextEncode", "title": "Negative", "widgets_values": [" ", "  own text\n", "another"]}
        workflow = {"nodes": [clip]}
        self.assertEqual(resolve_clip_prompt_text(workflow, clip), "own text")
        self.assertEqual(_extract_workflow_params(workflow)[1], ["own text", "another"])
        self.assertEqual(_prompt_roles_for_workflow(workflow)["1"]["role"], "negative")

    def test_api_prompt_inline_precedes_workflow_and_only_accepts_text(self):
        workflow, clip, _ = linked_workflow("PrimitiveNode")
        workflow["links"] = []
        for value, expected in [("  inline\n", "inline"), ([1, 0], ""), (" \n ", ""), (123, "")]:
            with self.subTest(value=value):
                api_prompt = {"100": {"inputs": {"text": value}}}
                self.assertEqual(resolve_clip_prompt_text(workflow, clip, api_prompt=api_prompt), expected)
                self.assertEqual(resolved_prompt_texts(workflow, api_prompt), {"100": expected} if expected else {})

    def test_static_nodes_and_supported_reroutes(self):
        for source_type in ("PrimitiveString", "PrimitiveStringMultiline", "Text Multiline"):
            for reroutes in ((), ("Reroute",), ("Reroute (rgthree)", "ReroutePrimitive")):
                with self.subTest(source_type=source_type, reroutes=reroutes):
                    workflow, clip, _ = linked_workflow(source_type, reroutes)
                    original = copy.deepcopy(workflow)
                    api_prompt = {"100": {"inputs": {"text": [1, 0]}}}
                    self.assertEqual(resolve_clip_prompt_text(workflow, clip, api_prompt=api_prompt), "linked text")
                    self.assertEqual(resolved_prompt_texts(workflow), {"100": "linked text"})
                    self.assertEqual(workflow, original)

    def test_unnamed_string_port_and_serialized_link_objects(self):
        workflow, clip, source = linked_workflow()
        clip["inputs"] = [{"name": "clip", "type": "CLIP"}, {"name": "value", "type": "STRING", "link": 0}]
        source["outputs"] = [{"type": "IMAGE"}, {"type": "*"}]
        link = {"id": 0, "origin_id": 1, "origin_slot": 1, "target_id": 100, "target_slot": 1}
        for links in ([link], {"0": link}):
            with self.subTest(links=links):
                workflow["links"] = links
                self.assertEqual(resolve_clip_prompt_text(workflow, clip), "linked text")

    def test_unsafe_sources_never_fall_back_to_stale_text(self):
        for source_type in ("WildcardText", "DynamicPrompt", "StringConcat", "RandomText", "LLMText", "LoadTextFile", "TextSwitch"):
            with self.subTest(source_type=source_type):
                workflow, clip, _ = linked_workflow(source_type)
                self.assertEqual(resolve_clip_prompt_text(workflow, clip), "")
                self.assertEqual(_extract_workflow_params(workflow)[1], [])
        for change in (
            {"widgets_values": ["first", 1]}, {"widgets_values": ["first", "second"]},
            {"widgets_values": ["  "]}, {"widgets_values": {"value": "not an array"}},
            {"mode": 2}, {"mode": 4}, {"inputs": [{"link": 0}]}, {"outputs": [{"type": "IMAGE"}]},
        ):
            with self.subTest(change=change):
                workflow, clip, source = linked_workflow()
                source.update(change)
                self.assertEqual(resolve_clip_prompt_text(workflow, clip), "")

    def test_reroute_bounds_cycle_mute_and_ambiguity(self):
        for length, expected in ((7, "linked text"), (8, "")):
            workflow, clip, _ = linked_workflow(reroutes=("Reroute",) * length)
            self.assertEqual(resolve_clip_prompt_text(workflow, clip), expected)
        for reroute_change in ({"mode": 2}, {"mode": 4}, {"inputs": [{"link": 1}, {"link": 2}]},
                               {"inputs": [{"link": 2}]}):
            with self.subTest(reroute_change=reroute_change):
                workflow, clip, _ = linked_workflow(reroutes=("Reroute",))
                workflow["nodes"][1].update(reroute_change)
                self.assertEqual(resolve_clip_prompt_text(workflow, clip), "")

    def test_roles_use_topology_for_linked_text_and_respect_selection(self):
        workflow, clip, source = linked_workflow(reroutes=("Reroute",))
        roles = _prompt_roles_for_workflow(workflow)
        self.assertEqual(roles["100"]["role"], "unknown")
        self.assertEqual(_prompt_groups_from_roles(workflow, roles), {"positive": [], "negative": []})

        workflow["nodes"].append({"id": 101, "type": "KSampler", "inputs": [{"name": "negative", "link": 20}]})
        workflow["links"].append([20, clip["id"], 0, 101, 0, "CONDITIONING"])
        roles = _prompt_roles_for_workflow(workflow)
        self.assertEqual(roles["100"]["role"], "negative")
        self.assertEqual(_prompt_groups_from_roles(workflow, roles), {"positive": [], "negative": ["linked text"]})
        for selected in ({"101"}, {"100"}, {"100", str(source["id"])}):
            self.assertEqual(_prompt_groups_from_roles(workflow, roles, selected), {"positive": [], "negative": []})

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "selected.json")
            path.write_text(json.dumps({
                "kind": "image_node_selection", "name": "Selected encoder", "workflow": workflow,
                "selection": {"scope": "nodes", "node_ids": [100]},
            }), encoding="utf-8")
            payload = json.loads(materials._material_detail_response(path, "0").body)
            self.assertNotIn("workflow", payload["data"])
            self.assertEqual([block["node_id"] for block in payload["node_blocks"]], [100])
            self.assertNotIn("linked text", json.dumps(payload))

    async def test_inspect_image_uses_both_png_chunks_without_changing_workflow(self):
        workflow, clip, _ = linked_workflow("PrimitiveNode")
        workflow["nodes"].append({"id": 101, "type": "KSampler", "inputs": [{"name": "positive", "link": 20}],
                                  "widgets_values": [42, "fixed", 20]})
        workflow["links"].append([20, clip["id"], 0, 101, 0, "CONDITIONING"])
        png_info = PngImagePlugin.PngInfo()
        png_info.add_text("workflow", json.dumps(workflow))
        png_info.add_text("prompt", json.dumps({"100": {"inputs": {"text": "  PNG\nprompt  "}}}))

        async def request_json():
            return {"source_image": {"type": "output", "filename": "fixture.png"}}

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "fixture.png")
            Image.new("RGB", (2, 2)).save(path, pnginfo=png_info)
            with mock.patch.object(material_assets, "_output_source_path", return_value=path), mock.patch.object(
                material_assets, "_embedded_workflow_payload", wraps=material_assets._embedded_workflow_payload
            ) as read_metadata:
                response = await materials.api_inspect_image_material(SimpleNamespace(json=request_json))
            read_metadata.assert_called_once_with(path)

        self.assertEqual(response.status, 200)
        payload = json.loads(response.body)
        self.assertEqual(payload["prompts"], ["PNG\nprompt"])
        self.assertEqual(payload["prompt_excerpt"], "PNG prompt")
        self.assertEqual(payload["prompt_groups"], {"positive": ["PNG\nprompt"], "negative": []})
        self.assertEqual(payload["resolved_prompt_texts"], {"100": "PNG\nprompt"})
        self.assertEqual(payload["params"]["seed"], 42)
        self.assertEqual(payload["workflow"], workflow)
