/**
 * The snapshot queue: save points of a whole workflow, run in order with Anomalous in charge of the
 * seeds (snapshot_plan.js). A node's right-click "Mark this state" keeps the canvas as it is now
 * (app.graph.serialize) and opens a bar under the canvas, where the user goes on changing anything:
 * a mark's number goes back to that state, each has its runs, and Run checks every mark with ComfyUI
 * first, so a broken one stops the queue before it starts. Marks run on a detached copy
 * (detached_graph.js): seeds are written to the copy's widgets and app.graphToPrompt compiles it, so the
 * canvas, its tabs and the seeds on it stay as they are while the user works on. Marks last for this
 * page; a state worth keeping is saved as a workflow card from the canvas.
 */

import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { changeLine, postCanvasActivity } from './activity_log.js';
import { diffSnapshots, snapshotGraph } from './activity_diff.js';
import { readDetached } from './detached_graph.js';
import { translate as t } from './locales.js';
import { MAX_RUNS, applySeeds, baseSeed, runCount, runTotal, seedWidgets, seedsOf } from './snapshot_plan.js';
import { anomalousConfirm } from './ui_dialog.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const TOOLTIP_LINES = 8;
const marks = []; // {graph, snapshot, changes, node, count}
let mode = 'random';
let current = null; // the mark the canvas was last sent back to
let bar = null;
let busy = false;

const canvasGraph = () => app.rootGraph || app.graph;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, run, title = '') {
    const node = el('button', className, label);
    node.type = 'button';
    node.title = title;
    node.onclick = run;
    return node;
}

/** What `mark` changes from the one before it, for its tooltip. */
function markWords(mark, at) {
    if (at === 0) return t('snapshotFirst', { node: mark.node });
    const lines = mark.changes.slice(0, TOOLTIP_LINES).map(changeLine);
    return lines.length ? lines.join('\n') : t('snapshotSame');
}

/** Keeps the canvas as it is now; `node` names where the user marked it. */
export function addMark(node) {
    const graph = canvasGraph();
    const snapshot = snapshotGraph(graph);
    const before = marks[marks.length - 1];
    marks.push({ graph: JSON.parse(JSON.stringify(graph.serialize())), snapshot, changes: before ? diffSnapshots(before.snapshot, snapshot) : [],
        node: node?.title || node?.type || '', count: 1 });
    current = marks[marks.length - 1];
    draw();
    showWorkbenchToast(t('snapshotMarked', { number: marks.length }));
}

/** The canvas back at `mark`, on the same tab: one more change of that workflow, as Ctrl+Z makes. */
async function goBack(mark) {
    const workflow = app.extensionManager?.workflow?.activeWorkflow;
    await app.loadGraphData(JSON.parse(JSON.stringify(mark.graph)), false, false, workflow, { showMissingNodesDialog: false, showMissingModelsDialog: false });
    workflow?.changeTracker?.checkState?.();
    current = mark;
    draw();
}

function status(text = '', bad = false) {
    const line = bar?.querySelector('.anomalous-snapshot-status');
    if (!line) return;
    line.textContent = text;
    line.classList.toggle('is-bad', bad);
}

/** Why the marks cannot run, each saying its mark: ComfyUI's own check, and a mark asked for several runs with no seed to vary. */
async function problems() {
    const found = [];
    for (const [at, mark] of marks.entries()) {
        await readDetached(mark.graph, async (graph) => {
            if (mark.count > 1 && !seedWidgets(graph).length) found.push(t('snapshotProblem', { number: at + 1, line: t('snapshotNoSeed') }));
            const { output } = await app.graphToPrompt(graph);
            const response = await fetch('/anomalous/snapshot_check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: output }) });
            const data = await response.json();
            for (const line of data.problems || []) found.push(t('snapshotProblem', { number: at + 1, line }));
        });
    }
    return found;
}

/** Every run of every mark into ComfyUI's queue, in order. How many went in. */
async function submit() {
    const base = baseSeed();
    let queued = 0;
    for (const mark of marks) {
        await readDetached(mark.graph, async (graph) => {
            for (const seed of seedsOf(mark, mode, base)) {
                applySeeds(graph, seed);
                await api.queuePrompt(0, await app.graphToPrompt(graph));
                status(t('snapshotQueueing', { done: ++queued, total: runTotal(marks) }));
            }
        });
    }
    return queued;
}

async function run() {
    const total = runTotal(marks);
    if (busy || !total) return;
    if (total > MAX_RUNS) return void status(t('snapshotTooMany', { most: MAX_RUNS }), true);
    busy = true;
    draw();
    try {
        status(t('snapshotChecking'));
        const found = await problems();
        if (found.length) return void status(found.slice(0, 4).join('\n'), true);
        const queued = await submit();
        status(t('snapshotQueued', { count: queued }));
        await postCanvasActivity({ changes: [{ kind: 'changed', node: t('snapshotTitle'), widget: t(`snapshotMode_${mode}`), before: '',
            after: t('snapshotLogged', { marks: marks.length, count: queued }) }], total: 1, workflow: '' }).catch(() => {});
    } catch (error) {
        console.warn('[AMB] Snapshot queue:', error);
        status(t('snapshotRefused', { why: String(error?.message || error).slice(0, 200) }), true);
    } finally {
        busy = false;
        draw(false);
    }
}

async function close() {
    if (marks.length && !await anomalousConfirm(t('snapshotCloseConfirm', { count: marks.length }), t('snapshotTitle'))) return;
    marks.length = 0;
    current = null;
    bar?.remove();
    bar = null;
}

function chip(mark, at) {
    const box = el('span', `anomalous-snapshot-mark${mark === current ? ' is-current' : ''}`);
    const number = button('anomalous-snapshot-number', String(at + 1), () => void goBack(mark), `${t('snapshotBack')}\n${markWords(mark, at)}`);
    const count = el('input', 'anomalous-snapshot-count');
    count.type = 'number';
    count.min = 1;
    count.value = mark.count;
    count.title = t('snapshotCount');
    count.setAttribute('aria-label', t('snapshotCount'));
    count.onchange = () => {
        mark.count = runCount(count.value);
        draw();
    };
    const remove = button('anomalous-snapshot-remove', '×', () => {
        marks.splice(at, 1);
        if (current === mark) current = null;
        draw();
    }, t('snapshotRemove'));
    box.append(number, count, remove);
    return box;
}

/** The bar as the marks stand; `clear`: the status line goes too. */
function draw(clear = true) {
    if (!bar) {
        bar = el('div', 'anomalous-snapshot-bar');
        bar.id = 'anomalous-snapshot-bar';
        bar.setAttribute('role', 'region');
        bar.setAttribute('aria-label', t('snapshotTitle'));
        document.body.append(bar);
    }
    const kept = bar.querySelector('.anomalous-snapshot-status');
    const line = el('div', 'anomalous-snapshot-status');
    if (kept && !clear) {
        line.textContent = kept.textContent;
        line.className = kept.className;
    }
    const row = el('div', 'anomalous-snapshot-row');
    const list = el('div', 'anomalous-snapshot-marks');
    list.append(...marks.map(chip));
    const seeds = el('div', 'anomalous-snapshot-modes');
    seeds.setAttribute('role', 'radiogroup');
    seeds.setAttribute('aria-label', t('snapshotSeeds'));
    for (const value of ['random', 'locked']) {
        const option = button(`anomalous-snapshot-mode${mode === value ? ' is-on' : ''}`, t(`snapshotMode_${value}`), () => {
            mode = value;
            draw();
        }, t(`snapshotModeHint_${value}`));
        option.setAttribute('role', 'radio');
        option.setAttribute('aria-checked', String(mode === value));
        seeds.append(option);
    }
    const go = button('anomalous-snapshot-run', t('snapshotRun', { count: runTotal(marks) }), () => void run());
    go.disabled = busy || !marks.length;
    row.append(el('span', 'anomalous-snapshot-title', t('snapshotTitle')), list, seeds, go, button('anomalous-snapshot-close', '×', () => void close(), t('snapshotClose')));
    bar.replaceChildren(row, line);
}
