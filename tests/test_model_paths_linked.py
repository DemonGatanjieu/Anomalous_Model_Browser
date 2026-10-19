"""Looking up saved model paths when the model folder is a link (api/model_catalog.py): the
subfolder is the model's place inside the folder, not a climb out of the link's path."""

from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import model_catalog


def link_folder(link, target):
    """A junction on Windows, a symlink elsewhere; False when this computer will not make one."""
    try:
        if os.name == "nt":
            done = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True)
            return done.returncode == 0
        os.symlink(target, link, target_is_directory=True)
        return True
    except OSError:
        return False


class LinkedModelFolderTests(unittest.TestCase):
    def test_subfolder_inside_a_linked_folder(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real = root / "elsewhere" / "loras"
            (real / "chars").mkdir(parents=True)
            (real / "chars" / "ahri.safetensors").write_bytes(b"\0" * 16)
            link = root / "comfy" / "loras"
            link.parent.mkdir()
            if not link_folder(link, real):
                self.skipTest("this computer makes no folder links")
            with mock.patch.object(model_catalog.folder_paths, "folder_names_and_paths", {"loras": ([str(link)], set())}), \
                    mock.patch.object(model_catalog.folder_paths, "get_folder_paths", lambda kind: [str(link)]):
                found = model_catalog._resolve_paths_to_model_info_sync(["chars/ahri.safetensors"], ["loras"])
        self.assertEqual(found["chars/ahri.safetensors"]["subfolder"], "/chars")
        self.assertEqual(found["chars/ahri.safetensors"]["filename"], "ahri.safetensors")


if __name__ == "__main__":
    unittest.main()
