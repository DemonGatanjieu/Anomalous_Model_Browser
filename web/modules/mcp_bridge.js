/**
 * The page side of the MCP canvas actions (api/mcp_bridge.py). The server sends
 * {id, action, args} as the "anomalous.mcp" event; one open page claims it (a hidden tab
 * waits a moment so a visible one goes first), does it with Anomalous's own canvas code and
 * posts the outcome back. Every change is one Ctrl+Z step, lands in the activity log marked
 * as the AI's (with its undo), and shows a toast. Errors are written for the AI to read. A
 * canvas action happens on the task's own tab when the task has one (mcp_task_tab.js).
 */

import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { queueTracked } from './mcp_run.js';
import { baseOnly, onKeptBase } from './base_only.js';
import { translate as t } from './locales.js';
import { diffSnapshots, snapshotGraph } from './activity_diff.js';
import { postCanvasActivity } from './activity_log.js';
import { keepUndo, workflowKey } from './canvas_undo.js';
import { canvasBrief, line as briefLine } from './mcp_canvas_brief.js';
import { canvasEditActions } from './mcp_canvas_edit.js';
import { findRoles } from './canvas_roles.js';
import { onTaskTab } from './mcp_task_tab.js';
import { recordCanvasStep } from './canvas_history.js';
import { chainEnd, loraChain, mainModelLoaders, modelLineStart, planLoraInsertion, spliceLora } from './graph_splice.js';
import { checkWorkflowModels, fixWorkflowModels, isProblem } from './model_check.js';
import { downloadFrom, downloadMissing } from './model_download.js';
import { promptBoxes } from './prompt_boxes.js';
import { findModelComboWidget, getNativeWidgetValues, setWidgetValue } from './ui_node_model_picker.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { openListedModel } from './ui_scan_lists.js';
import { freshId } from './detached_graph.js';
import { startFromAi } from './job_sheet_run.js';
import { NO_PROMPT_WORDS, aiWords, canvasPrompts, firstTime, languageProblem, noPrompt } from './prompt_language.js';
import { llliteProblem, llliteWords, usesLllite } from './lllite_fit.js';

const HIDDEN_PAGE_DELAY_MS = 1500;
const MAX_NODES = 150;
// What an AI on an empty canvas needs instead of "add a SaveImage" (api/mcp_situation.py says the same).
const EMPTY_CANVAS = 'The canvas is empty. run_workflow(workflow=<name>) opens a saved workflow and runs it in one call; '
    + "open_workflow opens one to change first, or a gallery picture's own by its file name (to change that picture); "
    + 'list_workflows names them and the examples.';
// UTF-8 bytes, as api/mcp_fit.py: past about 4,000 an AI app files the answer away and the AI reads nothing.
const CANVAS_BUDGET = 3800;
const MAX_VALUE = 400;
const MAX_LOGGED = 60;

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
        // Waited for, so the AI workbench's step knows its log entry (and with it the undo).
        try {
            const data = await postCanvasActivity({ changes: changes.slice(0, MAX_LOGGED), total: changes.length, workflow: workflowName(), via: 'mcp' });
            keepUndo(data?.entry?.id, workflow, before, after);
            if (data?.entry?.id && value && typeof value === 'object') value._activity = data.entry.id;
            getOwner()?.onActivityRecorded?.();
        } catch (error) {
            console.warn('[AMB] Activity log: the AI change was not recorded.', error);
        }
    }
    showWorkbenchToast(t(toastKey, value?.toast || {}));
    delete value?.toast;
    return value;
}

function describeNode(g, node) {
    const settings = {};
    for (const widget of node.widgets || []) {
        const value = widget.value;
        if (!widget.name || widget.type === 'button' || widget.name.startsWith('$$')) continue; // "$$…": the page's own, not settings
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

/** The files ComfyUI's page marks missing (its missingMedia store; none on a frontend without one). */
function missingMedia() {
    const store = document.querySelector('#vue-app')?.__vue_app__?.config?.globalProperties?.$pinia?._s?.get('missingMedia');
    return (store?.missingMediaCandidates || []).filter(item => item?.isMissing !== false);
}

/** The open workflow's nodes with their settings; `brief`: a line a node and what is unwired (get_situation). */
function describeCanvas({ brief } = {}) {
    const g = currentGraph();
    if (brief) return { workflow: workflowName(), ...canvasBrief(g, app.lastNodeErrors, missingMedia()) };
    const nodes = g._nodes || [];
    return fitCanvas(g, {
        workflow: workflowName(),
        node_count: nodes.length,
        ...(nodes.length ? {} : { note: EMPTY_CANVAS }),
        selected_node_ids: Object.keys(app.canvas?.selected_nodes || {}).map(Number),
        nodes: nodes.slice(0, MAX_NODES).map(node => describeNode(g, node)),
    });
}

/**
 * `answer` within CANVAS_BUDGET, losing as little as it can, a step at a time until it fits: the
 * titles (mostly the page's own name of each node); then nodes without settings as a line each
 * (id, type, what feeds each input: nothing lost); then from the end a line each with its settings
 * after "||"; last, from the end, lines without their settings.
 */
function fitCanvas(g, answer) {
    const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
    if (bytes(answer) <= CANVAS_BUDGET) return answer;
    const order = new Map(answer.nodes.map((item, at) => [item.id, at]));
    const settingsOf = item => Object.entries(item.settings || {})
        .map(([key, value]) => `${key}=${typeof value === 'string' ? JSON.stringify(value) : value}`).join(' ');
    const full = answer.nodes.map(({ title, ...item }) => item);
    const lines = []; // [item, with its settings]
    let bare = 0;
    const fitted = () => {
        if (!lines.length) return { ...answer, nodes: full };
        const sorted = [...lines].sort((a, b) => order.get(a[0].id) - order.get(b[0].id));
        const in_brief = sorted.map(([item, keep]) => {
            const live = g.getNodeById?.(item.id);
            const head = live ? briefLine(g, live).replace(/^(#\S+ \S+) "[^"]*"/, '$1') : `#${item.id} ${item.type}`; // no title here either
            const settings = keep ? settingsOf(item) : '';
            return settings ? `${head} || ${settings}` : head;
        });
        const note = `Too big to read whole in one answer: ${lines.length} nodes are in in_brief, a line each (id, type, what feeds `
            + 'each input, then its settings after "||")'
            + (bare ? `; ${bare} of them without their settings: find_nodes(types=[their type]) lists a type's settings` : '')
            + '. set_values and connect_nodes take their ids.';
        return { ...answer, nodes: full, in_brief, note };
    };
    const fits = () => bytes(fitted()) <= CANVAS_BUDGET;
    for (let at = full.length - 1; at >= 0 && !fits(); at--) {
        if (!Object.keys(full[at].settings || {}).length) lines.push([full.splice(at, 1)[0], false]);
    }
    while (!fits() && full.length) lines.push([full.pop(), true]);
    const kept = [...lines].sort((a, b) => order.get(b[0].id) - order.get(a[0].id)).filter(line => line[1]);
    for (const line of kept) {
        if (fits()) break;
        line[1] = false;
        bare += 1;
    }
    return fitted();
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

/** The MODEL line through `node` by its drop-down values: its loader's and its LoRAs', for the server's base-model check (model_advice.py). */
function modelLine(g, node) {
    const start = modelLineStart(g, node);
    const value = item => findModelComboWidget(item)?.value || '';
    return { model: value(start), loras: loraChain(g, start, 'MODEL').map(value).filter(Boolean) };
}

function setModel({ node_id: nodeId, model }, getOwner) {
    return recorded(getOwner, 'mcpDidModel', (g) => {
        const node = nodeById(nodeId);
        const widget = findModelComboWidget(node);
        if (!widget) throw new Error(`Node ${nodeId} (${node.type}) has no model drop-down.`);
        const value = modelChoice(node, widget, model.path);
        if (!value) throw new Error(`${node.type} cannot load ${model.path} (a ${model.type} model), or ComfyUI has not listed it yet.`);
        const old = writeWidget(node, widget, value);
        delete node.color;
        delete node.bgcolor;
        return { node_id: node.id, before: old, after: value, line: modelLine(g, node), toast: { name: value.split(/[\\/]/).pop() } };
    });
}

/** The workflow's one main model loader, past the LoRAs already chained to it. */
function defaultModelEnd(g) {
    const loaders = mainModelLoaders(g);
    if (loaders.length !== 1) throw new Error(loaders.length ? 'Several model loaders; give after_node_id.' : 'No model loader on the canvas; give after_node_id.');
    return chainEnd(g, loaders[0], 'MODEL');
}

/**
 * A LoRA goes after the model line's end (the main loader or the last LoRA on it), as
 * graph_splice.js planLoraInsertion places it: the CLIP line goes through it only when the
 * file has text-encoder weights (`textEncoder`, read from its header by the server).
 */
function addLora({ model, text_encoder: textEncoder, after_node_id: afterId, strength_model: strengthModel, strength_clip: strengthClip }, getOwner) {
    return recorded(getOwner, 'mcpDidLora', (g) => {
        const modelEnd = afterId != null ? nodeById(afterId) : defaultModelEnd(g);
        const plan = planLoraInsertion(g, modelEnd, 'after', { textEncoder });
        if (!plan.supported) throw new Error(`Node ${modelEnd.id} (${modelEnd.type}) has no MODEL output.`);
        const clipEnd = plan.outputs.find(output => output.type === 'CLIP')?.node || null;
        const node = LiteGraph.createNode(plan.clip ? 'LoraLoader' : 'LoraLoaderModelOnly');
        const widget = node && findModelComboWidget(node);
        const value = widget && modelChoice(node, widget, model.path);
        if (!value) throw new Error(`ComfyUI does not list ${model.path} as a LoRA yet; refresh ComfyUI's model lists (R).`);
        setWidgetValue(node, widget, value);
        for (const [name, strength] of [['strength_model', strengthModel], ['strength_clip', strengthClip]]) {
            const item = node.widgets?.find(w => w.name === name);
            if (item && Number.isFinite(strength)) setWidgetValue(node, item, strength);
        }
        spliceLora({ graph: g, plan, anchorNode: modelEnd, insertedNode: node });
        recordCanvasStep(app);
        return {
            node_id: node.id, node_type: node.type, lora: value, model_from: modelEnd.id, ...(clipEnd ? { clip_from: clipEnd.id } : {}),
            line: modelLine(g, node),
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
    if (!combo.data?.mainModel && combo.data?.kind !== 'nodes') throw new Error(`The combo ${combo.name} has no main model yet.`);
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

/** Downloads run on the server; each finished file is put into its nodes like a press in Model Check. */
async function downloadMissingModels({ names }, getOwner) {
    currentGraph();
    const result = await downloadMissing(getOwner(), names);
    return { ...result, note: 'Downloads run one at a time in the background; run_status(downloads=true) follows them. Each finished file '
        + 'is checked against its fingerprint and put into the nodes that use it.' };
}

async function downloadModel(args, getOwner) {
    return { ...await downloadFrom(getOwner(), args), note: 'run_status(downloads=true) follows it.' };
}

/**
 * run_workflow: refused once when the prompt is empty on a canvas that draws from nothing, or in a language the
 * canvas's model cannot read (prompt_language.js),
 * and whenever an Anima LLLite on the canvas does not fit the model it is put on (lllite_fit.js).
 * `base_only` queues the first pass alone as previews (base_only.js), checked before anything is
 * queued; `hold` is the base the user picked (api/ai_bases.py): its seed goes on its sampler, held "fixed"
 * and kept under every try, unless that sampler is not on this canvas; where the rest takes the base's
 * picture, it takes the kept picture instead and the base is not drawn again (`held.kept`).
 */
async function runWorkflow({ batch, base_only: firstPass, hold }, getOwner) {
    const g = currentGraph();
    if (!(g._nodes || []).length) throw new Error(`Nothing was run. ${EMPTY_CANVAS}`);
    const texts = canvasPrompts(g);
    if (noPrompt(g, texts)) throw new Error(NO_PROMPT_WORDS);
    const odd = firstTime(await languageProblem(g, texts), texts, 'ai'); // refused once: called again unchanged, it runs
    if (odd) throw new Error(aiWords(odd));
    const unfit = usesLllite(g) ? await llliteProblem((await app.graphToPrompt()).output) : null;
    if (unfit) throw new Error(llliteWords(unfit));
    const held = hold ? await holdBase(g, hold, getOwner) : null;
    const base = firstPass ? baseOnly((await app.graphToPrompt()).output) : null;
    if (held?.held && hold.kept_input) held.kept = Boolean(onKeptBase((await app.graphToPrompt()).output, hold.kept_input));
    const cut = base ? output => baseOnly(output).output : held?.kept ? output => onKeptBase(output, hold.kept_input) || output : null;
    const result = await queueTracked(app, api, batch || 1, { cut, keep: held?.held ? [String(hold.node)] : [] });
    if (result.queued) showWorkbenchToast(t('mcpDidRun'));
    return { ...result, ...(base ? { base: { bases: base.bases, shows: base.shows, saved: base.saved, prefix: base.prefix } } : {}), ...(held ? { held } : {}) };
}

async function holdBase(g, { node: id, type, names, seed }, getOwner) {
    const node = (g._nodes || []).find(item => String(item.id) === String(id));
    if (!node || node.type !== type) return { held: false, reason: `the sampler #${id} the bases came from is not on this canvas` };
    const has = name => (node.widgets || []).some(widget => widget?.name === name);
    const settings = Object.fromEntries((names || []).filter(has).map(name => [name, seed]));
    if (has('control_after_generate')) settings.control_after_generate = 'fixed';
    await ACTIONS.fill_slots({ values: { [String(id)]: settings } }, getOwner);
    return { held: true };
}

async function openModel({ type, path_idx: pathIdx, rel }, getOwner) {
    const owner = getOwner();
    if (!owner) throw new Error('Anomalous is not ready on this page yet.');
    owner.show();
    await openListedModel(owner, { type, path_idx: pathIdx, rel, filename: rel.split('/').pop() }, () => owner.goTo('models'));
    return { opened: rel };
}

/** The model line of the sampler a block goes with (canvas_roles.js): the server picks a ControlNet that fits it. */
function blockModel({ near_node_id: nearId }) {
    const g = currentGraph();
    return modelLine(g, findRoles(g, nearId).sampler);
}

const ACTIONS = {
    describe_canvas: describeCanvas,
    job_sheet: startFromAi,
    block_model: blockModel,
    set_prompt: setPrompt,
    set_model: setModel,
    add_lora: addLora,
    place_combo: placeCombo,
    check_models: checkModels,
    fix_models: fixModels,
    download_missing: downloadMissingModels,
    download_model: downloadModel,
    run_workflow: runWorkflow,
    open_model: openModel,
    ...canvasEditActions({ recorded, nodeById }),
};

/** This page's id in its claims, kept over a reload of the tab: the server gives an action to the page that did the last (api/mcp_bridge.py). */
function pageId() {
    try {
        const kept = sessionStorage.getItem('anomalous.mcpPage');
        if (kept) return kept;
        const made = freshId();
        sessionStorage.setItem('anomalous.mcpPage', made);
        return made;
    } catch {
        return freshId();
    }
}
export const PAGE = pageId();

const post = body => fetch('/anomalous/mcp/bridge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(response => response.json());

async function handle(detail, getOwner) {
    const { id, action, args } = detail || {};
    const run = ACTIONS[action];
    if (typeof id !== 'string' || !run) return;
    if (document.visibilityState !== 'visible') await new Promise(resolve => setTimeout(resolve, HIDDEN_PAGE_DELAY_MS));
    const ask = () => post({ id, claim: true, capabilities: ['prompt_ids'], page: PAGE }).catch(() => null);
    let claim = await ask();
    if (claim?.retry_ms) { // another tab did the last action: it goes first, this one only when that tab is gone
        await new Promise(resolve => setTimeout(resolve, claim.retry_ms));
        claim = await ask();
    }
    if (!claim?.granted) return; // another tab took it
    const { _task_canvas: taskCanvas, ...given } = args || {};
    let outcome;
    let tab = null; // a tab made or opened for the task is kept even when the action then fails
    getOwner()?.flushCanvasActivity?.(); // the user's own changes so far, before the task's tab may come to the front
    try {
        outcome = { ok: true, value: (await onTaskTab(action, taskCanvas, () => run(given, getOwner), (made) => { tab = made; })) ?? null };
    } catch (error) {
        outcome = { ok: false, error: String(error?.message || error) };
    }
    if (tab) outcome.tab = tab;
    await post({ id, outcome }).catch(error => console.warn('[AMB] MCP: could not send the result back.', error));
}

/** Listens for MCP canvas actions; `getOwner()` gives the browser (created on demand). */
export function watchMcpActions(getOwner) {
    api.addEventListener('anomalous.mcp', event => void handle(event.detail, getOwner));
}
