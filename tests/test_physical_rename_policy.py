from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from model_policies import is_physical_rename_protected, requires_hash_for_model_recovery


class PhysicalRenamePolicyTests(unittest.TestCase):
    def test_protected_model_types(self):
        for folder_type in ("vae", "vae_approx", "clip", "text_encoders", "clip_vision"):
            self.assertTrue(is_physical_rename_protected(folder_type=folder_type))

    def test_regular_model_types_remain_renameable(self):
        for folder_type in ("checkpoints", "loras", "unet", "diffusion_models", "controlnet"):
            self.assertFalse(is_physical_rename_protected(folder_type=folder_type))

    def test_foundation_recovery_requires_hash(self):
        self.assertTrue(requires_hash_for_model_recovery(("clip", "text_encoders")))
        self.assertTrue(requires_hash_for_model_recovery(("vae",)))
        self.assertFalse(requires_hash_for_model_recovery(("checkpoints",)))
        self.assertFalse(requires_hash_for_model_recovery(()))

    def test_standalone_scraper_path_guard_handles_nested_foundation_folders(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            protected = Path(temp_dir) / "models" / "vae" / "Anima"
            regular = Path(temp_dir) / "models" / "checkpoints" / "Anime"
            self.assertTrue(is_physical_rename_protected(folder_path=protected))
            self.assertFalse(is_physical_rename_protected(folder_path=regular))

    def test_standalone_scraper_refuses_protected_physical_rename(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            protected = Path(temp_dir) / "models" / "vae"
            protected.mkdir(parents=True)
            result = subprocess.run(
                [
                    sys.executable,
                    str(PLUGIN_ROOT / "scraper.py"),
                    str(protected),
                    "--dry-run",
                    "--physical-rename",
                    "--folder-type",
                    "vae",
                ],
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("不执行物理重命名", result.stdout)


if __name__ == "__main__":
    unittest.main()
