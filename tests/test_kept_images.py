import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import kept_images, materials, notebooks

IMAGE = {"type": "output", "filename": "a.png", "subfolder": "day"}


class KeptImagesTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.output = root / "output"
        (self.output / "day").mkdir(parents=True)
        self.recipes = root / "recipes"
        self.recipes.mkdir()
        self.materials = root / "materials"
        self.materials.mkdir()
        self.notebooks = root / "notebooks"
        self.notebooks.mkdir()
        (self.notebooks / ".legacy_imported.json").write_text("{}", encoding="utf-8")
        for target, name, value in (
            (materials.folder_paths, "get_output_directory", lambda: str(self.output)),
            (materials, "get_materials_dir", lambda: str(self.materials)),
            (kept_images, "get_materials_dir", lambda: str(self.materials)),
            (kept_images, "get_recipes_dir", lambda: str(self.recipes)),
            (notebooks, "get_notebooks_dir", lambda: str(self.notebooks)),
        ):
            patcher = mock.patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    async def _post(self, handler, payload):
        async def body():
            return payload
        response = await handler(SimpleNamespace(json=body))
        return response.status, json.loads(response.text)

    async def _kept(self):
        response = await kept_images.api_kept_images(SimpleNamespace(query={}))
        return json.loads(response.text)["images"]

    async def test_nothing_kept(self):
        self.assertEqual(await self._kept(), [])

    async def test_prompt_plan_remembers_its_image(self):
        plan = {"version": 2, "positive": "1girl", "negative": "lowres", "parts": [
            {"name": "x", "category": "subject", "role": "positive", "positive": "1girl", "negative": "", "enabled": True}]}
        status, saved = await self._post(materials.api_save_prompt_plan, {"name": "From a", "plan": plan, "source_image": IMAGE})
        self.assertEqual(status, 200)
        self.assertEqual(await self._kept(), [{"subfolder": "day", "filename": "a.png", "recipe": None, "combo": None,
                                                "prompt": {"filename": saved["filename"], "name": "From a"}}])
        # The same prompts again come back as the one saved, not a copy.
        status, again = await self._post(materials.api_save_prompt_plan, {"name": "Again", "plan": plan, "source_image": IMAGE})
        self.assertEqual((status, again["status"], again["filename"]), (409, "duplicate", saved["filename"]))

    async def test_prompt_plan_rejects_an_image_outside_output(self):
        plan = {"version": 2, "positive": "1girl", "negative": "", "parts": []}
        for image in ({"type": "input", "filename": "a.png"}, {"type": "output", "filename": "../a.png"},
                      {"type": "output", "filename": "a.png", "subfolder": "../.."}):
            status, _ = await self._post(materials.api_save_prompt_plan, {"name": "x", "plan": plan, "source_image": image})
            self.assertEqual(status, 400, image)

    async def test_combo_and_recipe_are_listed_by_their_image(self):
        status, _ = await self._post(notebooks.api_save_notebook, {
            "filename": "Combo a.json", "data": {"name": "Combo a", "mainModel": None, "loras": [], "source_image": IMAGE}})
        self.assertEqual(status, 200)
        (self.recipes / "recipe_1.json").write_text(json.dumps({
            "name": "Recipe a", "workflow": {"nodes": [], "links": []}, "source_image": IMAGE}), encoding="utf-8")
        (self.recipes / "recipe_2.json").write_text(json.dumps({
            "name": "Other", "workflow": {"nodes": [], "links": []}}), encoding="utf-8")
        images = await self._kept()
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0]["combo"], {"filename": "Combo a.json", "name": "Combo a"})
        self.assertEqual(images[0]["recipe"]["filename"], "recipe_1.json")
        self.assertIsNone(images[0]["prompt"])


if __name__ == "__main__":
    unittest.main()
