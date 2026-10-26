"""What Anomalous tells the AI about using a model well (api/model_advice.py): the settings of the
author's example pictures in get_model, and the note when add_lora or set_model puts a LoRA on a
main model of another base model."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import mcp_actions, model_advice  # noqa: E402

SHA = "abcdef0123" + "0" * 54


def pictures(*metas):
    return {"id": 77, "baseModel": "Illustrious", "images": [{"url": "x", "meta": meta} for meta in metas] + [{"url": "y", "meta": None}]}


class ExampleTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp(prefix="amb_advice_")
        self.model = os.path.join(self.folder, "glow_style.safetensors")
        Path(self.model).write_bytes(b"x")

    def keep(self, record):
        Path(self.folder, "glow_style.civitai.info").write_text(json.dumps(record), encoding="utf-8")

    def test_the_authors_settings_summed_up(self):
        self.keep(pictures(
            {"sampler": "Euler a", "steps": 28, "cfgScale": 5, "Size": "832x1216", "Clip skip": "2",
             "resources": [{"type": "lora", "name": "glow_style", "hash": "ABCDEF0123", "weight": 0.8}]},
            {"sampler": "Euler a", "steps": "30", "cfgScale": 6, "width": 832, "height": 1216, "clipSkip": 2,
             "additionalResources": [{"type": "lora", "name": "loras/glow_style.safetensors", "strength": 0.6}]},
            {"sampler": "DPM++ 2M", "scheduler": "karras", "steps": 25, "cfgScale": 5, "Size": "1024x1024",
             "civitaiResources": [{"type": "lora", "modelVersionId": 77, "weight": 1}]},
        ))
        found = model_advice.author_examples(self.model, "loras", SHA)
        self.assertEqual(found["pictures"], 3, "pictures without settings are left out")
        self.assertEqual(found["sampler"], "Euler a (2 of 3)")
        self.assertEqual(found["steps"], "25–30")
        self.assertEqual(found["cfg"], "5–6")
        self.assertEqual(found["size"], "832x1216 (2 of 3)")
        self.assertEqual(found["clip_skip"], "2")
        self.assertEqual(found["lora_weight"], "0.6–1", "by hash, by file name and by Civitai version")
        self.assertEqual(found["scheduler"], "karras (1 of 3)", "counted against all the pictures")

    def test_the_lora_most_pictures_name_is_this_one(self):
        lora = lambda name, weight: {"type": "lora", "name": name, "weight": weight}
        self.keep(pictures(
            {"sampler": "Undefined", "resources": [lora("authors_own_name", 0.7), lora("other_style", 1)]},
            {"resources": [lora("authors_own_name", 0.9)]},
            {"resources": [lora("authors_own_name", 0.8), lora("third", 1)]},
        ))
        found = model_advice.author_examples(self.model, "loras")
        self.assertEqual(found["lora_weight"], "0.7–0.9", "named in every picture: the author's name for this file")
        self.assertNotIn("sampler", found, "Civitai's 'Undefined' is no sampler")
        self.keep(pictures({"resources": [lora("a", 0.5), lora("b", 1)]}, {"resources": [lora("a", 0.5), lora("b", 1)]}))
        self.assertNotIn("lora_weight", model_advice.author_examples(self.model, "loras"), "two named as often: no guess")

    def test_nothing_kept_says_nothing(self):
        self.assertEqual(model_advice.author_examples(self.model, "loras"), {})
        self.keep(pictures())
        self.assertEqual(model_advice.author_examples(self.model, "checkpoints"), {})

    def test_a_checkpoint_has_no_weight(self):
        self.keep(pictures({"sampler": "Euler", "steps": 20}))
        self.assertNotIn("lora_weight", model_advice.author_examples(self.model, "checkpoints"))


class BaseModelTests(unittest.TestCase):
    def bases(self, **by_path):
        get = mock.patch.object(model_advice.metadata, "get_metadata", side_effect=lambda path: {"baseModel": by_path.get(path, "")})
        full = mock.patch.object(model_advice.folder_paths, "get_full_path",
                                 side_effect=lambda kind, name: name if kind in ("checkpoints", "loras") and name in by_path else None)
        for patcher in (get, full):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_families(self):
        self.assertEqual(model_advice.family("SDXL 1.0"), model_advice.family("Pony"))
        self.assertEqual(model_advice.family("Illustrious"), "SDXL")
        self.assertEqual(model_advice.family("SD 1.5"), "SD 1.x")
        self.assertEqual(model_advice.family("Flux.1 D"), model_advice.family("Chroma"))
        self.assertEqual(model_advice.family("Other"), "")

    def test_another_family_will_not_work(self):
        self.bases(lora="SD 1.5", main="SDXL 1.0")
        note = model_advice.lora_note("lora", {"model": "main"})
        self.assertIn("clash", note)
        self.assertIn("base_model='SDXL 1.0'", note)

    def test_a_branch_of_the_same_family_may_look_off(self):
        self.bases(lora="Pony", main="Illustrious")
        self.assertIn("same family", model_advice.lora_note("lora", {"model": "main"}))

    def test_the_same_base_or_an_unknown_one_says_nothing(self):
        self.bases(lora="SDXL 1.0", main="sdxl 1.0", plain="", flux_d="Flux.1 D", flux_s="Flux.1 S")
        self.assertIsNone(model_advice.lora_note("lora", {"model": "main"}))
        self.assertIsNone(model_advice.lora_note("plain", {"model": "main"}))
        self.assertIsNone(model_advice.lora_note("lora", {"model": "not_there"}))
        self.assertIsNone(model_advice.lora_note("flux_d", {"model": "flux_s"}))

    def test_add_lora_and_set_model_answer_with_the_note(self):
        self.bases(**{"old.safetensors": "SD 1.5", "main.safetensors": "SDXL 1.0"})
        line = {"model": "main.safetensors", "loras": ["old.safetensors"]}
        with mock.patch.object(mcp_actions, "_resolve_model", return_value=("loras", 0, "", "old.safetensors")), \
                mock.patch.object(mcp_actions, "trains_text_encoder", return_value=False), \
                mock.patch.object(mcp_actions, "_page", return_value={"node_id": 9, "line": line}):
            answer = mcp_actions.add_lora({}, "m")
        self.assertIn("clash", answer["base_model_note"])
        self.assertNotIn("line", answer, "the line is the server's, not the AI's")
        with mock.patch.object(mcp_actions, "_resolve_model", return_value=("checkpoints", 0, "", "main.safetensors")), \
                mock.patch.object(mcp_actions, "_page", return_value={"node_id": 4, "line": dict(line)}):
            answer = mcp_actions.set_model({}, 4, "m")
        self.assertIn("clash", answer["base_model_note"], "a new main model is checked against the LoRAs after it")


if __name__ == "__main__":
    unittest.main()
