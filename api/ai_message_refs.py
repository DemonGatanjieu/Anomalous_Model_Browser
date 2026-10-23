"""What the user points at in a message to the AI ("@" in the AI workbench's message box,
web/modules/ui_ai_mention.js): models, combos, workflows, prompts, node types, custom node packs
and output pictures, by the names the AI's tools use. Checked when the message is left (clean)
and given to the AI with it (message_of): each thing as get_toolbox gives a pick (lookup), the
pictures attached with what made them, as ai_pictures.py hands them over, so the AI needs no
guessing which "that LoRA" is."""

from . import ai_pictures
from .mcp_tools import ToolError, _resolve_image

KINDS = ("models", "combos", "workflows", "prompts", "nodes", "packs", "pictures")
MAX_REFS = 12
MAX_NAME = 300


class RefsError(ValueError):
    pass


def clean(refs):
    """[{kind, id, label}] from the page: known kinds, text names, each thing once, at most MAX_REFS."""
    if refs in (None, []):
        return []
    if not isinstance(refs, list) or len(refs) > MAX_REFS:
        raise RefsError(f"refs: a list of up to {MAX_REFS} things")
    out = []
    for ref in refs:
        if not isinstance(ref, dict) or ref.get("kind") not in KINDS:
            raise RefsError(f"refs: each is {{kind, id}} with kind one of {', '.join(KINDS)}")
        name = ref.get("id")
        if not isinstance(name, str) or not name.strip() or len(name) > MAX_NAME:
            raise RefsError(f"refs: an id is text of up to {MAX_NAME} characters")
        label = str(ref.get("label") or name).strip()[:MAX_NAME]
        item = {"kind": ref["kind"], "id": name.strip(), "label": label}
        if not any(have["kind"] == item["kind"] and have["id"] == item["id"] for have in out):
            out.append(item)
    return out


def lookup(kind, name):
    """A combo, workflow, prompt or model as the AI's tools give it, or None when it is gone."""
    from . import mcp_tools

    if kind in ("combos", "workflows"):
        lister = mcp_tools.list_combos if kind == "combos" else mcp_tools.list_workflows
        return next(iter(lister(name, 1, exact_name=True)[kind]), None)
    if kind == "prompts":
        from .ai_toolbox_catalog import everything

        return next((entry for entry in everything()["prompts"] if entry["id"] == name), None)
    if kind == "models":
        try:
            found = mcp_tools.get_model(name)
        except ToolError:
            return None
        return found[0] if isinstance(found, tuple) else found  # without its cover picture
    return None


def message_of(step):
    """The refs of a message step for the AI ("refs", each in full or marked missing) and the
    pictures' files in "_pictures" for ai_marks.image_items to attach."""
    items, files = [], []
    for ref in step.get("refs") or []:
        item = {"kind": ref["kind"], "id": ref["id"], "said_as": f"@{ref['label']}"}
        if ref["kind"] == "pictures":
            try:
                rel, path = _resolve_image(ref["id"])[:2]
            except ToolError:
                item["missing"] = True
            else:
                item.update(image=rel, made_with=ai_pictures.brief(path))
                files.append(path)
        elif ref["kind"] == "nodes":
            item["note"] = "a node type: find_nodes(types=[id]) gives it in full, add_node adds it"
        elif ref["kind"] == "packs":
            item["note"] = "a custom node pack (folder): its node types are those find_nodes lists with this source"
        else:
            found = lookup(ref["kind"], ref["id"])
            if found is None:
                item["missing"] = True
            else:
                item["details"] = found
        items.append(item)
    out = {"refs": items, "refs_note": "What the user's @ names in their text point at, exactly."}
    if files:
        out["_pictures"] = files
    return out
