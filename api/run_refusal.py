"""ComfyUI's refusal of a run, said as what to do next: run_workflow's answer when ComfyUI does not
take the prompt. The page passes the refusal on as data (web/modules/mcp_run.js `refusal`: its
error and each node's, from ComfyUI's validation); each problem becomes one line naming the node,
what is wrong and the tool that fixes it, so the AI does not have to read ComfyUI's raw report and
guess. Kinds not listed here keep ComfyUI's own message."""

MAX_LINES = 8

NODE_HINTS = {
    "required_input_missing": "node {node} ({class_type}) has nothing wired into {input}: connect_nodes into it, or add_node with wire_to={node}",
    "bad_linked_input": "node {node} ({class_type}): {input} is wired from an output of the wrong kind; connect_nodes the right one ({details})",
    "return_type_mismatch": "node {node} ({class_type}): {input} is wired from an output of the wrong kind; connect_nodes the right one ({details})",
    "invalid_input_type": "node {node} ({class_type}): {input} has a value of the wrong kind ({details}); set_values with the right one",
    "value_smaller_than_min": "node {node} ({class_type}): {input} = {value} is below its minimum ({details}); set_values within the range",
    "value_bigger_than_max": "node {node} ({class_type}): {input} = {value} is above its maximum ({details}); set_values within the range",
    "value_not_in_list": ("node {node} ({class_type}): {input} = {value} is not one of its choices. A model this computer "
                          "lacks: check_workflow_models / fix_workflow_models, or search_models then set_model; otherwise "
                          "set_values with one of its choices (find_nodes lists them)"),
}
TOP_HINTS = {
    "prompt_no_outputs": ("the workflow has no output node: add SaveImage (or PreviewImage) behind the VAE Decode with "
                          "add_node(type='SaveImage', wire_from=<its id>)"),
    "invalid_prompt": "{message} {details}: a node type this ComfyUI does not have; find_nodes for one it has, or ask the user to install its node pack",
}


class _Blank(dict):
    def __missing__(self, key):
        return "?"


def _say(template, item):
    return template.format_map(_Blank({key: str(value) for key, value in item.items() if value not in (None, "")}))


def say(refusal):
    """What to do about ComfyUI's refusal (the page's `refusal` data), or "" when it says nothing."""
    if not isinstance(refusal, dict):
        return ""
    lines = []
    for item in refusal.get("nodes") or []:
        if isinstance(item, dict):
            template = NODE_HINTS.get(item.get("type"))
            lines.append(_say(template, item) if template else
                         _say("node {node} ({class_type}): {message} {details}", item).replace(" ?", ""))
    if not lines:
        template = TOP_HINTS.get(refusal.get("type"))
        if template:
            lines.append(_say(template, refusal))
        elif refusal.get("message"):
            lines.append(_say("{message} {details}", refusal).replace(" ?", ""))
    if not lines:
        return ""
    more = len(lines) - MAX_LINES
    return ("ComfyUI did not take the run: " + "; ".join(lines[:MAX_LINES]) + (f"; and {more} more" if more > 0 else "")
            + ". Fix these, then run_workflow again.")
