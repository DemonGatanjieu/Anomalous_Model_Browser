"""Shared bounded constants for Workflow Recipe domains."""

import re

MAX_NAME_LENGTH = 120
MAX_TAGS = 20
MAX_TAG_LENGTH = 60
MAX_NOTES_LENGTH = 3000
MAX_MODEL_NOTE_LENGTH = 1000
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
VERIFIABLE_RECIPE_MODEL_CATEGORIES = frozenset({
    "checkpoint",
    "lora",
    "unet",
    "controlnet",
    "vae",
    "text_encoder",
    "clip_vision",
})
