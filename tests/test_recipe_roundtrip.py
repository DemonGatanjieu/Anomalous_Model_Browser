import os
import sys
import unittest
import io
import json
import hashlib
import tempfile
import zipfile
from pathlib import Path
from PIL import Image, PngImagePlugin

PLUGIN_DIR = Path(__file__).resolve().parents[1]
COMFY_ROOT = PLUGIN_DIR.parents[1]
sys.path.insert(0, str(COMFY_ROOT))
sys.path.insert(0, str(PLUGIN_DIR))

from api import recipes
from api import models
from api import parameters
from api import recipe_packages
from api import materials


def recipe_payload(workflow):
    return {
        "name": "Round-trip fixture",
        "tags": ["test"],
        "notes": "",
        "params": {"nodes": [], "pinned": []},
        "workflow": workflow,
        "workflow_scope": "complete",
        "thumbnail": None,
        "source_image": None,
        "presentation": {"save_model_preview_snapshots": False},
    }


def valid_workflow():
    return {
        "nodes": [
            {"id": 1, "type": "CLIPTextEncode", "widgets_values": ["prompt"]},
            {"id": 2, "type": "KSampler", "widgets_values": [1, "fixed", 20, 7, "euler", "normal", 1]},
        ],
        "links": [[1, 1, 0, 2, 1, "CONDITIONING"]],
        "groups": [],
    }


class MaterialSnapshotTests(unittest.TestCase):
    def test_image_snapshot_requires_full_ui_workflow(self):
        with tempfile.TemporaryDirectory() as directory:
            info = PngImagePlugin.PngInfo()
            info.add_text("prompt", json.dumps({"1": {"class_type": "KSampler", "inputs": {"seed": 1}}}))
            Image.new("RGB", (12, 12), "white").save(Path(directory, "prompt-only.png"), pnginfo=info)
            previous_output_dir = materials.folder_paths.get_output_directory
            materials.folder_paths.get_output_directory = lambda: directory
            try:
                with self.assertRaises(ValueError):
                    materials._inspect_source_image({"type": "output", "filename": "prompt-only.png", "subfolder": ""})
            finally:
                materials.folder_paths.get_output_directory = previous_output_dir

    def test_node_blocks_preserve_exact_values_and_mark_sampler_seed(self):
        workflow = valid_workflow()
        workflow["nodes"][1]["properties"] = {"preview": "detailed"}
        workflow["nodes"][1]["mode"] = 0
        blocks = materials._node_blocks(workflow, include_values=True)
        sampler = next(block for block in blocks if block["type"] == "KSampler")
        self.assertEqual(sampler["widgets_values"][0], 1)
        self.assertEqual(sampler["volatile_widget_indexes"], [0])
        self.assertEqual(sampler["properties"], {"preview": "detailed"})
        self.assertEqual(sampler["mode"], 0)

    def test_material_summary_excludes_full_workflow(self):
        material = {
            "id": "fixture",
            "kind": "image_workflow_snapshot",
            "name": "Fixture",
            "timestamp": 1,
            "workflow": valid_workflow(),
            "image": {"preview_asset_id": "preview.webp", "source_asset_id": "source.png"},
            "capabilities": ["open_workflow"],
        }
        summary = materials._material_summary("material_fixture.json", material)
        self.assertNotIn("workflow", summary)
        self.assertEqual(summary["node_count"], 2)
        self.assertEqual(summary["node_types"], ["CLIPTextEncode", "KSampler"])

    def test_selected_material_exposes_only_selected_node_blocks(self):
        material = {
            "workflow": valid_workflow(),
            "selection": {"scope": "nodes", "node_ids": [2]},
        }
        blocks = materials._material_node_blocks(material, include_values=True)
        self.assertEqual([block["node_id"] for block in blocks], [2])
        self.assertEqual(blocks[0]["type"], "KSampler")

    def test_selected_node_ids_are_validated_and_deduplicated(self):
        self.assertEqual(materials._normalise_selected_node_ids(valid_workflow(), ["2", 2, 1]), [2, 1])
        with self.assertRaises(ValueError):
            materials._normalise_selected_node_ids(valid_workflow(), [99])


class RecipeWorkflowValidationTests(unittest.TestCase):
    def test_workflow_scope_round_trips_and_legacy_defaults_complete(self):
        payload = recipe_payload(valid_workflow())
        payload["workflow_scope"] = "partial"
        self.assertEqual(recipes._normalise_recipe(payload)["workflow_scope"], "partial")
        payload.pop("workflow_scope")
        self.assertEqual(recipes._normalise_recipe(payload)["workflow_scope"], "complete")

    def test_invalid_workflow_scope_is_rejected(self):
        payload = recipe_payload(valid_workflow())
        payload["workflow_scope"] = "selection"
        with self.assertRaises(ValueError):
            recipes._normalise_recipe(payload)

    def test_valid_workflow_returns_integrity_receipt(self):
        recipe = recipes._normalise_recipe(recipe_payload(valid_workflow()))
        receipt = recipes._recipe_receipt(recipe, "recipe_fixture.json")
        self.assertEqual(receipt["node_count"], 2)
        self.assertEqual(receipt["link_count"], 1)
        self.assertEqual(receipt["group_count"], 0)
        self.assertTrue(receipt["workflow_fingerprint"] is None)

    def test_duplicate_node_ids_are_rejected(self):
        workflow = valid_workflow()
        workflow["nodes"].append({"id": 1, "type": "PreviewImage", "widgets_values": []})
        with self.assertRaises(ValueError):
            recipes._normalise_recipe(recipe_payload(workflow))

    def test_dangling_link_is_rejected(self):
        workflow = valid_workflow()
        workflow["links"] = [[1, 99, 0, 2, 1, "CONDITIONING"]]
        with self.assertRaises(ValueError):
            recipes._normalise_recipe(recipe_payload(workflow))

    def test_nodes_must_be_a_list(self):
        workflow = valid_workflow()
        workflow["nodes"] = {}
        with self.assertRaises(ValueError):
            recipes._normalise_recipe(recipe_payload(workflow))

    def test_structural_fingerprint_ignores_sampler_seed_and_batch_size(self):
        first = valid_workflow()
        first["nodes"][1]["properties"] = {"batch_size": 1, "seed": 1}
        second = json.loads(json.dumps(first))
        second["nodes"][1]["widgets_values"][0] = 987654321
        second["nodes"][1]["properties"] = {"batch_size": 4, "seed": 987654321}
        self.assertEqual(
            recipes._workflow_fingerprint(first),
            recipes._workflow_fingerprint(second),
        )

    def test_structural_fingerprint_keeps_generation_parameters(self):
        first = valid_workflow()
        second = json.loads(json.dumps(first))
        second["nodes"][1]["widgets_values"][2] = 28
        self.assertNotEqual(
            recipes._workflow_fingerprint(first),
            recipes._workflow_fingerprint(second),
        )

    def test_gallery_uses_embedded_workflow_and_structural_fingerprint(self):
        with tempfile.TemporaryDirectory() as directory:
            info = PngImagePlugin.PngInfo()
            workflow = valid_workflow()
            embedded_workflow = json.loads(json.dumps(workflow))
            embedded_workflow["nodes"][0]["widgets_values"] = ["a different prompt"]
            embedded_workflow["nodes"][1]["widgets_values"][2] = 42
            info.add_text("workflow", json.dumps(embedded_workflow))
            Image.new("RGB", (12, 12), "white").save(Path(directory, "match.png"), pnginfo=info)
            previous_output_dir = recipes.folder_paths.get_output_directory
            recipes.folder_paths.get_output_directory = lambda: directory
            try:
                matches, scanned = recipes._recipe_gallery_images(recipes._workflow_node_signature(workflow)["value"])
            finally:
                recipes.folder_paths.get_output_directory = previous_output_dir
        self.assertEqual(scanned, 1)
        self.assertEqual([item["filename"] for item in matches], ["match.png"])

    def test_gallery_comparison_reports_parameter_difference_after_node_match(self):
        recipe = valid_workflow()
        image_workflow = json.loads(json.dumps(recipe))
        image_workflow["nodes"][1]["widgets_values"][2] = 42
        comparison = recipes._gallery_parameter_diff(recipe, {"workflow": image_workflow, "prompt": None})
        self.assertEqual(
            recipes._workflow_node_signature(recipe),
            recipes._workflow_node_signature(image_workflow),
        )
        self.assertTrue(any(change["type"] == "KSampler" for change in comparison["changes"]))

    def test_parameter_signature_reads_api_prompt_inputs(self):
        first = {
            "1": {"class_type": "KSampler", "inputs": {"steps": 20, "seed": 1}},
        }
        second = {
            "1": {"class_type": "KSampler", "inputs": {"steps": 28, "seed": 1}},
        }
        self.assertNotEqual(recipes._parameter_signature(first), recipes._parameter_signature(second))


class RecipeIdentityBoundaryTests(unittest.TestCase):
    def test_save_time_verification_computes_supported_model_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory, "model.safetensors")
            model_path.write_bytes(b"recipe verification fixture")
            previous_resolver = recipes._resolve_exact_model_reference
            recipes._resolve_exact_model_reference = lambda value: {
                "path": str(model_path), "folder_type": "checkpoints", "path_index": 0,
            }
            try:
                identity = recipes._computed_identity_for_reference("model.safetensors")
            finally:
                recipes._resolve_exact_model_reference = previous_resolver
        self.assertEqual(identity["status"], "verified")
        self.assertEqual(identity["sha256"], hashlib.sha256(b"recipe verification fixture").hexdigest())

    def test_foundation_models_are_in_save_time_verification_categories(self):
        self.assertIn("vae", recipes.VERIFIABLE_RECIPE_MODEL_CATEGORIES)
        self.assertIn("text_encoder", recipes.VERIFIABLE_RECIPE_MODEL_CATEGORIES)
        self.assertIn("lora", recipes.VERIFIABLE_RECIPE_MODEL_CATEGORIES)

    def test_filename_alone_never_resolves_identity(self):
        candidates = [{"type": "checkpoints", "filename": "nested/model.safetensors", "size": 10, "hashes": set()}]
        result = models._resolve_from_candidates(candidates, filename_query="nested/model.safetensors")
        self.assertFalse(result["found"])

    def test_hash_and_size_resolve_without_filename_evidence(self):
        candidates = [{"type": "checkpoints", "filename": "other/model.safetensors", "size": 10, "hashes": {"A" * 64}}]
        result = models._resolve_from_candidates(candidates, target_hash="A" * 64, target_size=10, filename_query="missing/model.safetensors")
        self.assertTrue(result["found"])
        self.assertTrue(result["matched_by_hash"])
        self.assertTrue(result["matched_by_size"])

    def test_enrichment_preserves_imported_identity(self):
        original_identity = {"status": "verified", "sha256": "B" * 64, "size": 10, "provenance": "package"}
        original_preview = {"snapshot_asset_id": "historical.webp", "media_type": "image/webp"}
        recipe = {
            "workflow": {"nodes": [{"id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["model.safetensors"]}], "links": [], "groups": []},
            "params": {"baseModel": "model.safetensors", "model_references": [{
                "node_id": 1, "widget_index": 0, "category": "checkpoint", "saved_value": "model.safetensors",
                "identity": original_identity,
                "preview": original_preview,
            }]},
        }
        previous_resolver = recipes._identity_for_reference
        recipes._identity_for_reference = lambda value: {"status": "unavailable"}
        try:
            enriched = recipes._enrich_recipe(recipe)
        finally:
            recipes._identity_for_reference = previous_resolver
        self.assertEqual(enriched["params"]["model_references"][0]["identity"], original_identity)
        self.assertEqual(enriched["params"]["model_references"][0]["preview"], original_preview)

    def test_enrichment_preserves_bounded_model_note(self):
        recipe = {
            "workflow": {"nodes": [{"id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["model.safetensors"]}], "links": [], "groups": []},
            "params": {"model_references": [{
                "node_id": 1, "widget_index": 0, "category": "checkpoint", "saved_value": "model.safetensors",
                "identity": {"status": "unverified"},
                "user_note": "  Recommended CFG 5.5  ",
            }]},
        }
        previous_resolver = recipes._identity_for_reference
        recipes._identity_for_reference = lambda value: {"status": "unavailable"}
        try:
            enriched = recipes._enrich_recipe(recipe)
        finally:
            recipes._identity_for_reference = previous_resolver
        self.assertEqual(enriched["params"]["model_references"][0]["user_note"], "Recommended CFG 5.5")
        self.assertEqual(enriched["schema_version"], 7)


class RecipePreviewSnapshotTests(unittest.TestCase):
    def test_saving_with_preview_snapshots_captures_the_model_cover(self):
        """The default save path: a loader node, its cover next to the model, snapshots on."""
        with tempfile.TemporaryDirectory() as models_dir, tempfile.TemporaryDirectory() as recipes_dir:
            Path(models_dir, "model.safetensors").write_bytes(b"not a real model")
            Image.new("RGB", (64, 48), "red").save(Path(models_dir, "model.preview.png"))
            payload = recipe_payload({
                "nodes": [{"id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["model.safetensors"]}],
                "links": [],
                "groups": [],
            })
            payload["presentation"] = {"save_model_preview_snapshots": True}
            folder_paths = recipes.folder_paths
            previous_names = folder_paths.folder_names_and_paths
            previous_get = folder_paths.get_folder_paths
            folder_paths.folder_names_and_paths = {"checkpoints": ([models_dir], {".safetensors"})}
            folder_paths.get_folder_paths = lambda folder_type: [models_dir] if folder_type == "checkpoints" else []
            try:
                recipe = recipes._normalise_recipe(payload)
                enriched = recipes._enrich_recipe(recipe, recipes_dir, "recipe_fixture.json", True, False, False)
            finally:
                folder_paths.folder_names_and_paths = previous_names
                folder_paths.get_folder_paths = previous_get
            preview = enriched["params"]["model_references"][0]["preview"]
            self.assertEqual(preview["media_type"], "image/webp")
            self.assertTrue(Path(recipes_dir, ".assets", "recipe_fixture", preview["snapshot_asset_id"]).is_file())


class RecipePackageBoundaryTests(unittest.TestCase):
    def _package_recipe(self, asset_id):
        recipe = recipe_payload(valid_workflow())
        recipe["source_image"] = {"type": "output", "filename": "local.png", "subfolder": "renders"}
        recipe["params"]["model_references"] = [{
            "node_id": 1,
            "widget_index": 0,
            "category": "checkpoint",
            "saved_value": "model.safetensors",
            "preview": {"snapshot_asset_id": asset_id, "media_type": "image/webp"},
        }]
        return recipe

    def test_export_unions_history_assets_and_removes_local_source(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = "recipe_fixture.json"
            assets_dir = Path(recipes._recipe_assets_dir(directory, filename, create=True))
            assets_dir.joinpath("current.webp").write_bytes(b"RIFF0000WEBP")
            assets_dir.joinpath("historical.webp").write_bytes(b"RIFF1111WEBP")
            history_dir = Path(recipes._history_dir(directory, filename, create=True))
            history = self._package_recipe("historical.webp")
            history_dir.joinpath("version_1.json").write_text(json.dumps(history), encoding="utf-8")
            current = self._package_recipe("current.webp")
            package = recipe_packages._build_export(current, directory, filename, {
                "include_snapshots": True,
                "include_history": True,
                "include_identity": True,
            })
            with zipfile.ZipFile(io.BytesIO(package)) as archive:
                self.assertIn("assets/current.webp", archive.namelist())
                self.assertIn("assets/historical.webp", archive.namelist())
                exported = json.loads(archive.read("recipe.json"))
                historical_exported = json.loads(archive.read("history/version_1.json"))
            self.assertIsNone(exported["source_image"])
            self.assertIsNone(historical_exported["source_image"])

    def test_export_can_remove_personal_model_notes(self):
        recipe = self._package_recipe("model-preview.webp")
        recipe["params"]["model_references"][0]["user_note"] = "private tuning note"
        exported = recipe_packages._sanitize_recipe_for_export(
            recipe,
            include_snapshots=False,
            include_identity=True,
            include_model_notes=False,
        )
        self.assertNotIn("user_note", exported["params"]["model_references"][0])
        self.assertEqual(recipe["params"]["model_references"][0]["user_note"], "private tuning note")

    def test_the_receiver_is_told_about_the_cover_and_the_model_thumbnails(self):
        recipe = self._package_recipe("model-preview.webp")
        recipe["thumbnail"] = "data:image/jpeg;base64,AAAA"
        self.assertEqual(recipe_packages._picture_summary(recipe), (True, 1))
        recipe["thumbnail"] = None
        recipe["params"]["model_references"][0].pop("preview", None)
        self.assertEqual(recipe_packages._picture_summary(recipe), (False, 0))

    def _import_into(self, directory, package, fail_on=None):
        record = recipe_packages._inspect_package(package)
        record["raw"] = package
        previous_get_dir = recipe_packages.get_recipes_dir
        previous_replace = recipe_packages.os.replace
        calls = {"count": 0}

        def replace(source, target):
            calls["count"] += 1
            if fail_on and str(target).endswith(fail_on):
                raise OSError("simulated commit failure")
            return previous_replace(source, target)

        recipe_packages.get_recipes_dir = lambda: directory
        recipe_packages.os.replace = replace
        try:
            return recipe_packages._commit_import(record, {})
        finally:
            recipe_packages.get_recipes_dir = previous_get_dir
            recipe_packages.os.replace = previous_replace

    def _shared_package(self, source_dir):
        filename = "recipe_shared.json"
        assets_dir = Path(recipes._recipe_assets_dir(source_dir, filename, create=True))
        assets_dir.joinpath("cover-result.webp").write_bytes(b"RIFF0000WEBP")
        assets_dir.joinpath("model-preview.webp").write_bytes(b"RIFF1111WEBP")
        recipe = self._package_recipe("model-preview.webp")
        recipe["name"] = "Portrait"
        recipe["presentation"]["cover_asset_id"] = "cover-result.webp"
        return recipe_packages._build_export(recipe, source_dir, filename, {})

    def test_import_makes_a_new_card_and_never_replaces_one(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as directory:
            package = self._shared_package(source)
            mine = recipe_payload(valid_workflow())
            mine["name"] = "Portrait"
            Path(directory, "mine.json").write_text(json.dumps(mine), encoding="utf-8")
            filename, name = self._import_into(directory, package)
            self.assertEqual(name, "Portrait (2)")
            self.assertEqual(json.loads(Path(directory, "mine.json").read_text(encoding="utf-8"))["name"], "Portrait")
            imported = json.loads(Path(directory, filename).read_text(encoding="utf-8"))
            self.assertTrue(imported["presentation"]["imported"])
            assets = Path(recipes._recipe_assets_dir(directory, filename))
            self.assertTrue(assets.joinpath("cover-result.webp").is_file())
            self.assertTrue(assets.joinpath("model-preview.webp").is_file())  # model thumbnails by default
            _, again = self._import_into(directory, package)
            self.assertEqual(again, "Portrait (3)")

    def test_a_failed_import_leaves_nothing_behind(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as directory:
            package = self._shared_package(source)
            with self.assertRaises(OSError):
                self._import_into(directory, package, fail_on=".json")
            self.assertEqual([name for name in os.listdir(directory) if name.endswith(".json")], [])
            assets_root = Path(directory, ".assets")
            self.assertEqual(list(assets_root.iterdir()) if assets_root.exists() else [], [])
            self.assertFalse([name for name in os.listdir(directory) if name.startswith(".recipe-import-")])

    def test_a_tampered_package_is_refused(self):
        with tempfile.TemporaryDirectory() as source:
            package = self._shared_package(source)
            with zipfile.ZipFile(io.BytesIO(package)) as archive:
                entries = {name: archive.read(name) for name in archive.namelist()}
            entries["recipe.json"] = entries["recipe.json"].replace(b"Portrait", b"Changed!")
            tampered = io.BytesIO()
            with zipfile.ZipFile(tampered, "w") as archive:
                for name, data in entries.items():
                    archive.writestr(name, data)
            with self.assertRaises(ValueError):
                recipe_packages._inspect_package(tampered.getvalue())
            escaping = io.BytesIO()
            with zipfile.ZipFile(escaping, "w") as archive:
                for name, data in entries.items():
                    archive.writestr(name, data)
                archive.writestr("../evil.json", b"{}")
            with self.assertRaises(ValueError):
                recipe_packages._inspect_package(escaping.getvalue())

    def test_export_includes_gallery_cover_without_model_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = "recipe_fixture.json"
            assets_dir = Path(recipes._recipe_assets_dir(directory, filename, create=True))
            assets_dir.joinpath("cover-result.webp").write_bytes(b"RIFF0000WEBP")
            recipe = self._package_recipe("model-preview.webp")
            recipe["presentation"]["cover_asset_id"] = "cover-result.webp"
            package = recipe_packages._build_export(recipe, directory, filename, {
                "include_snapshots": False,
                "include_history": False,
                "include_identity": True,
            })
            with zipfile.ZipFile(io.BytesIO(package)) as archive:
                self.assertIn("assets/cover-result.webp", archive.namelist())
                self.assertNotIn("assets/model-preview.webp", archive.namelist())


class LegacyPromptRoleTests(unittest.TestCase):
    def test_manual_role_override_has_priority(self):
        node = {"id": 7, "type": "CLIPTextEncode", "widgets_values": ["negative prompt"]}
        params = {
            "promptRoleOverrides": {"7": {"role": "positive", "nodeType": "CLIPTextEncode"}},
            "promptNegative": ["negative prompt"],
        }
        self.assertEqual(parameters._prompt_role_for_node(node, params), "positive")

    def test_stale_manual_role_type_is_ignored(self):
        node = {"id": 7, "type": "CLIPTextEncode", "widgets_values": ["negative prompt"]}
        params = {
            "promptRoleOverrides": {"7": {"role": "positive", "nodeType": "OtherNode"}},
            "promptNegative": ["negative prompt"],
        }
        self.assertEqual(parameters._prompt_role_for_node(node, params), "negative")

    def test_legacy_parameter_node_recovers_negative_role(self):
        node = {"id": 7, "type": "CLIPTextEncode", "widgets_values": ["negative prompt"]}
        params = {"promptPositive": ["positive prompt"], "promptNegative": ["negative prompt"]}
        self.assertEqual(parameters._prompt_role_for_node(node, params), "negative")

    def test_ambiguous_prompt_is_not_guessed(self):
        node = {"id": 7, "type": "CLIPTextEncode", "widgets_values": ["shared prompt"]}
        params = {"promptPositive": ["shared prompt"], "promptNegative": ["shared prompt"]}
        self.assertIsNone(parameters._prompt_role_for_node(node, params))


class ParameterNotebookRenameTests(unittest.IsolatedAsyncioTestCase):
    async def test_rename_parameter_notebook(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            nb_filename = "params_test_12345.json"
            nb_path = os.path.join(temp_dir, nb_filename)
            initial_data = {
                "name": "Original Name",
                "recipe_filename": "recipe_1.json",
                "workflow": valid_workflow(),
                "timestamp": 1000
            }
            with open(nb_path, "w", encoding="utf-8") as f:
                json.dump(initial_data, f)

            # Mock get_parameters_dir
            orig_get_dir = parameters.get_parameters_dir
            parameters.get_parameters_dir = lambda: temp_dir
            try:
                class DummyRequest:
                    def __init__(self, payload):
                        self._payload = payload
                    async def json(self):
                        return self._payload

                # Test successful rename
                req = DummyRequest({"filename": nb_filename, "name": "Renamed Notebook"})
                res = await parameters.api_rename_parameter(req)
                self.assertEqual(res.status, 200)

                with open(nb_path, "r", encoding="utf-8") as f:
                    updated_data = json.load(f)
                self.assertEqual(updated_data["name"], "Renamed Notebook")

                # Test invalid filename rejection
                bad_req = DummyRequest({"filename": "../evil.json", "name": "Evil"})
                bad_res = await parameters.api_rename_parameter(bad_req)
                self.assertEqual(bad_res.status, 400)

                # Test empty name rejection
                empty_req = DummyRequest({"filename": nb_filename, "name": "   "})
                empty_res = await parameters.api_rename_parameter(empty_req)
                self.assertEqual(empty_res.status, 400)
            finally:
                parameters.get_parameters_dir = orig_get_dir


if __name__ == "__main__":
    unittest.main()
