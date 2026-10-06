import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN_DIR.parents[1]))
sys.path.insert(0, str(PLUGIN_DIR))

import scraper
from api import scan_summary, scanner
from model_identity import computed_file_identity

DIGEST = "a" * 64


def write_info(base, data):
    Path(base + ".info").write_text(json.dumps(data), encoding="utf-8")


class ScanRetryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        (root / "sub").mkdir()
        self.unmatched = root / "sub" / "unmatched.safetensors"
        self.matched = root / "matched.safetensors"
        self.new = root / "new.safetensors"
        for path in (self.unmatched, self.matched, self.new):
            path.write_bytes(b"model bytes")
        write_info(str(self.unmatched)[:-12], {
            "id": -1, "modelId": -1, "name": "unmatched", "files": [{"hashes": {"SHA256": DIGEST}}],
            "anomalous_file_identity": computed_file_identity(str(self.unmatched), DIGEST),
        })
        write_info(str(self.matched)[:-12], {"id": 5, "modelId": 2, "name": "v1"})
        Path(str(self.matched)[:-12] + ".preview.png").write_bytes(b"png")

    def tearDown(self):
        self.temp.cleanup()

    def run_scraper(self, *flags):
        fetched = []
        found = {"id": 7, "modelId": 3, "name": "v2", "model": {"name": "Found"}, "images": []}
        argv = ["scraper.py", self.temp.name, *flags]
        with mock.patch.object(sys, "argv", argv), \
                mock.patch.object(scraper, "fetch_civitai_info", side_effect=lambda h: fetched.append(h) or dict(found)), \
                mock.patch.object(scraper, "calculate_sha256", side_effect=AssertionError("hash recomputed")), \
                mock.patch.object(scraper.urllib.request, "urlopen", side_effect=OSError("offline test")):
            scraper.main()
        return fetched

    def test_retry_refetches_only_unmatched_models_with_the_saved_hash(self):
        self.assertEqual(scraper.count_scan_files(self.temp.name, [], True), 1)
        fetched = self.run_scraper("--retry-unmatched", "--virtual-rename")
        self.assertEqual(fetched, [DIGEST])
        info = json.loads(Path(str(self.unmatched)[:-12] + ".info").read_text(encoding="utf-8"))
        self.assertEqual(info["id"], 7)
        self.assertEqual(json.loads(Path(str(self.matched)[:-12] + ".info").read_text(encoding="utf-8"))["id"], 5)
        self.assertFalse(Path(str(self.new)[:-12] + ".info").exists())

    def test_changed_file_is_hashed_again(self):
        self.unmatched.write_bytes(b"other bytes, other size")
        with mock.patch.object(scraper, "write_report") as report:
            self.run_scraper("--retry-unmatched")
        failed = [call.kwargs for call in report.call_args_list if call.kwargs.get("status") == "failed"]
        self.assertEqual([entry["error"] for entry in failed], ["hash recomputed"])

    def test_summary_counts_each_kind_once(self):
        with mock.patch.object(scan_summary, "get_active_scan_paths", return_value=[self.temp.name, self.temp.name]):
            summary = scan_summary._summarize()
        counts = {key: summary[key] for key in ("total", "matched", "unmatched", "new")}
        self.assertEqual(counts, {"total": 3, "matched": 1, "unmatched": 1, "new": 1})

    def test_summary_lists_model_files_in_other_formats_outside_hidden_folders(self):
        root = Path(self.temp.name)
        (root / "voice").mkdir()
        (root / "voice" / "speaker.pth").write_bytes(b"x")
        (root / ".staging").mkdir()
        (root / ".staging" / "half.ckpt").write_bytes(b"x")
        (root / "notes.txt").write_bytes(b"x")
        with mock.patch.object(scan_summary, "get_active_scan_paths", return_value=[self.temp.name]):
            summary = scan_summary._summarize()
        self.assertEqual(summary["total"], 3)
        self.assertEqual(summary["skipped"], 1)
        self.assertEqual(summary["skipped_models"][0]["rel"], "voice/speaker.pth")

    def test_both_routes_map_request_fields_to_the_same_switches(self):
        data = {"offline_only": True, "virtual_rename": True, "retry_unmatched": True, "physical_rename": True}
        self.assertEqual(
            scanner._scraper_flags(data, False, False),
            ["--offline-only", "--virtual-rename", "--retry-unmatched"],
        )
        self.assertIn("--skip-rename", scanner._scraper_flags({}, True, True))
        self.assertIn("--physical-rename", scanner._scraper_flags({"physical_rename": True}, False, True))


if __name__ == "__main__":
    unittest.main()
