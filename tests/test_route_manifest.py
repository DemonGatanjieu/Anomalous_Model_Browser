import ast
from pathlib import Path
import unittest


API_INIT = Path(__file__).resolve().parents[1] / "api" / "__init__.py"

EXPECTED_ROUTES = [
    ("GET", "/anomalous/folders"),
    ("GET", "/anomalous/all_folder_types"),
    ("GET", "/anomalous/models"),
    ("GET", "/anomalous/all_scan_models"),
    ("GET", "/anomalous/batch_select"),
    ("GET", "/anomalous/image"),
    ("POST", "/anomalous/scan"),
    ("GET", "/anomalous/scan_status"),
    ("GET", "/anomalous/find_model"),
    ("GET", "/anomalous/config"),
    ("POST", "/anomalous/save_config"),
    ("POST", "/anomalous/delete_model"),
    ("POST", "/anomalous/clean_civitai_info"),
    ("GET", "/anomalous/compatible_models"),
    ("GET", "/anomalous/notebooks"),
    ("POST", "/anomalous/save_notebook"),
    ("POST", "/anomalous/delete_notebook"),
    ("GET", "/anomalous/parameters"),
    ("GET", "/anomalous/parameters/by_node_type"),
    ("POST", "/anomalous/save_parameter"),
    ("POST", "/anomalous/rename_parameter"),
    ("POST", "/anomalous/delete_parameter"),
    ("GET", "/anomalous/parameter_gallery"),
    ("GET", "/anomalous/recipes"),
    ("GET", "/anomalous/recipe_full"),
    ("GET", "/anomalous/recipe_asset"),
    ("GET", "/anomalous/recipe_gallery"),
    ("GET", "/anomalous/recipe_parameter_gallery"),
    ("GET", "/anomalous/recipe_gallery_compare"),
    ("POST", "/anomalous/save_recipe"),
    ("POST", "/anomalous/update_recipe"),
    ("POST", "/anomalous/set_recipe_gallery_cover"),
    ("POST", "/anomalous/delete_recipe"),
    ("GET", "/anomalous/recipe_history"),
    ("GET", "/anomalous/recipe_version"),
    ("POST", "/anomalous/restore_recipe_version"),
    ("POST", "/anomalous/refresh_recipe_identity"),
    ("POST", "/anomalous/export_recipe_package"),
    ("POST", "/anomalous/import_recipe_package_inspect"),
    ("POST", "/anomalous/import_recipe_package_commit"),
    ("GET", "/anomalous/materials"),
    ("GET", "/anomalous/material_full"),
    ("GET", "/anomalous/material_asset"),
    ("GET", "/anomalous/materials/by_node_type"),
    ("POST", "/anomalous/inspect_image_material"),
    ("POST", "/anomalous/save_image_material"),
    ("POST", "/anomalous/save_parameter_material"),
    ("POST", "/anomalous/save_prompt_note_material"),
    ("POST", "/anomalous/save_prompt_plan"),
    ("POST", "/anomalous/delete_material"),
    ("POST", "/anomalous/update_material"),
    ("POST", "/anomalous/translate"),
    ("GET", "/anomalous/base_models"),
    ("GET", "/anomalous/gallery_images"),
    ("POST", "/anomalous/delete_gallery_image"),
    ("GET", "/anomalous/resolve_hash"),
    ("POST", "/anomalous/resolve_hash_batch"),
    ("GET", "/anomalous/all_hashes"),
    ("POST", "/anomalous/scan_all"),
    ("GET", "/anomalous/global_scan_status"),
    ("GET", "/anomalous/scan_missing_models_status"),
    ("POST", "/anomalous/clear_cache"),
    ("POST", "/anomalous/update_metadata"),
    ("POST", "/anomalous/set_custom_cover"),
    ("POST", "/anomalous/upload_custom_cover"),
    ("GET", "/anomalous/model_images"),
    ("POST", "/anomalous/resolve_paths_to_previews"),
    ("POST", "/anomalous/scan_missing_models"),
]


class RouteManifestTests(unittest.TestCase):
    def test_http_method_and_path_manifest_is_stable(self):
        tree = ast.parse(API_INIT.read_text(encoding="utf-8"))
        setup = next(
            node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "setup_routes"
        )
        actual = []
        for statement in setup.body:
            if not isinstance(statement, ast.Expr) or not isinstance(statement.value, ast.Call):
                continue
            function = statement.value.func
            if not isinstance(function, ast.Attribute) or not function.attr.startswith("add_"):
                continue
            actual.append((function.attr.removeprefix("add_").upper(), ast.literal_eval(statement.value.args[0])))

        self.assertEqual(actual, EXPECTED_ROUTES)
        self.assertEqual(len(actual), len(set(actual)), "route method/path pairs must be unique")


if __name__ == "__main__":
    unittest.main()
