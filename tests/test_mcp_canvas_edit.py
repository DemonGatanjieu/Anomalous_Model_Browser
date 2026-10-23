"""The MCP tools that build a workflow on the canvas (api/mcp_canvas_edit.py): node types read
from a stand-in /object_info, arguments checked before the page is asked, and the page asked
with exactly what it needs. No ComfyUI, no page."""
import sys
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import action_catalog, mcp_canvas_edit, mcp_server  # noqa: E402
from api.mcp_tools import ToolError, call_tool  # noqa: E402

INFO = {
    "KSampler": {"display_name": "KSampler", "category": "sampling", "description": "Denoises a latent",
                 "input": {"required": {"model": ["MODEL"], "steps": ["INT", {"default": 20, "min": 1, "max": 10000}],
                                        "sampler_name": [["euler", "dpmpp_2m"]]},
                           "optional": {"note": ["STRING", {"multiline": True, "forceInput": True}]}},
                 "output": ["LATENT"], "output_name": ["LATENT"]},
    "CheckpointLoaderSimple": {"display_name": "Load Checkpoint", "category": "loaders",
                               "input": {"required": {"ckpt_name": ["COMBO", {"options": [f"m{i}.safetensors" for i in range(80)]}]}},
                               "output": ["MODEL", "CLIP", "VAE"], "output_name": ["MODEL", "CLIP", "VAE"]},
    "OldSampler": {"display_name": "Old sampler", "category": "sampling", "deprecated": True, "input": {}, "output": []},
}


class FindNodesTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(mcp_canvas_edit, "object_info", return_value=INFO)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_search_gives_inputs_outputs_and_a_few_choices(self):
        found = mcp_canvas_edit.find_nodes({}, query="load checkpoint")
        node = found["nodes"][0]
        self.assertEqual((node["type"], found["total_matches"]), ("CheckpointLoaderSimple", 1))
        choice = node["inputs"][0]
        self.assertEqual((choice["type"], len(choice["choices"]), choice["choices_count"]), ("choice", mcp_canvas_edit.MAX_CHOICES, 80))
        self.assertEqual([item["name"] for item in node["outputs"]], ["MODEL", "CLIP", "VAE"])
        self.assertEqual(node["outputs"][1]["slot"], 1)

    def test_settings_keep_their_range_and_sockets_say_so(self):
        node = mcp_canvas_edit.find_nodes({}, types=["KSampler"])["nodes"][0]
        steps = next(item for item in node["inputs"] if item["name"] == "steps")
        self.assertEqual((steps["type"], steps["default"], steps["min"], steps["max"]), ("INT", 20, 1, 10000))
        note = next(item for item in node["inputs"] if item["name"] == "note")
        self.assertEqual((note["required"], note.get("socket_only")), (False, True))

    def test_named_types_give_all_choices_up_to_a_limit_and_say_what_is_missing(self):
        found = mcp_canvas_edit.find_nodes({}, types=["CheckpointLoaderSimple", "Nope"])
        self.assertEqual(len(found["nodes"][0]["inputs"][0]["choices"]), mcp_canvas_edit.MAX_CHOICES_NAMED)
        self.assertEqual(found["not_found"], ["Nope"])

    def test_deprecated_nodes_come_last(self):
        names = [node["type"] for node in mcp_canvas_edit.find_nodes({}, query="sampl")["nodes"]]
        self.assertEqual(names, ["KSampler", "OldSampler"])

    def test_nothing_asked(self):
        with self.assertRaises(ToolError):
            mcp_canvas_edit.find_nodes({}, query=" ")


class BuildToolTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(mcp_canvas_edit, "_page", return_value={"ok": True})
        self.page = patcher.start()
        self.addCleanup(patcher.stop)

    def test_the_page_gets_what_it_needs(self):
        self.assertIn("run_workflow", mcp_canvas_edit.add_node({}, "KSampler", {"steps": 28}, near_node_id=4)["next"])
        self.assertEqual(self.page.call_args[0], ("add_node", {"type": "KSampler", "values": {"steps": 28}, "title": "", "near_node_id": 4}))
        mcp_canvas_edit.connect_nodes({}, 4, 3, "model", output="0")
        self.assertEqual(self.page.call_args[0][1]["output"], 0, "a slot number given as text")
        mcp_canvas_edit.connect_nodes({}, 4, 3, "clip", output="CLIP")
        self.assertEqual(self.page.call_args[0][1]["output"], "CLIP")
        mcp_canvas_edit.remove_nodes({}, [3, 4])
        self.assertEqual(self.page.call_args[0], ("remove_nodes", {"node_ids": [3, 4]}))

    def test_a_workflow_in_api_form(self):
        nodes = {"1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "a.safetensors"}},
                 "2": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "steps": 20}}}
        mcp_canvas_edit.new_workflow({}, "Portrait", nodes)
        self.assertEqual(self.page.call_args, mock.call("new_workflow", {"name": "Portrait", "nodes": nodes}, timeout=60))
        mcp_canvas_edit.new_workflow({})
        self.assertIsNone(self.page.call_args[0][1]["nodes"], "a blank tab")

    def test_bad_arguments_never_reach_the_page(self):
        bad = [
            lambda: mcp_canvas_edit.add_node({}, ""),
            lambda: mcp_canvas_edit.add_node({}, "KSampler", {"steps": [1, 2]}),
            lambda: mcp_canvas_edit.add_node({}, "KSampler", {"text": "x" * (mcp_canvas_edit.MAX_TEXT + 1)}),
            lambda: mcp_canvas_edit.add_node({}, "KSampler", near_node_id=True),
            lambda: mcp_canvas_edit.connect_nodes({}, 1, 2, ""),
            lambda: mcp_canvas_edit.connect_nodes({}, {"id": 1}, 2, "model"),
            lambda: mcp_canvas_edit.set_values({}, 3, {}),
            lambda: mcp_canvas_edit.remove_nodes({}, []),
            lambda: mcp_canvas_edit.remove_nodes({}, list(range(mcp_canvas_edit.MAX_REMOVE + 1))),
            lambda: mcp_canvas_edit.new_workflow({}, "x", {}),
            lambda: mcp_canvas_edit.new_workflow({}, "x", {"1": {"inputs": {}}}),
            lambda: mcp_canvas_edit.new_workflow({}, "x", {"1": {"class_type": "A", "inputs": {"t": {"deep": 1}}}}),
        ]
        for call in bad:
            with self.assertRaises(ToolError):
                call()
        self.page.assert_not_called()


class RegistryTests(unittest.TestCase):
    def test_served_with_their_place_in_the_flow(self):
        for name in mcp_canvas_edit.CANVAS_TOOLS:
            self.assertIn(name, mcp_server.TOOLS)
            self.assertIn(name, action_catalog.TOOLS)
        self.assertEqual(action_catalog.TOOLS["add_node"].gate, "canvas")
        self.assertTrue(mcp_server.TOOLS["find_nodes"]["spec"]["annotations"]["readOnlyHint"])
        self.assertTrue(mcp_server.TOOLS["remove_nodes"]["spec"]["annotations"]["destructiveHint"])

    def test_unknown_arguments_are_refused_by_the_schema(self):
        result = call_tool(mcp_server.TOOLS, "add_node", {"type": "KSampler", "delete_files": True}, {})
        self.assertTrue(result["isError"])


if __name__ == "__main__":
    unittest.main()
