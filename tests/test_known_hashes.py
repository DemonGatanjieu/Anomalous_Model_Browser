"""known_hashes.py: the SHA-256 an import read is kept for the scan, and only while the file is unchanged."""
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
import known_hashes  # noqa: E402


class KnownHashTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        patcher = mock.patch.object(known_hashes, "PATH", os.path.join(self.dir.name, ".known_hashes.json"))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.file = os.path.join(self.dir.name, "model.safetensors")
        Path(self.file).write_bytes(b"weights" * 100)
        self.digest = hashlib.sha256(Path(self.file).read_bytes()).hexdigest()

    def test_a_noted_hash_is_read_back(self):
        self.assertEqual(known_hashes.known(self.file), "")
        known_hashes.note(self.file, self.digest)
        self.assertEqual(known_hashes.known(self.file), self.digest)

    def test_a_changed_file_is_read_again(self):
        known_hashes.note(self.file, self.digest)
        Path(self.file).write_bytes(b"other" * 100)
        self.assertEqual(known_hashes.known(self.file), "")

    def test_the_note_follows_a_move(self):
        known_hashes.note(self.file, self.digest)
        dest = os.path.join(self.dir.name, "MOSS", "model.safetensors")
        os.makedirs(os.path.dirname(dest))
        os.replace(self.file, dest)
        known_hashes.carried(self.file, dest)
        self.assertEqual(known_hashes.known(dest), self.digest)

    def test_bad_input_and_a_garbled_file_are_ignored(self):
        known_hashes.note(self.file, "not a hash")
        self.assertEqual(known_hashes.known(self.file), "")
        Path(known_hashes.PATH).write_text("{garbled", encoding="utf-8")
        self.assertEqual(known_hashes.known(self.file), "")
        known_hashes.note(self.file, self.digest)  # rewritten whole
        self.assertEqual(known_hashes.known(self.file), self.digest)

    def test_only_the_newest_are_kept(self):
        with mock.patch.object(known_hashes, "KEEP", 3):
            paths = []
            for index in range(5):
                path = os.path.join(self.dir.name, f"m{index}.safetensors")
                Path(path).write_bytes(bytes([index]) * 10)
                known_hashes.note(path, hashlib.sha256(Path(path).read_bytes()).hexdigest())
                paths.append(path)
            self.assertEqual([bool(known_hashes.known(path)) for path in paths], [False, False, True, True, True])

    def test_the_scan_takes_the_noted_hash(self):
        import scraper
        known_hashes.note(self.file, "a" * 64)  # a hash the file does not have: proves it was not read
        with mock.patch.object(scraper, "file_sha256", side_effect=AssertionError("read again")):
            self.assertEqual(scraper.calculate_sha256(self.file), "a" * 64)
        time.sleep(0.01)
        Path(self.file).write_bytes(b"changed")
        self.assertEqual(scraper.calculate_sha256(self.file), hashlib.sha256(b"changed").hexdigest())


if __name__ == "__main__":
    unittest.main()
