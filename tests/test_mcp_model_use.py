"""What loads a model, for the AI (api/mcp_model_use.py): a model patch filed under ControlNet is
said to belong in model_patches, move_model puts it there, and a copy already there is never
overwritten. Files go to temporary folders."""
import json
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import mcp_canvas_edit, mcp_model_use, mcp_tools, model_placement  # noqa: E402

CTX = {"base_url": "http://127.0.0.1:1"}


def safetensors(*names):
    raw = json.dumps({name: {"dtype": "F16", "shape": [4, 4], "data_offsets": [0, 0]} for name in names}).encode()
    return struct.pack("<Q", len(raw)) + raw


LLLITE = safetensors("lllite_conditioning1.conv1.weight", "lllite_modules.0.down.weight")
CONTROL = safetensors("control_model.input_hint_block.0.weight", "control_model.zero_convs.0.0.weight")


class ModelUseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = os.path.realpath(self.temp.name)
        self.roots = {kind: [os.path.join(base, kind)] for kind in ("controlnet", "model_patches")}
        for paths in self.roots.values():
            os.makedirs(paths[0])
        listing = lambda kind: sorted(os.path.relpath(os.path.join(d, f), self.roots[kind][0]) for d, _, names in os.walk(self.roots[kind][0]) for f in names)
        info = lambda ctx: {"ControlNetLoader": {"input": {"required": {"control_net_name": [listing("controlnet")]}}},
                            "ModelPatchLoader": {"input": {"required": {"name": [listing("model_patches")]}}}}
        for patch in (
            mock.patch.object(model_placement.folder_paths, "folder_names_and_paths", {k: (v, set()) for k, v in self.roots.items()}),
            mock.patch.object(model_placement.folder_paths, "get_folder_paths", side_effect=lambda t: self.roots.get(t, [])),
            mock.patch("api.model_import.folder_paths.get_folder_paths", side_effect=lambda t: self.roots.get(t, [])),
            mock.patch.object(mcp_model_use.folder_paths, "get_filename_list", side_effect=listing),
            mock.patch.object(mcp_tools, "resolve_folder_subdir",
                              side_effect=lambda t, i, s: (self.roots[t][0], os.path.join(self.roots[t][0], s.strip("/")))),
            mock.patch.object(mcp_canvas_edit, "object_info", side_effect=info),
            mock.patch.object(model_placement, "add_entry"),
            mock.patch.object(model_placement, "forget_file_lists"),
            mock.patch.object(model_placement, "get_metadata", return_value={}),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        model_placement._heads.clear()
        self.addCleanup(self.temp.cleanup)

    def put(self, kind, name, data):
        Path(self.roots[kind][0], name).write_bytes(data)
        return f"{kind}:0:{name}"

    def about(self, model_id):
        return mcp_model_use._about(CTX, {"model_id": model_id})

    def test_a_loras_author_weight_comes_with_the_search(self):
        found = {"total_matches": 2, "models": [{"model_id": "loras:0:a.safetensors", "type": "loras"},
                                                {"model_id": "checkpoints:0:b.safetensors", "type": "checkpoints"}]}
        with mock.patch.object(mcp_tools, "search_models", return_value=found), \
                mock.patch.object(mcp_model_use, "_about", side_effect=lambda ctx, model: model), \
                mock.patch.object(mcp_tools, "_resolve_model", return_value=("loras", 0, "/m", "/m/a.safetensors")), \
                mock.patch.object(mcp_tools, "get_metadata", return_value={"hash": "abc"}), \
                mock.patch.object(mcp_model_use.model_advice, "author_examples", return_value={"lora_weight": "0.7-0.8"}) as examples:
            got = mcp_model_use.search_models(CTX, "a")
        self.assertEqual(got["models"][0]["author_weight"], "0.7-0.8")
        self.assertNotIn("author_weight", got["models"][1], "only a LoRA has one")
        examples.assert_called_once_with("/m/a.safetensors", "loras", "abc")

    def test_the_search_answer_stays_readable(self):
        lora = lambda at: {"model_id": f"loras:0:style/l{at}.safetensors", "name": f"Style {at}", "file": f"l{at}.safetensors",  # noqa: E731
                           "type": "loras", "folder": "style", "base_model": "Illustrious",
                           "trigger_words": [f"word{n}" for n in range(9)], "loaded_by": ["LoraLoader"]}
        models = [lora(at) for at in range(40)]
        models.append({"model_id": "loras:0:wrong.safetensors", "name": "Wrong", "file": "wrong.safetensors", "type": "loras",
                       "folder": "", "belongs_in": "model_patches", "placement": "moves"})
        got = mcp_model_use._compact({"total_matches": 41, "models": models})
        self.assertLessEqual(mcp_model_use.mcp_fit.size(got), mcp_model_use.mcp_fit.BUDGET)
        self.assertNotIn("loaded_by", got, "a misfiled one shares no loader")
        self.assertEqual(got["models"][0]["loaded_by"], ["LoraLoader"])
        self.assertIn("named in more_names", got["left_out"])
        self.assertEqual(len(got["more_names"]) + len(got["models"]), 41, "every model is there, the rest by name")
        self.assertEqual(got["more_names"][-1], "Wrong")
        self.assertEqual((got["models"][0]["trigger_words"], got["models"][0]["more_trigger_words"]), (["word0", "word1", "word2", "word3"], 5))
        self.assertFalse({"file", "folder", "type"} & set(got["models"][0]), "the model_id says them")
        shared = mcp_model_use._compact({"total_matches": 2, "models": [lora(0), lora(1)]})
        self.assertEqual((shared["loaded_by"], "loaded_by" in shared["models"][0]), ({"loras": ["LoraLoader"]}, False), "said once")

    def test_a_misfiled_patch_is_said_to_belong_elsewhere_and_moves_there(self):
        self.put("controlnet", "depth.safetensors", CONTROL)
        patch = self.put("controlnet", "anima-lllite-depth.safetensors", LLLITE)
        self.assertEqual(self.about("controlnet:0:depth.safetensors")["loaded_by"], ["ControlNetLoader"])
        misfiled = self.about(patch)
        self.assertEqual(misfiled["belongs_in"], "model_patches")
        self.assertNotIn("loaded_by", misfiled)  # listed by the ControlNet loader, which cannot read it
        self.assertIn("move_model", misfiled["placement"])
        moved = mcp_model_use.move_model(CTX, patch, "model_patches")
        self.assertEqual(moved["model_id"], "model_patches:0:anima-lllite-depth.safetensors")
        self.assertEqual(moved["loaded_by"], ["ModelPatchLoader"])
        self.assertTrue(Path(self.roots["model_patches"][0], "anima-lllite-depth.safetensors").is_file())
        self.assertFalse(Path(self.roots["controlnet"][0], "anima-lllite-depth.safetensors").exists())
        with self.assertRaises(mcp_tools.ToolError):  # where it belongs now: nothing to move
            mcp_model_use.move_model(CTX, moved["model_id"], "model_patches")

    def test_a_copy_already_in_place_is_named_and_never_overwritten(self):
        patch = self.put("controlnet", "pose.safetensors", LLLITE)
        self.put("model_patches", "pose.safetensors", LLLITE)
        self.assertIn("model_patches:0:pose.safetensors", self.about(patch)["placement"])
        with self.assertRaises(mcp_tools.ToolError):
            mcp_model_use.move_model(CTX, patch, "model_patches")
        self.assertTrue(Path(self.roots["controlnet"][0], "pose.safetensors").is_file())


if __name__ == "__main__":
    unittest.main()
