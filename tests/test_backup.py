"""Backups (Settings -> Backup): exporting the user's data and putting it back on another
computer. Two fake computers in temporary folders; nothing outside them is touched."""
import json
import os
import shutil
import sys
import tempfile
import unittest
import zipfile
from contextlib import ExitStack
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import backup  # noqa: E402

PARTS = ("recipes", "combos", "materials", "parameters", "comfy_workflows")


class Computer:
    """A user folder, a models folder and settings of one computer; `hashes` stands for the scan."""

    def __init__(self, root):
        self.root = root
        self.stores = {part: os.path.join(root, "user", part) for part in PARTS}
        self.models = os.path.join(root, "models", "loras")
        self.config = os.path.join(root, "config.json")
        self.download_settings = os.path.join(root, "download_settings.json")
        self.temp = os.path.join(root, "temp")
        self.trash = os.path.join(root, "trash")
        for path in [*self.stores.values(), self.models, self.temp, self.trash]:
            os.makedirs(path, exist_ok=True)
        self.hashes = {}

    def write(self, path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb" if isinstance(data, bytes) else "w", **({} if isinstance(data, bytes) else {"encoding": "utf-8"})) as handle:
            handle.write(data)
        return path

    def model(self, rel, data=b"weights", sha=""):
        path = self.write(os.path.join(self.models, rel), data)
        if sha:
            self.hashes[os.path.realpath(path)] = sha
        return os.path.splitext(path)[0]

    def trashed(self):
        return sorted(os.listdir(self.trash))

    def patches(self):
        def to_trash(path):
            shutil.move(path, os.path.join(self.trash, os.path.basename(path)))

        stack = ExitStack()
        stack.enter_context(mock.patch.object(backup, "part_dirs", return_value=self.stores))
        stack.enter_context(mock.patch.object(backup, "work_dir", return_value=self.temp))
        stack.enter_context(mock.patch.object(backup, "config_path", return_value=self.config))
        stack.enter_context(mock.patch.object(backup, "download_settings_path", return_value=self.download_settings))
        stack.enter_context(mock.patch.object(backup.folder_paths, "get_folder_paths", side_effect=lambda t: [self.models] if t == "loras" else []))
        stack.enter_context(mock.patch.object(backup, "get_metadata", side_effect=lambda p: {"hash": self.hashes.get(os.path.realpath(p), "")}))
        stack.enter_context(mock.patch.object(backup, "move_to_trash", side_effect=to_trash))
        stack.enter_context(mock.patch.object(backup, "add_entry"))
        stack.enter_context(mock.patch.object(backup, "_version", return_value="v-test"))
        return stack


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.a = Computer(os.path.join(self.tmp.name, "a"))
        self.b = Computer(os.path.join(self.tmp.name, "b"))
        a = self.a
        a.write(os.path.join(a.stores["recipes"], "recipe_1.json"), '{"name": "portrait"}')
        a.write(os.path.join(a.stores["materials"], ".assets", "m1", "preview.webp"), b"img")
        a.write(os.path.join(a.stores["combos"], "Flux.json"), '{"name": "Flux"}')
        a.write(os.path.join(a.stores["combos"], ".legacy_imported.json"), "{}")
        a.write(os.path.join(a.stores["comfy_workflows"], "mine.json"), "{}")
        a.write(a.config, json.dumps({"CIVITAI_API_KEY": "secret-a", "folder_view_mode": "abstract"}))
        base = a.model("Style/cute.safetensors", sha="ab" * 32)
        a.write(base + ".anomalous.json", json.dumps({"format": 1, "custom_name": "Cute", "custom_notes": "trigger: cute"}))
        a.write(base + ".preview.png", b"my own cover")
        civitai = a.model("plain.safetensors", sha="cd" * 32)
        a.write(civitai + ".preview.png", b"civitai image")
        a.write(civitai + ".civitai_bak.png", b"civitai image")

    def tearDown(self):
        self.tmp.cleanup()

    def export(self, **options):
        with self.a.patches():
            path, manifest = backup.build_backup(**options)
        return path, manifest

    def put_back(self, path, **options):
        with self.b.patches():
            summary = backup.inspect_backup(path)
            result = backup.apply_backup(path, **{"parts": PARTS, **options})
        return summary, result

    def test_export_keeps_stores_and_the_users_own_model_data(self):
        path, manifest = self.export()
        names = zipfile.ZipFile(path).namelist()
        self.assertIn("stores/recipes/recipe_1.json", names)
        self.assertIn("stores/materials/.assets/m1/preview.webp", names)
        self.assertNotIn("stores/combos/.legacy_imported.json", names)  # this computer's own marker
        self.assertEqual(manifest["parts"]["comfy_workflows"], 1)
        # Only the model with the user's name, notes and cover; a Civitai cover is no user data.
        self.assertEqual([m["rel"] for m in manifest["models"]], ["Style/cute.safetensors"])
        self.assertEqual(manifest["models"][0]["cover"], ".preview.png")
        settings = json.loads(zipfile.ZipFile(path).read("settings/config.json"))
        self.assertNotIn("CIVITAI_API_KEY", settings)  # the key never leaves the computer

    def test_comfy_workflows_can_be_left_out(self):
        _path, manifest = self.export(include_comfy=False)
        self.assertNotIn("comfy_workflows", manifest["parts"])

    def test_a_new_computer_gets_everything_and_models_are_found_by_hash(self):
        path, _ = self.export()
        b = self.b
        base = b.model("Moved/elsewhere/cute_renamed.safetensors", sha="ab" * 32)  # moved and renamed
        b.write(b.config, json.dumps({"CIVITAI_API_KEY": "secret-b"}))
        summary, result = self.put_back(path, settings=True)
        self.assertEqual(summary["parts"]["recipes"], {"new": 1, "same": 0, "differs": 0})
        self.assertEqual(summary["models"]["matched"], 1)
        self.assertEqual(result["added"], 4)
        self.assertTrue(os.path.isfile(os.path.join(b.stores["materials"], ".assets", "m1", "preview.webp")))
        user = json.loads(Path(base + ".anomalous.json").read_text(encoding="utf-8"))
        self.assertEqual(user["custom_name"], "Cute")
        self.assertEqual(Path(base + ".preview.png").read_bytes(), b"my own cover")
        config = json.loads(Path(b.config).read_text(encoding="utf-8"))
        self.assertEqual(config["CIVITAI_API_KEY"], "secret-b")  # this computer's key stays
        self.assertEqual(config["folder_view_mode"], "abstract")

    def test_differing_files_stay_unless_replace_and_then_go_to_the_recycle_bin(self):
        path, _ = self.export()
        b = self.b
        mine = b.write(os.path.join(b.stores["recipes"], "recipe_1.json"), '{"name": "changed here"}')
        _summary, kept = self.put_back(path)
        self.assertEqual(Path(mine).read_text(encoding="utf-8"), '{"name": "changed here"}')
        self.assertEqual(kept["skipped"], 1)
        _summary, replaced = self.put_back(path, replace=True)
        self.assertEqual(replaced["replaced"], 1)
        self.assertEqual(Path(mine).read_text(encoding="utf-8"), '{"name": "portrait"}')
        self.assertIn("recipe_1.json", b.trashed())
        _summary, again = self.put_back(path, replace=True)
        self.assertEqual((again["added"], again["replaced"]), (0, 0))  # all the same now

    def test_user_fields_are_filled_where_empty_and_replaced_only_on_request(self):
        path, _ = self.export()
        base = self.b.model("cute.safetensors", sha="ab" * 32)
        self.b.write(base + ".anomalous.json", json.dumps({"format": 1, "custom_name": "Mine"}))
        self.put_back(path)
        user = json.loads(Path(base + ".anomalous.json").read_text(encoding="utf-8"))
        self.assertEqual((user["custom_name"], user["custom_notes"]), ("Mine", "trigger: cute"))
        self.put_back(path, replace=True)
        user = json.loads(Path(base + ".anomalous.json").read_text(encoding="utf-8"))
        self.assertEqual(user["custom_name"], "Cute")
        self.assertIn("cute.anomalous.json", self.b.trashed())

    def test_the_users_cover_replaces_civitais_but_not_another_user_cover(self):
        path, _ = self.export()
        b = self.b
        base = b.model("cute.safetensors", sha="ab" * 32)
        b.write(base + ".png", b"civitai here")
        b.write(base + ".civitai_bak.png", b"civitai here")
        self.put_back(path)
        self.assertEqual(Path(base + ".preview.png").read_bytes(), b"my own cover")
        self.assertFalse(os.path.exists(base + ".png"))
        self.assertTrue(os.path.exists(base + ".civitai_bak.png"))  # Civitai's copy stays
        b.write(base + ".preview.png", b"another of mine")
        _summary, result = self.put_back(path)
        self.assertEqual(result["covers_kept"], 1)
        self.assertEqual(Path(base + ".preview.png").read_bytes(), b"another of mine")

    def test_without_a_hash_a_model_needs_the_same_path_and_size(self):
        path, _ = self.export()
        with zipfile.ZipFile(path) as archive:
            manifest = json.loads(archive.read("manifest.json"))
        manifest["models"][0]["sha256"] = ""
        rewritten = os.path.join(self.b.temp, "nohash.zip")
        with zipfile.ZipFile(path) as source, zipfile.ZipFile(rewritten, "w") as target:
            for info in source.infolist():
                data = json.dumps(manifest) if info.filename == "manifest.json" else source.read(info)
                target.writestr(info.filename, data)
        self.b.model("Style/cute.safetensors", data=b"other size!")
        summary, result = self.put_back(rewritten)
        self.assertEqual((summary["models"]["matched"], result["models_missing"]), (0, 1))
        self.b.model("Style/cute.safetensors", data=b"weights")
        summary, _ = self.put_back(rewritten)
        self.assertEqual(summary["models"]["matched"], 1)

    def test_unsafe_or_foreign_files_are_refused(self):
        evil = os.path.join(self.b.temp, "evil.zip")
        with zipfile.ZipFile(evil, "w") as archive:
            archive.writestr("manifest.json", json.dumps({"app": backup.APP, "format": backup.FORMAT}))
            archive.writestr("stores/recipes/../../escape.json", "{}")
        with self.b.patches(), self.assertRaises(backup.BackupError):
            backup.inspect_backup(evil)
        foreign = os.path.join(self.b.temp, "foreign.zip")
        with zipfile.ZipFile(foreign, "w") as archive:
            archive.writestr("readme.txt", "hello")
        with self.b.patches(), self.assertRaises(backup.BackupError):
            backup.inspect_backup(foreign)
        text = os.path.join(self.b.temp, "text.zip")
        Path(text).write_text("not a zip", encoding="utf-8")
        with self.b.patches(), self.assertRaises(backup.BackupError):
            backup.inspect_backup(text)


if __name__ == "__main__":
    unittest.main()
