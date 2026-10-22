"""What a scan reports per model, why a model is unmatched, and the scan's result and log entry."""
import asyncio
import hashlib
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from aiohttp.test_utils import make_mocked_request

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

import isolated_layout  # noqa: F401 - side files beside the model, whatever this computer chose
import scraper
from api import activity_log, model_metadata, scan_report, scan_summary, scanner
from model_identity import computed_file_identity

def digest(name):
    return hashlib.sha256(name.encode()).hexdigest()


FOUND = {"id": 7, "modelId": 3, "name": "v2", "baseModel": "SDXL 1.0", "model": {"name": "Found"}, "images": []}


class ScanReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)
        self.report = self.dir / "report.jsonl"

    def tearDown(self):
        self.temp.cleanup()

    def model(self, name, info=None):
        path = self.dir / f"{name}.safetensors"
        header = json.dumps({"__metadata__": {"name": name}, "lora_unet_a.lora_up.weight": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}).encode()
        path.write_bytes(len(header).to_bytes(8, "little") + header + b"\0" * 4)  # a whole LoRA file (not damaged)
        if info is not None:
            Path(str(path)[:-12] + ".info").write_text(json.dumps(info), encoding="utf-8")
        return path

    def info(self, name):
        return json.loads((self.dir / f"{name}.info").read_text(encoding="utf-8"))

    def scan(self, fetch, *flags):
        """Runs the scraper (no real network); returns (models Civitai was asked about, report lines)."""
        asked = []

        def ask(file_hash):
            asked.append(file_hash)
            return fetch(file_hash)

        argv = ["scraper.py", str(self.dir), "--report-file", str(self.report), *flags]
        with mock.patch.object(sys, "argv", argv), \
                mock.patch.object(scraper, "fetch_civitai_info", side_effect=ask), \
                mock.patch.object(scraper, "calculate_sha256", side_effect=lambda p: digest(Path(p).stem)), \
                mock.patch.object(scraper.urllib.request, "urlopen", side_effect=OSError("no network in tests")):
            scraper.main()
        lines = [json.loads(line) for line in self.report.read_text(encoding="utf-8").splitlines()]
        self.report.unlink()
        return asked, lines

    def test_each_model_reports_its_outcome_and_unmatched_ones_keep_why(self):
        self.model("aaa")
        self.model("bbb")
        asked, lines = self.scan(lambda h: dict(FOUND) if h == digest("aaa") else None)
        self.assertEqual(len(asked), 2)
        by_file = {Path(line["file"]).stem: line for line in lines if "file" in line}
        self.assertEqual(by_file["aaa"]["status"], "matched")
        self.assertEqual(by_file["aaa"]["name"], "Found · v2")
        self.assertEqual((by_file["bbb"]["status"], by_file["bbb"]["reason"]), ("inferred", "not_found"))
        self.assertEqual(self.info("bbb")["anomalous_unmatched_reason"], "not_found")
        self.assertEqual(lines[-1], {"event": "done", "unchanged": 0, "civitai_down": False})

    def test_when_covers_will_not_download_the_rest_fetch_none(self):
        # Civitai answered on civitai.red, but its pictures (image.civitai.com) cannot be reached.
        for name in ("c1", "c2", "c3", "c4"):
            self.model(name)
        tried = []
        pictured = {**FOUND, "images": [{"url": "https://image.civitai.com/a/b/orig"}]}
        with mock.patch.object(scraper, "download_media", side_effect=lambda url, base: tried.append(base) or None):
            asked, _lines = self.scan(lambda h: dict(pictured))
        self.assertEqual(len(asked), 4)  # names and trigger words still come
        self.assertEqual(len(tried), scraper.COVERS_DOWN_AFTER)

    def test_when_civitai_stops_answering_the_rest_is_inferred_without_asking(self):
        for name in ("m1", "m2", "m3", "m4"):
            self.model(name)

        def down(_hash):
            raise scraper.CivitaiUnreachable("timeout")

        asked, lines = self.scan(down)
        self.assertEqual(len(asked), scraper.CIVITAI_DOWN_AFTER)
        self.assertIn({"event": "civitai_down", "reason": "timeout"}, lines)  # why, for the scan page
        reasons = [line.get("reason") for line in lines if "file" in line]
        self.assertEqual(reasons, ["network"] * 4)

    def test_online_scans_look_up_models_civitai_was_never_asked_about(self):
        for name, reason in (("off", "offline"), ("net", "network"), ("gone", "not_found")):
            path = self.model(name)
            Path(str(path)[:-12] + ".info").write_text(json.dumps({
                "id": -1, "modelId": -1, "anomalous_unmatched_reason": reason,
                "anomalous_file_identity": computed_file_identity(str(path), digest(name))}), encoding="utf-8")
        asked, lines = self.scan(lambda h: dict(FOUND))
        self.assertEqual(sorted(asked), sorted([digest("net"), digest("off")]))
        self.assertEqual(self.info("gone")["id"], -1)  # waits for "look up again"
        self.assertEqual(self.info("off")["id"], 7)
        # An offline scan leaves them alone.
        asked, _ = self.scan(lambda h: dict(FOUND), "--offline-only")
        self.assertEqual(asked, [])

    def test_one_models_failure_does_not_end_the_scan(self):
        self.model("bad")
        self.model("good")

        def fetch(file_hash):
            if file_hash == digest("bad"):
                raise PermissionError("locked")
            return dict(FOUND)

        _asked, lines = self.scan(fetch)
        by_file = {Path(line["file"]).stem: line for line in lines if "file" in line}
        self.assertEqual(by_file["bad"]["status"], "failed")
        self.assertIn("locked", by_file["bad"]["error"])
        self.assertEqual(by_file["good"]["status"], "matched")

    def test_job_result_locates_models_and_is_kept_and_logged(self):
        sub = self.dir / "sub"
        sub.mkdir()
        self.report.write_text("\n".join(json.dumps(line) for line in (
            {"file": str(sub / "a.safetensors"), "status": "matched", "name": "A · v1", "cover": "new"},
            {"file": str(self.dir / "b.safetensors"), "status": "inferred", "reason": "network", "base": "Flux.1 D"},
            {"file": str(self.dir / "old.safetensors"), "status": "unchanged", "renamed_to": str(self.dir / "New_v1.safetensors")},
            {"event": "civitai_down", "reason": "refused"},
            {"event": "done", "unchanged": 5},
        )), encoding="utf-8")
        log = self.dir / "activity_log.json"
        with mock.patch.object(scan_report, "log_path", return_value=str(log)), \
                mock.patch.object(activity_log, "log_path", return_value=str(log)):
            activity_log._entries = None
            job = scan_report.ScanJob("all", {"offline_only": False})
            job.add_folder(str(self.report), str(self.dir), ("loras", 0))
            result = job.finish()
            entry = activity_log.list_entries()[0]
            activity_log._entries = None
        self.assertFalse(self.report.exists())
        self.assertEqual(result["counts"], {"matched": 1, "inferred": 1, "failed": 0, "covers": 1, "renamed": 1, "unchanged": 5})
        self.assertTrue(result["civitai_down"])
        self.assertEqual(result["civitai_error"], "refused")
        first, _, renamed = result["files"]
        self.assertEqual((first["type"], first["rel"], first["filename"]), ("loras", "sub/a.safetensors", "a.safetensors"))
        self.assertEqual((renamed["filename"], renamed["renamed_from"]), ("New_v1.safetensors", "old.safetensors"))
        self.assertEqual(json.loads((self.dir / "last_scan.json").read_text(encoding="utf-8"))["counts"]["matched"], 1)
        self.assertEqual(entry["action"], "scan_done")
        self.assertEqual(entry["detail"]["scan"]["counts"]["inferred"], 1)
        self.assertEqual(len(entry["detail"]["files"]), 3)

    def test_summary_lists_unmatched_and_new_models_with_why(self):
        self.model("new")
        self.model("gone", {"id": -1, "anomalous_unmatched_reason": "not_found", "baseModel": "SD 1.5"})
        self.model("off", {"id": -1, "anomalous_unmatched_reason": "offline"})
        self.model("found", {"id": 3})
        with mock.patch.object(scan_summary, "get_active_scan_paths", return_value=[str(self.dir)]), \
                mock.patch.object(scan_summary, "locate_root", return_value=("loras", 1)):
            summary = scan_summary._summarize()
        self.assertEqual((summary["total"], summary["matched"], summary["unmatched"], summary["new"], summary["pending"]), (4, 1, 2, 1, 1))
        self.assertEqual(summary["new_models"], [{"type": "loras", "path_idx": 1, "filename": "new.safetensors", "rel": "new.safetensors", "state": "new"}])
        reasons = {item["filename"]: (item["reason"], item["base"]) for item in summary["unmatched_models"]}
        self.assertEqual(reasons, {"gone.safetensors": ("not_found", "SD 1.5"), "off.safetensors": ("offline", "")})

    def test_components_are_counted_and_listed_on_their_own(self):
        loras, vae = self.dir / "loras", self.dir / "vae"
        for folder in (loras, vae):
            folder.mkdir()
        top = self.dir
        self.dir = loras
        self.model("style", {"id": 3})
        self.dir = vae
        self.model("found_vae", {"id": 4})
        self.model("odd_vae", {"id": -1, "anomalous_unmatched_reason": "not_found"})
        self.model("new_vae")
        self.dir = top
        roots = {str(loras): ("loras", 0), str(vae): ("vae", 0)}
        with mock.patch.object(scan_summary, "get_active_scan_paths", return_value=[str(loras), str(vae)]), \
                mock.patch.object(scan_summary, "locate_root", side_effect=lambda path: roots[path]):
            summary = scan_summary._summarize()
        self.assertEqual((summary["total"], summary["matched"], summary["unmatched"], summary["new"]), (4, 2, 1, 1))
        self.assertEqual(summary["components"], {"total": 3, "matched": 1, "unmatched": 1, "new": 1, "pending": 0})
        states = {item["filename"]: (item["state"], item.get("reason", "")) for item in summary["component_models"]}
        self.assertEqual(states, {"found_vae.safetensors": ("matched", ""), "odd_vae.safetensors": ("unmatched", "not_found"),
                                  "new_vae.safetensors": ("new", "")})
        self.assertTrue(all(item.get("component") for item in summary["unmatched_models"] + summary["new_models"]))

    def test_summary_has_the_scanned_models_covers_newest_first(self):
        loras, vae = self.dir / "loras", self.dir / "vae"
        top, now = self.dir, time.time()
        for folder, name, info, age, cover in (
                (loras, "old", {"id": 3}, 300, True), (loras, "fresh", {"id": 4}, 100, True),
                (loras, "gone", {"id": -1, "anomalous_unmatched_reason": "not_found"}, 200, True),
                (loras, "bare", {"id": 5}, 50, False), (loras, "new", None, 10, True), (vae, "part", {"id": 6}, 5, True)):
            folder.mkdir(exist_ok=True)
            self.dir = folder
            path = self.model(name, info)
            if cover:
                (folder / f"{name}.preview.png").write_bytes(b"png")
            os.utime(path, (now - age, now - age))
        self.dir = top
        roots = {str(loras): ("loras", 0), str(vae): ("vae", 0)}
        with mock.patch.object(scan_summary, "get_active_scan_paths", return_value=[str(loras), str(vae)]), \
                mock.patch.object(scan_summary, "locate_root", side_effect=lambda path: roots[path]):
            summary = scan_summary._summarize()
            with mock.patch.object(scan_summary, "COVER_SAMPLE", 1):
                capped = scan_summary._summarize()
        # Scanned ones with a cover, found or not; not the new one, the one without a cover or the component.
        self.assertEqual([cover["name"] for cover in summary["covers"]], ["fresh", "gone", "old"])
        self.assertIn("filename=fresh.preview.png", summary["covers"][0]["preview_url"])
        self.assertEqual([cover["name"] for cover in capped["covers"]], ["fresh"])

    def test_picker_lists_every_model_a_scan_reads_with_its_badge_fields(self):
        self.model("new")
        self.model("found", {**FOUND, "description": "<p>long text</p>"})
        (self.dir / "found.preview.png").write_bytes(b"png")
        self.model("skipped")
        (self.dir / "skipped.anomalous.json").write_text(json.dumps({"format": 1, "scan": "skip"}), encoding="utf-8")
        (self.dir / "sub").mkdir()
        self.dir, top = self.dir / "sub", self.dir
        self.model("deep", {"id": -1, "anomalous_unmatched_reason": "damaged"})
        self.dir = top
        (self.dir / "old.ckpt").write_bytes(b"never read")
        with mock.patch.object(scan_summary, "get_active_scan_paths", return_value=[str(self.dir)]), \
                mock.patch.object(scan_summary, "locate_root", return_value=("loras", 1)):
            listed = scan_summary._pickable()
            with mock.patch.object(scan_summary, "MAX_PICKABLE", 2):
                capped = scan_summary._pickable()
        models = {item["rel"]: item for item in listed["models"]}
        self.assertEqual(sorted(models), ["found.safetensors", "new.safetensors", "skipped.safetensors", "sub/deep.safetensors"])
        self.assertEqual(listed["total"], 4)
        self.assertEqual(listed["roots"], [{"type": "loras", "path_idx": 1, "name": self.dir.name, "parent": self.dir.parent.name}])
        found = models["found.safetensors"]
        self.assertEqual((found["type"], found["path_idx"], found["filename"]), ("loras", 1, "found.safetensors"))
        self.assertIn("filename=found.preview.png", found["preview_url"])
        self.assertEqual(found["size"], (self.dir / "found.safetensors").stat().st_size)
        self.assertEqual(set(found["metadata"]), set(scan_summary.PICKER_FIELDS))  # no description
        self.assertEqual((found["metadata"]["info_source"], found["metadata"]["baseModel"]), ("civitai", "SDXL 1.0"))
        self.assertEqual(models["skipped.safetensors"]["metadata"]["scan_choice"], "skip")
        self.assertEqual(models["sub/deep.safetensors"]["metadata"]["unmatched_reason"], "damaged")
        self.assertEqual(models["new.safetensors"]["metadata"]["info_source"], "")
        self.assertEqual((len(capped["models"]), capped["total"]), (2, 4))


class EditDetailTests(unittest.TestCase):
    def test_editing_a_model_logs_what_changed_from_what(self):
        with tempfile.TemporaryDirectory() as temp:
            model = Path(temp) / "m.safetensors"
            model.write_bytes(b"m")
            (Path(temp) / "m.anomalous.json").write_text(json.dumps({"custom_name": "Old"}), encoding="utf-8")
            request = make_mocked_request("POST", "/anomalous/update_metadata")
            body = {"type": "loras", "filename": "m.safetensors", "custom_name": "New", "custom_notes": ""}
            request.json = lambda: asyncio.sleep(0, body)
            with mock.patch.object(model_metadata, "resolve_folder_subdir", return_value=(temp, temp)):
                asyncio.run(model_metadata.api_update_metadata(request))
        self.assertEqual(request[activity_log.ACTIVITY_DETAIL], {"fields": [{"field": "custom_name", "before": "Old", "after": "New"}]})
        self.assertEqual(activity_log._clean_detail({"fields": [{"field": "custom_notes", "after": "x" * (activity_log.MAX_CHANGE_CHARS + 100)}]})["fields"][0]["after"][-1], "…")


class ScanPlanTests(unittest.TestCase):
    def test_picked_models_scan_their_own_folders_and_bad_targets_are_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            sub = str(Path(temp) / "sub")
            Path(sub).mkdir()
            resolve = lambda _type, _idx, subfolder: (temp, sub if subfolder == "/sub" else temp)
            with mock.patch.object(scanner, "resolve_folder_subdir", side_effect=resolve):
                plan = scanner._global_scan_plan({"targets": [
                    {"type": "loras", "path_idx": 0, "subfolder": "/sub", "files": ["a.safetensors"]},
                    {"type": "loras", "path_idx": 0, "subfolder": "/", "files": []},  # nothing picked there
                ]})
                self.assertEqual(plan, [(sub, ("loras", 0), temp, ["a.safetensors"], "loras")])
                for bad in ({"targets": "loras"}, {"targets": [{"type": "loras", "files": "a.safetensors"}]}):
                    with self.assertRaises(ValueError):
                        scanner._global_scan_plan(bad)


if __name__ == "__main__":
    unittest.main()
