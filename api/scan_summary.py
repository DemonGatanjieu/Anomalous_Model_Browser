"""What the scan page shows before a scan: how many models are matched on Civitai, unmatched, or new."""

import asyncio
import os

from aiohttp import web

from .folder_types import get_active_scan_paths

try:
    from ..model_identity import is_unmatched, sidecar_info
except ImportError:  # loaded outside the package (tests)
    from model_identity import is_unmatched, sidecar_info


def _summarize():
    """Counts the files the scanner handles (.safetensors in the active scan folders), each once."""
    seen = set()
    total = matched = unmatched = 0
    for base_dir in get_active_scan_paths():
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
                if info is None:
                    continue
                if is_unmatched(info):
                    unmatched += 1
                else:
                    matched += 1
    return {"total": total, "matched": matched, "unmatched": unmatched, "new": total - matched - unmatched}


async def api_scan_summary(request):
    """GET /anomalous/scan_summary - {total, matched, unmatched, new}."""
    return web.json_response(await asyncio.to_thread(_summarize))
