"""What the user hands the AI to work with (api/ai_toolbox.py): picks checked and kept with the
task, given to the AI once as a message and in begin_task, favourites standing in, and "only"
refusing other custom or paid node types. A stand-in /object_info; temporary folders only."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_panels, ai_tasks, ai_toolbox, mcp_canvas_edit, mcp_task_tools  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402
from test_ai_tasks import isolate, ok  # noqa: E402

FAVOURITES = os.path.join(tempfile.mkdtemp(prefix="amb_ai_toolbox_"), "ai_toolbox.json")
INFO = {
    "KSampler": {"python_module": "nodes", "display_name": "KSampler", "input": {"required": {"model": ["MODEL"]}}, "output": ["LATENT"]},
    "ImageBlur": {"python_module": "comfy_extras.nodes_post_processing", "input": {}, "output": ["IMAGE"]},
    "FaceDetailer": {"python_module": "custom_nodes.ComfyUI-Impact-Pack", "display_name": "FaceDetailer", "input": {}, "output": ["IMAGE"]},
    "SAMLoader": {"python_module": "custom_nodes.ComfyUI-Impact-Pack", "input": {}, "output": ["SAM_MODEL"]},
    "KlingTextToVideo": {"python_module": "comfy_api_nodes.nodes_kling", "input": {}, "output": ["VIDEO"]},
}


class ToolboxTests(unittest.TestCase):
    def setUp(self):
        isolate()
        if os.path.exists(FAVOURITES):
            os.remove(FAVOURITES)
        for target, value in ((ai_toolbox, "_path"), (mcp_canvas_edit, "_object_info")):
            patcher = mock.patch.object(target, value, (lambda: FAVOURITES) if value == "_path" else (lambda ctx: INFO))
            patcher.start()
            self.addCleanup(patcher.stop)
        ai_tasks.record("Gemini", "describe_canvas", {}, ok({}), time.time(), True)
        self.task = ai_tasks.list_tasks()[0]["id"]
        self.ctx = {"client": "Gemini", "task": self.task, "base_url": "http://127.0.0.1:1"}

    def test_a_pick_is_kept_and_reaches_the_ai_once(self):
        step = ai_toolbox.pick(self.task, {"nodes": ["FaceDetailer", "FaceDetailer"], "combos": ["赛博少女"]}, "prefer")
        self.assertEqual(step["toolbox"]["nodes"], ["FaceDetailer"], "each once")
        self.assertEqual(ai_tasks.get_task(self.task)["toolbox"]["combos"], ["赛博少女"])
        result = ai_panels.attach_pending(ok({}), "Gemini", task_id=self.task)
        message = result["structuredContent"]["user_messages"][0]
        self.assertEqual(message["kind"], "toolbox")
        self.assertIn("FaceDetailer", message["text"])
        self.assertNotIn("user_messages", ai_panels.attach_pending(ok({}), "Gemini", task_id=self.task)["structuredContent"])
        begun = mcp_task_tools.begin_task(self.ctx, "继续")
        self.assertIn("Use these first", begun["toolbox"])

    def test_favourites_stand_in_until_the_task_has_its_own(self):
        self.assertIsNone(ai_toolbox.effective(ai_tasks.get_task(self.task)))
        ai_toolbox.set_favorites({"nodes": ["SAMLoader"]})
        self.assertEqual(ai_toolbox.effective(ai_tasks.get_task(self.task))["from"], "favorites")
        ai_toolbox.pick(self.task, {"nodes": []}, "prefer")
        box = ai_toolbox.effective(ai_tasks.get_task(self.task))
        self.assertEqual((box["from"], box["nodes"]), ("task", []), "an empty pick is the user's choice too")

    def test_only_refuses_other_custom_and_paid_nodes_but_not_built_in_or_page_helpers(self):
        ai_toolbox.pick(self.task, {"nodes": ["FaceDetailer"]}, "only")
        self.assertEqual(ai_toolbox.refused(self.task, ["KSampler", "ImageBlur", "FaceDetailer", "Reroute", "SAMLoader", "KlingTextToVideo"], INFO),
                         ["KlingTextToVideo", "SAMLoader"])
        with mock.patch.object(mcp_canvas_edit, "_page", return_value={}) as page:
            with self.assertRaisesRegex(ToolError, "allowed only these node types.*FaceDetailer.*Not allowed: SAMLoader"):
                mcp_canvas_edit.add_node(self.ctx, "SAMLoader")
            with self.assertRaises(ToolError):
                mcp_canvas_edit.new_workflow(self.ctx, "x", {"1": {"class_type": "KlingTextToVideo", "inputs": {}}})
            page.assert_not_called()
            mcp_canvas_edit.add_node(self.ctx, "KSampler")
            page.assert_called_once()

    def test_prefer_refuses_nothing_and_find_nodes_lists_picks_first(self):
        ai_toolbox.pick(self.task, {"nodes": ["SAMLoader"]}, "prefer")
        self.assertEqual(ai_toolbox.refused(self.task, ["KlingTextToVideo"], INFO), [])
        found = mcp_canvas_edit.find_nodes(self.ctx, query="e")
        self.assertEqual(found["nodes"][0]["type"], "SAMLoader")
        self.assertTrue(found["nodes"][0]["picked_by_user"])
        paid = next(node for node in found["nodes"] if node["type"] == "KlingTextToVideo")
        self.assertEqual((paid["source"], paid.get("paid")), ("api", True))
        self.assertEqual(found["nodes"][-1]["type"], "KlingTextToVideo", "paid nodes last")

    def test_get_toolbox_gives_the_picks_in_full(self):
        self.assertFalse(mcp_task_tools.get_toolbox(self.ctx)["picked"])
        ai_toolbox.pick(self.task, {"nodes": ["FaceDetailer", "Fast Groups Muter (rgthree)"], "models": ["loras:0:gone.safetensors"]}, "only")
        with mock.patch("api.mcp_tools.get_model", side_effect=ToolError("gone")):
            box = mcp_task_tools.get_toolbox(self.ctx)
        self.assertEqual((box["mode"], box["nodes"][0]["type"], box["page_only_nodes"]), ("only", "FaceDetailer", ["Fast Groups Muter (rgthree)"]))
        self.assertTrue(box["models"][0]["missing"])

    def test_the_picker_lists_nodes_by_source(self):
        groups = ai_toolbox.catalog({}, "nodes")["groups"]
        self.assertEqual([group["source"] for group in groups], ["builtin", "ComfyUI-Impact-Pack", "api"])
        self.assertEqual([node["type"] for node in groups[1]["nodes"]], ["FaceDetailer", "SAMLoader"])

    def test_what_is_refused(self):
        for picks, mode in [(None, "prefer"), ({"nodes": "FaceDetailer"}, "prefer"), ({"nodes": [3]}, "prefer"),
                            ({"nodes": ["x" * 400]}, "prefer"), ({"nodes": ["a"] * 0 + [str(i) for i in range(61)]}, "prefer"),
                            ({"nodes": []}, "strict")]:
            with self.assertRaises(ai_toolbox.ToolboxError, msg=(picks, mode)):
                ai_toolbox.pick(self.task, picks, mode)
        with self.assertRaises(ai_toolbox.ToolboxError):
            ai_toolbox.pick("no-task", {}, "prefer")
        with self.assertRaises(ai_toolbox.ToolboxError):
            ai_toolbox.catalog({}, "secrets")


if __name__ == "__main__":
    unittest.main()
