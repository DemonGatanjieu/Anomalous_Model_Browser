/**
 * The page side of the MCP canvas actions (api/mcp_bridge.py). The server sends
 * {id, action, args} as the "anomalous.mcp" event; one open page claims it (a hidden tab
 * waits a moment so a visible one goes first), does it with Anomalous's own canvas code and
 * posts the outcome back. Every change is one Ctrl+Z step, lands in the activity log marked
 * as the AI's (with its undo), and shows a toast. Errors are written for the AI to read.
 */

import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { translate as t } from './locales.js';
import { diffSnapshots, snapshotGraph } from './activity_diff.js';
import { postCanvasActivity } from './activity_log.js';
import { keepUndo, workflowKey } from './canvas_undo.js';
import { recordCanvasStep } from './canvas_history.js';
import { spliceAfterOutputs } from './graph_splice.js';
import { checkWorkflowModels, fixWorkflowModels, isProblem } from './model_check.js';
import { promptBoxes } from './prompt_boxes.js';
import { findModelComboWidget, getNativeWidgetValues, setWidgetValue } from './ui_node_model_picker.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { openListedModel } from './ui_scan_lists.js';

const HIDDEN_PAGE_DELAY_MS = 1500;
const MAX_NODES = 150;
const MAX_VALUE = 400;
const MAX_LOGGED = 60;
const MAIN_LOADER = /checkpointloader|unetloader|unetloadergguf|diffusionmodelloader/i;
const outputType = (node, type) => (node?.outputs || []).some(output => String(output.type).toUpperCase() === type);

const graph = () => app.canvas?.graph || app.graph || null;
const workflowName = () => {
    const workflow = app.extensionManager?.workflow?.activeWorkflow;
    return String(workflow?.filename || workflow?.path || '');
};
const short = (text) => (String(text).length > MAX_VALUE ? `${String(text).slice(0, MAX_VALUE)}…` : String(text));
const samePath = (a, b) => String(a).replace(/\\/g, '/') === String(b).replace(/\\/g, '/');

function currentGraph() {
    const g = graph();
    if (!g) throw new Error('No workflow is open in ComfyUI.');
    return g;
}

function nodeById(id) {
    const node = currentGraph().getNodeById?.(Number(id)) ?? currentGraph().getNodeById?.(id);
    if (!node) throw new Error(`There is no node ${id} on the canvas; describe_canvas lists them.`);
    return node;
}

/** The drop-down value of `node`'s model widget naming `path` (relative to its models folder). */
function modelChoice(node, widget, path) {
    return getNativeWidgetValues(node, widget).find(value => samePath(value, path)) || null;
}

/** Sets a widget the way the user would, so ComfyUI and other extensions notice. */
function writeWidget(node, widget, value) {
    const old = widget.value;
    app.graph?.beforeChange?.(node);
    setWidgetValue(node, widget, value);
    widget.callback?.(value, app.canvas, node, app.canvas?.graph_mouse, null);
    node.onWidgetChanged?.(widget.name, value, old, widget); // clears ComfyUI's missing-model mark
    app.graph?.afterChange?.(node);
    if (app.lastNodeErrors?.[node.id]) delete app.lastNodeErrors[node.id];
    app.graph?.setDirtyCanvas?.(true, true);
    recordCanvasStep(app);
    return old;
}

/** Runs a canvas change and logs what it changed as the AI's, with its undo. */
async function recorded(getOwner, toastKey, change) {
    getOwner()?.flushCanvasActivity?.(); // what was pending before is the user's own
    const g = currentGraph();
    const before = snapshotGraph(g);
    const workflow = workflowKey(app);
    const value = await change(g);
    const after = snapshotGraph(g);
    const changes = diffSnapshots(before, after);
    if (changes.length) {
        postCanvasActivity({ changes: changes.slice(0, MAX_LOGGED), total: changes.length, workflow: workflowName(), via: 'mcp' })
            .then((data) => {
                keepUndo(data?.entry?.id, workflow, before, after);
                getOwner()?.onActivityRecorded?.();
            })
            .catch(error => console.warn('[AMB] Activity log: the AI change was not recorded.', error));
    }
    showWorkbenchToast(t(toastKey, value?.toast || {}));
    delete value?.toast;
    return value;
}

function describeNode(g, node) {
    const settings = {};
    for (const widget of node.widgets || []) {
        const value = widget.value;
        if (!widget.name || widget.type === 'button') continue;
        if (typeof value === 'string') settings[widget.name] = short(value);
        else if (typeof value === 'number' || typeof value === 'boolean') settings[widget.name] = value;
    }
    const inputs = {};
    for (const input of node.inputs || []) {
        if (input.link == null) continue;
        const link = g.getLink?.(input.link) ?? g.links?.[input.link];
        if (link) inputs[input.name] = link.origin_id;
    }
    const boxes = promptBoxes(node);
    return {
        id: node.id,
        type: node.type,
        title: node.title && node.title !== node.type ? node.title : undefined,
        bypassed: node.mode === 4 || undefined,
        muted: node.mode === 2 || undefined,
        settings,
        inputs_from_nodes: Object.keys(inputs).length ? inputs : undefined,
        prompt_boxes: boxes.length ? boxes.map(box => ({ setting: box.name, role: box.role || 'unknown' })) : undefined,
    };
}

function describeCanvas() {
    const g = currentGraph();
    const nodes = g._nodes || [];
    return {
        workflow: workflowName(),
        node_count: nodes.length,
        selected_node_ids: Object.keys(app.canvas?.selected_nodes || {}).map(Number),
        nodes: nodes.slice(0, MAX_NODES).map(node => describeNode(g, node)),
    };
}

function findPromptBox(role, nodeId) {
    if (nodeId != null) {
        const node = nodeById(nodeId);
        const boxes = promptBoxes(node);
        const box = boxes.find(item => item.role === role) || (boxes.length === 1 ? boxes[0] : null);
        if (!box) throw new Error(`Node ${nodeId} (${node.type}) has no ${role} prompt box.`);
        return { node, box };
    }
    const found = (currentGraph()._nodes || []).flatMap(node => promptBoxes(node)
        .filter(box => box.role === role).map(box => ({ node, box })));
    if (!found.length) throw new Error(`No ${role} prompt box is wired on the canvas; give node_id.`);
    if (found.length > 1) throw new Error(`Several ${role} prompt boxes (nodes ${found.map(item => item.node.id).join(', ')}); give node_id.`);
    return found[0];
}

function setPrompt({ text, role, node_id: nodeId, mode }, getOwner) {
    return recorded(getOwner, role === 'negative' ? 'mcpDidNegative' : 'mcpDidPositive', () => {
        const { node, box } = findPromptBox(role, nodeId);
        const old = String(box.widget.value || '');
        const value = mode === 'append' && old.trim() ? `${old.replace(/[\s,]+$/, '')}, ${text}` : text;
        writeWidget(node, box.widget, value);
        return { node_id: node.id, role: box.role || role, before: short(old), after: short(value) };
    });
}

function setModel({ node_id: nodeId, model }, getOwner) {
    return recorded(getOwner, 'mcpDidModel', () => {
        const node = nodeById(nodeId);
        const widget = findModelComboWidget(node);
        if (!widget) throw new Error(`Node ${nodeId} (${node.type}) has no model drop-down.`);
        const value = modelChoice(node, widget, model.path);
        if (!value) throw new Error(`${node.type} cannot load ${model.path} (a ${model.type} model), or ComfyUI has not listed it yet.`);
        const old = writeWidget(node, widget, value);
        delete node.color;
        delete node.bgcolor;
        return { node_id: node.id, before: old, after: value, toast: { name: value.split(/[\\/]/).pop() } };
    });
}

/** Follows `type` from `node` through the LoRA loaders chained after it: the last of them. */
function chainEnd(g, node, type) {
    let end = node;
    for (let hop = 0; hop < 20; hop++) {
        const output = (end.outputs || []).find(item => String(item.type).toUpperCase() === type);
        const targets = (output?.links || []).map(id => g.getLink?.(id) ?? g.links?.[id]).filter(Boolean)
            .map(link => g.getNodeById(link.target_id));
        if (targets.length !== 1 || !/lora/i.test(targets[0]?.type || '')) break;
        end = targets[0];
    }
    return end;
}

/** The workflow's one main model loader, past the LoRAs already chained to it. */
function defaultModelEnd(g) {
    const loaders = (g._nodes || []).filter(node => MAIN_LOADER.test(node.type) && node.mode !== 4);
    if (loaders.length !== 1) throw new Error(loaders.length ? 'Several model loaders; give after_node_id.' : 'No model loader on the canvas; give after_node_id.');
    return chainEnd(g, loaders[0], 'MODEL');
}

/** Where the text encoder comes from when the model node has none (a UNet's own CLIP loader): the one source, or null. */
function separateClipEnd(g) {
    const sources = (g._nodes || []).filter(node => node.mode !== 4 && outputType(node, 'CLIP')
        && !(node.inputs || []).some(input => ['CLIP', 'MODEL'].includes(String(input.type).toUpperCase())));
    return sources.length === 1 ? chainEnd(g, sources[0], 'CLIP') : null;
}

/**
 * A LoRA goes after the model line's end (the main loader or the last LoRA on it). Its CLIP
 * line is wired only when the file carries text-encoder weights (`textEncoder`, read from its
 * header by the server): from the same node (a checkpoint, a full LoRA loader) or, for a UNet,
 * from the canvas's one CLIP source. Otherwise a model-only LoRA loader patches just the model.
 * Every node the outputs fed (both prompts on one CLIP) now hangs after the LoRA.
 */
function addLora({ model, text_encoder: textEncoder, after_node_id: afterId, strength_model: strengthModel, strength_clip: strengthClip }, getOwner) {
    return recorded(getOwner, 'mcpDidLora', (g) => {
        const modelEnd = afterId != null ? nodeById(afterId) : defaultModelEnd(g);
        if (!outputType(modelEnd, 'MODEL')) throw new Error(`Node ${modelEnd.id} (${modelEnd.type}) has no MODEL output.`);
        const clipEnd = !textEncoder ? null : outputType(modelEnd, 'CLIP') ? modelEnd : separateClipEnd(g);
        const outputs = [{ node: modelEnd, type: 'MODEL' }, ...(clipEnd ? [{ node: clipEnd, type: 'CLIP' }] : [])];
        const node = LiteGraph.createNode(clipEnd ? 'LoraLoader' : 'LoraLoaderModelOnly');
        const widget = node && findModelComboWidget(node);
        const value = widget && modelChoice(node, widget, model.path);
        if (!value) throw new Error(`ComfyUI does not list ${model.path} as a LoRA yet; refresh ComfyUI's model lists (R).`);
        setWidgetValue(node, widget, value);
        for (const [name, strength] of [['strength_model', strengthModel], ['strength_clip', strengthClip]]) {
            const item = node.widgets?.find(w => w.name === name);
            if (item && Number.isFinite(strength)) setWidgetValue(node, item, strength);
        }
        spliceAfterOutputs({ graph: g, insertedNode: node, outputs });
        recordCanvasStep(app);
        return {
            node_id: node.id, node_type: node.type, lora: value, model_from: modelEnd.id, ...(clipEnd ? { clip_from: clipEnd.id } : {}),
            ...(textEncoder && !clipEnd ? { note: 'The LoRA has text-encoder weights but no single CLIP source was found; only the model is patched.' } : {}),
            toast: { name: value.split(/[\\/]/).pop() },
        };
    });
}

async function placeCombo({ name }, getOwner) {
    const data = await (await fetch('/anomalous/notebooks')).json();
    const combos = data?.notebooks || [];
    const combo = combos.find(item => item.name === name)
        || combos.find(item => String(item.name).toLowerCase() === String(name).toLowerCase());
    if (!combo) throw new Error(`No combo called ${name}; list_combos names them.`);
    if (!combo.data?.mainModel) throw new Error(`The combo ${combo.name} has no main model yet.`);
    const owner = getOwner();
    if (!owner) throw new Error('Anomalous is not ready on this page yet.');
    return recorded(getOwner, 'mcpDidCombo', (g) => {
        const nodes = g._nodes || [];
        const right = nodes.reduce((max, node) => Math.max(max, (node.pos?.[0] || 0) + (node.size?.[0] || 0)), 0);
        const top = nodes.length ? Math.min(...nodes.map(node => node.pos?.[1] || 0)) : 100;
        const count = nodes.length;
        owner.currentNotebook = combo;
        owner.sendNotebookToCanvas([right + 120, top]);
        return { placed: combo.name, new_nodes: (g._nodes || []).length - count, toast: { name: combo.name } };
    });
}

function entryView(entry) {
    return {
        node_id: entry.node.id, node_type: entry.node.type, setting: entry.widget.name, model: entry.value,
        state: entry.state, ...(entry.target ? { can_put_back: entry.target, found_by: entry.via } : {}),
    };
}

const CHECK_MEANING = 'ready: present; changed: present but a different file than when saved; fixable: found for sure (fix_workflow_models puts it back); '
    + 'candidate: a likely file, for the user to confirm in Model Check; ambiguous / conflict / missing: not found.';

async function checkModels() {
    const entries = await checkWorkflowModels({ refresh: false });
    return { models: entries.map(entryView), problems: entries.filter(isProblem).length, meaning: CHECK_MEANING };
}

async function fixModels(_args, getOwner) {
    const entries = await checkWorkflowModels({ refresh: false });
    const fixable = entries.filter(entry => entry.state === 'fixable').map(entryView);
    if (!fixable.length) return { fixed: 0, still_missing: entries.filter(isProblem).map(entryView) };
    return recorded(getOwner, 'mcpDidFix', () => {
        const fixed = fixWorkflowModels(entries);
        return { fixed, put_back: fixable, still_missing: entries.filter(entry => isProblem(entry) && entry.state !== 'fixable').map(entryView), toast: { count: fixed } };
    });
}

async function runWorkflow({ batch }) {
    currentGraph();
    await app.queuePrompt(0, batch || 1);
    showWorkbenchToast(t('mcpDidRun'));
    return { queued: batch || 1, note: 'Results land in the output folder; search_images finds them when done.' };
}

async function openModel({ type, path_idx: pathIdx, rel }, getOwner) {
    const owner = getOwner();
    if (!owner) throw new Error('Anomalous is not ready on this page yet.');
    owner.show();
    await openListedModel(owner, { type, path_idx: pathIdx, rel, filename: rel.split('/').pop() }, () => owner.goTo('models'));
    return { opened: rel };
}

const ACTIONS = {
    describe_canvas: describeCanvas,
    set_prompt: setPrompt,
    set_model: setModel,
    add_lora: addLora,
    place_combo: placeCombo,
    check_models: checkModels,
    fix_models: fixModels,
    run_workflow: runWorkflow,
    open_model: openModel,
};

const post = body => fetch('/anomalous/mcp/bridge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(response => response.json());

async function handle(detail, getOwner) {
    const { id, action, args } = detail || {};
    const run = ACTIONS[action];
    if (typeof id !== 'string' || !run) return;
    if (document.visibilityState !== 'visible') await new Promise(resolve => setTimeout(resolve, HIDDEN_PAGE_DELAY_MS));
    const claim = await post({ id, claim: true }).catch(() => null);
    if (!claim?.granted) return; // another tab took it
    let outcome;
    try {
        outcome = { ok: true, value: (await run(args || {}, getOwner)) ?? null };
    } catch (error) {
        outcome = { ok: false, error: String(error?.message || error) };
    }
    await post({ id, outcome }).catch(error => console.warn('[AMB] MCP: could not send the result back.', error));
}

/** Listens for MCP canvas actions; `getOwner()` gives the browser (created on demand). */
export function watchMcpActions(getOwner) {
    api.addEventListener('anomalous.mcp', event => void handle(event.detail, getOwner));
}
