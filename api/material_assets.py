"""Image inspection and asset storage for curated materials."""

import hashlib
import os
import shutil
import tempfile

from .recipe_images import _embedded_workflow_payload, _output_source_path, _recipe_cover_webp_bytes
from .recipe_schema import _build_model_references, _normalise_source_image
from .workflow_schema import _validate_workflow
from .material_schema import _node_blocks, _suggested_name
from .utils import require_filename, resolve_within


MAX_SOURCE_IMAGE_BYTES = 64 * 1024 * 1024


def _material_assets_dir(materials_dir, filename, create=False):
    stem = os.path.splitext(require_filename(filename))[0]
    assets_dir = resolve_within(materials_dir, ".assets", stem)
    if create:
        os.makedirs(assets_dir, exist_ok=True)
    return assets_dir


def _inspect_source_image(source_image):
    source = _normalise_source_image(source_image)
    if not source["filename"].lower().endswith(".png"):
        raise ValueError("Only PNG output images can contain reusable workflow metadata")
    source_path = _output_source_path(source)
    payload = _embedded_workflow_payload(source_path)
    workflow = payload.get("workflow") if isinstance(payload, dict) else None
    if not isinstance(workflow, dict):
        raise ValueError("Image has no reusable UI workflow")
    _validate_workflow(workflow)
    blocks = _node_blocks(workflow, include_values=False)
    references = _build_model_references({"workflow": workflow, "params": {}}, verify_identities=False)
    suggested_name = _suggested_name(workflow, source_path, references)
    return source, source_path, workflow, blocks, references, suggested_name


def _store_assets(materials_dir, filename, source_path):
    source_size = os.path.getsize(source_path)
    if source_size > MAX_SOURCE_IMAGE_BYTES:
        raise ValueError("Source image is too large")
    digest = hashlib.sha256()
    with open(source_path, "rb") as source_file:
        for block in iter(lambda: source_file.read(1024 * 1024), b""):
            digest.update(block)
    assets_dir = _material_assets_dir(materials_dir, filename, create=True)
    source_asset = f"source-{digest.hexdigest()}.png"
    source_target = resolve_within(assets_dir, source_asset)
    if not os.path.exists(source_target):
        fd, temp_path = tempfile.mkstemp(prefix=".source-", suffix=".tmp", dir=assets_dir)
        os.close(fd)
        try:
            shutil.copyfile(source_path, temp_path)
            os.replace(temp_path, source_target)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    preview = _recipe_cover_webp_bytes(source_path)
    preview_asset = None
    if preview:
        data, width, height = preview
        preview_asset = f"preview-{hashlib.sha256(data).hexdigest()}.webp"
        preview_target = resolve_within(assets_dir, preview_asset)
        if not os.path.exists(preview_target):
            with open(preview_target, "wb") as preview_file:
                preview_file.write(data)
    else:
        width = height = None
    return {
        "source_asset_id": source_asset,
        "preview_asset_id": preview_asset,
        "preview_width": width,
        "preview_height": height,
        "source_sha256": digest.hexdigest(),
        "source_size": source_size,
    }
