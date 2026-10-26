"""ComfyUI's refusal of a run said as what to do next (api/run_refusal.py), in run_workflow's answer."""
import sys
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import mcp_actions, run_refusal  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402


def node(node_id, kind, **extra):
    return {"node": node_id, "class_type": "KSampler", "type": kind, "message": "Problem", "details": "", **extra}


class SayTests(unittest.TestCase):
    def test_each_node_problem_names_the_node_and_the_tool(self):
        text = run_refusal.say({"type": "prompt_outputs_failed_validation", "nodes": [
            node("3", "required_input_missing", input="model"),
            node("4", "value_not_in_list", input="ckpt_name", value="gone.safetensors"),
            node("5", "value_bigger_than_max", input="cfg", value="80", details="max 30"),
        ]})
        self.assertIn("node 3 (KSampler) has nothing wired into model: connect_nodes", text)
        self.assertIn("ckpt_name = gone.safetensors is not one of its choices", text)
        self.assertIn("fix_workflow_models", text)
        self.assertIn("cfg = 80 is above its maximum (max 30)", text)
        self.assertTrue(text.endswith("run_workflow again."))

    def test_the_whole_prompt_and_unknown_kinds(self):
        self.assertIn("SaveImage", run_refusal.say({"type": "prompt_no_outputs", "message": "Prompt has no outputs", "nodes": []}))
        self.assertIn("node 9 (KSampler): Odd thing it said", run_refusal.say({"nodes": [
            {"node": "9", "class_type": "KSampler", "type": "custom_validation_failed", "message": "Odd thing it said"}]}))
        self.assertIn("Server down 500", run_refusal.say({"type": "server_error", "message": "Server down", "details": "500", "nodes": []}))
        self.assertEqual(run_refusal.say(None), "")
        self.assertEqual(run_refusal.say({"nodes": []}), "")

    def test_many_problems_are_cut_short(self):
        text = run_refusal.say({"nodes": [node(str(n), "required_input_missing", input="model") for n in range(12)]})
        self.assertIn("and 4 more", text)


class RunTests(unittest.TestCase):
    def test_run_workflow_says_what_to_fix(self):
        refused = {"prompt_ids": [], "queued": 0, "requested": 1, "submission_error": "Prompt outputs failed validation",
                   "refusal": {"type": "prompt_outputs_failed_validation", "nodes": [node("3", "required_input_missing", input="model")]}}
        with mock.patch.object(mcp_actions.mcp_fill, "fill", return_value=None), \
                mock.patch.object(mcp_actions, "ask_page", return_value=refused):
            with self.assertRaises(ToolError) as caught:
                mcp_actions.run_workflow({})
        self.assertIn("node 3 (KSampler) has nothing wired into model", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
