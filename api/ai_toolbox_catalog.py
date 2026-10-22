"""Everything the materials picker (web/modules/ui_ai_toolbox.js) lists besides node types, in
one answer (GET /anomalous/ai_toolbox?kind=all): combos with their cover and prompt, saved
workflows with their cover, tags and prompts, prompts (the saved ones, and the ones inside
combos and workflows, ids "combo:<name>" and "workflow:<name>"), and models with their cover,
by the names and ids the AI's tools use. Read in one go and kept a few seconds, so the picker
opens at once; node types come from the page's own node definitions. prompt_entries() also
gives get_toolbox the text of picked prompts."""

import threading
import time

from . import mcp_tools
from .model_catalog import _collect_all_scan_models
from .notebooks import _list_notebooks
from .quick_index import compact_models
from .recipe_store import _list_recipes, get_recipes_dir

CACHE_SECONDS = 15
MAX_TEXT = 1500
MAX_THUMBNAIL = 60_000  # an inline thumbnail larger than this is left out; the cover asset or the default stands in
_cache = {"at": 0.0, "data": None}
_lock = threading.Lock()


def _join(texts, limit=MAX_TEXT):
    text = "\n".join(str(item).strip() for item in texts or [] if str(item or "").strip())
    return text if len(text) <= limit else text[:limit] + "…"


def _combos():
    out = []
    for note in _list_notebooks():
        data = note.get("data") or {}
        combo, loras = mcp_tools.combo_view(note)
        out.append({"name": combo["name"], "model": combo["main_model"], "loras": loras[:12], "base": combo.get("base_model") or "",
                    "prompt": combo["prompt"], "structure": data.get("kind") == "nodes",
                    "cover": (data.get("mainModel") or {}).get("preview_url") or "" if isinstance(data.get("mainModel"), dict) else "",
                    "image": data.get("source_image") if isinstance(data.get("source_image"), dict) else None})
    return out


def _workflows():
    out = []
    for recipe in _list_recipes(get_recipes_dir()):
        data = recipe.get("data") or {}
        params = data.get("params") if isinstance(data.get("params"), dict) else {}
        thumbnail = data.get("thumbnail") if isinstance(data.get("thumbnail"), str) and len(data["thumbnail"]) <= MAX_THUMBNAIL else None
        out.append({"name": data.get("name") or recipe["filename"], "filename": recipe["filename"], "tags": (data.get("tags") or [])[:8],
                    "notes": str(data.get("notes") or "")[:300], "partial": data.get("workflow_scope") == "partial",
                    "nodes": len(params.get("nodes") or []), "base": params.get("baseModel") or "",
                    "prompt": _join(params.get("promptPositive")), "negative": _join(params.get("promptNegative"), 600),
                    "cover_asset": (data.get("presentation") or {}).get("cover_asset_id"), "thumbnail": thumbnail,
                    "image": data.get("source_image") if isinstance(data.get("source_image"), dict) else None,
                    "saved": data.get("timestamp") or 0})
    return out


def _models():
    out = []
    for model in compact_models(_collect_all_scan_models(1, 0).get("models") or []):
        place = f"{model['subfolder']}/{model['filename']}" if model["subfolder"] else model["filename"]
        out.append({"id": f"{model['type']}:{model['path_idx']}:{place}", "name": model["name"] or model["civitai_name"] or model["filename"],
                    "file": model["filename"], "type": model["type"], "base": model["base"], "words": model["words"],
                    "cover": model["preview_url"], "folder": model["subfolder"]})
    return out


def prompt_entries(combos, workflows):
    """The prompts the picker lists: saved ones (id = name), then those of combos and workflows."""
    entries = [{"id": prompt["name"], "name": prompt["name"], "source": "saved", "tags": prompt["tags"],
                "positive": prompt["positive"], "negative": prompt["negative"]} for prompt in mcp_tools.saved_prompts()]
    entries += [{"id": f"combo:{combo['name']}", "name": combo["name"], "source": "combo", "tags": [],
                 "positive": combo["prompt"], "negative": ""} for combo in combos if combo["prompt"]]
    entries += [{"id": f"workflow:{flow['name']}", "name": flow["name"], "source": "workflow", "tags": flow["tags"],
                 "positive": flow["prompt"], "negative": flow["negative"]} for flow in workflows if flow["prompt"] or flow["negative"]]
    return entries


def everything(fresh=False):
    """{combos, workflows, prompts, models}, read at most every CACHE_SECONDS."""
    with _lock:
        if fresh or _cache["data"] is None or time.monotonic() - _cache["at"] > CACHE_SECONDS:
            combos, workflows = _combos(), _workflows()
            _cache.update(at=time.monotonic(), data={"combos": combos, "workflows": workflows,
                                                     "prompts": prompt_entries(combos, workflows), "models": _models()})
        return _cache["data"]
