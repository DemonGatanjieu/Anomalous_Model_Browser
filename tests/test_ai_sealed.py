"""Prompt text and picture names of a private task as tokens (api/ai_sealed.py): sealed on the way
out of every tool, put back into a call's arguments, the user's prompt box handing the AI tokens
only, the user's own changes told sealed. Canary words stand for what must never reach the AI.
Temporary folders only."""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_panels, ai_privacy, ai_sealed, ai_task_changes, ai_tasks, mcp_apps, mcp_server, mcp_task_tools  # noqa: E402
from test_mcp import rpc  # noqa: E402  (its module keeps tasks and gates in temporary folders)

SETTING = os.path.join(tempfile.mkdtemp(prefix="amb_sealed_"), "ai_privacy.json")
CANARIES = ("canarypos", "canaryneg", "canaryfile", "canarytrigger", "canaryecho")
INFO = {"CLIPTextEncode": {"input": {"required": {"text": ["STRING", {"multiline": True}], "clip": ["CLIP"]}}},
        "KSampler": {"input": {"required": {"sampler_name": [["euler", "dpmpp_2m"]], "steps": ["INT", {}]}}},
        "SaveImage": {"input": {"required": {"filename_prefix": ["STRING", {}]}}}}


def canary_result(arguments=None):
    """A tool's answer holding every kind of thing a private task keeps: a node's text, prompt fields,
    a picture's name, and what the call was given (a tool echoing its arguments)."""
    data = {"nodes": [{"id": 6, "type": "CLIPTextEncode", "settings": {"text": "canarypos, 1girl"}},
                      {"id": 9, "type": "KSampler", "settings": {"sampler_name": "euler", "steps": 20, "control_after_generate": "fixed"}},
                      {"id": 11, "class_type": "SaveImage", "inputs": {"filename_prefix": "canaryfile"}},
                      {"id": 12, "type": "SomePackNode", "settings": {"wildcard": "canarypos again", "model": "flux.safetensors"}}],
            "prompts": [{"name": "kept", "positive": "canarypos", "negative": "canaryneg"}],
            "images": [{"image": "sub/canaryfile_00001_.png"}, {"filename": "canaryfile_00002_.png", "subfolder": ""}],
            "trigger_words": ["canarytrigger"], "echo": json.dumps(arguments or {}), "filled": {"prompt": ["6"]}}
    return {"content": [{"type": "text", "text": json.dumps(data)}], "structuredContent": data, "isError": False}


class SealedTests(unittest.TestCase):
    def setUp(self):
        ai_tasks._tasks, ai_tasks._current = None, {}
        for name in os.listdir(ai_tasks.tasks_dir()):
            os.remove(os.path.join(ai_tasks.tasks_dir(), name))
        if os.path.exists(SETTING):
            os.remove(SETTING)
        for patcher in (mock.patch.object(ai_privacy, "_path", lambda: SETTING),
                        mock.patch.object(mcp_server, "_node_list", return_value=INFO),
                        mock.patch.object(mcp_task_tools, "_canvas_model", return_value={"name": "Anima/K.safetensors", "params": 2_100_000_000})):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.task = ai_tasks.begin_task("test", "private", new_task=True)["id"]
        ai_privacy.set_private(self.task, True)

    def test_a_text_is_one_token_and_comes_back(self):
        seals = ai_sealed.Seals(self.task)
        token = seals.seal("canarypos, 1girl")
        self.assertEqual(token, "[P1]")
        self.assertEqual(seals.seal("canarypos, 1girl"), token)
        self.assertEqual(seals.seal("sub/a.png", "img"), "[img1]")
        seals.save()
        self.assertEqual(ai_sealed.expand(self.task, {"prompt": "[P1], masterpiece", "image": "[img1]", "x": ["[P9]", 3]}),
                         {"prompt": "canarypos, 1girl, masterpiece", "image": "sub/a.png", "x": ["[P9]", 3]})

    def test_mask_keeps_models_numbers_and_choices(self):
        result = ai_sealed.mask(canary_result(), self.task, INFO, "get_model")
        text = json.dumps(result)
        self.assertFalse([word for word in CANARIES if word in text], text)
        nodes = result["structuredContent"]["nodes"]
        self.assertEqual(nodes[1]["settings"], {"sampler_name": "euler", "steps": 20, "control_after_generate": "fixed"},
                         "a choice, a number and the page's own setting stay")
        self.assertEqual(nodes[3]["settings"]["model"], "flux.safetensors", "a model file stays")
        self.assertRegex(nodes[0]["settings"]["text"], r"^\[P\d+\]$")
        self.assertEqual(json.loads(result["content"][0]["text"]), result["structuredContent"], "the text says the same")
        self.assertEqual(result["structuredContent"]["filled"], {"prompt": ["6"]}, "a node id is no prompt")

    def test_no_tool_lets_a_prompt_or_a_picture_name_through(self):
        def answer(tools, name, arguments, ctx=None):
            return canary_result(arguments)
        with mock.patch.object(mcp_server, "call_tool", side_effect=answer), \
                mock.patch.object(mcp_server.ai_gates, "check", return_value=None), \
                mock.patch.object(mcp_server.ai_task_runs, "watch"), \
                mock.patch.object(mcp_server.ai_run_tracking, "wait_for_receipt"):
            for name in mcp_server.TOOLS:
                with self.subTest(tool=name):
                    text = json.dumps(rpc("tools/call", {"name": name, "arguments": {"task": self.task}}, name))
                    self.assertFalse([word for word in CANARIES if word in text], f"{name}: {text[:300]}")
            ai_privacy.set_private(self.task, False)
            text = json.dumps(rpc("tools/call", {"name": "describe_canvas", "arguments": {"task": self.task}}, "describe_canvas"))
            self.assertIn("canarypos", text, "a task that is not private sees it all")

    def test_the_prompt_box_gives_the_ai_tokens_and_the_tool_the_texts(self):
        shown = rpc("tools/call", {"name": "show_panel", "arguments": {"task": self.task, "title": "Prompts", "blocks": [
            {"type": "prompts", "id": "p", "question": "What to draw?", "count": 2, "negative": True, "pictures": True}]}}, "show_panel")
        panel = shown["result"]["structuredContent"]["panel"]
        task, step = ai_panels._find(panel)
        self.assertIn("2.1B", step["prompt_advice"]["zh"], "the box says what suits the canvas's model")
        with self.assertRaises(ai_panels.PanelError):  # typed anywhere but the box (the card in the AI app)
            ai_panels.answer(self.task, step["id"], "p", text="canarypos")
        self.assertFalse(mcp_apps._questions(step), "the card leaves the box to Anomalous")
        extra = ai_sealed.seal_answer(self.task, ["canarypos, 1girl", "canaryecho"], "canaryneg",
                                      [{"filename": "canaryfile_00001_.png", "subfolder": "ai_inbox"}])
        ai_panels.answer(self.task, step["id"], "p", text=extra["text"], extra=extra)
        got = rpc("tools/call", {"name": "get_answers", "arguments": {"task": self.task}}, "get_answers")["result"]["structuredContent"]
        given = got["answers"][0]
        self.assertEqual((given["prompts"], given["negative"], given["pictures"]), (["[P1]", "[P2]"], "[P3]", ["[img1]"]))
        self.assertFalse([word for word in CANARIES if word in json.dumps(got)])
        seen = []
        with mock.patch.object(mcp_server, "call_tool", side_effect=lambda tools, name, arguments, ctx=None: seen.append(arguments) or canary_result(arguments)), \
                mock.patch.object(mcp_server.ai_gates, "check", return_value=None):
            result = rpc("tools/call", {"name": "set_prompt", "arguments": {"task": self.task, "prompt": "[P1], masterpiece"}}, "set_prompt")
        self.assertEqual(seen[0]["prompt"], "canarypos, 1girl, masterpiece", "the tool gets the text")
        self.assertNotIn("canary", json.dumps(result), "its echo goes back as tokens")
        record = ai_tasks.get_task(self.task)
        self.assertNotIn("canarypos", json.dumps([(s.get("summary"), s.get("text")) for s in record["steps"]]), "the record keeps tokens")

    def test_the_users_changes_are_told_sealed(self):
        ai_tasks.record("test", "describe_canvas", {}, {"structuredContent": {}, "content": []}, time.time(), True, task_id=self.task)
        entry = {"id": "e1", "time": time.time(), "source": "canvas", "action": "canvas",
                 "detail": {"changes": [{"kind": "changed", "node": "Positive", "widget": "text", "before": "old words", "after": "canarypos"},
                                        {"kind": "changed", "node": "Loader", "widget": "unet_name", "before": "a.safetensors", "after": "b.safetensors"}]}}
        with mock.patch.object(ai_task_changes.activity_log, "tag"):
            step = ai_task_changes.note_activity(entry)
        self.assertNotIn("canarypos", step["text"])
        self.assertIn("a.safetensors -> b.safetensors", step["text"], "the models it may know")

    def test_a_private_task_gets_its_own_skill_only(self):
        from api import ai_skills
        self.assertNotIn("privacy", ai_skills.directory())
        ctx = {"client": "test", "task": self.task}
        self.assertIn("prompts", " ".join(mcp_task_tools.get_toolbox(ctx, skill="privacy")["advice"]))
        with self.assertRaisesRegex(mcp_task_tools.ToolError, "privacy"):
            mcp_task_tools.get_toolbox(ctx, skill="prompt_pose")
        ai_privacy.set_private(self.task, False)
        with self.assertRaises(mcp_task_tools.ToolError):
            mcp_task_tools.get_toolbox(ctx, skill="privacy")
        self.assertIn("advice", mcp_task_tools.get_toolbox(ctx, skill="prompt_pose"))
        ai_privacy.set_private(self.task, True)
        self.assertEqual(mcp_task_tools.begin_task({"client": "test", "task": self.task}, "private")["privacy"], ai_privacy.NOTE)


if __name__ == "__main__":
    unittest.main()
