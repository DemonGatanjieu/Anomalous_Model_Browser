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

# Foundation components may be recovered under a different local filename, but
# only when the workflow carries a cryptographic identity. File size alone is
# too weak for shared VAE/text-encoder libraries.
HASH_ONLY_RECOVERY_TYPES = PHYSICAL_RENAME_PROTECTED_TYPES


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


def requires_hash_for_model_recovery(folder_types):
    """Return True when every requested category requires a hash match."""
    normalized = {
        str(folder_type or "").strip().lower()
        for folder_type in (folder_types or ())
        if str(folder_type or "").strip()
    }
    return bool(normalized) and normalized.issubset(HASH_ONLY_RECOVERY_TYPES)
