"""What the user lets an AI see of one model (api/ai_model_choice.py): the choice is kept in the model's
own file, a hidden model reaches an AI as a token in any task, its description stays home but for the
paragraphs the user picked, and a model shown by name keeps its name in a private task. Files go to
temporary folders."""
import json
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_model_choice, ai_privacy, ai_sealed, ai_sealed_models, ai_tasks, ai_toolbox_catalog, mcp_tools  # noqa: E402
from api.description_parts import paragraphs  # noqa: E402
from model_identity import USER_INFO_SUFFIX  # noqa: E402
from model_sidecars import find  # noqa: E402
import test_mcp  # noqa: E402,F401  (tasks in a temporary folder)

DESCRIPTION = ("<p>Canarychar from Canaryshow, three outfits.</p><ul><li>Weight 0.8, CFG 5</li>"
               "<li>Put the trigger first</li></ul><p>Thanks &amp; support me<br>on my page</p>")


def safetensors():
    raw = json.dumps({"lora_unet_a.lora_down.weight": {"dtype": "F16", "shape": [4, 4], "data_offsets": [0, 0]}}).encode()
    return struct.pack("<Q", len(raw)) + raw


class ParagraphTests(unittest.TestCase):
    def test_a_description_reads_as_its_paragraphs(self):
        self.assertEqual(paragraphs(DESCRIPTION), ["Canarychar from Canaryshow, three outfits.", "Weight 0.8, CFG 5",
                                                   "Put the trigger first", "Thanks & support me on my page"])
        self.assertEqual(paragraphs("plain first\n\nplain second\n\nplain first"), ["plain first", "plain second"])
        self.assertEqual(paragraphs(""), [])


class ModelChoiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(os.path.realpath(self.temp.name), "loras")
        root.mkdir()
        (root / "canarylora.safetensors").write_bytes(safetensors())
        (root / "canarylora.preview.png").write_bytes(b"cover")
        (root / "canarylora.civitai.info").write_text(json.dumps({
            "name": "v2", "model": {"name": "Canarychar Lora"}, "modelId": 1, "id": 2, "baseModel": "Illustrious",
            "description": DESCRIPTION, "trainedWords": ["canarytrigger"]}), encoding="utf-8")
        self.root = root
        self.model_id = "loras:0:canarylora.safetensors"
        self.library = [{"id": self.model_id, "name": "Canarychar Lora - v2", "file": "canarylora.safetensors"}]
        ai_tasks._tasks, ai_tasks._current = None, {}
        for patch in (
            mock.patch.object(mcp_tools, "resolve_folder_subdir", side_effect=lambda t, i, s: (str(root), str(root / s.strip("/")))),
            mock.patch.object(ai_model_choice, "_path", lambda: os.path.join(self.temp.name, "ai_model_choice.json")),
            mock.patch.object(ai_privacy, "_path", lambda: os.path.join(self.temp.name, "ai_privacy.json")),
            mock.patch.object(ai_sealed_models, "_library", side_effect=lambda: self.library),
            mock.patch.object(mcp_tools, "_image_content", return_value={"type": "image", "data": "", "mimeType": "image/png"}),
            mock.patch.object(ai_toolbox_catalog, "everything", side_effect=lambda fresh=False: {"models": [
                {**model, "ai_name": ai_model_choice.view(model["id"])["name"]} for model in self.library]}),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        self.task = ai_tasks.begin_task("test", "choice", new_task=True)["id"]

    def kept(self):
        """The model's own file of the user's choices, wherever the sidecar setting puts it."""
        return json.loads(Path(find(str(self.root / "canarylora"), USER_INFO_SUFFIX)).read_text(encoding="utf-8"))

    def details(self):
        detail, extra = mcp_tools.get_model(self.model_id, include_cover=True)
        return {"content": [{"type": "text", "text": json.dumps(detail)}, *extra], "structuredContent": detail}

    def test_the_choice_is_kept_in_the_models_own_file(self):
        self.assertFalse(ai_model_choice.chosen())
        before, after, view = ai_model_choice.choose(self.model_id, name="hidden", about=["Weight 0.8, CFG 5", "not in it"])
        self.assertEqual(before, {"ai_name": "", "ai_about": []})
        self.assertEqual(after, {"ai_name": "hidden", "ai_about": ["Weight 0.8, CFG 5"]})
        kept = self.kept()
        self.assertEqual((kept["ai_name"], kept["ai_about"]), ("hidden", ["Weight 0.8, CFG 5"]))
        self.assertEqual(view["picked"], ["Weight 0.8, CFG 5"])
        self.assertEqual(len(view["paragraphs"]), 4)
        self.assertTrue(ai_model_choice.chosen())
        self.assertEqual(ai_model_choice.marks(), {"hidden": [self.model_id], "shown": []})
        ai_model_choice.choose(self.model_id, name="", about=[])
        kept = self.kept()
        self.assertNotIn("ai_name", kept)
        self.assertNotIn("ai_about", kept)
        with self.assertRaises(ValueError):
            ai_model_choice.choose(self.model_id, name="maybe")

    def test_a_hidden_model_is_a_token_in_a_task_that_is_not_private(self):
        ai_model_choice.choose(self.model_id, name="hidden", about=["Weight 0.8, CFG 5"])
        raw = self.details()
        self.assertEqual(len(raw["content"]), 1, "no cover for a hidden model")
        out = ai_privacy.guard(raw, False, self.task)
        dumped = json.dumps(out)
        for secret in ("canarylora", "Canarychar", "Canaryshow", "canarytrigger", "civitai.com"):
            self.assertNotIn(secret, dumped)
        data = out["structuredContent"]
        self.assertRegex(data["model_id"], r"^\[M\d+\]$")
        self.assertEqual((data["type"], data["base_model"]), ("loras", "Illustrious"))
        self.assertEqual(data["about_for_ai"], ["Weight 0.8, CFG 5"])
        self.assertRegex(data["trigger_words"][0], r"^\[P\d+\]$")
        self.assertIn(ai_privacy.MODEL_NOTE, [item.get("text") for item in out["content"]], "a line on what the token is")
        self.assertEqual(ai_sealed.expand(self.task, {"model": data["model_id"], "prompt": data["trigger_words"][0] + ", 1girl"}),
                         {"model": self.model_id, "prompt": "canarytrigger, 1girl"})

    def test_nothing_changes_while_no_model_is_hidden(self):
        raw = self.details()
        self.assertEqual(ai_privacy.guard(raw, False, self.task), raw)
        self.assertIn("Canaryshow", raw["structuredContent"]["description"])
        self.assertEqual(len(raw["content"]), 2, "the cover goes along")

    def test_a_model_shown_by_name_keeps_it_in_a_private_task_but_not_its_description(self):
        ai_privacy.set_private(self.task, True)
        ai_model_choice.choose(self.model_id, name="shown", about=["Put the trigger first"])
        out = ai_privacy.guard(self.details(), True, self.task, {}, "get_model")
        data = out["structuredContent"]
        self.assertEqual(data["model_id"], self.model_id)
        self.assertEqual(data["file"], "canarylora.safetensors")
        self.assertNotIn("description", data)
        self.assertNotIn("Canaryshow", json.dumps(out))
        self.assertEqual(data["about_for_ai"], ["Put the trigger first"])
        self.assertEqual([item for item in out["content"] if item.get("type") == "image"], [], "a private task gets no pictures")

    def test_a_private_tasks_unchosen_model_is_a_token(self):
        ai_privacy.set_private(self.task, True)
        out = ai_privacy.guard(self.details(), True, self.task, {}, "get_model")
        self.assertRegex(out["structuredContent"]["model_id"], r"^\[M\d+\]$")
        self.assertNotIn("Canarychar", json.dumps(out))


if __name__ == "__main__":
    unittest.main()
