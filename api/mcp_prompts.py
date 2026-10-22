"""Ready-made requests the user can start from their AI app (MCP prompts; Claude shows them as
slash commands such as /anomalous:pick_best): each is a few lines telling the AI how to do a
common job with Anomalous's tools so the user can watch, choose and step in on the AI workbench.
They only shape the AI's first message; they change nothing themselves."""

PROMPTS = {
    "workbench_task": {
        "title": "Start a task on the AI workbench",
        "description": "Do something in ComfyUI the way the user can follow on Anomalous's AI workbench.",
        "arguments": [{"name": "what", "description": "What to do", "required": True}],
        "text": ("Use Anomalous for this: {what}\n"
                 "Call begin_task with a short title in my language first. Show your plan, then results, with "
                 "show_panel in the order they happen; when a choice is mine, ask with choices or picks and wait "
                 "with get_answers. Honour any user_messages that come with a tool result. End with report(done=true)."),
    },
    "pick_best": {
        "title": "Make a few, let me pick",
        "description": "Make several variations with the open workflow and let the user pick one.",
        "arguments": [{"name": "what", "description": "What to vary (seed, LoRA weight, prompt…)", "required": True},
                      {"name": "count", "description": "How many (default 3)", "required": False}],
        "text": ("Make {count} variations of the open ComfyUI workflow, changing: {what}.\n"
                 "Call begin_task first. Read the canvas (describe_canvas), change one thing per run, run the workflow "
                 "each time and find the pictures with search_images. Then show them with show_panel as a picks block, "
                 "each with what you changed as its reason, and wait for my pick with get_answers. Put the chosen "
                 "settings back on the canvas and report(done=true)."),
    },
    "fix_missing_models": {
        "title": "Fix the missing models",
        "description": "Find what the open workflow lacks and put it back, asking before downloads.",
        "arguments": [],
        "text": ("Check the open workflow's models with check_workflow_models (call begin_task first). Put back the ones "
                 "Anomalous found with certainty (fix_workflow_models). Show what is still missing with show_panel as a "
                 "table, and ask me with choices before downloading anything. report(done=true) when finished."),
    },
    "explain_canvas": {
        "title": "Explain the open workflow",
        "description": "A picture of the open workflow's main chain with a short explanation.",
        "arguments": [],
        "text": ("Explain the workflow open in ComfyUI. Call begin_task, read it with describe_canvas, then show_panel "
                 "with a diagram block of its main chain (loaders, prompts, sampler, decoding, saving; node_id on each "
                 "box) and a few lines of text on what each part does and which settings matter most. Change nothing."),
    },
}


def list_prompts():
    return {"prompts": [{"name": name, "title": item["title"], "description": item["description"], "arguments": item["arguments"]}
                        for name, item in PROMPTS.items()]}


def get_prompt(name, arguments=None):
    """prompts/get, or None for an unknown name or a missing required argument."""
    item = PROMPTS.get(name)
    arguments = arguments if isinstance(arguments, dict) else {}
    if not item or any(arg["required"] and not str(arguments.get(arg["name"], "")).strip() for arg in item["arguments"]):
        return None
    values = {"what": "", "count": "3", **{key: str(value) for key, value in arguments.items()}}
    return {"description": item["description"],
            "messages": [{"role": "user", "content": {"type": "text", "text": item["text"].format(**values)}}]}
