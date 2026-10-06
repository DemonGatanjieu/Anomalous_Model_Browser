import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock


PLUGIN_DIR = Path(__file__).resolve().parents[1]
COMFY_ROOT = PLUGIN_DIR.parents[1]
sys.path.insert(0, str(COMFY_ROOT))
sys.path.insert(0, str(PLUGIN_DIR))

from api import scanner
from scraper import count_scan_files, write_scan_progress


class ScannerRecoveryTests(unittest.TestCase):
    class Request:
        query = {"type": "checkpoints", "path_idx": "0", "subfolder": "/"}

        async def json(self):
            return {"skip_rename": True, "offline_only": True}

    def test_legacy_marker_is_recovered_before_new_scan(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            marker = Path(temp_dir) / ".scan_in_progress"
            progress = Path(temp_dir) / ".scan_progress.json"
            marker.write_text("1", encoding="utf-8")
            progress.write_text("{}", encoding="utf-8")

            claimed, recovered = scanner._claim_scan_marker(
                str(marker),
                "folder",
                (str(progress),),
            )

            self.assertTrue(claimed)
            self.assertTrue(recovered)
            self.assertEqual(json.loads(marker.read_text(encoding="utf-8"))["version"], 2)
            scanner._release_scan_marker(str(marker), (str(progress),))
            self.assertFalse(marker.exists())

    def test_active_marker_still_rejects_duplicate_scan(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            marker = str(Path(temp_dir) / ".global_scan_in_progress")
            first_claim, _ = scanner._claim_scan_marker(marker, "global")
            second_claim, _ = scanner._claim_scan_marker(marker, "global")
            scanner._release_scan_marker(marker)

            self.assertTrue(first_claim)
            self.assertFalse(second_claim)

    def test_dead_owner_marker_reports_interruption_and_cleans_artifacts(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            marker = Path(temp_dir) / ".scan_in_progress"
            progress = Path(temp_dir) / ".scan_progress.json"
            targets = Path(temp_dir) / ".scan_targets.json"
            marker.write_text(json.dumps({
                "version": 2,
                "session_id": "previous-session",
                "owner_pid": 999999999,
                "worker_pid": 0,
            }), encoding="utf-8")
            progress.write_text("{}", encoding="utf-8")
            targets.write_text("[]", encoding="utf-8")

            status = scanner._scan_status_payload(
                str(marker),
                str(progress),
                (str(progress), str(targets)),
            )

            self.assertFalse(status["scanning"])
            self.assertTrue(status["interrupted"])
            self.assertFalse(marker.exists())
            self.assertFalse(progress.exists())
            self.assertFalse(targets.exists())

    def test_orphan_worker_remains_locked_only_while_process_is_alive(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            marker = Path(temp_dir) / ".scan_in_progress"
            progress = Path(temp_dir) / ".scan_progress.json"
            process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
            try:
                marker.write_text(json.dumps({
                    "version": 2,
                    "session_id": "previous-session",
                    "owner_pid": 999999999,
                    "worker_pid": process.pid,
                }), encoding="utf-8")
                progress.write_text("{}", encoding="utf-8")

                active = scanner._scan_status_payload(str(marker), str(progress), (str(progress),))
                self.assertTrue(active["scanning"])
                self.assertFalse(active["interrupted"])
            finally:
                process.terminate()
                process.wait(timeout=5)

            recovered = scanner._scan_status_payload(str(marker), str(progress), (str(progress),))
            self.assertFalse(recovered["scanning"])
            self.assertTrue(recovered["interrupted"])
            self.assertFalse(marker.exists())

    def test_scraper_progress_uses_real_selected_file_count(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "a.safetensors").write_bytes(b"a")
            (root / "b.safetensors").write_bytes(b"b")
            (root / "ignore.txt").write_text("x", encoding="utf-8")
            progress = root / ".scan_progress.json"

            self.assertEqual(count_scan_files(str(root), []), 2)
            self.assertEqual(count_scan_files(str(root), ["b.safetensors"]), 1)
            write_scan_progress(str(progress), "scanning", 2, 1, "a.safetensors")
            payload = json.loads(progress.read_text(encoding="utf-8"))
            self.assertEqual(payload["current"], 1)
            self.assertEqual(payload["total"], 2)

    def test_scraper_cli_publishes_completion_for_empty_folder(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            progress = Path(temp_dir) / ".scan_progress.json"
            result = subprocess.run(
                [
                    sys.executable,
                    str(PLUGIN_DIR / "scraper.py"),
                    temp_dir,
                    "--dry-run",
                    "--progress-file",
                    str(progress),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(progress.read_text(encoding="utf-8"))
            self.assertEqual(payload["phase"], "complete")
            self.assertEqual(payload["total"], 0)

    def test_folder_scan_endpoint_completes_and_releases_marker(self):
        # The scan's result is kept in the ComfyUI user folder: patched until the worker is done.
        with tempfile.TemporaryDirectory() as temp_dir, \
                mock.patch.object(scanner, "resolve_folder_subdir", return_value=(temp_dir, temp_dir)), \
                mock.patch.object(scanner.ScanJob, "finish") as finish:
            response = asyncio.run(scanner.api_scan_folder(self.Request()))
            payload = json.loads(response.text)
            self.assertEqual(payload["status"], "ok")

            marker = Path(temp_dir) / ".scan_in_progress"
            deadline = time.monotonic() + 5
            while marker.exists() and time.monotonic() < deadline:
                time.sleep(0.02)

            self.assertFalse(marker.exists())
            self.assertTrue((Path(temp_dir) / ".scan_result.json").exists())
            finish.assert_called_once()


if __name__ == "__main__":
    unittest.main()
