"""A chain of ready-made blocks (api/block_chain.py): what each block gives the one after it, the chain steps
taking the step before's picture, and the chain built on a new tab with each step anchored to the one before."""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import block_chain, mcp_actions, mcp_canvas_edit, reference_blocks  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402

A, B, LORA = "diffusion_models:0:a.safetensors", "diffusion_models:0:b.safetensors", "loras:0:style.safetensors"


def node_sets(block):
    return [block["nodes"]] + [variant["nodes"] for variant in (block.get("variants") or {}).values() if variant.get("nodes")]


class BlockEndTests(unittest.TestCase):
    def test_every_block_says_what_it_gives(self):
        for name, block in reference_blocks.BLOCKS.items():
            with self.subTest(block=name):
                self.assertIn("gives", block, "say {} for a block that changes the step it is put on")
                self.assertLessEqual(set(block["gives"]), {"sampler", "save"})
                for nodes in node_sets(block):
                    for key in block["gives"].values():
                        self.assertIn(key, nodes)
                        self.assertFalse(nodes[key].get("optional"), "a node a next block goes on from is always there")
                own = block.get("own_model")
                if own:
                    self.assertTrue(any(key in block["nodes"] for key in own["nodes"]))

    def test_a_chain_step_works_on_the_picture_of_the_step_before(self):
        for name, block in reference_blocks.BLOCKS.items():
            chained = "save" in block["gives"] and not block.get("standalone") and block.get("takes") not in ("picture", "reference")
            for nodes in node_sets(block) if chained else ():
                for key, spec in nodes.items():
                    with self.subTest(block=name, node=key):
                        self.assertNotIn(["$decode", 0], list(spec.get("inputs", {}).values()),
                                         "$save.images: after an enlargement the decode's picture is the older one")


class ChainTests(unittest.TestCase):
    def run_chain(self, steps, answers):
        calls, answers = [], iter(answers)
        with mock.patch.object(mcp_canvas_edit, "new_workflow", side_effect=lambda ctx, name: calls.append(("new", name))), \
                mock.patch.object(mcp_canvas_edit, "add_nodes", side_effect=lambda ctx, **kw: (calls.append(("add", kw)), next(answers))[1]), \
                mock.patch.object(mcp_actions, "add_lora", side_effect=lambda ctx, lora, after_node_id: calls.append(("lora", after_node_id))), \
                mock.patch.object(mcp_actions, "set_model", side_effect=lambda ctx, node, model: calls.append(("model", node, model))):
            return calls, block_chain.build({}, steps, "plan")

    def test_each_step_goes_on_from_what_the_one_before_gave(self):
        calls, built = self.run_chain(
            [{"use": "picture", "model": A, "loras": [LORA]}, {"use": "refine", "model": B, "loras": [LORA]},
             {"use": "follow", "want": "pose", "image": "pose.png"}, {"use": "detail"}, {"use": "upscale"}],
            [{"block": "picture", "nodes": {"model": "1", "sampler": "5", "save": "7"}},
             {"block": "refine_other_model", "nodes": {"second_model": "20", "redraw": "24", "save": "26"}},
             {"block": "control_pose", "nodes": {"look": "30"}},
             {"block": "detail_face_hands", "nodes": {"face": "40", "hands": "41", "save": "42"}},
             {"block": "upscale", "nodes": {"redraw": "50", "save": "53"}}])
        self.assertEqual(calls, [
            ("new", "plan"), ("add", {"use": "picture", "model": A}), ("lora", 1),
            ("add", {"use": "refine", "near_node_id": 5, "save_node_id": 7}), ("model", 20, B), ("lora", 20),
            ("add", {"use": "follow", "want": "pose", "image": "pose.png", "near_node_id": 24, "save_node_id": 26}),
            ("add", {"use": "detail", "near_node_id": 24, "save_node_id": 26}),
            ("add", {"use": "upscale", "near_node_id": 24, "save_node_id": 42})],
            "a pose changes the step it is put on; the details keep the redraw's sampler and give their own picture")
        self.assertEqual(built["nodes"]["5.save"], "53")
        self.assertEqual([step["block"] for step in built["steps"]][-1], "upscale")

    def test_a_copied_model_line_keeps_its_loras(self):
        calls, _built = self.run_chain(
            [{"use": "picture", "model": A}, {"use": "upscale", "want": "tile", "model": B, "loras": [LORA]}],
            [{"block": "picture", "nodes": {"model": "1", "sampler": "5", "save": "7"}},
             {"block": "upscale_tile", "nodes": {"own_1": "9", "own": "10", "redraw": "12", "save": "14"}}])
        self.assertEqual(calls[-1], ("model", 9, B))

    def test_a_plan_starts_with_its_picture_and_a_model_needs_a_loader(self):
        with self.assertRaisesRegex(ToolError, "at least its first step"):
            self.run_chain([], [])
        with self.assertRaisesRegex(ToolError, "starts with the picture"):
            self.run_chain([{"use": "upscale"}], [{"block": "upscale", "nodes": {"redraw": "2", "save": "3"}}])
        with self.assertRaisesRegex(ToolError, "no loader of its own"):
            self.run_chain([{"use": "picture"}, {"use": "upscale", "model": B}],
                           [{"block": "picture", "nodes": {"model": "1", "sampler": "5", "save": "7"}},
                            {"block": "upscale", "nodes": {"redraw": "12", "save": "14"}}])


if __name__ == "__main__":
    unittest.main()
