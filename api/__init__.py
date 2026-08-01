
from .models import *
from .scanner import *
from .config import *
from .notebooks import *
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

