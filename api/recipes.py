"""Local, structured Workflow Recipe storage.

Recipes deliberately live under ComfyUI's user directory rather than the
extension repository, so personal prompts and graphs are never Git content.
"""

import asyncio
import copy
from io import BytesIO
import hashlib
import heapq
import json
import os
import re
import shutil
import tempfile
import time
import uuid

from aiohttp import web
import folder_paths
from PIL import Image

from .metadata import get_metadata
from .utils import require_filename, resolve_within


MAX_NAME_LENGTH = 120
MAX_TAGS = 20
MAX_TAG_LENGTH = 60
MAX_NOTES_LENGTH = 3000
MAX_THUMBNAIL_LENGTH = 1_500_000
MAX_SOURCE_SUBFOLDER_LENGTH = 500
MAX_RECIPE_BYTES = 12 * 1024 * 1024
MAX_HISTORY_VERSIONS = 20
MAX_PREVIEW_SNAPSHOTS = 12
MAX_PREVIEW_SNAPSHOT_BYTES = 96 * 1024
MAX_PREVIEW_SNAPSHOT_TOTAL_BYTES = 1_250_000
MAX_PREVIEW_SOURCE_BYTES = 20 * 1024 * 1024
MAX_WORKFLOW_NODES = 5_000
MAX_WORKFLOW_LINKS = 30_000
MAX_WORKFLOW_GROUPS = 2_000
MAX_WIDGET_VALUES_PER_NODE = 2_048
MAX_RECIPE_GALLERY_SCAN = 200
MAX_RECIPE_GALLERY_RESULTS = 200
MAX_EMBEDDED_WORKFLOW_BYTES = 3 * 1024 * 1024
MAX_RECIPE_COVER_SOURCE_BYTES = 64 * 1024 * 1024
MAX_RECIPE_COVER_BYTES = 256 * 1024
SAFE_THUMBNAIL_PREFIXES = (
    "data:image/jpeg;base64,",
    "data:image/png;base64,",
    "data:image/webp;base64,",
)
MODEL_FILE_SUFFIXES = (".safetensors", ".ckpt", ".pt", ".bin", ".sft")
STATIC_PREVIEW_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif")
STATIC_PREVIEW_SUFFIXES = tuple(f".preview{extension}" for extension in STATIC_PREVIEW_EXTENSIONS)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$", re.IGNORECASE)
VOLATILE_WORKFLOW_KEYS = frozenset({
    "seed",
    "noise_seed",
    "random_seed",
    "variation_seed",
    "batch_size",
    "batch_index",
    "batch_num",
    "last_seed",
})


def _normalise_workflow_key(value):
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")


def _volatile_widget_indexes(node):
    """Known serialized LiteGraph widget positions for native sampler seeds."""
    node_type = _node_type(node).lower()
    if node_type == "ksampler":
        return (0,)
    if node_type == "ksampleradvanced":
        return (1,)
    return ()


def _clean_volatile_params(value):
    """Produce a stable graph view while retaining all generation-defining data."""
    if isinstance(value, list):
        return [_clean_volatile_params(item) for item in value]
    if not isinstance(value, dict):
        return value

    cleaned = {}
    for key, nested_value in value.items():
        if _normalise_workflow_key(key) in VOLATILE_WORKFLOW_KEYS:
            continue
        cleaned[str(key)] = _clean_volatile_params(nested_value)

    widgets = cleaned.get("widgets_values")
    if isinstance(widgets, list):
        for index in _volatile_widget_indexes(value):
            if 0 <= index < len(widgets):
                widgets[index] = "__anomalous_volatile_seed__"
    return cleaned


def _workflow_fingerprint(workflow):
    """Hash the workflow structure after removing known run-volatile values."""
    canonical = json.dumps(
        _clean_volatile_params(workflow),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return {
        "algorithm": "sha256-structural-v1",
        "value": hashlib.sha256(canonical).hexdigest(),
    }


def _parameter_signature(workflow):
    """Hash node types and parameter values for UI workflows or API prompts."""
    if not isinstance(workflow, dict):
        return {"algorithm": "sha256-params-v1", "value": ""}
    
    nodes = workflow.get("nodes")
    is_ui_workflow = isinstance(nodes, list)
    if not is_ui_workflow:
        nodes = list(workflow.values())

    cleaned_nodes = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        
        if is_ui_workflow:
            parameters = {"widgets": _clean_volatile_params(node.get("widgets_values") or [])}
            widgets = parameters["widgets"]
            if isinstance(widgets, list):
                for index in _volatile_widget_indexes(node):
                    if 0 <= index < len(widgets):
                        widgets[index] = "__anomalous_volatile_seed__"
        else:
            parameters = {"inputs": _clean_volatile_params(node.get("inputs") or {})}
                    
        cleaned_nodes.append({
            "type": _node_type(node),
            **parameters,
        })
        
    cleaned_nodes.sort(key=lambda x: (x["type"], json.dumps(x, sort_keys=True, ensure_ascii=False)))
    
    canonical = json.dumps(
        cleaned_nodes,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    
    return {
        "algorithm": "sha256-params-v1",
        "value": hashlib.sha256(canonical).hexdigest(),
    }


def _workflow_node_types(workflow):
    """Extract only node class names from either UI workflow or API prompt data."""
    if not isinstance(workflow, dict):
        return []
    nodes = workflow.get("nodes")
    if isinstance(nodes, list):
        values = nodes
    else:
        values = workflow.values()
    result = []
    for node in values:
        if not isinstance(node, dict):
            continue
        node_type = _node_type(node) or str(node.get("class_type") or "").strip()
        if node_type:
            result.append(node_type)
    return sorted(result, key=lambda value: value.casefold())


def _workflow_node_signature(workflow):
    """Stable node-composition signature used for tolerant result discovery."""
    canonical = json.dumps(
        _workflow_node_types(workflow),
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return {
        "algorithm": "sha256-node-types-v1",
        "value": hashlib.sha256(canonical).hexdigest(),
    }


def _node_type(node):
    return str(node.get("type") or node.get("class_type") or "").strip()


def _node_title(node):
    meta = node.get("_meta") if isinstance(node.get("_meta"), dict) else {}
    return str(meta.get("title") or node.get("title") or _node_type(node) or "Unknown node").strip()


def _widget_values(node):
    values = node.get("widgets_values")
    return values if isinstance(values, list) else []


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


def _build_model_references(recipe):
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


def _recipe_assets_dir(recipes_dir, filename, create=False):
    stem = os.path.splitext(require_filename(filename))[0]
    assets_dir = resolve_within(recipes_dir, ".assets", stem)
    if create:
        os.makedirs(assets_dir, exist_ok=True)
    return assets_dir


def _preview_source_path(saved_value):
    resolved = _resolve_exact_model_reference(saved_value)
    if not resolved:
        return None
    base_path = os.path.splitext(resolved["path"])[0]
    for suffix in STATIC_PREVIEW_SUFFIXES + STATIC_PREVIEW_EXTENSIONS:
        candidate = f"{base_path}{suffix}"
        if os.path.isfile(candidate):
            return candidate
    return None


def _thumbnail_webp_bytes(source_path):
    try:
        if os.path.getsize(source_path) > MAX_PREVIEW_SOURCE_BYTES:
            return None
        with Image.open(source_path) as image:
            image.thumbnail((320, 320))
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            width, height = image.size
            for quality in (76, 62, 48):
                output = BytesIO()
                image.save(output, format="WEBP", quality=quality, method=4)
                data = output.getvalue()
                if len(data) <= MAX_PREVIEW_SNAPSHOT_BYTES:
                    return data, width, height
    except (OSError, ValueError):
        return None
    return None


def _recipe_cover_webp_bytes(source_path):
    """Create a portable recipe-cover asset without retaining the full output image."""
    try:
        if os.path.getsize(source_path) > MAX_RECIPE_COVER_SOURCE_BYTES:
            return None
        with Image.open(source_path) as image:
            image.thumbnail((640, 640))
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            width, height = image.size
            for quality in (84, 72, 60, 48):
                output = BytesIO()
                image.save(output, format="WEBP", quality=quality, method=4)
                data = output.getvalue()
                if len(data) <= MAX_RECIPE_COVER_BYTES:
                    return data, width, height
    except (OSError, ValueError):
        return None
    return None


def _output_source_path(source_image):
    output_dir = folder_paths.get_output_directory()
    target_dir = resolve_within(output_dir, source_image.get("subfolder", ""))
    source_path = resolve_within(target_dir, source_image["filename"])
    if not os.path.isfile(source_path):
        raise FileNotFoundError
    return source_path


def _store_recipe_gallery_cover(recipes_dir, filename, source_image):
    source_path = _output_source_path(source_image)
    cover = _recipe_cover_webp_bytes(source_path)
    if not cover:
        raise ValueError("Could not create recipe cover")
    data, width, height = cover
    asset_id = f"cover-{hashlib.sha256(data).hexdigest()}.webp"
    asset_path = resolve_within(_recipe_assets_dir(recipes_dir, filename, create=True), asset_id)
    if not os.path.exists(asset_path):
        with open(asset_path, "wb") as asset_file:
            asset_file.write(data)
    return {
        "asset_id": asset_id,
        "media_type": "image/webp",
        "width": width,
        "height": height,
    }


def _decode_embedded_json(value):
    if isinstance(value, bytes):
        if len(value) > MAX_EMBEDDED_WORKFLOW_BYTES:
            return None
        value = value.decode("utf-8")
    if not isinstance(value, str) or len(value.encode("utf-8")) > MAX_EMBEDDED_WORKFLOW_BYTES:
        return None
    parsed = json.loads(value)
    return parsed if isinstance(parsed, dict) else None


def _embedded_workflow_payload(image_path):
    """Read bounded workflow/prompt metadata from one PNG without loading pixels."""
    try:
        with Image.open(image_path) as image:
            return {
                "workflow": _decode_embedded_json(image.info.get("workflow")),
                "prompt": _decode_embedded_json(image.info.get("prompt")),
            }
    except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError):
        return None


def _embedded_workflow_node_signature(image_path):
    payload = _embedded_workflow_payload(image_path)
    if not payload:
        return None
    workflow = payload.get("workflow") or payload.get("prompt")
    if not workflow:
        return None
    return _workflow_node_signature(workflow)["value"]


def _embedded_parameter_signature(image_path):
    payload = _embedded_workflow_payload(image_path)
    if not payload:
        return None
    workflow = payload.get("workflow") or payload.get("prompt")
    if not workflow:
        return None
    return _parameter_signature(workflow)["value"]


def _recent_output_pngs(output_dir, limit=MAX_RECIPE_GALLERY_SCAN):
    """Return a bounded newest-first PNG list without trusting request paths."""
    newest = []
    try:
        for root, _, files in os.walk(output_dir):
            for name in files:
                if not name.lower().endswith(".png"):
                    continue
                path = os.path.join(root, name)
                try:
                    stat = os.stat(path)
                except OSError:
                    continue
                candidate = (stat.st_mtime_ns, path)
                if len(newest) < limit:
                    heapq.heappush(newest, candidate)
                elif candidate > newest[0]:
                    heapq.heapreplace(newest, candidate)
    except OSError:
        return []
    return sorted(newest, reverse=True)


def _recipe_gallery_images(node_signature):
    output_dir = folder_paths.get_output_directory()
    if not os.path.isdir(output_dir):
        return [], 0
    matches = []
    scanned = 0
    for mtime_ns, image_path in _recent_output_pngs(output_dir):
        scanned += 1
        if _embedded_workflow_node_signature(image_path) != node_signature:
            continue
        relative_dir = os.path.relpath(os.path.dirname(image_path), output_dir)
        subfolder = "" if relative_dir == "." else relative_dir.replace("\\", "/")
        matches.append({
            "filename": os.path.basename(image_path),
            "subfolder": subfolder,
            "type": "output",
            "mtime": mtime_ns // 1_000_000,
        })
        if len(matches) >= MAX_RECIPE_GALLERY_RESULTS:
            break
    return matches, scanned


def _parameter_gallery_images(parameter_signature):
    output_dir = folder_paths.get_output_directory()
    if not os.path.isdir(output_dir):
        return [], 0
    matches = []
    scanned = 0
    for mtime_ns, image_path in _recent_output_pngs(output_dir):
        scanned += 1
        if _embedded_parameter_signature(image_path) != parameter_signature:
            continue
        relative_dir = os.path.relpath(os.path.dirname(image_path), output_dir)
        subfolder = "" if relative_dir == "." else relative_dir.replace("\\", "/")
        matches.append({
            "filename": os.path.basename(image_path),
            "subfolder": subfolder,
            "type": "output",
            "mtime": mtime_ns // 1_000_000,
        })
        if len(matches) >= MAX_RECIPE_GALLERY_RESULTS:
            break
    return matches, scanned


def _bounded_gallery_value(value, depth=0):
    """Keep image-embedded parameter details useful without echoing huge metadata."""
    if depth > 5:
        return "…"
    if isinstance(value, str):
        return value if len(value) <= 2000 else f"{value[:1997]}..."
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        return [_bounded_gallery_value(item, depth + 1) for item in value[:64]]
    if isinstance(value, dict):
        return {
            str(key): _bounded_gallery_value(nested, depth + 1)
            for key, nested in list(value.items())[:96]
        }
    return str(value)[:2000]


def _gallery_parameter_records(workflow):
    if not isinstance(workflow, dict):
        return []
    nodes = workflow.get("nodes")
    is_ui_workflow = isinstance(nodes, list)
    values = nodes if is_ui_workflow else workflow.values()
    records = []
    occurrence = {}
    for node in values:
        if not isinstance(node, dict):
            continue
        node_type = _node_type(node) or str(node.get("class_type") or "").strip()
        if not node_type:
            continue
        occurrence[node_type] = occurrence.get(node_type, 0) + 1
        if is_ui_workflow:
            parameters = {"widgets": _bounded_gallery_value(node.get("widgets_values", []))}
            node_id = node.get("id")
        else:
            parameters = {"inputs": _bounded_gallery_value(node.get("inputs", {}))}
            node_id = None
        records.append({
            "type": node_type,
            "index": occurrence[node_type],
            "node_id": node_id,
            "parameters": parameters,
        })
    return records


def _gallery_parameter_diff(recipe_workflow, image_payload):
    recipe_records = _gallery_parameter_records(recipe_workflow)
    embedded_workflow = image_payload.get("workflow") or image_payload.get("prompt") if image_payload else None
    image_records = _gallery_parameter_records(embedded_workflow)
    recipe_map = {(item["type"], item["index"]): item for item in recipe_records}
    image_map = {(item["type"], item["index"]): item for item in image_records}
    changes = []
    for key in sorted(set(recipe_map) | set(image_map), key=lambda item: (item[0].casefold(), item[1])):
        recipe_item = recipe_map.get(key)
        image_item = image_map.get(key)
        if recipe_item is None or image_item is None or recipe_item["parameters"] != image_item["parameters"]:
            changes.append({
                "type": key[0],
                "index": key[1],
                "recipe": recipe_item["parameters"] if recipe_item else None,
                "image": image_item["parameters"] if image_item else None,
            })
    return {
        "recipe_nodes": recipe_records,
        "image_nodes": image_records,
        "changes": changes,
        "comparable": bool(image_records) and all(
            isinstance(item.get("workflow"), dict) for item in [image_payload or {}]
        ),
    }


def _attach_preview_snapshots(recipe, recipes_dir, filename, references):
    if not recipe.get("presentation", {}).get("save_model_preview_snapshots"):
        return
    assets_dir = _recipe_assets_dir(recipes_dir, filename, create=True)
    total_bytes = 0
    for reference in references[:MAX_PREVIEW_SNAPSHOTS]:
        source_path = _preview_source_path(reference.get("saved_value"))
        if not source_path:
            continue
        thumbnail = _thumbnail_webp_bytes(source_path)
        if not thumbnail:
            continue
        data, width, height = thumbnail
        if total_bytes + len(data) > MAX_PREVIEW_SNAPSHOT_TOTAL_BYTES:
            break
        asset_id = f"{hashlib.sha256(data).hexdigest()}.webp"
        asset_path = resolve_within(assets_dir, asset_id)
        if not os.path.exists(asset_path):
            with open(asset_path, "wb") as asset_file:
                asset_file.write(data)
        total_bytes += len(data)
        reference["preview"] = {
            "snapshot_asset_id": asset_id,
            "media_type": "image/webp",
            "width": width,
            "height": height,
            "captured_at": recipe["timestamp"],
        }


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


def _enrich_recipe(recipe, recipes_dir=None, filename=None, recapture_previews=True, refresh_identities=False):
    recipe["workflow_fingerprint"] = _workflow_fingerprint(recipe["workflow"])
    # Keep the exact parameter-match identity alongside the structural
    # fingerprint. The detail panel can use this value for result discovery
    # without asking the browser to recreate or upload a legacy notebook.
    recipe["parameter_signature"] = _parameter_signature(recipe["workflow"])
    params = dict(recipe.get("params") or {})
    previous_references = params.get("model_references", [])
    references = _build_model_references(recipe)
    _preserve_model_reference_fields(
        previous_references,
        references,
        preserve_identity=not refresh_identities,
    )
    if recipes_dir and filename and recapture_previews:
        _attach_preview_snapshots(recipe, recipes_dir, filename, references)
    params["model_references"] = references
    recipe["params"] = params
    recipe["schema_version"] = 5
    encoded = json.dumps(recipe, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_RECIPE_BYTES:
        raise ValueError("Recipe is too large")
    return recipe


def get_recipes_dir():
    """Return the user-owned recipe directory, creating it if needed."""
    user_dir = (
        folder_paths.get_user_directory()
        if hasattr(folder_paths, "get_user_directory")
        else os.path.join(folder_paths.base_path, "user", "default")
    )
    recipes_dir = os.path.join(user_dir, "workflows", "anomalous_recipes")
    os.makedirs(recipes_dir, exist_ok=True)
    return os.path.realpath(recipes_dir)


def _read_recipe(path):
    with open(path, "r", encoding="utf-8") as recipe_file:
        return json.load(recipe_file)


def _workflow_node_key(value):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError("Invalid workflow node id")
    value = str(value).strip()
    if not value:
        raise ValueError("Invalid workflow node id")
    return value


def _workflow_link_records(workflow):
    links = workflow.get("links", [])
    if links is None:
        return []
    if isinstance(links, list):
        return links
    if isinstance(links, dict):
        return list(links.values())
    raise ValueError("Invalid workflow links")


def _validate_workflow(workflow):
    """Reject malformed graph topology before it reaches user recipe storage."""
    if not isinstance(workflow, dict):
        raise ValueError("Invalid recipe workflow")
    nodes = workflow.get("nodes")
    if not isinstance(nodes, list) or len(nodes) > MAX_WORKFLOW_NODES:
        raise ValueError("Invalid workflow nodes")

    node_ids = set()
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError("Invalid workflow node")
        node_key = _workflow_node_key(node.get("id"))
        if node_key in node_ids:
            raise ValueError("Duplicate workflow node id")
        node_ids.add(node_key)
        values = node.get("widgets_values")
        if values is not None and (not isinstance(values, list) or len(values) > MAX_WIDGET_VALUES_PER_NODE):
            raise ValueError("Invalid workflow widget values")

    groups = workflow.get("groups", [])
    if groups is not None and (not isinstance(groups, list) or len(groups) > MAX_WORKFLOW_GROUPS):
        raise ValueError("Invalid workflow groups")

    links = _workflow_link_records(workflow)
    if len(links) > MAX_WORKFLOW_LINKS:
        raise ValueError("Too many workflow links")
    for link in links:
        if isinstance(link, list) and len(link) >= 5:
            origin_id, target_id = link[1], link[3]
        elif isinstance(link, dict):
            origin_id, target_id = link.get("origin_id"), link.get("target_id")
        else:
            raise ValueError("Invalid workflow link")
        if _workflow_node_key(origin_id) not in node_ids or _workflow_node_key(target_id) not in node_ids:
            raise ValueError("Dangling workflow link")


def _recipe_receipt(recipe, filename):
    """Return a small, user-visible confirmation for the accepted graph."""
    workflow = recipe.get("workflow") if isinstance(recipe, dict) else {}
    params = recipe.get("params") if isinstance(recipe, dict) else {}
    return {
        "filename": filename,
        "node_count": len(workflow.get("nodes", [])) if isinstance(workflow, dict) else 0,
        "link_count": len(_workflow_link_records(workflow)) if isinstance(workflow, dict) else 0,
        "group_count": len(workflow.get("groups", [])) if isinstance(workflow.get("groups", []), list) else 0,
        "parameter_node_count": len(params.get("nodes", [])) if isinstance(params, dict) and isinstance(params.get("nodes", []), list) else 0,
        "pinned_count": len(params.get("pinned", [])) if isinstance(params, dict) and isinstance(params.get("pinned", []), list) else 0,
        "workflow_fingerprint": recipe.get("workflow_fingerprint") if isinstance(recipe, dict) else None,
    }


def _list_recipes(recipes_dir):
    recipes = []
    try:
        with os.scandir(recipes_dir) as entries:
            for entry in entries:
                if not entry.is_file() or not entry.name.endswith(".json"):
                    continue
                try:
                    filename = require_filename(entry.name)
                    data = _read_recipe(resolve_within(recipes_dir, filename))
                    if not isinstance(data, dict):
                        continue
                    # The graph can be much larger than all card data combined.
                    summary = {key: value for key, value in data.items() if key != "workflow"}
                    recipes.append({"filename": filename, "data": summary})
                except (OSError, ValueError, json.JSONDecodeError):
                    continue
    except OSError:
        return []
    recipes.sort(key=lambda item: item["data"].get("timestamp", 0), reverse=True)
    return recipes


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
    _validate_workflow(workflow)

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


def _write_recipe(recipes_dir, filename, recipe):
    path = resolve_within(recipes_dir, filename)
    fd, temp_path = tempfile.mkstemp(prefix=".recipe-", suffix=".tmp", dir=recipes_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as recipe_file:
            json.dump(recipe, recipe_file, ensure_ascii=False, separators=(",", ":"))
            recipe_file.flush()
            os.fsync(recipe_file.fileno())
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def _history_dir(recipes_dir, filename, create=False):
    """Return the contained, user-data-only history directory for one recipe."""
    stem = os.path.splitext(require_filename(filename))[0]
    history_dir = resolve_within(recipes_dir, ".history", stem)
    if create:
        os.makedirs(history_dir, exist_ok=True)
    return history_dir


def _archive_recipe(recipes_dir, filename, recipe):
    """Atomically retain a bounded pre-update snapshot before replacing a recipe."""
    history_dir = _history_dir(recipes_dir, filename, create=True)
    version_name = f"version_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}.json"
    _write_recipe(history_dir, version_name, recipe)

    entries = []
    with os.scandir(history_dir) as scan:
        for entry in scan:
            if entry.is_file() and entry.name.endswith(".json"):
                entries.append(entry)
    entries.sort(key=lambda entry: entry.stat().st_mtime_ns, reverse=True)
    for entry in entries[MAX_HISTORY_VERSIONS:]:
        try:
            os.remove(resolve_within(history_dir, entry.name))
        except OSError:
            pass


def _list_recipe_history(recipes_dir, filename):
    history_dir = _history_dir(recipes_dir, filename)
    versions = []
    try:
        with os.scandir(history_dir) as entries:
            for entry in entries:
                if not entry.is_file() or not entry.name.endswith(".json"):
                    continue
                try:
                    version = require_filename(entry.name)
                    data = _read_recipe(resolve_within(history_dir, version))
                    if not isinstance(data, dict):
                        continue
                    versions.append({
                        "version": version,
                        "timestamp": data.get("timestamp", 0),
                        "name": data.get("name", ""),
                        "workflow_fingerprint": data.get("workflow_fingerprint"),
                        "model_reference_count": len(
                            (data.get("params") or {}).get("model_references", [])
                            if isinstance(data.get("params"), dict)
                            else []
                        ),
                    })
                except (OSError, ValueError, json.JSONDecodeError):
                    continue
    except OSError:
        return []
    versions.sort(key=lambda item: item["timestamp"], reverse=True)
    return versions


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


def _delete_recipe_with_history(recipes_dir, filename):
    """Delete an explicitly selected recipe and its contained local history."""
    os.remove(resolve_within(recipes_dir, filename))
    history_dir = _history_dir(recipes_dir, filename)
    if os.path.isdir(history_dir):
        shutil.rmtree(history_dir)
    assets_dir = _recipe_assets_dir(recipes_dir, filename)
    if os.path.isdir(assets_dir):
        shutil.rmtree(assets_dir)


async def api_get_recipes(request):
    recipes_dir = get_recipes_dir()
    recipes = await asyncio.to_thread(_list_recipes, recipes_dir)
    return web.json_response({"recipes": recipes})


async def api_save_recipe(request):
    try:
        recipe = _normalise_recipe(await request.json())
    except (ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe"}, status=400)
    except Exception:
        return web.json_response({"status": "error", "message": "Invalid request"}, status=400)

    filename = f"recipe_{int(time.time())}_{uuid.uuid4().hex[:8]}.json"
    try:
        recipes_dir = get_recipes_dir()
        recipe["created_timestamp"] = recipe["timestamp"]
        recipe["updated_timestamp"] = recipe["timestamp"]
        recipe = await asyncio.to_thread(_enrich_recipe, recipe, recipes_dir, filename)
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
    recipe["schema_version"] = max(5, int(recipe.get("schema_version") or 1))

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
        refresh_only = refresh_identities and set(payload).issubset({"filename", "refreshIdentities"})
        recipe = copy.deepcopy(existing) if refresh_only else _updated_recipe(payload, existing)
        recipe = await asyncio.to_thread(_enrich_recipe, recipe, recipes_dir, filename, True, refresh_identities)
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
            result["identity"] = _identity_for_reference(saved_value)
        results.append(result)
    return web.json_response({"status": "success", "results": results})
