from . import (
    folder_types, gallery_routes, materials, media_routes, model_catalog,
    model_media, model_metadata, model_resolution, recipe_packages, recipes,
    translation_routes, version_manager,
)
from .scanner import *
from .config import *
from .notebooks import *
from .parameters import *

from aiohttp import web

@web.middleware
async def no_cache_extension_middleware(request, handler):
    response = await handler(request)
    if request.path.startswith('/extensions/Anomalous_Model_Browser'):
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response

def setup_routes(app):
    if hasattr(app, 'middlewares') and no_cache_extension_middleware not in app.middlewares:
        app.middlewares.append(no_cache_extension_middleware)
    app.router.add_get('/anomalous/folders', model_catalog.api_get_folders)
    app.router.add_get('/anomalous/all_folder_types', folder_types.api_get_all_folder_types)
    app.router.add_get('/anomalous/models', model_catalog.api_get_models)
    app.router.add_get('/anomalous/all_scan_models', model_catalog.api_get_all_scan_models)
    app.router.add_get('/anomalous/batch_select', model_catalog.api_batch_select)
    app.router.add_get('/anomalous/image', media_routes.api_serve_image)
    app.router.add_post('/anomalous/scan', api_scan_folder)
    app.router.add_get('/anomalous/scan_status', api_scan_status)
    app.router.add_get('/anomalous/find_model', model_catalog.api_find_model)
    app.router.add_get('/anomalous/config', api_get_config)
    app.router.add_post('/anomalous/save_config', api_save_config)
    app.router.add_post('/anomalous/delete_model', model_metadata.api_delete_model)
    app.router.add_post('/anomalous/clean_civitai_info', api_clean_civitai_info)
    app.router.add_get('/anomalous/compatible_models', model_catalog.api_compatible_models)
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
    app.router.add_get('/anomalous/recipes', recipes.api_get_recipes)
    app.router.add_get('/anomalous/recipe_full', recipes.api_get_recipe_full)
    app.router.add_get('/anomalous/recipe_asset', recipes.api_get_recipe_asset)
    app.router.add_get('/anomalous/recipe_gallery', recipes.api_get_recipe_gallery)
    app.router.add_get('/anomalous/recipe_parameter_gallery', recipes.api_get_recipe_parameter_gallery)
    app.router.add_get('/anomalous/recipe_gallery_compare', recipes.api_get_recipe_gallery_compare)
    app.router.add_post('/anomalous/save_recipe', recipes.api_save_recipe)
    app.router.add_post('/anomalous/update_recipe', recipes.api_update_recipe)
    app.router.add_post('/anomalous/set_recipe_gallery_cover', recipes.api_set_recipe_gallery_cover)
    app.router.add_post('/anomalous/delete_recipe', recipes.api_delete_recipe)
    app.router.add_get('/anomalous/recipe_history', recipes.api_get_recipe_history)
    app.router.add_get('/anomalous/recipe_version', recipes.api_get_recipe_version)
    app.router.add_post('/anomalous/restore_recipe_version', recipes.api_restore_recipe_version)
    app.router.add_post('/anomalous/refresh_recipe_identity', recipes.api_refresh_recipe_identity)
    app.router.add_post('/anomalous/export_recipe_package', recipe_packages.api_export_recipe_package)
    app.router.add_post('/anomalous/import_recipe_package_inspect', recipe_packages.api_import_recipe_package_inspect)
    app.router.add_post('/anomalous/import_recipe_package_commit', recipe_packages.api_import_recipe_package_commit)

    # Curated Material Library Routes
    app.router.add_get('/anomalous/materials', materials.api_get_materials)
    app.router.add_get('/anomalous/material_full', materials.api_get_material_full)
    app.router.add_get('/anomalous/material_asset', materials.api_get_material_asset)
    app.router.add_get('/anomalous/materials/by_node_type', materials.api_get_materials_by_node_type)
    app.router.add_post('/anomalous/inspect_image_material', materials.api_inspect_image_material)
    app.router.add_post('/anomalous/save_image_material', materials.api_save_image_material)
    app.router.add_post('/anomalous/save_parameter_material', materials.api_save_parameter_material)
    app.router.add_post('/anomalous/save_prompt_note_material', materials.api_save_prompt_note_material)
    app.router.add_post('/anomalous/save_prompt_plan', materials.api_save_prompt_plan)
    app.router.add_post('/anomalous/delete_material', materials.api_delete_material)
    app.router.add_post('/anomalous/update_material', materials.api_update_material)

    app.router.add_post('/anomalous/translate', translation_routes.api_translate)
    app.router.add_get('/anomalous/base_models', model_catalog.api_base_models)
    app.router.add_get('/anomalous/gallery_images', gallery_routes.api_get_gallery_images)
    app.router.add_post('/anomalous/delete_gallery_image', gallery_routes.api_delete_gallery_image)
    app.router.add_get('/anomalous/resolve_hash', model_resolution.api_resolve_hash)
    app.router.add_post('/anomalous/resolve_hash_batch', model_resolution.api_resolve_hash_batch)
    app.router.add_get('/anomalous/all_hashes', model_resolution.api_get_all_hashes)
    app.router.add_post('/anomalous/scan_all', api_scan_all)
    app.router.add_get('/anomalous/global_scan_status', api_global_scan_status)
    app.router.add_get('/anomalous/scan_missing_models_status', api_scan_missing_models_status)
    app.router.add_post('/anomalous/clear_cache', media_routes.api_clear_cache)
    app.router.add_post('/anomalous/update_metadata', model_metadata.api_update_metadata)
    app.router.add_post('/anomalous/set_custom_cover', model_media.api_set_custom_cover)
    app.router.add_post('/anomalous/upload_custom_cover', model_media.api_upload_custom_cover)
    app.router.add_get('/anomalous/model_images', media_routes.api_get_model_images)
    app.router.add_post('/anomalous/resolve_paths_to_previews', model_catalog.api_resolve_paths_to_previews)
    app.router.add_post('/anomalous/scan_missing_models', api_scan_missing_models)
    version_manager.register_routes(app)
