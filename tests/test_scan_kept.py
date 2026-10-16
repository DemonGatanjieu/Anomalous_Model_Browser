"""Many models, or models on a network drive: headers are read once per file version (kept on
disk), the scan page gets the last summary at once, and requests meanwhile share one count."""
import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from aiohttp.test_utils import make_mocked_request

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import metadata, model_heads, scan_summary


def write_model(path, info=None):
    header = json.dumps({"lora_unet_a.lora_up.weight": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}).encode()
    Path(path).write_bytes(len(header).to_bytes(8, "little") + header + b"\0" * 4)
    if info is not None:
        Path(str(path)[:-12] + ".info").write_text(json.dumps(info), encoding="utf-8")


class ModelHeadsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)
        self.cache = str(self.dir / "model_heads.json")
        for name, value in (("_heads", None), ("_on_disk", True), ("_timer", None)):
            patcher = mock.patch.object(model_heads, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = mock.patch.object(model_heads, "cache_path", return_value=self.cache)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.reads = []
        real = model_heads.inspect_file
        patcher = mock.patch.object(model_heads, "inspect_file", side_effect=lambda path: self.reads.append(path) or real(path))
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        if model_heads._timer:
            model_heads._timer.cancel()
        self.temp.cleanup()

    def test_a_header_is_read_once_per_file_version_also_after_a_restart(self):
        model = self.dir / "style.safetensors"
        write_model(model)
        first = model_heads.inspect(str(model))
        self.assertEqual(model_heads.inspect(str(model)), first)
        self.assertEqual(len(self.reads), 1)
        model_heads.save()
        model_heads._heads = None  # ComfyUI restarted
        self.assertEqual(model_heads.inspect(str(model)), first)
        self.assertEqual(len(self.reads), 1)
        write_model(model, None)
        os.utime(model, ns=(1, 1))  # the file changed
        model_heads.inspect(str(model))
        self.assertEqual(len(self.reads), 2)

    def test_the_longest_unused_files_go_first_when_there_are_too_many(self):
        model_heads._heads = {"old": [1, 1, 10, "", "", False, None], "new": [1, 1, 20, "", "", False, None]}
        with mock.patch.object(model_heads, "MAX_ENTRIES", 1):
            model_heads.save()
        self.assertEqual(list(json.loads(Path(self.cache).read_text(encoding="utf-8"))), ["new"])

    def test_nothing_is_written_before_the_plugin_starts(self):
        model_heads._on_disk = False
        model_heads._heads = None
        model = self.dir / "style.safetensors"
        write_model(model)
        model_heads.inspect(str(model))
        self.assertIsNone(model_heads._timer)
        self.assertFalse(os.path.exists(self.cache))


class KeptSummaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)
        write_model(self.dir / "found.safetensors", {"id": 7, "modelId": 3, "name": "v2", "baseModel": "SDXL 1.0", "model": {"name": "Found"}})
        write_model(self.dir / "fresh.safetensors")
        metadata.clear_metadata_cache()
        for patcher in (mock.patch.object(scan_summary, "_last", {}), mock.patch.object(scan_summary, "_working", None),
                        mock.patch.object(scan_summary, "_summary_path", return_value=str(self.dir / "scan_summary.json")),
                        mock.patch.object(scan_summary, "get_active_scan_paths", return_value=[str(self.dir)]),
                        mock.patch.object(scan_summary, "locate_root", return_value=("loras", 0))):
            patcher.start()
            self.addCleanup(patcher.stop)

    def tearDown(self):
        self.temp.cleanup()

    def ask(self, route, query=""):
        async def run():
            response = await route(make_mocked_request("GET", f"/x{query}"))
            return json.loads(response.text)
        return asyncio.run(run())

    def test_the_last_summary_comes_at_once_and_after_a_restart(self):
        self.assertEqual(self.ask(scan_summary.api_scan_summary, "?quick=1"), {})
        fresh = self.ask(scan_summary.api_scan_summary)
        self.assertEqual((fresh["total"], fresh["matched"], fresh["new"]), (2, 1, 1))
        self.assertNotIn("matched_models", fresh)  # listed on request, the page's summary stays small
        self.assertEqual(self.ask(scan_summary.api_scan_summary, "?quick=1")["summary"], fresh)
        scan_summary._last.clear()  # ComfyUI restarted: from disk
        self.assertEqual(self.ask(scan_summary.api_scan_summary, "?quick=1")["summary"], fresh)

    def test_the_models_found_on_civitai_are_listed_with_their_names(self):
        found = self.ask(scan_summary.api_scan_matched)
        self.assertEqual(found["total"], 1)
        self.assertEqual({key: found["models"][0][key] for key in ("filename", "name", "base")},
                         {"filename": "found.safetensors", "name": "Found · v2", "base": "SDXL 1.0"})

    def test_requests_meanwhile_share_one_count(self):
        counted = []
        real = scan_summary._summarize
        async def both():
            return await asyncio.gather(scan_summary._fresh(), scan_summary._fresh())
        with mock.patch.object(scan_summary, "_summarize", side_effect=lambda **kw: counted.append(1) or real(**kw)):
            first, second = asyncio.run(both())
        self.assertEqual(len(counted), 1)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
