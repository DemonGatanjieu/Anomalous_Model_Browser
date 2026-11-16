"""Per-token sealed notes (api/ai_sealed_notes.py): validation, persistence, AI delivery in
begin_task / get_situation / attach_pending / get_answers, and canary masking under ai_privacy.guard."""

import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_gates, ai_panels, ai_privacy, ai_sealed, ai_sealed_models, ai_sealed_notes, ai_tasks, ai_tasks_routes, mcp_server, mcp_situation, mcp_task_tools  # noqa: E402
from test_mcp import rpc  # noqa: E402

SETTING = os.path.join(tempfile.mkdtemp(prefix="amb_notes_"), "ai_privacy.json")


class _FakeRequest:
    def __init__(self, task_id, payload):
        self.match_info = {"task_id": task_id}
        self._payload = payload

    async def json(self):
        return self._payload


class SealedNotesTests(unittest.TestCase):
    def setUp(self):
        ai_tasks._tasks, ai_tasks._current = None, {}
        for name in os.listdir(ai_tasks.tasks_dir()):
            os.remove(os.path.join(ai_tasks.tasks_dir(), name))
        if os.path.exists(SETTING):
            os.remove(SETTING)
        for patcher in (
            mock.patch.object(ai_privacy, "_path", lambda: SETTING),
            mock.patch.object(ai_sealed_models, "_library", return_value=[]),
            mock.patch.object(ai_gates, "check", return_value=None),
            mock.patch.object(mcp_server, "_node_list", return_value={}),
            mock.patch.object(mcp_situation, "_canvas", return_value={"node_count": 0}),
            mock.patch.object(mcp_task_tools, "_node_list", return_value={}),
            mock.patch.object(mcp_task_tools, "_canvas_model", return_value=None),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.task = ai_tasks.begin_task("test", "hug girls", new_task=True)["id"]
        ai_privacy.set_private(self.task, True)
        seals = ai_sealed.Seals(self.task)
        self.p1 = seals.seal("canarysecret, two girls, swimsuit")
        self.img1 = seals.seal("ai_inbox/ref_pose.png", "img")
        seals.save()

    def test_validation_merge_and_clear(self):
        saved = ai_sealed_notes.set_notes(self.task, {self.p1: "  main positive   hug  "})
        self.assertEqual(saved, {self.p1: "main positive hug"})

        saved2 = ai_sealed_notes.set_notes(self.task, {self.img1: "pose ref only"})
        self.assertEqual(saved2, {self.p1: "main positive hug", self.img1: "pose ref only"})

        cleared = ai_sealed_notes.set_notes(self.task, {self.p1: "   "})
        self.assertEqual(cleared, {self.img1: "pose ref only"})

        with self.assertRaises(ValueError):
            ai_sealed_notes.set_notes(self.task, {"[P99]": "does not exist"})
        with self.assertRaises(ValueError):
            ai_sealed_notes.set_notes(self.task, {"bad": "token"})
        with self.assertRaises(LookupError):
            ai_sealed_notes.set_notes("missing_task", {self.p1: "x"})

    def test_begin_task_and_get_situation_deliver_and_clear_dirty(self):
        ai_sealed_notes.set_notes(self.task, {self.p1: "keep hug pose, main positive"})

        # begin_task returns sealed_notes and clears dirty (no duplicate kind=sealed_notes message)
        res0 = rpc("tools/call", {"name": "begin_task", "arguments": {"title": "hug girls"}}, "begin_task")["result"]
        data0 = res0["structuredContent"]
        self.assertEqual(data0["sealed_notes"], {self.p1: "keep hug pose, main positive"})
        self.assertFalse([m for m in data0.get("user_messages") or [] if m.get("kind") == "sealed_notes"])

        # get_situation returns sealed_notes without dirty spam
        res = rpc("tools/call", {"name": "get_situation", "arguments": {"task": self.task}}, "get_situation")["result"]
        data = res["structuredContent"]
        self.assertEqual(data["task"]["sealed_notes"], {self.p1: "keep hug pose, main positive"})
        self.assertFalse([m for m in data.get("user_messages") or [] if m.get("kind") == "sealed_notes"])

        # Next call without edits does not attach sealed_notes messages
        res2 = rpc("tools/call", {"name": "get_answers", "arguments": {"task": self.task, "wait_seconds": 0}}, "get_answers")["result"]
        self.assertNotIn("messages", res2["structuredContent"])

    def test_mid_task_edit_delivered_once_and_masks_canary(self):
        rpc("tools/call", {"name": "get_situation", "arguments": {"task": self.task}}, "get_situation")

        # User edits a note later and accidentally includes the sealed secret string
        ai_sealed_notes.set_notes(self.task, {self.img1: "use pose like canarysecret, two girls, swimsuit"})

        # Delivered once in user_messages on next tool call, with canary text automatically sealed by guard!
        res = rpc("tools/call", {"name": "get_answers", "arguments": {"task": self.task, "wait_seconds": 0}}, "get_answers")["result"]
        raw_text = json.dumps(res)
        self.assertNotIn("canarysecret", raw_text)
        msgs = res["structuredContent"].get("messages") or []
        note_msgs = [m for m in msgs if m.get("kind") == "sealed_notes"]
        self.assertEqual(len(note_msgs), 1)
        self.assertIn("[P1]", note_msgs[0]["notes"][self.img1])

        # Also works via attach_pending on any regular tool call when edited again
        ai_sealed_notes.set_notes(self.task, {self.p1: "new hint"})
        res_tool = rpc("tools/call", {"name": "list_voices", "arguments": {}}, "list_voices")["result"]
        msgs2 = res_tool["structuredContent"].get("user_messages") or []
        self.assertEqual(len([m for m in msgs2 if m.get("kind") == "sealed_notes"]), 1)

        # Does not repeat on subsequent call
        res_next = rpc("tools/call", {"name": "list_voices", "arguments": {}}, "list_voices")["result"]
        self.assertNotIn("user_messages", res_next["structuredContent"])

    def test_route_saves_notes_and_wakes_panel_wait(self):
        res = asyncio.run(ai_tasks_routes.api_sealed_notes(_FakeRequest(self.task, {"notes": {self.p1: "front pose"}})))
        self.assertEqual(res.status, 200)
        body = json.loads(res.text)
        self.assertEqual(body["sealed_notes"], {self.p1: "front pose"})
        task = ai_tasks.get_task(self.task)
        self.assertEqual(task.get("sealed_notes"), {self.p1: "front pose"})


if __name__ == "__main__":
    unittest.main()
