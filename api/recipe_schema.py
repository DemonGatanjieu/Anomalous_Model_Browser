"""Workflow Recipe record normalization, model references, and enrichment."""

import hashlib
import json
import os
import re
import time

import folder_paths

from .metadata import get_metadata
from .recipe_constants import *
from .recipe_images import _attach_preview_snapshots
from .utils import require_filename, resolve_within
from .workflow_schema import (
    _node_title, _node_type, _parameter_signature, _validate_workflow,
    _widget_values, _workflow_fingerprint,
)

def _model_reference_specs(node):
    """Known loader adapters only; arbitrary third-party widgets stay parameters."""
    node_type = _node_type(node)
    lowered = node_type.lower()
    specs = []

    if re.search(r"checkpointloader(simple)?$", lowered):
        specs.append((0, "checkpoint", "checkpoint"))
    elif lowered.endswith("unetloader"):
        specs.append((0, "unet", "unet"))
    elif re.search(r"loraloader", lowered):
        specs.append((0, "lora", "lora"))
    elif lowered.endswith("vaeloader"):
        specs.append((0, "vae", "vae"))
    elif lowered.endswith("clipvisionloader"):
        specs.append((0, "clip_vision", "clip_vision"))
    elif lowered.endswith("controlnetloader"):
        specs.append((0, "controlnet", "controlnet"))
    elif re.search(r"(?:^|[^a-z])(?:dual|triple)?cliploader$", lowered):
        specs.append((0, "text_encoder", "clip"))
        if "dualclip" in lowered or "tripleclip" in lowered:
            specs.append((1, "text_encoder", "clip"))
        if "tripleclip" in lowered:
            specs.append((2, "text_encoder", "clip"))
    return specs


def _model_roots():
    for folder_type in getattr(folder_paths, "folder_names_and_paths", {}):
        try:
            paths = folder_paths.get_folder_paths(folder_type)
        except Exception:
            continue
        for path_index, base_dir in enumerate(paths or []):
            if os.path.isdir(base_dir):
                yield folder_type, path_index, os.path.realpath(base_dir)


def _resolve_exact_model_reference(saved_value):
    """Resolve one saved model value without recursive scanning or hashing."""
    if not isinstance(saved_value, str) or not saved_value.strip():
        return None
    relative_value = saved_value.replace("/", os.sep)
    for folder_type, path_index, base_dir in _model_roots():
        candidate = os.path.realpath(os.path.join(base_dir, relative_value))
        try:
            if os.path.commonpath((base_dir, candidate)) != base_dir:
                continue
        except ValueError:
            continue
        if not os.path.isfile(candidate) or not candidate.lower().endswith(MODEL_FILE_SUFFIXES):
            continue
        return {
            "path": candidate,
            "folder_type": folder_type,
            "path_index": path_index,
        }
    return None


def _identity_for_reference(saved_value):
    resolved = _resolve_exact_model_reference(saved_value)
    if not resolved:
        return {"status": "unavailable"}, None

    identity = {"status": "unverified", "provenance": "local cached metadata"}
    origin = None
    try:
        identity["size"] = os.path.getsize(resolved["path"])
    except OSError:
        pass
    try:
        metadata = get_metadata(resolved["path"])
        candidate_hash = str(metadata.get("hash") or "").strip()
        if SHA256_PATTERN.fullmatch(candidate_hash):
            identity["status"] = "verified"
            identity["sha256"] = candidate_hash.lower()
            identity["provenance"] = metadata.get("hash_source") or "sidecar file SHA-256"
        
        civitai_url = metadata.get("civitai_url")
        if civitai_url:
            origin = {
                "provider": "civitai",
                "model_name": metadata.get("name") or "",
                "model_url": civitai_url,
                "model_id": metadata.get("model_id") or "",
                "version_id": metadata.get("version_id") or ""
            }
    except Exception:
        pass
    return identity, origin


def _computed_identity_for_reference(saved_value):
    """Compute an exact SHA-256 only after an explicit save-time opt-in."""
    resolved = _resolve_exact_model_reference(saved_value)
    if not resolved:
        return {"status": "unavailable"}
    digest = hashlib.sha256()
    try:
        with open(resolved["path"], "rb") as model_file:
            for block in iter(lambda: model_file.read(4 * 1024 * 1024), b""):
                digest.update(block)
        return {
            "status": "verified",
            "sha256": digest.hexdigest(),
            "size": os.path.getsize(resolved["path"]),
            "provenance": "computed during recipe save",
        }
    except OSError:
        return {"status": "unverified"}


def _workflow_identity_for_reference(workflow, node_id, saved_value):
    extra = workflow.get("extra") if isinstance(workflow, dict) else None
    hashes = extra.get("anomalous_hashes") if isinstance(extra, dict) else None
    if not isinstance(hashes, dict) or not isinstance(saved_value, str):
        return None
    normalized = saved_value.replace("\\", "/")
    windows_path = saved_value.replace("/", "\\")
    keys = (
        f"{node_id}_{saved_value}",
        f"{node_id}_{normalized}",
        f"{node_id}_{windows_path}",
        saved_value,
        normalized,
        windows_path,
    )
    record = next((hashes[key] for key in keys if key in hashes), None)
    candidate_hash = record if isinstance(record, str) else record.get("hash") if isinstance(record, dict) else None
    if not isinstance(candidate_hash, str) or not SHA256_PATTERN.fullmatch(candidate_hash.strip()):
        return None
    identity = {
        "status": "verified",
        "sha256": candidate_hash.strip().lower(),
        "provenance": "workflow snapshot",
    }
    if isinstance(record, dict):
        try:
            identity["size"] = int(record.get("size"))
        except (TypeError, ValueError):
            pass
    return identity


def _build_model_references(recipe, verify_identities=False):
    workflow = recipe.get("workflow") if isinstance(recipe, dict) else None
    params = recipe.get("params") if isinstance(recipe, dict) else None
    base_model = params.get("baseModel") if isinstance(params, dict) else None
    references = []
    for node in workflow.get("nodes", []) if isinstance(workflow, dict) else []:
        if not isinstance(node, dict):
            continue
        values = _widget_values(node)
        for widget_index, category, widget_name in _model_reference_specs(node):
            saved_value = values[widget_index] if widget_index < len(values) else None
            if not isinstance(saved_value, str) or not saved_value.strip():
                continue
            identity_result = _identity_for_reference(saved_value)
            if isinstance(identity_result, tuple):
                identity, origin = (identity_result + (None,))[:2]
            else:
                # Keep compatibility with older callers/tests that provide the
                # pre-origin helper contract and return identity only.
                identity, origin = identity_result, None
            workflow_identity = _workflow_identity_for_reference(workflow, node.get("id"), saved_value)
            if workflow_identity:
                identity = workflow_identity
            elif (
                verify_identities
                and category in VERIFIABLE_RECIPE_MODEL_CATEGORIES
                and identity.get("status") != "verified"
            ):
                identity = _computed_identity_for_reference(saved_value)
            ref_dict = {
                "node_id": node.get("id"),
                "node_type": _node_type(node) or "Unknown",
                "node_title": _node_title(node),
                "widget_index": widget_index,
                "widget_name": widget_name,
                "saved_value": saved_value,
                "category": category,
                "base_model": base_model,
                "identity": identity,
            }
            if origin:
                ref_dict["origin"] = origin
            references.append(ref_dict)
    return references


def _model_reference_key(reference):
    if not isinstance(reference, dict):
        return None
    return (
        reference.get("node_id"),
        reference.get("widget_index"),
        reference.get("category"),
        reference.get("saved_value"),
    )


def _preserve_model_reference_fields(previous_references, references, preserve_identity=True):
    """Carry package/history presentation and identity without trusting names."""
    previous = {
        _model_reference_key(reference): reference
        for reference in previous_references or []
        if _model_reference_key(reference) is not None
        and isinstance(reference, dict)
    }
    for reference in references:
        prior = previous.get(_model_reference_key(reference))
        if prior is None:
            continue
        for field in ("identity", "origin", "preview"):
            if field == "preview" or (field in ("identity", "origin") and preserve_identity):
                if isinstance(prior.get(field), dict):
                    reference[field] = json.loads(json.dumps(prior[field], ensure_ascii=False))
        user_note = prior.get("user_note")
        if isinstance(user_note, str) and user_note.strip():
            reference["user_note"] = user_note.strip()


def _enrich_recipe(
    recipe,
    recipes_dir=None,
    filename=None,
    recapture_previews=True,
    refresh_identities=False,
    verify_identities=False,
):
    recipe["workflow_fingerprint"] = _workflow_fingerprint(recipe["workflow"])
    # Keep the exact parameter-match identity alongside the structural
    # fingerprint. The detail panel can use this value for result discovery
    # without asking the browser to recreate or upload a legacy notebook.
    recipe["parameter_signature"] = _parameter_signature(recipe["workflow"])
    params = dict(recipe.get("params") or {})
    previous_references = params.get("model_references", [])
    references = _build_model_references(recipe, verify_identities=verify_identities)
    _preserve_model_reference_fields(
        previous_references,
        references,
        preserve_identity=not (refresh_identities or verify_identities),
    )
    if recipes_dir and filename and recapture_previews:
        _attach_preview_snapshots(recipe, recipes_dir, filename, references)
    params["model_references"] = references
    recipe["params"] = params
    if recipe.get("workflow_scope") not in {"partial", "complete"}:
        recipe["workflow_scope"] = "complete"
    recipe["schema_version"] = 7
    encoded = json.dumps(recipe, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_RECIPE_BYTES:
        raise ValueError("Recipe is too large")
    return recipe


def _normalise_source_image(value):
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("type") != "output":
        raise ValueError("Invalid source image")
    filename = require_filename(value.get("filename", ""))
    subfolder = value.get("subfolder", "")
    if not isinstance(subfolder, str) or len(subfolder) > MAX_SOURCE_SUBFOLDER_LENGTH:
        raise ValueError("Invalid source image")
    output_dir = folder_paths.get_output_directory()
    resolve_within(output_dir, subfolder)
    return {
        "filename": filename,
        "subfolder": subfolder,
        "type": "output",
    }


def _normalise_recipe(payload):
    if not isinstance(payload, dict):
        raise ValueError("Invalid recipe")

    name = payload.get("name", "")
    if not isinstance(name, str) or not (name := name.strip()) or len(name) > MAX_NAME_LENGTH:
        raise ValueError("Invalid recipe name")

    raw_tags = payload.get("tags", [])
    if not isinstance(raw_tags, list):
        raise ValueError("Invalid recipe tags")
    tags = []
    for tag in raw_tags:
        if not isinstance(tag, str):
            raise ValueError("Invalid recipe tag")
        tag = tag.strip()
        if not tag or len(tag) > MAX_TAG_LENGTH:
            continue
        if tag not in tags:
            tags.append(tag)
        if len(tags) >= MAX_TAGS:
            break

    notes = payload.get("notes", "")
    if not isinstance(notes, str) or len(notes) > MAX_NOTES_LENGTH:
        raise ValueError("Invalid recipe notes")

    params = payload.get("params", {})
    workflow = payload.get("workflow")
    if not isinstance(params, dict) or not isinstance(workflow, dict):
        raise ValueError("Invalid recipe workflow")
    model_references = params.get("model_references")
    if model_references is not None:
        if not isinstance(model_references, list):
            raise ValueError("Invalid recipe model references")
        for reference in model_references:
            if not isinstance(reference, dict):
                raise ValueError("Invalid recipe model reference")
            user_note = reference.get("user_note")
            if user_note is None:
                continue
            if not isinstance(user_note, str) or len(user_note) > MAX_MODEL_NOTE_LENGTH:
                raise ValueError("Invalid recipe model note")
            if user_note.strip():
                reference["user_note"] = user_note.strip()
            else:
                reference.pop("user_note", None)
    _validate_workflow(workflow)
    workflow_scope = payload.get("workflow_scope", "complete")
    if workflow_scope not in {"partial", "complete"}:
        raise ValueError("Invalid recipe workflow scope")

    thumbnail = payload.get("thumbnail")
    if thumbnail is not None:
        if (
            not isinstance(thumbnail, str)
            or len(thumbnail) > MAX_THUMBNAIL_LENGTH
            or not thumbnail.lower().startswith(SAFE_THUMBNAIL_PREFIXES)
        ):
            thumbnail = None

    presentation = payload.get("presentation", {})
    if presentation is None:
        presentation = {}
    if not isinstance(presentation, dict):
        raise ValueError("Invalid recipe presentation")
    save_model_preview_snapshots = presentation.get("save_model_preview_snapshots", True)
    if not isinstance(save_model_preview_snapshots, bool):
        raise ValueError("Invalid recipe presentation")
    cover_asset_id = presentation.get("cover_asset_id")
    if cover_asset_id is not None:
        cover_asset_id = require_filename(cover_asset_id)
        if not cover_asset_id.startswith("cover-") or not cover_asset_id.endswith(".webp"):
            raise ValueError("Invalid recipe presentation")

    recipe = {
        "schema_version": 1,
        "name": name,
        "tags": tags,
        "notes": notes.strip(),
        "params": params,
        "workflow": workflow,
        "workflow_scope": workflow_scope,
        "thumbnail": thumbnail,
        "source_image": _normalise_source_image(payload.get("source_image")),
        "presentation": {
            "save_model_preview_snapshots": save_model_preview_snapshots,
            **({"cover_asset_id": cover_asset_id} if cover_asset_id else {}),
        },
        "timestamp": int(time.time() * 1000),
    }
    encoded = json.dumps(recipe, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_RECIPE_BYTES:
        raise ValueError("Recipe is too large")
    return recipe


def _updated_recipe(payload, existing):
    recipe = _normalise_recipe(payload)
    existing_presentation = existing.get("presentation") if isinstance(existing.get("presentation"), dict) else {}
    existing_cover = existing_presentation.get("cover_asset_id")
    source_unchanged = recipe.get("source_image") == existing.get("source_image")
    if existing_cover and source_unchanged and not recipe["presentation"].get("cover_asset_id"):
        recipe["presentation"]["cover_asset_id"] = existing_cover
    created_timestamp = existing.get("created_timestamp", existing.get("timestamp"))
    if isinstance(created_timestamp, int):
        recipe["created_timestamp"] = created_timestamp
    recipe["updated_timestamp"] = recipe["timestamp"]
    return recipe
