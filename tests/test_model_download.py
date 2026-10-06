"""Model Check's downloads: finding the one exact file, where it may go, and fetching it safely.
No network: every site answer is faked; files go to a temporary folder."""
import asyncio
import hashlib
import io
import json
import os
import sys
import tempfile
import time
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from aiohttp.test_utils import make_mocked_request

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import download_sources, hf_card, model_download  # noqa: E402

DATA = b"model bytes " * 1000
SHA = hashlib.sha256(DATA).hexdigest()


def civitai_version(sha=SHA, name="cool.safetensors"):
    return {
        "id": 456, "modelId": 123, "name": "v1", "baseModel": "SDXL 1.0", "model": {"name": "Cool", "nsfw": False},
        "files": [
            {"name": "other.pt", "sizeKB": 1, "downloadUrl": "https://civitai.com/api/download/models/456?type=Training",
             "hashes": {"SHA256": "AB" * 32}},
            {"name": name, "sizeKB": len(DATA) / 1024, "primary": True, "downloadUrl": "https://civitai.com/api/download/models/456",
             "hashes": {"SHA256": sha.upper(), "AutoV2": sha[:10].upper()}, "metadata": {"format": "SafeTensor"}},
        ],
    }


class SourceTests(unittest.TestCase):
    def test_civitai_by_hash_picks_the_file_with_that_hash(self):
        with mock.patch.object(download_sources, "_get_json", return_value=civitai_version()):
            found = download_sources.find_source(SHA[:10])  # AutoV2
        self.assertTrue(found["found"])
        self.assertEqual(found["download_url"], "https://civitai.com/api/download/models/456")
        self.assertEqual(found["sha256"], SHA)
        self.assertEqual(found["base_model"], "SDXL 1.0")
        self.assertEqual(found["page"], "https://civitai.com/models/123?modelVersionId=456")

    def test_a_version_without_that_hash_is_no_source(self):
        with mock.patch.object(download_sources, "_get_json", return_value=civitai_version(sha="cd" * 32)):
            self.assertFalse(download_sources.find_source(SHA)["found"])

    def test_a_civitai_link_needs_a_version_and_takes_the_file_of_that_name(self):
        asked = []
        def fake(url, headers):
            asked.append(url)
            return civitai_version()
        with mock.patch.object(download_sources, "_get_json", side_effect=fake):
            found = download_sources.find_source(url="https://civitai.com/models/123?modelVersionId=456", name="cool.safetensors")
            self.assertTrue(found["found"])
            self.assertTrue(asked[-1].endswith("/model-versions/456"))
            # A model page without a version could mean any version: not a source.
            self.assertFalse(download_sources.find_source(url="https://civitai.com/models/123", name="cool.safetensors")["found"])
            # A renamed file: the version's primary model file (the hash, when there is one, still decides).
            renamed = download_sources.find_source(url="https://civitai.com/models/123?modelVersionId=456", name="renamed.safetensors")
            self.assertEqual(renamed["file_name"], "cool.safetensors")
            self.assertFalse(download_sources.find_source(url="https://civitai.com/models/123?modelVersionId=456",
                                                          file_hash="cd" * 32)["found"])

    def test_a_file_name_alone_is_never_a_source(self):
        self.assertEqual(download_sources.find_source("", "", "cool.safetensors"), {"found": False, "reason": "no_source"})

    def test_hugging_face_links_become_file_links_with_size_and_hash(self):
        self.assertEqual(download_sources._hf_file_url("https://huggingface.co/org/repo/blob/main/split/vae/ae.safetensors?download=true"),
                         "https://huggingface.co/org/repo/resolve/main/split/vae/ae.safetensors")
        self.assertEqual(download_sources._hf_file_url("https://huggingface.co/org/repo"), "")
        headers = {"x-linked-size": str(len(DATA)), "x-linked-etag": f'"{SHA}"'}
        redirect = urllib.error.HTTPError("u", 302, "Found", headers, None)
        opener = mock.Mock()
        opener.open.side_effect = redirect
        with mock.patch.object(download_sources.urllib.request, "build_opener", return_value=opener):
            found = download_sources.find_source(url="https://hf-mirror.com/org/repo/resolve/main/ae.safetensors")
        self.assertEqual((found["source"], found["size"], found["sha256"]), ("huggingface", len(DATA), SHA))

    def test_the_mirror_setting_picks_the_host_and_follows_its_redirect(self):
        asked = []
        def head(url):
            asked.append(url)
            if "hf-mirror.com" in url:  # outside China the mirror sends you back
                return {"Location": url.replace("hf-mirror.com", "huggingface.co")}, True
            return {"x-linked-size": str(len(DATA)), "x-linked-etag": f'"{SHA}"'}, True
        link = "https://huggingface.co/org/repo/blob/main/ae.safetensors"
        with mock.patch.object(download_sources, "_head", side_effect=head):
            found = download_sources.find_source(url=link, hf_mirror=True)
            self.assertEqual(found["download_url"], "https://hf-mirror.com/org/repo/resolve/main/ae.safetensors")
            self.assertTrue(found["mirror"])
            self.assertEqual((found["size"], found["sha256"]), (len(DATA), SHA))
            self.assertEqual(len(asked), 2)
            # Without the mirror, a mirror link is fetched from Hugging Face itself.
            found = download_sources.find_source(url=link.replace("huggingface.co", "hf-mirror.com"))
            self.assertEqual(found["download_url"], "https://huggingface.co/org/repo/resolve/main/ae.safetensors")
            self.assertFalse(found["mirror"])

    def test_only_https_links_on_known_sites_may_be_downloaded(self):
        allowed = download_sources.allowed_download_url
        self.assertTrue(allowed("https://civitai.com/api/download/models/1"))
        self.assertTrue(allowed("https://huggingface.co/a/b/resolve/main/x.safetensors"))
        self.assertFalse(allowed("http://civitai.com/api/download/models/1"))
        self.assertFalse(allowed("https://civitai.com.evil.example/x"))
        self.assertFalse(allowed("https://example.com/x.safetensors"))
        self.assertFalse(allowed("file:///etc/passwd"))

    def test_network_failure_is_told_apart(self):
        with mock.patch.object(download_sources, "_get_json", side_effect=download_sources.SourceUnreachable("down")):
            self.assertEqual(download_sources.find_source(SHA)["reason"], "network")

    def test_lookup_refuses_a_link_to_another_file(self):
        with mock.patch.object(model_download, "find_source", return_value={"found": True, "sha256": "cd" * 32, "page": "p"}):
            self.assertEqual(model_download.lookup_item({"hash": SHA, "url": "https://huggingface.co/a/b/resolve/main/x.safetensors"})["reason"],
                             "different_file")


class FakeResponse(io.BytesIO):
    def __init__(self, data, status=200, headers=None):
        super().__init__(data)
        self.status = status
        self.headers = {"Content-Length": str(len(data)), "Content-Type": "application/octet-stream", **(headers or {})}


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self.temp.name)
        self.patches = [
            mock.patch.object(model_download.folder_paths, "folder_names_and_paths", {"loras": ([self.root], set())}),
            mock.patch.object(model_download.folder_paths, "get_folder_paths", side_effect=lambda t: [self.root] if t == "loras" else []),
            mock.patch.object(model_download, "add_entry"),
            mock.patch.object(model_download, "settings_path", return_value=os.path.join(self.root, "settings.json")),
        ]
        for patch in self.patches:
            patch.start()
        self.add_entry = model_download.add_entry

    def tearDown(self):
        for patch in reversed(self.patches):
            patch.stop()
        self.temp.cleanup()

    def job(self, **changes):
        data = {"download_url": "https://civitai.com/api/download/models/456", "type": "loras", "root": 0,
                "rel": "Flux/cool.safetensors", "sha256": SHA, "size": len(DATA), "value": "Flux\\cool.safetensors", "source": "civitai"}
        data.update(changes)
        return model_download.plan_job(data)

    def run_with(self, job, responses):
        calls = []
        def fake(request, timeout=0):
            calls.append(request)
            answer = responses.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer
        with mock.patch.object(model_download.urllib.request, "urlopen", side_effect=fake):
            model_download.run_job(job)
        return calls

    def test_where_a_file_may_go(self):
        refused = lambda **c: self.assertRaises((model_download.DownloadError, ValueError), self.job, **c)
        refused(rel="../outside.safetensors")
        refused(rel="C:/Windows/x.safetensors")
        refused(rel="Flux/cool.txt")
        refused(download_url="https://example.com/cool.safetensors")
        refused(type="checkpoints")
        refused(root=3)
        os.makedirs(os.path.join(self.root, "Flux"))
        Path(self.root, "Flux", "cool.safetensors").write_bytes(b"mine")
        with self.assertRaises(model_download.DownloadError) as caught:
            self.job()
        self.assertEqual(caught.exception.code, "exists")
        with mock.patch.object(model_download.shutil, "disk_usage", return_value=mock.Mock(free=10)):
            with self.assertRaises(model_download.DownloadError) as caught:
                self.job(rel="other.safetensors")
            self.assertEqual(caught.exception.code, "no_space")

    def test_a_download_is_checked_then_named_and_recorded(self):
        job = self.job()
        self.run_with(job, [FakeResponse(DATA)])
        self.assertEqual((job["state"], job["error"], job["verified"]), ("done", "", True))
        dest = Path(self.root, "Flux", "cool.safetensors")
        self.assertEqual(dest.read_bytes(), DATA)
        self.assertFalse(Path(str(dest) + ".part").exists())
        source, action, target, detail = self.add_entry.call_args.args
        self.assertEqual((source, action, target), ("file", "model_download", "Flux/cool.safetensors"))
        self.assertEqual(detail["download"]["sha256"], SHA)

    def test_a_wrong_file_never_lands(self):
        job = self.job(sha256="cd" * 32)
        self.run_with(job, [FakeResponse(DATA)])
        self.assertEqual((job["state"], job["error"]), ("failed", "hash_mismatch"))
        self.assertEqual(os.listdir(os.path.join(self.root, "Flux")), [])
        self.add_entry.assert_not_called()

    def test_the_workflow_hash_checks_when_the_site_gives_none(self):
        job = self.job(sha256="", hash=SHA[:10])
        self.run_with(job, [FakeResponse(DATA)])
        self.assertEqual((job["state"], job["verified"]), ("done", True))

    def test_an_interrupted_download_continues(self):
        os.makedirs(os.path.join(self.root, "Flux"))
        Path(self.root, "Flux", "cool.safetensors.part").write_bytes(DATA[:5000])
        job = self.job()
        calls = self.run_with(job, [FakeResponse(DATA[5000:], status=206)])
        self.assertEqual(calls[0].get_header("Range"), "bytes=5000-")
        self.assertEqual(job["state"], "done")
        self.assertEqual(Path(self.root, "Flux", "cool.safetensors").read_bytes(), DATA)

    def test_a_site_that_ignores_the_range_sends_it_all_again(self):
        os.makedirs(os.path.join(self.root, "Flux"))
        Path(self.root, "Flux", "cool.safetensors.part").write_bytes(b"junk")
        job = self.job()
        self.run_with(job, [FakeResponse(DATA, status=200)])
        self.assertEqual(Path(self.root, "Flux", "cool.safetensors").read_bytes(), DATA)

    def test_a_login_page_is_not_a_model(self):
        job = self.job()
        self.run_with(job, [FakeResponse(b"<html>", headers={"Content-Type": "text/html; charset=utf-8"})])
        self.assertEqual((job["state"], job["error"]), ("failed", "not_a_file"))
        self.assertFalse(Path(self.root, "Flux", "cool.safetensors").exists())

    def test_civitai_login_needed(self):
        job = self.job()
        with mock.patch.object(model_download, "_load_api_key", return_value=None):
            self.run_with(job, [urllib.error.HTTPError("u", 401, "no", {}, None)])
        self.assertEqual(job["error"], "needs_key")

    def test_the_key_goes_to_civitai_only_and_not_along_redirects(self):
        with mock.patch.object(model_download, "_load_api_key", return_value="secret"):
            calls = self.run_with(self.job(), [FakeResponse(DATA)])
            self.assertEqual(calls[0].unredirected_hdrs.get("Authorization"), "Bearer secret")
            self.assertNotIn("Authorization", calls[0].headers)
            calls = self.run_with(self.job(rel="b.safetensors", download_url="https://huggingface.co/a/b/resolve/main/b.safetensors"),
                                  [FakeResponse(DATA)])
            self.assertIsNone(calls[0].unredirected_hdrs.get("Authorization"))

    def test_a_network_failure_keeps_what_came(self):
        job = self.job()
        self.run_with(job, [urllib.error.URLError("reset")])
        self.assertEqual((job["state"], job["error"]), ("failed", "network"))

    def test_cancel_removes_the_unfinished_file(self):
        job = self.job()
        job["cancel"] = True
        self.run_with(job, [FakeResponse(DATA)])
        self.assertEqual(job["state"], "cancelled")
        self.assertFalse(Path(self.root, "Flux", "cool.safetensors.part").exists())

    def test_settings(self):
        self.assertEqual(model_download.read_settings(), {"place": "workflow", "folder": "Downloads", "hf_mirror": None})
        def call(body):
            request = make_mocked_request("POST", "/anomalous/download/settings")
            request.json = lambda: asyncio.sleep(0, body)
            response = asyncio.run(model_download.api_settings(request))
            return response.status, json.loads(response.text)
        self.assertEqual(call({"place": "folder", "folder": "\\Models\\{base}\\", "hf_mirror": True})[1],
                         {"place": "folder", "folder": "Models/{base}", "hf_mirror": True})
        self.assertEqual(call({"folder": "../up"})[0], 400)
        self.assertEqual(model_download.read_settings()["folder"], "Models/{base}")

    def test_a_site_that_stops_answering_is_skipped_but_the_others_are_asked(self):
        civitai = []
        def offline(url, headers):
            civitai.append(url)
            raise download_sources.SourceUnreachable("down")
        def head(url):
            return {"x-linked-size": str(len(DATA)), "x-linked-etag": f'"{SHA}"'}, True
        listed = [{"name": "Flux VAE", "url": "https://huggingface.co/bfl/flux/resolve/main/ae.safetensors", "folder": "vae", "base": "FLUX.1"}]
        request = make_mocked_request("POST", "/anomalous/download/lookup")
        items = [{"key": str(i), "hash": SHA, "types": ["loras"], "value": "a.safetensors"} for i in range(3)]
        items.append({"key": "3", "hash": SHA, "types": ["vae"], "value": "vae\\ae.safetensors"})
        items.append({"key": "4", "types": ["loras"], "value": "b.safetensors"})
        request.json = lambda: asyncio.sleep(0, {"items": items, "hf_mirror": True})
        with mock.patch.object(download_sources, "_get_json", side_effect=offline), \
                mock.patch.object(download_sources, "_head", side_effect=head), \
                mock.patch.object(download_sources.manager_catalog, "candidates",
                                  side_effect=lambda name, folder="": listed if name == "ae.safetensors" else []):
            body = json.loads(asyncio.run(model_download.api_lookup(request)).text)
        self.assertEqual(len(civitai), 1)  # Civitai asked once, not once per model
        reasons = [r.get("reason") for r in body["results"]]
        self.assertEqual(reasons[:3], ["network"] * 3)
        self.assertTrue(body["results"][3]["found"])  # Hugging Face (mirror) through the Manager's list
        self.assertEqual(body["results"][3]["download_url"], "https://hf-mirror.com/bfl/flux/resolve/main/ae.safetensors")
        self.assertEqual(reasons[4], "no_source")
        self.assertEqual(body["roots"]["loras"][0]["path"], self.root)

    def test_one_at_a_time_through_the_queue(self):
        order = []
        def fake_run(job):
            order.append(job["rel"])
            job["finished"] = time.time()
        with mock.patch.object(model_download, "run_job", side_effect=fake_run):
            model_download.enqueue(self.job(rel="a.safetensors"))
            model_download.enqueue(self.job(rel="b.safetensors"))
            for _ in range(100):
                if model_download._worker is None:
                    break
                time.sleep(0.01)
        self.assertEqual(order, ["a.safetensors", "b.safetensors"])


class ManagerListTests(unittest.TestCase):
    """ComfyUI-Manager's model list as a source by file name, checked by the fingerprint."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        path = os.path.join(self.temp.name, "model-list.json")
        hf = "https://huggingface.co/{}/resolve/main/{}"
        models = [
            {"name": "FLUX VAE", "type": "VAE", "save_path": "vae/FLUX1", "filename": "ae.safetensors", "url": hf.format("bfl/one", "ae.safetensors"), "base": "FLUX.1"},
            {"name": "CN A", "type": "controlnet", "save_path": "controlnet/SDXL", "filename": "diffusion_pytorch_model.safetensors", "url": hf.format("a/cn", "diffusion_pytorch_model.safetensors")},
            {"name": "CN B", "type": "controlnet", "save_path": "controlnet/SDXL", "filename": "diffusion_pytorch_model.safetensors", "url": hf.format("b/cn", "diffusion_pytorch_model.safetensors")},
            {"name": "UNet", "type": "diffusion_model", "save_path": "diffusion_models/x", "filename": "diffusion_pytorch_model.safetensors", "url": hf.format("c/unet", "diffusion_pytorch_model.safetensors")},
            {"name": "Upscaler", "type": "upscale", "save_path": "default", "filename": "4x-UltraSharp.pth", "url": hf.format("k/u", "4x-UltraSharp.pth")},
            {"name": "Elsewhere", "type": "VAE", "save_path": "default", "filename": "x.pth", "url": "http://example.com/x.pth"},
        ]
        Path(path).write_text(json.dumps({"models": models}), encoding="utf-8")
        self.patch = mock.patch.object(download_sources.manager_catalog, "list_path", return_value=path)
        self.patch.start()
        self.civitai = mock.patch.object(download_sources, "_get_json", return_value=None)  # Civitai: not known
        self.civitai.start()
        self.addCleanup(self.civitai.stop)
        self.shas = {"bfl/one": SHA, "a/cn": "aa" * 32, "b/cn": SHA, "c/unet": SHA, "k/u": "bb" * 32}

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def head(self, url):
        repo = "/".join(url.split("/")[3:5])
        return {"x-linked-size": "10", "x-linked-etag": f'"{self.shas[repo]}"'}, True

    def test_candidates_fit_the_folder_type(self):
        candidates = download_sources.manager_catalog.candidates
        self.assertEqual([c["name"] for c in candidates("DIFFUSION_PYTORCH_MODEL.safetensors", "controlnet")], ["CN A", "CN B"])
        self.assertEqual([c["name"] for c in candidates("diffusion_pytorch_model.safetensors", "unet")], ["UNet"])
        self.assertEqual([c["name"] for c in candidates("Sub/4x-ultrasharp.pth", "upscale_models")], ["Upscaler"])
        self.assertEqual(candidates("x.pth"), [])  # not https
        self.assertEqual(candidates("ae.safetensors", "loras"), [])

    def test_with_a_fingerprint_only_the_matching_file(self):
        with mock.patch.object(download_sources, "_head", side_effect=self.head):
            found = download_sources.find_source(SHA, name="diffusion_pytorch_model.safetensors", folder_type="controlnet")
            self.assertEqual((found["via"], found["list_name"], found["by_name"]), ("manager_list", "CN B", False))
            self.assertFalse(download_sources.find_source("cc" * 32, name="ae.safetensors", folder_type="vae")["found"])

    def test_without_one_only_a_single_entry_and_marked(self):
        with mock.patch.object(download_sources, "_head", side_effect=self.head):
            found = download_sources.find_source(name="ae.safetensors", folder_type="vae")
            self.assertTrue(found["found"] and found["by_name"])
            self.assertEqual(found["base_model"], "FLUX.1")
            # Two different files of that name: not offered.
            self.assertFalse(download_sources.find_source(name="diffusion_pytorch_model.safetensors", folder_type="controlnet")["found"])


class HuggingFaceFirstTests(unittest.TestCase):
    """With the mirror on, the same file on Hugging Face is fetched there instead of Civitai."""

    def test_same_file_comes_from_hugging_face_with_the_mirror(self):
        listed = [{"name": "T5", "url": "https://huggingface.co/c/t5/resolve/main/t5.safetensors", "folder": "text_encoders", "base": ""}]
        head = lambda url: ({"x-linked-size": str(len(DATA)), "x-linked-etag": f'"{SHA}"'}, True)
        with mock.patch.object(download_sources, "_get_json", return_value=civitai_version(name="t5.safetensors")), \
                mock.patch.object(download_sources, "_head", side_effect=head), \
                mock.patch.object(download_sources.manager_catalog, "candidates", return_value=listed):
            found = download_sources.find_source(SHA, name="t5.safetensors", hf_mirror=True, folder_type="text_encoders")
            self.assertEqual(found["download_url"], "https://hf-mirror.com/c/t5/resolve/main/t5.safetensors")
            self.assertEqual((found["also_on"], found["base_model"], found["page"]),
                             ("civitai", "SDXL 1.0", "https://civitai.com/models/123?modelVersionId=456"))
            # Without the mirror, Civitai as before.
            self.assertEqual(download_sources.find_source(SHA, name="t5.safetensors", folder_type="text_encoders")["source"], "civitai")
        other = lambda url: ({"x-linked-size": "1", "x-linked-etag": f'"{"dd" * 32}"'}, True)
        with mock.patch.object(download_sources, "_get_json", return_value=civitai_version(name="t5.safetensors")), \
                mock.patch.object(download_sources, "_head", side_effect=other), \
                mock.patch.object(download_sources.manager_catalog, "candidates", return_value=listed):
            # A different file on Hugging Face: Civitai's stays.
            self.assertEqual(download_sources.find_source(SHA, name="t5.safetensors", hf_mirror=True)["source"], "civitai")


class ModelCardTests(unittest.TestCase):
    """A file downloaded from Hugging Face gets its model card's picture and words."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.model = os.path.join(self.temp.name, "style.safetensors")
        Path(self.model).write_bytes(b"x")
        self.base = os.path.splitext(self.model)[0]

    def tearDown(self):
        self.temp.cleanup()

    def fake_get(self, url, limit=None):
        if "/api/models/" in url:
            card = {"cardData": {"base_model": "black-forest-labs/FLUX.1-dev", "instance_prompt": "frstingln",
                                 "widget": [{"text": "a frosted cake", "output": {"url": "images/a b.png"}}]},
                    "siblings": [{"rfilename": "images/a b.png"}, {"rfilename": "style.safetensors"}]}
            return json.dumps(card).encode(), "application/json"
        self.asked_image = url
        return b"\x89PNG picture", "image/png"

    def test_cover_and_notes_from_the_card(self):
        with mock.patch.object(hf_card, "_get", side_effect=self.fake_get):
            result = hf_card.enrich(self.model, "https://hf-mirror.com/alv/frost/resolve/main/style.safetensors")
        self.assertEqual(result, {"cover": True, "notes": True})
        self.assertEqual(self.asked_image, "https://hf-mirror.com/alv/frost/resolve/main/images/a%20b.png")  # same host
        self.assertTrue(os.path.exists(self.base + ".preview.png"))
        user = json.loads(Path(self.base + ".anomalous.json").read_text(encoding="utf-8"))
        self.assertIn("Trigger words: frstingln", user["custom_notes"])
        self.assertIn("- a frosted cake", user["custom_notes"])
        self.assertEqual(user["source_url"], "https://huggingface.co/alv/frost")

    def test_nothing_the_user_has_is_replaced(self):
        Path(self.base + ".preview.jpg").write_bytes(b"mine")
        Path(self.base + ".anomalous.json").write_text(json.dumps({"format": 1, "custom_notes": "my notes"}), encoding="utf-8")
        with mock.patch.object(hf_card, "_get", side_effect=self.fake_get):
            result = hf_card.enrich(self.model, "https://huggingface.co/alv/frost/resolve/main/style.safetensors")
        self.assertEqual(result["cover"], False)
        self.assertFalse(os.path.exists(self.base + ".preview.png"))
        user = json.loads(Path(self.base + ".anomalous.json").read_text(encoding="utf-8"))
        self.assertEqual(user["custom_notes"], "my notes")  # kept; only the empty link is filled
        self.assertEqual(user["source_url"], "https://huggingface.co/alv/frost")

    def test_not_a_hugging_face_file(self):
        self.assertEqual(hf_card.enrich(self.model, "https://civitai.com/api/download/models/1"), {"cover": False, "notes": False})


class FolderDefaultsTests(unittest.TestCase):
    def test_older_configs_get_the_new_defaults_once(self):
        from api import folder_types
        with tempfile.TemporaryDirectory() as temp:
            path = os.path.join(temp, "config.json")
            Path(path).write_text(json.dumps({"CIVITAI_API_KEY": "k", "folder_types_config": [
                {"type": "loras", "visible": True}, {"type": "text_encoders", "visible": False},
                {"type": "upscale_models", "visible": False}, {"type": "embeddings", "visible": False}]}), encoding="utf-8")
            self.assertTrue(folder_types.upgrade_folder_defaults(path))
            cfg = json.loads(Path(path).read_text(encoding="utf-8"))
            shown = {item["type"]: item["visible"] for item in cfg["folder_types_config"]}
            self.assertEqual(shown, {"loras": True, "text_encoders": True, "upscale_models": True, "embeddings": False})
            self.assertEqual((cfg["CIVITAI_API_KEY"], cfg["folder_defaults_version"]), ("k", 2))
            # Hidden again by the user afterwards: stays hidden.
            cfg["folder_types_config"][1]["visible"] = False
            Path(path).write_text(json.dumps(cfg), encoding="utf-8")
            self.assertFalse(folder_types.upgrade_folder_defaults(path))
            self.assertFalse(folder_types.upgrade_folder_defaults(os.path.join(temp, "none.json")))


if __name__ == "__main__":
    unittest.main()
