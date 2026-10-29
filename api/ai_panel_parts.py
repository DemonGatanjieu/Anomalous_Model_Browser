"""The parts of the blocks the AI sends to a panel (ai_panels.py), each checked to one plain shape:
text and lists of bounded size, fractions of a picture, marks (circles or boxes with a label),
the part of the pictures shown enlarged (zoom), pictures only from ComfyUI's output folder,
diagram boxes and arrows, and model cards only from the user's folders."""

import os

from . import ai_tasks

MAX_ITEMS = 12
COLORS = ("red", "green", "blue", "yellow", "purple")
MAX_MARKS = 8
MAX_NODES = 24
MAX_EDGES = 40


class PanelError(ValueError):
    """What is wrong with a panel, for the AI to fix."""


def _text(value, limit, where, required=False):
    if value is None and not required:
        return ""
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise PanelError(f"{where} must be text")
    text = str(value).strip()
    if required and not text:
        raise PanelError(f"{where} is empty")
    return text[:limit]


def _list(value, limit, where):
    if value is None:
        return []
    if not isinstance(value, list):
        raise PanelError(f"{where} must be a list")
    if len(value) > limit:
        raise PanelError(f"{where} has more than {limit} items")
    return value


def _fraction(value, where):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 <= value <= 1:
        raise PanelError(f"{where} must be a number from 0 to 1 (a fraction of the picture)")
    return round(float(value), 4)


def _marks(value, where):
    marks = []
    for i, mark in enumerate(_list(value, MAX_MARKS, where)):
        here = f"{where}[{i}]"
        if not isinstance(mark, dict):
            raise PanelError(f"{here} must be {{x, y, w, h | r, label, color}}")
        out = {"x": _fraction(mark.get("x"), f"{here}.x"), "y": _fraction(mark.get("y"), f"{here}.y"),
               "label": _text(mark.get("label"), 60, f"{here}.label"),
               "color": mark.get("color") if mark.get("color") in COLORS else "red"}
        if mark.get("w") is not None or mark.get("h") is not None:
            out.update(w=_fraction(mark.get("w"), f"{here}.w"), h=_fraction(mark.get("h"), f"{here}.h"))
        else:
            out["r"] = _fraction(mark.get("r", 0.06), f"{here}.r")
        marks.append(out)
    return marks


def _image(item, where):
    image = item.get("image") if isinstance(item, dict) else item
    found = ai_tasks._output_media(str(image or ""))
    if not found:
        raise PanelError(f"{where}: {image!r} is not a picture in ComfyUI's output folder (subfolder/name.png, as search_images gives it)")
    out = {**found, "caption": _text(item.get("caption") if isinstance(item, dict) else "", 120, f"{where}.caption")}
    if isinstance(item, dict) and item.get("marks"):
        out["marks"] = _marks(item["marks"], f"{where}.marks")
    return out


def _zoom(value, where):
    """The part of every picture of a slider or picks block shown enlarged: {x, y, w, h} as fractions,
    x/y its centre (as a mark's box), kept inside the picture: {left, top, w, h}."""
    try:
        x, y, w, h = (float(value[key]) for key in ("x", "y", "w", "h"))
    except (KeyError, TypeError, ValueError):
        raise PanelError(f"{where} must be {{x, y, w, h}}: fractions 0-1 of the picture, x/y the centre")
    if not (0 <= x <= 1 and 0 <= y <= 1 and 0.02 <= w <= 1 and 0.02 <= h <= 1):
        raise PanelError(f"{where}: x and y 0-1, w and h 0.02-1")
    return {"left": round(min(max(x - w / 2, 0), 1 - w), 4), "top": round(min(max(y - h / 2, 0), 1 - h), 4),
            "w": round(w, 4), "h": round(h, 4)}


def _diagram(block, where):
    nodes, ids = [], set()
    for i, node in enumerate(_list(block.get("nodes"), MAX_NODES, f"{where}.nodes")):
        here = f"{where}.nodes[{i}]"
        if not isinstance(node, dict):
            raise PanelError(f"{here} must be {{id, label, detail, node_id}}")
        node_id = _text(node.get("id") or f"n{i + 1}", 40, f"{here}.id")
        if node_id in ids:
            raise PanelError(f"{here}.id {node_id!r} twice")
        ids.add(node_id)
        out = {"id": node_id, "label": _text(node.get("label"), 40, f"{here}.label", True),
               "detail": _text(node.get("detail"), 80, f"{here}.detail"),
               "color": node.get("color") if node.get("color") in COLORS else ""}
        if node.get("node_id") not in (None, ""):
            out["node_id"] = _text(node.get("node_id"), 20, f"{here}.node_id")
        nodes.append(out)
    if not nodes:
        raise PanelError(f"{where}.nodes is empty")
    edges = []
    for i, edge in enumerate(_list(block.get("edges"), MAX_EDGES, f"{where}.edges")):
        here = f"{where}.edges[{i}]"
        if not isinstance(edge, dict) or edge.get("from") not in ids or edge.get("to") not in ids:
            raise PanelError(f"{here} must be {{from, to, label}} naming two node ids")
        edges.append({"from": edge["from"], "to": edge["to"], "label": _text(edge.get("label"), 30, f"{here}.label")})
    return {"nodes": nodes, "edges": edges, "direction": "down" if block.get("direction") == "down" else "right"}


def _model(item, where):
    from .mcp_tools import ToolError, _resolve_model
    from .model_media import _preview_url_for_model

    model_id = item.get("model_id") if isinstance(item, dict) else item
    try:
        folder_type, path_idx, base_dir, file_path = _resolve_model(model_id)
    except ToolError as error:
        raise PanelError(f"{where}: {error}")
    try:
        cover = _preview_url_for_model(folder_type, path_idx, base_dir, file_path) or ""
    except Exception:  # noqa: BLE001 - a card without its cover is still a card
        cover = ""
    return {"model_id": str(model_id), "folder": folder_type, "path_idx": path_idx,
            "rel": os.path.relpath(file_path, base_dir).replace(os.sep, "/"), "name": os.path.basename(file_path),
            "cover": cover, "note": _text(item.get("note") if isinstance(item, dict) else "", 160, f"{where}.note")}
