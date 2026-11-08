"""A chain of ready-made blocks (reference_blocks.py) built on a new tab, one after another: the plan an AI
lays out in big steps (make the picture, redraw it with another model, fix the faces, enlarge), built by
Anomalous so the AI wires nothing. The first step makes the picture (a block that stands alone, on the
model it names). Each next block goes on from what the step before gave (a block's "gives": the sampler
a next one takes its model, prompts and settings from, and the output node whose picture it works on),
both named to the page, so nothing is guessed when the canvas holds several samplers and outputs. A block
that gives nothing changes the step it is put on (a pose to follow, a split between two models), and the
next goes on from the same place. A step may name a model for the block's own loader ("own_model"), and
LoRAs: on the picture's model, or on a bare second loader (a copied model line has them already)."""

from . import reference_blocks
from .mcp_tools import ToolError


def _loader(step, block, nodes):
    """The node id of the block's own model loader in `nodes` (add_nodes' key -> id), or None."""
    own = reference_blocks.BLOCKS[block].get("own_model") or {}
    found = next((nodes[key] for key in own.get("nodes") or () if key in nodes), None)
    if step.get("model") and found is None:
        raise ToolError(f"Step {block} has no loader of its own for a second model; leave model out.")
    return None if found is None else int(found)


def build(ctx, steps, name="plan"):
    """`steps` ([{use, want | block, model, loras, image}], the first a picture) on a new tab named `name`.
    {"steps": [{"block", "nodes"}], "nodes": every step's nodes by "<step>.<key>"} for what was built."""
    from . import mcp_actions, mcp_canvas_edit

    if not steps:
        raise ToolError("A plan has at least its first step, the picture.")
    mcp_canvas_edit.new_workflow(ctx, name)
    at, built = {"sampler": None, "save": None}, []
    for index, step in enumerate(steps):
        how = {key: step[key] for key in ("use", "want", "block", "image") if step.get(key) is not None}
        if index == 0:
            how["model"] = step.get("model")
        else:
            how.update(near_node_id=at["sampler"], save_node_id=at["save"])
        added = mcp_canvas_edit.add_nodes(ctx, **how)
        block, nodes = added.get("block") or step.get("block"), added.get("nodes") or {}
        if index == 0 and not reference_blocks.BLOCKS.get(block, {}).get("standalone"):
            raise ToolError("A plan starts with the picture (use=picture).")
        loader = int(nodes["model"]) if index == 0 else _loader(step, block, nodes)
        if index and step.get("model"):
            mcp_actions.set_model(ctx, loader, step["model"])
        copied = (reference_blocks.BLOCKS[block].get("own_model") or {}).get("copies_loras")
        if loader is not None and not copied:
            for lora in step.get("loras") or ():
                mcp_actions.add_lora(ctx, lora, after_node_id=loader)
        for role, key in (reference_blocks.BLOCKS[block].get("gives") or {}).items():
            if key in nodes:
                at[role] = int(nodes[key])
        built.append({"block": block, "nodes": nodes})
    return {"steps": built, "nodes": {f"{at_step}.{key}": node for at_step, item in enumerate(built, 1)
                                      for key, node in item["nodes"].items()}}
