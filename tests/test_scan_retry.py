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
from api import metadata, scan_choice, scan_summary, scanner
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

    def test_models_found_offline_keep_their_name(self):
        # Named after the file as model and version: renaming doubled the name on every scan.
        for flags in (["--offline-only"], ["--force-overwrite"]):
            with mock.patch.object(sys, "argv", ["scraper.py", self.temp.name, "--physical-rename", "--virtual-rename", *flags]), \
                    mock.patch.object(scraper, "fetch_civitai_info", return_value=None), \
                    mock.patch.object(scraper, "calculate_sha256", return_value=DIGEST):
                scraper.main()
        self.assertTrue(self.new.exists())
        info = json.loads(Path(str(self.new)[:-12] + ".info").read_text(encoding="utf-8"))
        self.assertNotIn("anomalous_custom_name", info)
        self.assertEqual(metadata._read_metadata(str(self.new))["name"], "new")

    def test_damaged_files_are_named_as_such(self):
        # "model bytes" is no safetensors header; a whole file next to it is only unknown to Civitai.
        header = json.dumps({"w": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}).encode()
        whole = Path(self.temp.name, "whole.safetensors")
        whole.write_bytes(len(header).to_bytes(8, "little") + header + b"\0" * 4)
        with mock.patch.object(sys, "argv", ["scraper.py", self.temp.name]), \
                mock.patch.object(scraper, "fetch_civitai_info", return_value=None), \
                mock.patch.object(scraper, "calculate_sha256", return_value=DIGEST):
            scraper.main()
        reason = lambda path: json.loads(Path(str(path)[:-12] + ".info").read_text(encoding="utf-8"))["anomalous_unmatched_reason"]
        self.assertEqual(reason(self.new), "damaged")
        self.assertEqual(reason(whole), "not_found")
        with mock.patch.object(scan_summary, "get_active_scan_paths", return_value=[self.temp.name]):
            self.assertEqual(scan_summary._summarize()["damaged"], 1)

    def test_new_models_headers_are_read_once_until_the_file_changes(self):
        # On a network drive each read waits: the page opened again reads none of them.
        header = json.dumps({"ema_model.transformer.w": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}).encode()
        voice = Path(self.temp.name, "voice.safetensors")
        voice.write_bytes(len(header).to_bytes(8, "little") + header + b"\0" * 4)
        reads = []
        real_inspect = metadata.inspect_file
        metadata.clear_metadata_cache()
        with mock.patch.object(scan_summary, "get_active_scan_paths", return_value=[self.temp.name]), \
                mock.patch.object(metadata, "inspect_file", side_effect=lambda path: reads.append(path) or real_inspect(path)):
            first = scan_summary._summarize()
            again = scan_summary._summarize()
            self.assertEqual(len(reads), 2)  # new.safetensors and the voice model, each once
            self.assertEqual(again["not_drawing"], first["not_drawing"])
            voice.write_bytes(len(header).to_bytes(8, "little") + header + b"\0" * 8)  # changed: read again
            scan_summary._summarize()
        self.assertEqual([Path(path).name for path in reads].count("voice.safetensors"), 2)

    def test_models_set_not_to_be_scanned_are_left_out(self):
        # A voice model's header names no drawing model kind: the page asks; "skip" leaves it out.
        header = json.dumps({"ema_model.transformer.w": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}).encode()
        voice = Path(self.temp.name, "voice.safetensors")
        voice.write_bytes(len(header).to_bytes(8, "little") + header + b"\0" * 4)
        summarize = lambda: scan_summary._summarize()
        with mock.patch.object(scan_summary, "get_active_scan_paths", return_value=[self.temp.name]):
            first = summarize()
            self.assertEqual([item["filename"] for item in first["new_models"] if item.get("not_drawing")], ["voice.safetensors"])
            self.assertTrue(metadata._read_metadata(str(voice))["not_drawing"])
            target = [{"type": "checkpoints", "path_idx": 0, "subfolder": "/", "files": ["voice.safetensors", "gone.safetensors"]}]
            with mock.patch.object(scan_choice, "resolve_folder_subdir", return_value=(self.temp.name, self.temp.name)):
                self.assertEqual(scan_choice._set_scan_choice(target, "skip"), (1, ["gone.safetensors"]))
                with self.assertRaises(ValueError):
                    scan_choice._set_scan_choice(target, "never")
            after = summarize()
        self.assertEqual((after["excluded"], after["total"], after["not_drawing"]), (1, first["total"] - 1, 0))
        self.assertEqual(metadata._read_metadata(str(voice))["scan_choice"], "skip")
        with mock.patch.object(sys, "argv", ["scraper.py", self.temp.name]), \
                mock.patch.object(scraper, "fetch_civitai_info", return_value=None), \
                mock.patch.object(scraper, "calculate_sha256", return_value=DIGEST):
            scraper.main()
        self.assertFalse(Path(self.temp.name, "voice.info").exists())
        # Picked by hand, it is scanned all the same.
        with mock.patch.object(sys, "argv", ["scraper.py", self.temp.name, "--target-files", "voice.safetensors"]), \
                mock.patch.object(scraper, "fetch_civitai_info", return_value=None), \
                mock.patch.object(scraper, "calculate_sha256", return_value=DIGEST):
            scraper.main()
        self.assertTrue(Path(self.temp.name, "voice.info").exists())

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
