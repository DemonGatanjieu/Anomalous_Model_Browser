"""Per-task & per-model privacy overrides, prompt splitting, retroactive phrase sealing,
legacy token expansion compatibility, and route validation (api/ai_sealed_adjust.py)."""

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

from api import ai_gates, ai_privacy, ai_sealed, ai_sealed_adjust, ai_sealed_models, ai_sealed_notes, ai_tasks, ai_tasks_routes, mcp_server, mcp_situation, mcp_task_tools  # noqa: E402
from test_mcp import rpc  # noqa: E402

SETTING = os.path.join(tempfile.mkdtemp(prefix="amb_priv_adj_"), "ai_privacy.json")
CHECKPOINT = "checkpoints:0:Anima/animaTurbo.safetensors"
LORA = "loras:0:secretfolder/nsfw_pose_v2.safetensors"
LIBRARY = [
    {"id": CHECKPOINT, "name": "Anima Turbo", "file": "animaTurbo.safetensors"},
    {"id": LORA, "name": "NSFW Pose Lora", "file": "nsfw_pose_v2.safetensors"},
]


class _FakeRequest:
    def __init__(self, task_id, payload):
        self.match_info = {"task_id": task_id}
        self._payload = payload

    async def json(self):
        return self._payload


class PrivacyAdjustTests(unittest.TestCase):
    def setUp(self):
        ai_tasks._tasks, ai_tasks._current = None, {}
        for name in os.listdir(ai_tasks.tasks_dir()):
            os.remove(os.path.join(ai_tasks.tasks_dir(), name))
        if os.path.exists(SETTING):
            os.remove(SETTING)
        for patcher in (
            mock.patch.object(ai_privacy, "_path", lambda: SETTING),
            mock.patch.object(ai_sealed_models, "_library", return_value=LIBRARY),
            mock.patch.object(ai_gates, "check", return_value=None),
            mock.patch.object(mcp_server, "_node_list", return_value={}),
            mock.patch.object(mcp_situation, "_canvas", return_value={"node_count": 0}),
            mock.patch.object(mcp_task_tools, "_node_list", return_value={}),
            mock.patch.object(mcp_task_tools, "_canvas_model", return_value=None),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.task = ai_tasks.begin_task("test", "two girls hug", new_task=True)["id"]
        ai_privacy.set_private(self.task, True)

    def test_per_model_exposure_and_legacy_token_expand(self):
        seals = ai_sealed.Seals(self.task)
        m_ckpt = seals.seal(CHECKPOINT, "M")
        m_lora = seals.seal(LORA, "M")
        seals.save()

        # Expose checkpoint to AI while keeping LoRA sealed
        snap = ai_sealed_adjust.apply_rule(self.task, {"action": "model_rule", "model_id": CHECKPOINT, "hidden": False})
        self.assertIn(CHECKPOINT, snap["public_models"])
        self.assertNotIn(m_ckpt, snap["sealed"])
        self.assertEqual(snap["sealed_legacy"][m_ckpt], CHECKPOINT)
        self.assertEqual(snap["sealed"][m_lora], LORA)

        # Previous token m_ckpt STILL expands cleanly if AI uses cached token
        self.assertEqual(ai_sealed.expand(self.task, {"model": m_ckpt}), {"model": CHECKPOINT})

        # Outgoing MCP mask leaves public checkpoint unmasked while masking private LoRA
        raw = {
            "content": [{"type": "text", "text": json.dumps({"ckpt": "animaTurbo.safetensors", "lora": "nsfw_pose_v2.safetensors"})}],
            "structuredContent": {"models": [
                {"model_id": CHECKPOINT, "name": "Anima Turbo", "file": "animaTurbo.safetensors"},
                {"model_id": LORA, "name": "NSFW Pose Lora", "file": "nsfw_pose_v2.safetensors"},
            ]},
            "isError": False,
        }
        guarded = ai_privacy.guard(raw, True, self.task, {}, "search_models")
        text = json.dumps(guarded)
        self.assertIn("animaTurbo.safetensors", text)
        self.assertNotIn("nsfw_pose_v2", text)
        self.assertNotIn("NSFW Pose Lora", text)
        self.assertIn(m_lora, text)

        # Flip task default off, yet private_models override still keeps explicit LoRA hidden!
        ai_sealed_adjust.apply_rule(self.task, {"action": "model_rule", "privacy_models": False})
        ai_sealed_adjust.apply_rule(self.task, {"action": "model_rule", "model_id": LORA, "hidden": True})
        raw2 = {
            "content": [{"type": "text", "text": json.dumps({"ckpt": "animaTurbo.safetensors", "lora": "nsfw_pose_v2.safetensors"})}],
            "structuredContent": {"ckpt": "animaTurbo.safetensors", "lora": LORA},
            "isError": False,
        }
        guarded2 = ai_privacy.guard(raw2, True, self.task, {}, "search_models")
        text2 = json.dumps(guarded2)
        self.assertIn("animaTurbo.safetensors", text2)
        self.assertNotIn("nsfw_pose_v2", text2)
        self.assertIn(m_lora, text2)

    def test_split_prompt_migrates_note_preserves_legacy_and_notifies_ai(self):
        seals = ai_sealed.Seals(self.task)
        p1 = seals.seal("canarysecret, swimsuit, ocean, sunset")
        seals.save()
        ai_sealed_notes.set_notes(self.task, {p1: "keep hug main prompt"})

        # Clear any initial pending messages first
        rpc("tools/call", {"name": "get_situation", "arguments": {"task": self.task}}, "get_situation")

        snap = ai_sealed_adjust.apply_rule(self.task, {
            "action": "split_prompt",
            "token": p1,
            "keep_text": "canarysecret, swimsuit",
            "expose_text": "ocean, sunset",
        })
        self.assertNotIn(p1, snap["sealed"])
        self.assertEqual(snap["sealed_legacy"][p1], "canarysecret, swimsuit, ocean, sunset")
        self.assertIn("[P2]", snap["sealed"])
        self.assertEqual(snap["sealed"]["[P2]"], "canarysecret, swimsuit")
        self.assertEqual(snap["sealed_notes"]["[P2]"], "keep hug main prompt")
        self.assertEqual(snap["exposed_prompts"][-1]["text"], "ocean, sunset")

        # Old token p1 still expands while new token p2 expands to kept subset
        self.assertEqual(ai_sealed.expand(self.task, {"a": p1, "b": "[P2]"}),
                         {"a": "canarysecret, swimsuit, ocean, sunset", "b": "canarysecret, swimsuit"})

        # Next MCP call delivers kind=privacy_adjust once with exposed text, never leaking kept secret!
        res = rpc("tools/call", {"name": "list_voices", "arguments": {}}, "list_voices")["result"]
        raw = json.dumps(res)
        self.assertNotIn("canarysecret", raw)
        self.assertIn("ocean, sunset", raw)
        msgs = res["structuredContent"].get("user_messages") or []
        adj = [m for m in msgs if m.get("kind") == "privacy_adjust"]
        self.assertEqual(len(adj), 1)

        # Next call does not duplicate
        res2 = rpc("tools/call", {"name": "list_voices", "arguments": {}}, "list_voices")["result"]
        self.assertFalse([m for m in (res2["structuredContent"].get("user_messages") or []) if m.get("kind") == "privacy_adjust"])

    def test_seal_message_phrase_and_route(self):
        res = asyncio.run(ai_tasks_routes.api_privacy_rules(_FakeRequest(self.task, {
            "action": "seal_message_phrase",
            "phrase": "secretphrase",
        })))
        self.assertEqual(res.status, 200)
        body = json.loads(res.text)
        self.assertEqual(body["sealed"].get("[P1]"), "secretphrase")


if __name__ == "__main__":
    unittest.main()
