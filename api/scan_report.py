"""What a scan did, model by model.

The scraper appends one JSON line per model it changed to a report file (--report-file),
plus events: "civitai_down" when Civitai stopped answering, "done" with the count of models
left as they were. When a scan ends, ScanJob turns the lines of all its folders into one
result: kept as the last scan (GET /anomalous/last_scan, shown on the scan page) and recorded
in the activity log, with each model located by type, path index and relative path so the
browser can open it (GET /anomalous/scan_model).
"""

import asyncio
import json
import os
import time

from aiohttp import web
import folder_paths

from .activity_log import MAX_CHANGES, add_entry, log_path
from .folder_types import get_active_folder_types
from .model_catalog import _model_info_for_path
from .path_utils import atomic_write_json, resolve_folder_subdir

MAX_FILES = 2000  # models kept in the last scan's result
FILE_FIELDS = ("status", "reason", "name", "base", "cover", "error")


def last_scan_path():
    return os.path.join(os.path.dirname(log_path()), "last_scan.json")


def locate_root(directory):
    """(type, path_idx) of the models folder that is `directory`, shown types first; None if none."""
    target = os.path.normcase(os.path.realpath(directory))
    active = get_active_folder_types()
    types = active + [name for name in folder_paths.folder_names_and_paths if name not in active]
    for folder_type in types:
        try:
            paths = folder_paths.get_folder_paths(folder_type) or []
        except Exception:
            continue
        for path_idx, path in enumerate(paths):
            if os.path.normcase(os.path.realpath(path)) == target:
                return folder_type, path_idx
    return None


def read_report(path):
    """(model entries, events) from a report file; both empty when there is none."""
    entries, events = [], []
    try:
        with open(path, encoding="utf-8") as source:
            for line in source:
                try:
                    item = json.loads(line)
                except ValueError:
                    continue
                if isinstance(item, dict):
                    (events if "event" in item else entries).append(item)
    except OSError:
        pass
    return entries, events


class ScanJob:
    """One scan from start to end: what to call it, its options, and its folders' reports."""

    def __init__(self, kind, data):
        self.kind = kind  # "all" | "picked" | "one"
        self.options = {key: bool(data.get(key)) for key in ("offline_only", "retry_unmatched", "force_overwrite")}
        self.started = time.time()
        self.files = []
        self.unchanged = 0
        self.civitai_down = False
        self.errors = []

    def add_folder(self, report_file, base_dir, located=None):
        """Reads (and removes) one scraper run's report. `located`: (type, path_idx) of base_dir."""
        located = located or locate_root(base_dir) or ("", 0)
        entries, events = read_report(report_file)
        try:
            os.remove(report_file)
        except OSError:
            pass
        for event in events:
            if event.get("event") == "done":
                self.unchanged += int(event.get("unchanged") or 0)
            elif event.get("event") == "civitai_down":
                self.civitai_down = True
        for entry in entries:
            path = entry.get("renamed_to") if entry.get("renamed_to") and entry.get("status") != "failed" else entry.get("file")
            if not isinstance(path, str):
                continue
            item = {key: entry[key] for key in FILE_FIELDS if entry.get(key)}
            item.update(type=located[0], path_idx=located[1], filename=os.path.basename(path),
                        rel=os.path.relpath(path, base_dir).replace(os.sep, "/"))
            if entry.get("renamed_to") and item["status"] != "failed":
                item["renamed_from"] = os.path.basename(entry.get("file") or "")
            if entry.get("duplicate_of"):
                item["duplicate"] = True
            self.files.append(item)

    def add_error(self, message):
        self.errors.append(str(message)[:300])

    def result(self):
        files = self.files
        counts = {
            "matched": sum(item["status"] == "matched" for item in files),
            "inferred": sum(item["status"] == "inferred" for item in files),
            "failed": sum(item["status"] == "failed" for item in files),
            "covers": sum(item.get("cover") == "new" for item in files),
            "renamed": sum(bool(item.get("renamed_from")) for item in files),
            "unchanged": self.unchanged,
        }
        return {
            "kind": self.kind, "options": self.options, "started": self.started,
            "finished": time.time(), "counts": counts, "civitai_down": self.civitai_down,
            "errors": self.errors[:10], "files": files[:MAX_FILES],
        }

    def finish(self):
        """Keeps the result as the last scan and records it in the activity log. Never raises:
        the scan itself is done, the record of it is a convenience."""
        result = self.result()
        try:
            atomic_write_json(last_scan_path(), result)
        except Exception as error:  # noqa: BLE001
            print(f"[Anomalous Browser] Could not keep the scan result: {error}")
        try:
            target = result["files"][0]["filename"] if self.kind == "one" and result["files"] else ""
            detail = {"scan": {key: result[key] for key in ("kind", "options", "counts", "civitai_down", "errors")},
                      "files": result["files"][:MAX_CHANGES], "total": len(self.files),
                      "seconds": round(result["finished"] - result["started"])}
            add_entry("file", "scan_done", target, detail)
        except Exception as error:  # noqa: BLE001
            print(f"[Anomalous Browser] Could not record the scan in the activity log: {error}")
        return result


async def api_last_scan(request):
    """GET /anomalous/last_scan - the last scan's result, or {} before the first one."""
    def read():
        try:
            with open(last_scan_path(), encoding="utf-8") as source:
                data = json.load(source)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}
    return web.json_response(await asyncio.to_thread(read))


async def api_scan_model(request):
    """GET /anomalous/scan_model?type&path_idx&rel - one model as the grid lists it, to open it."""
    rel = request.query.get("rel", "").replace("\\", "/").strip("/")
    subfolder, filename = os.path.split(rel)
    try:
        path_idx = int(request.query.get("path_idx", 0))
        base_dir, target_dir = resolve_folder_subdir(request.query.get("type", ""), path_idx, "/" + subfolder)
    except (ValueError, KeyError, TypeError):
        return web.json_response({"error": "Invalid model location"}, status=400)
    file_path = os.path.join(target_dir, filename)
    if not filename or filename in (".", "..") or not os.path.isfile(file_path):
        return web.json_response({"error": "Model not found"}, status=404)
    model = await asyncio.to_thread(_model_info_for_path, request.query.get("type"), path_idx, base_dir, file_path)
    return web.json_response({"model": model})
