"""What a message's "@" point at (ai_message_refs.py): checked when it is left, given to the AI
with the message, each thing in full or marked missing, pictures attached with what made them."""
import unittest
from unittest import mock

from test_ai_tasks import OUTPUT, isolate, ok
from test_ai_run_map import lora_workflow, picture
from api import ai_message_refs, ai_panels, ai_tasks
from api.mcp_tools import ToolError


class RefsTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.task = ai_tasks.begin_task("A", "Refs")["id"]
        patcher = mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_what_the_at_points_at_reaches_the_ai_in_full(self):
        combo = {"name": "水彩风景", "model": "a.safetensors", "prompt": "watercolor"}
        refs = [{"kind": "combos", "id": "水彩风景", "label": "水彩风景"}, {"kind": "combos", "id": "水彩风景"},
                {"kind": "models", "id": "loras:0:gone.safetensors", "label": "gone"},
                {"kind": "pictures", "id": picture("ref.png", lora_workflow()), "label": "ref.png"},
                {"kind": "nodes", "id": "KSampler", "label": "K采样器"}]
        step = ai_panels.leave_message(self.task, "用 @水彩风景 的感觉重画 @ref.png", refs)
        self.assertEqual(len(step["refs"]), 4, "each thing once")
        with mock.patch("api.mcp_tools.list_combos", return_value={"combos": [combo]}), \
                mock.patch("api.mcp_tools.get_model", side_effect=ToolError("gone")):
            result = ai_panels.attach_pending(ok({}), "A", task_id=self.task)
        message = result["structuredContent"]["user_messages"][0]
        by_kind = {item["kind"]: item for item in message["refs"]}
        self.assertEqual(by_kind["combos"]["details"], combo)
        self.assertEqual(by_kind["combos"]["said_as"], "@水彩风景")
        self.assertTrue(by_kind["models"]["missing"])
        self.assertEqual(by_kind["pictures"]["made_with"]["models"], ["Kirazuri_v4"])
        self.assertIn("find_nodes", by_kind["nodes"]["note"])
        self.assertEqual(sum(1 for item in result["content"] if item.get("type") == "image"), 1, "the picture itself goes along")
        self.assertNotIn("_pictures", message)

    def test_a_deleted_picture_is_marked_gone_and_the_ai_told_plainly(self):
        import os
        from api import ai_pictures, ai_task_changes
        name = picture("bye.png")
        ai_pictures.hand(self.task, [name, picture("stay.png")])
        os.remove(os.path.join(OUTPUT, name))
        marked = ai_pictures.mark_gone(ai_tasks.get_task(self.task))
        results = marked["steps"][-1]["results"]
        self.assertEqual([item.get("gone", False) for item in results], [True, False])
        self.assertNotIn("gone", ai_tasks.get_task(self.task)["steps"][-1]["results"][0], "only the page's copy is marked")
        words = ai_task_changes._change_text({"action": "image_delete", "target": "bye.png", "source": "gallery"})
        self.assertIn("do not use, show or hand it in again", words)

    def test_a_plain_message_has_no_refs_and_bad_refs_are_refused(self):
        self.assertNotIn("refs", ai_panels.leave_message(self.task, "继续"))
        for refs in ("x", [{"kind": "files", "id": "a"}], [{"kind": "models", "id": ""}], [{"kind": "nodes", "id": str(n)} for n in range(13)]):
            with self.assertRaises(ai_panels.PanelError, msg=refs):
                ai_panels.leave_message(self.task, "看这个", refs)
        self.assertEqual(ai_message_refs.clean(None), [])


if __name__ == "__main__":
    unittest.main()
