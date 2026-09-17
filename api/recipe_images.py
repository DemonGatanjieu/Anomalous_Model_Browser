"""Contained Recipe image assets and bounded output-gallery inspection."""

from io import BytesIO
import heapq
import json
import os

import folder_paths
from PIL import Image

from .recipe_constants import *
from .utils import require_filename, resolve_within
from .workflow_schema import _node_type, _parameter_signature, _workflow_node_signature

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
