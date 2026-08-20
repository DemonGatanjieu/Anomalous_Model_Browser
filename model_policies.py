import os
from pathlib import Path


# These components are normally referenced by stable ecosystem filenames.
# Renaming them breaks existing workflows without providing meaningful value.
PHYSICAL_RENAME_PROTECTED_TYPES = frozenset({
    "vae",
    "vae_approx",
    "clip",
    "text_encoders",
    "clip_vision",
})


def is_physical_rename_protected(folder_type=None, folder_path=None):
    """Return True when a model category must keep its physical filename."""
    normalized_type = str(folder_type or "").strip().lower()
    if normalized_type in PHYSICAL_RENAME_PROTECTED_TYPES:
        return True

    if not folder_path:
        return False

    try:
        parts = {
            os.path.normcase(part).lower()
            for part in Path(os.path.abspath(folder_path)).parts
        }
    except (OSError, TypeError, ValueError):
        return False
    return bool(parts.intersection(PHYSICAL_RENAME_PROTECTED_TYPES))
