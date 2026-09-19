"""HTTP routes for Workflow Recipes."""

import asyncio
import copy
import json
import os
import time
import uuid

from aiohttp import web
import folder_paths

from . import recipe_schema as _recipe_schema_module
from .recipe_constants import *
from .recipe_images import (
    _attach_preview_snapshots, _bounded_gallery_value, _decode_embedded_json,
    _embedded_parameter_signature, _embedded_workflow_node_signature,
    _embedded_workflow_payload, _gallery_parameter_diff, _output_source_path,
    _parameter_gallery_images, _recipe_assets_dir, _recipe_gallery_images,
    _recipe_cover_webp_bytes, _recent_output_pngs, _store_recipe_gallery_cover,
    _thumbnail_webp_bytes,
)
from .recipe_schema import (
    _build_model_references,
    _computed_identity_for_reference as _schema_computed_identity_for_reference,
    _enrich_recipe as _schema_enrich_recipe, _normalise_recipe, _normalise_source_image,
    _identity_for_reference as _schema_identity_for_reference,
    _model_reference_key, _model_reference_specs,
    _model_roots, _preserve_model_reference_fields,
    _resolve_exact_model_reference, _updated_recipe, _workflow_identity_for_reference,
)
from .recipe_store import (
    _archive_recipe, _delete_recipe_with_history, _history_dir, _list_recipe_history,
    _list_recipes, _read_recipe, _write_recipe, get_recipes_dir,
)
from .utils import require_filename, resolve_within
from .workflow_schema import (
    _clean_volatile_params, _node_title, _node_type, _normalise_workflow_key,
    _parameter_signature, _recipe_receipt, _validate_workflow,
    _volatile_widget_indexes, _widget_values, _workflow_fingerprint,
    _workflow_link_records, _workflow_node_key, _workflow_node_signature,
    _workflow_node_types,
)


def _computed_identity_for_reference(saved_value):
    """Compatibility facade for callers that patched the former route module."""
    previous = _recipe_schema_module._resolve_exact_model_reference
    _recipe_schema_module._resolve_exact_model_reference = _resolve_exact_model_reference
    try:
        return _schema_computed_identity_for_reference(saved_value)
    finally:
        _recipe_schema_module._resolve_exact_model_reference = previous


def _identity_for_reference(saved_value):
    """Compatibility facade for the former monolithic recipes module."""
    previous = _recipe_schema_module._resolve_exact_model_reference
    _recipe_schema_module._resolve_exact_model_reference = _resolve_exact_model_reference
    try:
        return _schema_identity_for_reference(saved_value)
    finally:
        _recipe_schema_module._resolve_exact_model_reference = previous


def _enrich_recipe(*args, **kwargs):
    """Compatibility facade while domain callers migrate to recipe_schema."""
    previous = _recipe_schema_module._identity_for_reference
    _recipe_schema_module._identity_for_reference = _identity_for_reference
    try:
        return _schema_enrich_recipe(*args, **kwargs)
    finally:
        _recipe_schema_module._identity_for_reference = previous

async def api_get_recipes(request):
    recipes_dir = get_recipes_dir()
    recipes = await asyncio.to_thread(_list_recipes, recipes_dir)
    return web.json_response({"recipes": recipes})


async def api_save_recipe(request):
    try:
        payload = await request.json()
        verify_identities = payload.get("verify_model_identities", False)
        if not isinstance(verify_identities, bool):
            raise ValueError("Invalid verification preference")
        recipe = _normalise_recipe(payload)
    except (ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe"}, status=400)
    except Exception:
        return web.json_response({"status": "error", "message": "Invalid request"}, status=400)

    filename = f"recipe_{int(time.time())}_{uuid.uuid4().hex[:8]}.json"
    try:
        recipes_dir = get_recipes_dir()
        recipe["created_timestamp"] = recipe["timestamp"]
        recipe["updated_timestamp"] = recipe["timestamp"]
        recipe = await asyncio.to_thread(
            _enrich_recipe,
            recipe,
            recipes_dir,
            filename,
            True,
            False,
            verify_identities,
        )
        await asyncio.to_thread(_write_recipe, recipes_dir, filename, recipe)
    except (OSError, ValueError):
        return web.json_response({"status": "error", "message": "Could not save recipe"}, status=500)
    return web.json_response({
        "status": "success",
        "filename": filename,
        "receipt": _recipe_receipt(recipe, filename),
    })


async def api_delete_recipe(request):
    try:
        payload = await request.json()
        filename = require_filename(payload.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid filename")
        recipes_dir = get_recipes_dir()
        path = resolve_within(recipes_dir, filename)
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid filename"}, status=400)
    except Exception:
        return web.json_response({"status": "error", "message": "Invalid request"}, status=400)

    try:
        await asyncio.to_thread(_delete_recipe_with_history, recipes_dir, filename)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not delete recipe"}, status=500)
    return web.json_response({"status": "success"})


async def api_get_recipe_full(request):
    try:
        filename = require_filename(request.query.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid filename")
        recipes_dir = get_recipes_dir()
        path = resolve_within(recipes_dir, filename)
        data = await asyncio.to_thread(_read_recipe, path)
        if not isinstance(data, dict) or not isinstance(data.get("workflow"), dict):
            raise ValueError("Invalid recipe")
    except (ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read recipe"}, status=500)
    return web.json_response({"status": "success", "data": data})


async def api_get_recipe_asset(request):
    try:
        filename = require_filename(request.query.get("filename", ""))
        asset_id = require_filename(request.query.get("asset", ""))
        if not filename.endswith(".json") or not asset_id.endswith(".webp"):
            raise ValueError("Invalid recipe asset")
        recipes_dir = get_recipes_dir()
        await asyncio.to_thread(_read_recipe, resolve_within(recipes_dir, filename))
        asset_path = resolve_within(_recipe_assets_dir(recipes_dir, filename), asset_id)
        if not os.path.isfile(asset_path):
            raise FileNotFoundError
    except (ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe asset"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read recipe asset"}, status=500)
    return web.FileResponse(asset_path)


async def api_get_recipe_gallery(request):
    """Find recent output PNGs whose embedded node composition matches one recipe."""
    try:
        filename = request.query.get("filename")
        fingerprint = request.query.get("fingerprint")
        if filename:
            filename = require_filename(filename)
            if not filename.endswith(".json"):
                raise ValueError("Invalid recipe")
            recipes_dir = get_recipes_dir()
            recipe = await asyncio.to_thread(_read_recipe, resolve_within(recipes_dir, filename))
            if not isinstance(recipe, dict) or not isinstance(recipe.get("workflow"), dict):
                raise ValueError("Invalid recipe")
            fingerprint = _workflow_node_signature(recipe["workflow"])["value"]
        elif not isinstance(fingerprint, str) or not SHA256_PATTERN.fullmatch(fingerprint):
            raise ValueError("Invalid fingerprint")
        images, scanned = await asyncio.to_thread(_recipe_gallery_images, fingerprint.lower())
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe gallery request"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read recipe gallery"}, status=500)
    return web.json_response({
        "status": "success",
        "fingerprint": fingerprint.lower(),
        "match_mode": "node-types",
        "images": images,
        "scanned": scanned,
    })


async def api_get_recipe_parameter_gallery(request):
    """Find output PNGs with the same saved node parameters as one recipe."""
    try:
        filename = require_filename(request.query.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid recipe")
        recipes_dir = get_recipes_dir()
        recipe = await asyncio.to_thread(_read_recipe, resolve_within(recipes_dir, filename))
        if not isinstance(recipe, dict) or not isinstance(recipe.get("workflow"), dict):
            raise ValueError("Invalid recipe")
        signature = _parameter_signature(recipe["workflow"])["value"]
        images, scanned = await asyncio.to_thread(_parameter_gallery_images, signature.lower())
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe parameter gallery request"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read recipe parameter gallery"}, status=500)
    return web.json_response({
        "status": "success",
        "fingerprint": signature.lower(),
        "match_mode": "parameters",
        "images": images,
        "scanned": scanned,
    })


async def api_get_recipe_gallery_compare(request):
    """Return bounded parameters and differences for one matched output image."""
    try:
        filename = require_filename(request.query.get("filename", ""))
        source_image = _normalise_source_image({
            "type": "output",
            "filename": request.query.get("image_filename", ""),
            "subfolder": request.query.get("image_subfolder", ""),
        })
        recipes_dir = get_recipes_dir()
        recipe = await asyncio.to_thread(_read_recipe, resolve_within(recipes_dir, filename))
        image_path = await asyncio.to_thread(_output_source_path, source_image)
        payload = await asyncio.to_thread(_embedded_workflow_payload, image_path)
        if not payload or not (payload.get("workflow") or payload.get("prompt")):
            raise ValueError("Image has no workflow metadata")
        comparison = _gallery_parameter_diff(recipe.get("workflow"), payload)
        return web.json_response({
            "status": "success",
            "image": source_image,
            "match_mode": "node-types",
            "comparison": comparison,
        })
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid gallery comparison request"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Image or recipe not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read gallery comparison"}, status=500)


async def api_set_recipe_gallery_cover(request):
    """Promote one verified output image to a portable recipe cover asset."""
    try:
        payload = await request.json()
        filename = require_filename(payload.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid filename")
        source_image = _normalise_source_image(payload.get("source_image"))
        recipes_dir = get_recipes_dir()
        existing = await asyncio.to_thread(_read_recipe, resolve_within(recipes_dir, filename))
        if not isinstance(existing, dict) or not isinstance(existing.get("workflow"), dict):
            raise ValueError("Invalid recipe")
        cover = await asyncio.to_thread(_store_recipe_gallery_cover, recipes_dir, filename, source_image)
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe cover"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Output image not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not create recipe cover"}, status=500)

    recipe = copy.deepcopy(existing)
    recipe["source_image"] = source_image
    recipe["thumbnail"] = None
    presentation = dict(recipe.get("presentation") or {})
    presentation["cover_asset_id"] = cover["asset_id"]
    recipe["presentation"] = presentation
    recipe["timestamp"] = int(time.time() * 1000)
    recipe["updated_timestamp"] = recipe["timestamp"]
    recipe["workflow_fingerprint"] = _workflow_fingerprint(recipe["workflow"])
    if recipe.get("workflow_scope") not in {"partial", "complete"}:
        recipe["workflow_scope"] = "complete"
    recipe["schema_version"] = max(7, int(recipe.get("schema_version") or 1))

    try:
        await asyncio.to_thread(_archive_recipe, recipes_dir, filename, existing)
        await asyncio.to_thread(_write_recipe, recipes_dir, filename, recipe)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not update recipe cover"}, status=500)
    return web.json_response({
        "status": "success",
        "filename": filename,
        "cover": cover,
        "source_image": source_image,
        "workflow_fingerprint": recipe["workflow_fingerprint"],
    })


async def api_update_recipe(request):
    """Replace one recipe while preserving its prior state in local history."""
    try:
        payload = await request.json()
        filename = require_filename(payload.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid filename")
        recipes_dir = get_recipes_dir()
        path = resolve_within(recipes_dir, filename)
        existing = await asyncio.to_thread(_read_recipe, path)
        if not isinstance(existing, dict) or not isinstance(existing.get("workflow"), dict):
            raise ValueError("Invalid recipe")
        refresh_identities = bool(payload.get("refreshIdentities"))
        verify_identities = payload.get("verify_model_identities", False)
        if not isinstance(verify_identities, bool):
            raise ValueError("Invalid verification preference")
        refresh_only = refresh_identities and set(payload).issubset({"filename", "refreshIdentities"})
        recipe = copy.deepcopy(existing) if refresh_only else _updated_recipe(payload, existing)
        recipe = await asyncio.to_thread(
            _enrich_recipe,
            recipe,
            recipes_dir,
            filename,
            True,
            refresh_identities,
            verify_identities,
        )
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read recipe"}, status=500)
    except Exception:
        return web.json_response({"status": "error", "message": "Invalid request"}, status=400)

    try:
        await asyncio.to_thread(_archive_recipe, recipes_dir, filename, existing)
        await asyncio.to_thread(_write_recipe, recipes_dir, filename, recipe)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not update recipe"}, status=500)
    return web.json_response({
        "status": "success",
        "filename": filename,
        "receipt": _recipe_receipt(recipe, filename),
    })


async def api_get_recipe_history(request):
    try:
        filename = require_filename(request.query.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid filename")
        recipes_dir = get_recipes_dir()
        # Verify the root recipe exists before exposing its history directory.
        await asyncio.to_thread(_read_recipe, resolve_within(recipes_dir, filename))
        versions = await asyncio.to_thread(_list_recipe_history, recipes_dir, filename)
    except (ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read recipe history"}, status=500)
    return web.json_response({"status": "success", "versions": versions})


async def api_get_recipe_version(request):
    """Return one bounded historical recipe for semantic comparison only."""
    try:
        filename = require_filename(request.query.get("filename", ""))
        version = require_filename(request.query.get("version", ""))
        if not filename.endswith(".json") or not version.endswith(".json"):
            raise ValueError("Invalid recipe version")
        recipes_dir = get_recipes_dir()
        await asyncio.to_thread(_read_recipe, resolve_within(recipes_dir, filename))
        data = await asyncio.to_thread(
            _read_recipe,
            resolve_within(_history_dir(recipes_dir, filename), version),
        )
        if not isinstance(data, dict) or not isinstance(data.get("workflow"), dict):
            raise ValueError("Invalid recipe version")
    except (ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe version"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Recipe version not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read recipe version"}, status=500)
    return web.json_response({"status": "success", "data": data})


async def api_restore_recipe_version(request):
    try:
        payload = await request.json()
        filename = require_filename(payload.get("filename", ""))
        version = require_filename(payload.get("version", ""))
        if not filename.endswith(".json") or not version.endswith(".json"):
            raise ValueError("Invalid filename")
        recipes_dir = get_recipes_dir()
        existing = await asyncio.to_thread(_read_recipe, resolve_within(recipes_dir, filename))
        historical = await asyncio.to_thread(
            _read_recipe,
            resolve_within(_history_dir(recipes_dir, filename), version),
        )
        if not isinstance(existing, dict) or not isinstance(historical, dict):
            raise ValueError("Invalid recipe")
        recipe = _updated_recipe(historical, existing)
        recipe = await asyncio.to_thread(_enrich_recipe, recipe, recipes_dir, filename, False)
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not restore recipe history"}, status=500)
    except Exception:
        return web.json_response({"status": "error", "message": "Invalid request"}, status=400)

    try:
        await asyncio.to_thread(_archive_recipe, recipes_dir, filename, existing)
        await asyncio.to_thread(_write_recipe, recipes_dir, filename, recipe)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not restore recipe history"}, status=500)
    return web.json_response({
        "status": "success",
        "filename": filename,
        "receipt": _recipe_receipt(recipe, filename),
    })


async def api_refresh_recipe_identity(request):
    """Check exact saved model references using cached metadata only.

    This deliberately does not walk model folders and never computes a full-file
    hash. The response is transient current-machine availability, separate from
    the historical identity stored in the recipe.
    """
    try:
        payload = await request.json()
        references = payload.get("references", [])
        if not isinstance(references, list):
            raise ValueError("Invalid references")
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid references"}, status=400)

    results = []
    for reference in references[:128]:
        if not isinstance(reference, dict):
            continue
        saved_value = reference.get("saved_value")
        resolved = _resolve_exact_model_reference(saved_value)
        result = {
            "node_id": reference.get("node_id"),
            "widget_index": reference.get("widget_index"),
            "saved_value": saved_value,
            "availability": "available" if resolved else "missing",
        }
        if resolved:
            result["local_path"] = resolved["path"]
            identity_result = _identity_for_reference(saved_value)
            result["identity"] = identity_result[0] if isinstance(identity_result, tuple) else identity_result
        results.append(result)
    return web.json_response({"status": "success", "results": results})
