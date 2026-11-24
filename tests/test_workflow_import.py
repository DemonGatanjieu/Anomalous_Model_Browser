"""A workflow out of a picture dropped on the Workflows page (api/workflow_import.py): a PNG's workflow text,
a WebP's EXIF, a picture keeping only the run told apart, bad or huge files refused, this computer only."""
import asyncio
import io
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

from aiohttp.test_utils import make_mocked_request
from PIL import Image, PngImagePlugin

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import local_guard, workflow_import  # noqa: E402

WORKFLOW = {"last_node_id": 2, "links": [], "nodes": [
    {"id": 1, "type": "KSampler", "widgets_values": [7, "fixed"]},
    {"id": 2, "type": "SomePackNotInstalled", "properties": {"kept": True}, "widgets_values": ["as it was"]},
]}
PROMPT = {"1": {"class_type": "KSampler", "inputs": {"seed": 7}}}


def png(**texts):
    info = PngImagePlugin.PngInfo()
    for key, value in texts.items():
        info.add_text(key, json.dumps(value))
    out = io.BytesIO()
    Image.new("RGB", (4, 4)).save(out, format="PNG", pnginfo=info)
    return out.getvalue()


def webp(tags):
    image = Image.new("RGB", (4, 4))
    exif = image.getexif()
    for tag, text in tags.items():
        exif[tag] = text
    out = io.BytesIO()
    image.save(out, format="WEBP", exif=exif)
    return out.getvalue()


def code_of(raw, name=""):
    with unittest.TestCase().assertRaises(workflow_import.WorkflowImportError) as caught:
        workflow_import.extract_workflow_from_image_bytes(raw, name)
    return caught.exception.code


def inspect(raw, name="x.png"):
    request = make_mocked_request("POST", f"/anomalous/inspect_workflow_file?name={name}", headers={"Content-Length": str(len(raw))})
    request.read = lambda: asyncio.sleep(0, raw)
    response = asyncio.run(workflow_import.api_inspect_workflow_file(request))
    return response.status, json.loads(response.text)


class WorkflowImportTests(unittest.TestCase):
    def test_a_png_gives_its_workflow_as_written_and_its_name(self):
        found = workflow_import.extract_workflow_from_image_bytes(png(workflow=WORKFLOW, prompt=PROMPT), "C:\\pics\\my flow.png")
        self.assertEqual(found["workflow"], WORKFLOW)  # a node of a pack not installed stays whole
        self.assertEqual(found["suggested_name"], "my flow")

    def test_a_png_with_only_the_run_is_told_apart(self):
        self.assertEqual(code_of(png(prompt=PROMPT)), "api_only")
        self.assertEqual(code_of(png()), "no_workflow")

    def test_a_webp_gives_the_workflow_from_its_exif(self):
        raw = webp({0x010F: "workflow:" + json.dumps(WORKFLOW), 0x0110: "prompt:" + json.dumps(PROMPT)})
        self.assertEqual(workflow_import.extract_workflow_from_image_bytes(raw, "out.webp")["workflow"], WORKFLOW)
        other = webp({0x010E: "Workflow:" + json.dumps(WORKFLOW)})
        self.assertEqual(workflow_import.extract_workflow_from_image_bytes(other)["workflow"], WORKFLOW)
        self.assertEqual(code_of(webp({0x0110: "prompt:" + json.dumps(PROMPT)})), "api_only")

    def test_bad_huge_or_broken_files_are_refused_cleanly(self):
        self.assertEqual(code_of(b""), "too_large")
        self.assertEqual(code_of(b"not a picture at all"), "not_image")
        with mock.patch.object(workflow_import, "MAX_WORKFLOW_IMAGE_BYTES", 10):
            self.assertEqual(code_of(png(workflow=WORKFLOW)), "too_large")
        twice = {"nodes": [{"id": 1, "type": "A"}, {"id": 1, "type": "B"}]}
        self.assertEqual(code_of(png(workflow=twice)), "invalid_workflow")
        self.assertEqual(code_of(png(workflow={"nodes": "none"})), "no_workflow")

    def test_the_route_answers_and_is_for_this_computer_only(self):
        status, body = inspect(png(workflow=WORKFLOW), "drop.png")
        self.assertEqual((status, body["status"], body["suggested_name"]), (200, "success", "drop"))
        status, body = inspect(png(prompt=PROMPT))
        self.assertEqual((status, body["code"]), (400, "api_only"))
        self.assertTrue(local_guard.needs_local("POST", "/anomalous/inspect_workflow_file"))
        self.assertNotIn("/anomalous/inspect_workflow_file", local_guard.OPEN_POSTS)
        routes = (PLUGIN / "api" / "__init__.py").read_text(encoding="utf-8")
        self.assertIn("add_post('/anomalous/inspect_workflow_file', workflow_import.api_inspect_workflow_file)", routes)


if __name__ == "__main__":
    unittest.main()
