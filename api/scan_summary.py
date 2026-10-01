"""What the scan page shows before a scan: how many models are matched on Civitai, unmatched or
new, and which ones the last two are (located like the scan report's models, so the page can
open them)."""

import asyncio
import os

from aiohttp import web

from .folder_types import get_active_scan_paths
from .scan_report import locate_root

try:
    from ..model_identity import is_unmatched, sidecar_info, unmatched_reason
except ImportError:  # loaded outside the package (tests)
    from model_identity import is_unmatched, sidecar_info, unmatched_reason

MAX_LISTED = 2000  # models listed per kind; the counts stay exact


def _summarize():
    """Counts the files the scanner handles (.safetensors in the active scan folders), each once.
    `pending`: unmatched models Civitai was never asked about (offline, or unreachable then),
    which the next online scan looks up."""
    seen = set()
    total = matched = 0
    unmatched, new = [], []
    for base_dir in get_active_scan_paths():
        located = locate_root(base_dir) or ("", 0)
        for root, _dirs, files in os.walk(base_dir):
            for filename in files:
                if not filename.endswith(".safetensors"):
                    continue
                path = os.path.join(root, filename)
                real = os.path.realpath(path)
                if real in seen:
                    continue
                seen.add(real)
                total += 1
                info = sidecar_info(os.path.splitext(path)[0])
                if info is not None and not is_unmatched(info):
                    matched += 1
                    continue
                item = {"type": located[0], "path_idx": located[1], "filename": filename,
                        "rel": os.path.relpath(path, base_dir).replace(os.sep, "/")}
                if info is None:
                    new.append(item)
                else:
                    item.update(reason=unmatched_reason(info), base=info.get("baseModel") or "")
                    unmatched.append(item)
    return {
        "total": total, "matched": matched, "unmatched": len(unmatched), "new": len(new),
        "pending": sum(item["reason"] in ("offline", "network") for item in unmatched),
        "unmatched_models": unmatched[:MAX_LISTED], "new_models": new[:MAX_LISTED],
    }


async def api_scan_summary(request):
    """GET /anomalous/scan_summary - counts, and the unmatched and new models."""
    return web.json_response(await asyncio.to_thread(_summarize))
