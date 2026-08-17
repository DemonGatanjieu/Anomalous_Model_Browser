from .models import *
from .scanner import *
from .config import *
from .notebooks import *
from .parameters import *
from .recipes import *
from .recipe_packages import *
from .utils import *

def setup_routes(app):
    app.router.add_get('/anomalous/folders', api_get_folders)
    app.router.add_get('/anomalous/all_folder_types', api_get_all_folder_types)
    app.router.add_get('/anomalous/models', api_get_models)
    app.router.add_get('/anomalous/all_scan_models', api_get_all_scan_models)
    app.router.add_get('/anomalous/batch_select', api_batch_select)
    app.router.add_get('/anomalous/image', api_serve_image)
    app.router.add_post('/anomalous/scan', api_scan_folder)
    app.router.add_get('/anomalous/scan_status', api_scan_status)
    app.router.add_get('/anomalous/find_model', api_find_model)
    app.router.add_get('/anomalous/config', api_get_config)
    app.router.add_post('/anomalous/save_config', api_save_config)
    app.router.add_post('/anomalous/delete_model', api_delete_model)
    app.router.add_post('/anomalous/clean_civitai_info', api_clean_civitai_info)
    app.router.add_get('/anomalous/compatible_models', api_compatible_models)
    app.router.add_get('/anomalous/notebooks', api_get_notebooks)
    app.router.add_post('/anomalous/save_notebook', api_save_notebook)
    app.router.add_post('/anomalous/delete_notebook', api_delete_notebook)

    # Parameter Routes
    app.router.add_get('/anomalous/parameters', api_get_parameters)
    app.router.add_get('/anomalous/parameters/by_node_type', api_get_parameters_by_type)
    app.router.add_post('/anomalous/save_parameter', api_save_parameter)
    app.router.add_post('/anomalous/rename_parameter', api_rename_parameter)
    app.router.add_post('/anomalous/delete_parameter', api_delete_parameter)
    app.router.add_get('/anomalous/parameter_gallery', api_get_parameter_gallery)

    # Recipe Routes
    app.router.add_get('/anomalous/recipes', api_get_recipes)
    app.router.add_get('/anomalous/recipe_full', api_get_recipe_full)
    app.router.add_get('/anomalous/recipe_asset', api_get_recipe_asset)
    app.router.add_get('/anomalous/recipe_gallery', api_get_recipe_gallery)
    app.router.add_get('/anomalous/recipe_parameter_gallery', api_get_recipe_parameter_gallery)
    app.router.add_get('/anomalous/recipe_gallery_compare', api_get_recipe_gallery_compare)
    app.router.add_post('/anomalous/save_recipe', api_save_recipe)
    app.router.add_post('/anomalous/update_recipe', api_update_recipe)
    app.router.add_post('/anomalous/set_recipe_gallery_cover', api_set_recipe_gallery_cover)
    app.router.add_post('/anomalous/delete_recipe', api_delete_recipe)
    app.router.add_get('/anomalous/recipe_history', api_get_recipe_history)
    app.router.add_get('/anomalous/recipe_version', api_get_recipe_version)
    app.router.add_post('/anomalous/restore_recipe_version', api_restore_recipe_version)
    app.router.add_post('/anomalous/refresh_recipe_identity', api_refresh_recipe_identity)
    app.router.add_post('/anomalous/export_recipe_package', api_export_recipe_package)
    app.router.add_post('/anomalous/import_recipe_package_inspect', api_import_recipe_package_inspect)
    app.router.add_post('/anomalous/import_recipe_package_commit', api_import_recipe_package_commit)

    app.router.add_post('/anomalous/translate', api_translate)
    app.router.add_get('/anomalous/base_models', api_base_models)
    app.router.add_get('/anomalous/gallery_images', api_get_gallery_images)
    app.router.add_post('/anomalous/delete_gallery_image', api_delete_gallery_image)
    app.router.add_get('/anomalous/resolve_hash', api_resolve_hash)
    app.router.add_post('/anomalous/resolve_hash_batch', api_resolve_hash_batch)
    app.router.add_get('/anomalous/all_hashes', api_get_all_hashes)
    app.router.add_post('/anomalous/scan_all', api_scan_all)
    app.router.add_get('/anomalous/global_scan_status', api_global_scan_status)
    app.router.add_get('/anomalous/scan_missing_models_status', api_scan_missing_models_status)
    app.router.add_post('/anomalous/clear_cache', api_clear_cache)
    app.router.add_post('/anomalous/update_metadata', api_update_metadata)
    app.router.add_post('/anomalous/set_custom_cover', api_set_custom_cover)
    app.router.add_post('/anomalous/upload_custom_cover', api_upload_custom_cover)
    app.router.add_get('/anomalous/model_images', api_get_model_images)
    app.router.add_post('/anomalous/resolve_paths_to_previews', api_resolve_paths_to_previews)
    app.router.add_post('/anomalous/scan_missing_models', api_scan_missing_models)
