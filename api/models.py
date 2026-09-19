"""Compatibility exports for model API domains.

Route registration imports the focused modules directly; this module preserves
the former import surface for third-party callers and tests.
"""

import folder_paths

from .model_catalog import (
    _allowed_folder_types, _collect_all_scan_models, _collect_folder_models,
    _collect_folders, _find_model_sync, _iter_search_models, _model_info_for_path,
    _resolve_paths_to_model_info_sync, _resolve_paths_to_previews_sync,
    api_base_models, api_batch_select, api_compatible_models, api_find_model,
    api_get_all_scan_models, api_get_folders, api_get_models,
    api_resolve_paths_to_previews,
)
from .model_constants import *
from .model_media import (
    _cache_token, _handle_custom_cover, _preview_url_for_model,
    api_set_custom_cover, api_upload_custom_cover,
)
from .model_metadata import (
    _first_existing_sidecar, _reset_model_cover, api_delete_model, api_update_metadata,
)
from .model_resolution import (
    _candidate_hashes, _collect_resolution_candidates, _compute_and_save_fallback_info,
    _parse_resolution_types, _resolve_from_candidates, _resolved_payload,
    _size_candidate_payload, api_get_all_hashes, api_resolve_hash,
    api_resolve_hash_batch,
)
