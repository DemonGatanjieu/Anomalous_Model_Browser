"""The Tidy tab's "Not used lately" (api/model_usage.py, api/usage_ledger.py): when each model and
node pack was last used, from the run record, output images and sounds and saved workflows in
temporary folders."""
import asyncio
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image
from PIL.PngImagePlugin import PngInfo

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import image_search, model_usage, usage_ledger  # noqa: E402

DAY = 24 * 3600
NOW = 1_800_000_000.0


def output(path, when, nodes):
    """A PNG whose prompt holds `nodes` ({id: (class_type, inputs)}), dated `when`."""
    info = PngInfo()
    info.add_text("prompt", json.dumps({key: {"class_type": kind, "inputs": inputs} for key, (kind, inputs) in nodes.items()}))
    Image.new("RGB", (2, 2)).save(path, pnginfo=info)
    os.utime(path, (when, when))


def node(module, takes=(), makes=()):
    """A node class of the pack `module`, taking and making those kinds of thing."""
    return type("Node", (), {
        "RELATIVE_PYTHON_MODULE": module, "RETURN_TYPES": tuple(makes),
        "INPUT_TYPES": classmethod(lambda cls: {"required": {f"in{index}": (kind, {}) for index, kind in enumerate(takes)}}),
    })


def stat(born, changed):
    return types.SimpleNamespace(st_birthtime=born, st_ctime=born, st_mtime=changed)


class UsageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.out, self.flows, self.recipes = base / "output", base / "workflows", base / "recipes"
        custom = base / "custom_nodes"
        for folder in (self.out / "sub", self.flows, self.recipes):
            folder.mkdir(parents=True)
        packs = ["rgthree-comfy", "ComfyUI-Easy-Use", "forgotten-pack", "ComfyUI-Impact-Pack", "comfyui-impact-subpack",
                 "Genie-TTS", "page-only", "ComfyUI-Manager", os.path.basename(model_usage.PLUGIN_DIR)]
        for name in packs:
            (custom / name).mkdir(parents=True)
        (custom / "rgthree-comfy" / "js").mkdir()
        (custom / "page-only" / "web").mkdir()
        self.ledger = {"started": None, "types": {}, "models": {}, "opened": {"types": {}, "models": {}}}
        self.models = [
            {"type": "checkpoints", "root": 0, "rel": "sdxl/fresh.safetensors", "size": 6},
            {"type": "loras", "root": 0, "rel": "old.safetensors", "size": 3},
            {"type": "loras", "root": 0, "rel": "style/kept.safetensors", "size": 2},
            {"type": "loras", "root": 0, "rel": "never.safetensors", "size": 9},
            {"type": "vae", "root": 0, "rel": "hashed.safetensors", "size": 1},
        ]
        nodes = types.SimpleNamespace(
            NODE_CLASS_MAPPINGS={
                "KSampler": node("nodes", ["MODEL"], ["LATENT"]),
                "Power Lora Loader (rgthree)": node("custom_nodes.rgthree-comfy", ["MODEL"], ["MODEL"]),
                "easy loraStack": node("custom_nodes.ComfyUI-Easy-Use"),
                "easy seed": node("custom_nodes.ComfyUI-Easy-Use.py.nodes"),
                "Unused Thing": node("custom_nodes.forgotten-pack"),
                "DetailerForEach": node("custom_nodes.ComfyUI-Impact-Pack", ["IMAGE", "BBOX_DETECTOR"], ["IMAGE"]),
                "UltralyticsDetectorProvider": node("custom_nodes.comfyui-impact-subpack", [], ["BBOX_DETECTOR"]),
                "Genie Speak": node("custom_nodes.Genie-TTS", ["STRING"], ["AUDIO"]),
                "Manager Thing": node("custom_nodes.ComfyUI-Manager"),
            },
            LOADED_MODULE_DIRS={name: str(custom / name) for name in packs},
            EXTENSION_WEB_DIRS={"rgthree-comfy": str(custom / "rgthree-comfy" / "js"), "page-only": str(custom / "page-only" / "web")},
        )
        patches = [
            mock.patch.object(model_usage, "library", return_value=self.models),
            mock.patch.object(model_usage, "_card", side_effect=lambda item: {"name": Path(item["rel"]).stem, "version": "", "preview_url": ""}),
            mock.patch.object(model_usage, "_known_hash", side_effect=lambda item: "AB" * 32 if item["rel"] == "hashed.safetensors" else ""),
            mock.patch.object(model_usage, "part_dirs", return_value={"comfy_workflows": str(self.flows), "recipes": str(self.recipes), "materials": str(base / "nope")}),
            mock.patch.object(model_usage.folder_paths, "get_output_directory", return_value=str(self.out)),
            mock.patch.object(model_usage.folder_paths, "get_folder_paths", side_effect=lambda kind: [str(custom)] if kind == "custom_nodes" else []),
            mock.patch.object(model_usage.usage_ledger, "read", side_effect=lambda: self.ledger),
            mock.patch.dict(sys.modules, {"nodes": nodes}),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        image_search._record_cache.clear()
        self.addCleanup(self.temp.cleanup)

    def test_models_and_packs_by_when_they_were_last_used(self):
        output(self.out / "a.png", NOW - 2 * DAY, {"1": ("CheckpointLoaderSimple", {"ckpt_name": "sdxl\\fresh.safetensors"}),
                                                     "2": ("KSampler", {"seed": 1})})
        output(self.out / "sub" / "b.png", NOW - 100 * DAY, {"1": ("LoraLoader", {"lora_name": "old.safetensors"}),
                                                              "2": ("Power Lora Loader (rgthree)", {"lora_1": {"on": True, "lora": "old.safetensors"}})})
        output(self.out / "c.png", NOW - 40 * DAY, {"1": ("easy seed", {"seed": 2})})
        (self.flows / "portrait.json").write_text(json.dumps({"nodes": [
            {"type": "LoraLoader", "widgets_values": ["style/kept.safetensors", 1, 1]},
            {"type": "easy loraStack", "widgets_values": [True, "simple", 1]}]}), encoding="utf-8")
        (self.recipes / "r.json").write_text(json.dumps({"models": [{"sha256": "ab" * 32}]}), encoding="utf-8")

        result = model_usage.check(now=NOW)
        models = {Path(item["rel"]).stem: item for item in result["models"]}
        self.assertNotIn("fresh", models)  # used two days ago
        self.assertEqual((models["old"]["last_used"], models["old"]["outputs"], models["old"]["saved"]), (NOW - 100 * DAY, 1, 0))  # one image naming it twice
        self.assertEqual((models["kept"]["last_used"], models["kept"]["saved"]), (None, 1))  # only in a saved workflow
        self.assertEqual((models["never"]["last_used"], models["never"]["outputs"], models["never"]["saved"]), (None, 0, 0))
        self.assertEqual(models["hashed"]["saved"], 1)  # its SHA-256 is in a recipe
        self.assertEqual(result["seen"], {"outputs": 3, "saved": 2, "capped": False})
        self.assertIsNone(result["ledger_since"])

        packs = {item["name"]: item for item in result["packs"]}
        self.assertEqual(sorted(packs, key=str.lower), ["ComfyUI-Easy-Use", "ComfyUI-Impact-Pack", "comfyui-impact-subpack", "forgotten-pack",
                                         "Genie-TTS", "page-only", "rgthree-comfy"])  # ComfyUI's own nodes, the Manager and this plugin are left out
        self.assertEqual((packs["rgthree-comfy"]["last_used"], packs["rgthree-comfy"]["outputs"], packs["rgthree-comfy"]["web"]), (NOW - 100 * DAY, 1, True))
        self.assertEqual((packs["ComfyUI-Easy-Use"]["nodes"], packs["ComfyUI-Easy-Use"]["last_used"], packs["ComfyUI-Easy-Use"]["saved"]),
                         (2, NOW - 40 * DAY, 1))
        self.assertEqual((packs["forgotten-pack"]["last_used"], packs["forgotten-pack"]["saved"], packs["forgotten-pack"]["web"]), (None, 0, False))
        self.assertEqual((packs["page-only"]["nodes"], packs["page-only"]["web"]), (0, True))  # works on the page only
        self.assertEqual(packs["comfyui-impact-subpack"]["feeds"], ["ComfyUI-Impact-Pack"])  # makes what only Impact's nodes take
        self.assertEqual(packs["ComfyUI-Impact-Pack"]["feeds"], [])  # IMAGE is ComfyUI's own
        self.assertEqual(packs["comfyui-impact-subpack"]["words"], "impact subpack")
        self.assertEqual(packs["ComfyUI-Easy-Use"]["words"], "easy use")

    def test_the_run_record_and_sounds_count_as_use(self):
        self.ledger = {"started": NOW - 10 * DAY, "types": {"Genie Speak": [NOW - 3 * DAY, 4]},
                       "models": {"never.safetensors": [NOW - 31 * DAY, 2]},
                       "opened": {"types": {}, "models": {"style/kept.safetensors": [NOW - 45 * DAY, 3]}}}
        sound = self.out / "speech.flac"
        sound.write_bytes(b"")
        os.utime(sound, (NOW - 50 * DAY, NOW - 50 * DAY))
        prompt = {"1": {"class_type": "Unused Thing", "inputs": {"model": "old.safetensors"}}}
        with mock.patch.object(model_usage, "read_audio_tags", return_value={"prompt": json.dumps(prompt)}):
            result = model_usage.check(now=NOW)
        models = {Path(item["rel"]).stem: item for item in result["models"]}
        packs = {item["name"]: item for item in result["packs"]}
        self.assertEqual(result["ledger_since"], NOW - 10 * DAY)
        self.assertEqual((packs["Genie-TTS"]["last_used"], packs["Genie-TTS"]["runs"]), (NOW - 3 * DAY, 4))  # a sound, never an image
        self.assertEqual((models["never"]["last_used"], models["never"]["runs"]), (NOW - 31 * DAY, 2))
        self.assertEqual((models["kept"]["last_used"], models["kept"]["opened"], models["kept"]["runs"]), (NOW - 45 * DAY, 3, 0))  # opened, never run
        self.assertEqual((packs["forgotten-pack"]["last_used"], models["old"]["last_used"]), (NOW - 50 * DAY, NOW - 50 * DAY))
        self.assertEqual(result["seen"]["outputs"], 1)

    def test_what_came_lately_is_not_judged(self):
        self.models[1]["stat"] = stat(NOW - 5 * DAY, NOW - 400 * DAY)  # copied here five days ago: keeps its old date
        self.models[3]["stat"] = stat(NOW - 400 * DAY, NOW - 400 * DAY)
        result = model_usage.check(now=NOW)
        models = {Path(item["rel"]).stem: item for item in result["models"]}
        self.assertNotIn("old", models)
        self.assertEqual(models["never"]["added"], NOW - 400 * DAY)

    def test_reading_stops_at_the_limits_and_says_so(self):
        for index in range(3):
            output(self.out / f"{index}.png", NOW - DAY, {"1": ("KSampler", {})})
        with mock.patch.object(model_usage, "MAX_IMAGES", 2):
            result = model_usage.check(now=NOW)
        self.assertEqual((result["seen"]["outputs"], result["seen"]["capped"]), (2, True))

    def test_a_broken_or_huge_saved_file_is_skipped(self):
        (self.flows / "broken.json").write_text("{not json", encoding="utf-8")
        (self.flows / "ok.json").write_text(json.dumps({"x": "never.safetensors"}), encoding="utf-8")
        with mock.patch.object(model_usage, "MAX_JSON_BYTES", 40):
            (self.flows / "big.json").write_text(json.dumps({"x": "old.safetensors", "pad": "x" * 100}), encoding="utf-8")
            result = model_usage.check(now=NOW)
        models = {Path(item["rel"]).stem: item for item in result["models"]}
        self.assertEqual((models["never"]["saved"], models["old"]["saved"]), (1, 0))


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = os.path.join(self.temp.name, "usage_ledger.json")
        patch = mock.patch.object(usage_ledger, "ledger_path", return_value=self.path)
        patch.start()
        self.addCleanup(patch.stop)
        usage_ledger._ledger = None
        self.addCleanup(setattr, usage_ledger, "_ledger", None)

    def test_each_run_is_noted_and_saved(self):
        prompt = {"1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "SDXL\\Base.safetensors"}},
                  "2": {"class_type": "Power Lora Loader (rgthree)", "inputs": {"lora_1": {"on": True, "lora": "a.safetensors"}}},
                  "3": {"class_type": "KSampler", "inputs": {"seed": 5, "model": ["1", 0]}}}
        usage_ledger.note(prompt, when=100.0)
        usage_ledger.note(prompt, when=200.0)
        usage_ledger._timer.cancel()
        usage_ledger._save()
        with open(self.path, encoding="utf-8") as f:
            saved = json.load(f)
        self.assertEqual(saved["started"], 100.0)
        self.assertEqual(saved["types"]["KSampler"], [200.0, 2])
        self.assertEqual(sorted(saved["models"]), ["a.safetensors", "sdxl/base.safetensors"])
        usage_ledger._ledger = None  # read back from the file
        self.assertEqual(usage_ledger.read()["models"]["a.safetensors"], [200.0, 2])

    def test_an_opened_workflow_is_noted_apart_from_runs(self):
        class Request:
            def __init__(self, body):
                self.body = body

            async def json(self):
                return self.body

        noted = asyncio.run(usage_ledger.api_opened(Request({"types": ["KSampler", 5, ""], "models": ["Loras\\A.safetensors", "notes.txt"]})))
        usage_ledger._timer.cancel()
        self.assertEqual(json.loads(noted.body)["noted"], 2)
        ledger = usage_ledger.read()
        self.assertEqual((sorted(ledger["opened"]["types"]), sorted(ledger["opened"]["models"])), (["KSampler"], ["loras/a.safetensors"]))
        self.assertEqual((ledger["types"], ledger["models"]), ({}, {}))  # not counted as a run
        for body in ({"types": "KSampler", "models": []}, ["KSampler"], {"types": []}):
            self.assertEqual(asyncio.run(usage_ledger.api_opened(Request(body))).status, 400)

    def test_a_note_never_stops_a_run(self):
        request = {"prompt": "not a prompt", "client_id": "x"}
        self.assertIs(usage_ledger.note_prompt(request), request)
        with mock.patch.object(usage_ledger, "note", side_effect=RuntimeError("boom")):
            self.assertIs(usage_ledger.note_prompt(request), request)
        self.assertIsNone(usage_ledger.read()["started"])


if __name__ == "__main__":
    unittest.main()
