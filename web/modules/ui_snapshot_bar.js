/**
 * The saves bar: whole workflows kept while the user works on one, run in order with Anomalous in charge
 * of the seeds (snapshot_plan.js). The saves live in api/workflow_saves.py, a group for each canvas: the
 * workflow carries the group's key in its extra, so they follow it through a rename, a reload and a
 * picture dragged back. The right-click entry of a node or the empty canvas, or the bar's +, keeps the
 * canvas as it is now; a bar under the canvas shows the open tab's saves and goes with the tab. A save's
 * number goes back to that state, its pictures button opens what it made and what can be done with it,
 * and Run checks every save with ComfyUI first, so a broken one stops the queue before it starts. Saves
 * run on a detached copy (detached_graph.js): seeds are written to the copy's widgets and it is compiled
 * on its own, so the canvas, its tabs and the seeds on it stay as they are while the user works on.
 */

import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { changeLine, postCanvasActivity } from './activity_log.js';
import { diffSnapshots, snapshotGraph } from './activity_diff.js';
import { recordCanvasStep } from './canvas_history.js';
import { freshId, readDetached } from './detached_graph.js';
import { translate as t } from './locales.js';
import { MAX_RUNS, applySeeds, baseSeed, changeKind, compiled, runCount, runTotal, seedWidgets, seedsOf } from './snapshot_plan.js';
import { addSave, findGroup, noteRuns, readWorkflow, removeSave, setCount } from './snapshot_store.js';
import { anomalousConfirm } from './ui_dialog.js';
import { showGalleryViewer } from './ui_gallery_viewer.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const EXTRA_KEY = 'anomalous_saves'; // in a workflow's extra: the group of saves it belongs to
const FOLDED_KEY = 'anomalous_saves_folded';
const TOOLTIP_LINES = 8;
const PICTURES_SHOWN = 40;

let group = null; // the open tab's saves: {key, title, path, saves: [{id, at, count, changes, pictures, running}]}
const workflows = new Map(); // save id -> its whole workflow, read when needed
const ours = new Set(); // prompt ids of runs from this page, whose pictures are looked for when they end
let shownTab = ''; // the tab `group` is for
let mode = 'random';
let current = null; // the save the canvas was last sent back to
let opened = null; // the save whose pictures and actions are open
let branched = false; // the tab was just opened from a save: an empty bar to start its own
let folded = readFolded();
let bar = null;
let busy = false;

const canvasGraph = () => app.rootGraph || app.graph;
const activeTab = () => app.extensionManager?.workflow?.activeWorkflow || null;
const canvasKey = () => canvasGraph()?.extra?.[EXTRA_KEY] || '';
const tabPath = tab => (tab?.isPersisted ? tab.path : '');
const copied = value => JSON.parse(JSON.stringify(value));

function readFolded() {
    try {
        return globalThis.localStorage?.getItem(FOLDED_KEY) === '1';
    } catch {
        return false;
    }
}

function fold(value) {
    folded = value;
    try {
        globalThis.localStorage?.setItem(FOLDED_KEY, value ? '1' : '0');
    } catch { /* it folds for this page anyway */ }
    draw();
}

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

/**
 * Writes `key` on the open workflow without it counting as a change: the tab's undo states take it too,
 * so nothing asks to be saved and Ctrl+Z does not lose it. It reaches the file when the user next saves.
 */
function tagCanvas(key) {
    canvasGraph().extra[EXTRA_KEY] = key;
    const tracker = activeTab()?.changeTracker;
    for (const state of [tracker?.activeState, tracker?.initialState, ...tracker?.undoQueue || [], ...tracker?.redoQueue || []]) {
        if (state) state.extra = { ...state.extra, [EXTRA_KEY]: key };
    }
}

function showGroup(found) {
    if (found?.key !== group?.key) {
        workflows.clear();
        current = null;
        opened = null;
    }
    group = found;
    draw(false);
}

/** The bar for the tab now open; a tab with no saves has none. */
async function followTab() {
    const tab = activeTab();
    if (!tab) return;
    const key = canvasKey();
    const path = tabPath(tab);
    const seen = `${tab.path}\n${key}`;
    if (seen === shownTab) return;
    shownTab = seen;
    branched = false;
    let found = null;
    try {
        found = key || path ? await findGroup(key, path) : null;
    } catch (error) {
        console.warn('[AMB] Saves: could not read this tab\'s.', error);
    }
    if (seen !== shownTab) return;
    if (found && found.key !== key) {
        tagCanvas(found.key);
        shownTab = `${tab.path}\n${found.key}`;
    }
    showGroup(found);
}

async function workflowOf(key, save) {
    if (!workflows.has(save.id)) workflows.set(save.id, await readWorkflow(key, save.id));
    return workflows.get(save.id);
}

/** Keeps the canvas as it is now. */
export async function addMark() {
    try {
        if (!canvasKey()) tagCanvas(freshId());
        const key = canvasKey();
        const tab = activeTab();
        const graph = canvasGraph();
        const last = group?.key === key ? group.saves[group.saves.length - 1] : null;
        const changes = last ? diffSnapshots(readDetached(await workflowOf(key, last), snapshotGraph), snapshotGraph(graph)) : [];
        const kept = await addSave({ key, workflow: copied(graph.serialize()), title: String(tab?.filename || ''), path: tabPath(tab), changes });
        shownTab = `${tab?.path}\n${key}`;
        branched = false;
        showGroup(kept);
        current = kept.saves[kept.saves.length - 1].id;
        draw();
        showWorkbenchToast(t('snapshotMarked', { number: kept.saves.length }));
    } catch (error) {
        console.warn('[AMB] Saves:', error);
        showWorkbenchToast(t('snapshotSaveFailed', { why: String(error?.message || error).slice(0, 200) }));
    }
}

/**
 * The canvas back at `save`, on the same tab, by ComfyUI's own undo step: what the canvas was goes on the
 * undo list, so Ctrl+Z comes back to it, and the tab still compares with its file. loadGraphData alone
 * would take the save for the tab's starting state and keep no step.
 */
async function goBack(save) {
    const workflow = copied(await workflowOf(group.key, save));
    const tracker = activeTab().changeTracker;
    recordCanvasStep(app);
    await tracker.updateState([workflow], tracker.undoQueue);
    tracker.redoQueue.length = 0;
    current = save.id;
    draw();
}

/** `save` on a tab of its own, as ComfyUI opens a workflow: a branch, with saves of its own from here on. */
async function openOnNewTab(save) {
    const workflow = copied(await workflowOf(group.key, save));
    delete workflow.extra?.[EXTRA_KEY];
    await app.loadGraphData({ ...workflow, id: freshId() });
    await followTab();
    branched = true;
    draw();
}

async function remove(save, at) {
    if (!await anomalousConfirm(t('snapshotRemoveConfirm', { number: at + 1 }), t('snapshotTitle'))) return;
    try {
        const left = await removeSave(group.key, save.id);
        workflows.delete(save.id);
        if (opened === save.id) opened = null;
        if (current === save.id) current = null;
        showGroup(left);
    } catch (error) {
        status(String(error?.message || error).slice(0, 300), true);
    }
}

function status(text = '', bad = false) {
    const line = bar?.querySelector('.anomalous-snapshot-status');
    if (!line) return;
    line.textContent = text;
    line.classList.toggle('is-bad', bad);
}

/** Why the saves cannot run, each saying its save: ComfyUI's own check, and a save asked for several runs with no seed to vary. */
async function problems(key, saves) {
    const found = [];
    for (const [at, save] of saves.entries()) {
        await readDetached(await workflowOf(key, save), async (graph) => {
            if (save.count > 1 && !seedWidgets(graph).length) found.push(t('snapshotProblem', { number: at + 1, line: t('snapshotNoSeed') }));
            const { output } = await compiled(app, graph);
            const response = await fetch('/anomalous/snapshot_check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: output }) });
            const data = await response.json();
            for (const line of data.problems || []) found.push(t('snapshotProblem', { number: at + 1, line }));
        });
    }
    return found;
}

/** Every run of every save into ComfyUI's queue, in order. How many went in. */
async function submit(key, saves) {
    const base = baseSeed();
    const total = runTotal(saves);
    let done = 0;
    for (const save of saves) {
        const prompts = [];
        await readDetached(await workflowOf(key, save), async (graph) => {
            for (const seed of seedsOf(save, mode, base)) {
                applySeeds(graph, seed);
                const answer = await api.queuePrompt(0, await compiled(app, graph));
                prompts.push(answer.prompt_id);
                ours.add(answer.prompt_id);
                status(t('snapshotQueueing', { done: ++done, total }));
            }
        });
        const noted = await noteRuns(key, save.id, prompts);
        if (group?.key === key) group = noted;
    }
    return done;
}

async function run() {
    if (busy || !group?.saves.length) return;
    const { key } = group;
    const saves = [...group.saves];
    if (runTotal(saves) > MAX_RUNS) return void status(t('snapshotTooMany', { most: MAX_RUNS }), true);
    busy = true;
    draw();
    try {
        status(t('snapshotChecking'));
        const found = await problems(key, saves);
        if (found.length) return void status(found.slice(0, 4).join('\n'), true);
        const queued = await submit(key, saves);
        status(t('snapshotQueued', { count: queued }));
        await postCanvasActivity({ changes: [{ kind: 'changed', node: t('snapshotTitle'), widget: t(`snapshotMode_${mode}`), before: '',
            after: t('snapshotLogged', { marks: saves.length, count: queued }) }], total: 1, workflow: '' }).catch(() => {});
    } catch (error) {
        console.warn('[AMB] Saves:', error);
        status(t('snapshotRefused', { why: String(error?.message || error).slice(0, 200) }), true);
    } finally {
        busy = false;
        draw(false);
    }
}

/** One of this page's runs ended: its pictures are in ComfyUI's history now. */
async function runEnded(promptId) {
    if (!ours.delete(promptId) || !group) return;
    const { key } = group;
    const found = await findGroup(key, '').catch(() => null);
    if (found && group?.key === key) showGroup(found);
}

/** What `save` changes from the one before, for its tooltip. */
function saveWords(save, at) {
    if (at === 0) return t('snapshotFirst');
    const lines = save.changes.slice(0, TOOLTIP_LINES).map(changeLine);
    return lines.length ? lines.join('\n') : t('snapshotKind_same');
}

function chip(save, at) {
    const box = el('span', `anomalous-snapshot-mark${save.id === current ? ' is-current' : ''}`);
    const number = button('anomalous-snapshot-number', String(at + 1), () => void goBack(save), `${t('snapshotBack')}\n${saveWords(save, at)}`);
    const count = el('input', 'anomalous-snapshot-count');
    count.type = 'number';
    count.min = 1;
    count.value = save.count;
    count.title = t('snapshotCount');
    count.setAttribute('aria-label', t('snapshotCount'));
    count.onchange = () => {
        save.count = runCount(count.value);
        setCount(group.key, save.id, save.count).catch(error => console.warn('[AMB] Saves:', error));
        draw();
    };
    const made = `${save.pictures.length || ''}${save.running ? '…' : ''}`;
    const more = button(`anomalous-snapshot-more${opened === save.id ? ' is-on' : ''}`, `${made} ▴`.trim(), () => {
        opened = opened === save.id ? null : save.id;
        draw();
    }, t('snapshotDetails'));
    box.append(number, count, more);
    return box;
}

function picture(item) {
    const query = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder, type: item.type });
    const thumb = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder });
    const box = button('anomalous-snapshot-picture', undefined, () => showGalleryViewer(`/view?${query}`));
    const image = el('img');
    image.alt = '';
    image.loading = 'lazy';
    image.src = item.type === 'output' ? `/anomalous/output_thumbnail?${thumb}` : `/view?${query}&preview=webp;60`;
    box.append(image);
    return box;
}

/** What `save` made and what can be done with it, above the bar. */
function details(save, at) {
    const box = el('div', 'anomalous-snapshot-details');
    const when = new Date(save.at * 1000).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const kind = at === 0 ? '' : ` · ${t(`snapshotKind_${changeKind(save.changes)}`)}`;
    box.append(el('div', 'anomalous-snapshot-head', `${t('snapshotNumber', { number: at + 1 })} · ${when}${kind}`));
    if (at > 0 && save.changes.length) box.append(el('div', 'anomalous-snapshot-lines', saveWords(save, at)));
    const newest = [...save.pictures].reverse().slice(0, PICTURES_SHOWN);
    if (newest.length) {
        const list = el('div', 'anomalous-snapshot-pictures');
        list.append(...newest.map(picture));
        box.append(list);
    } else {
        box.append(el('div', 'anomalous-snapshot-lines', t(save.running ? 'snapshotRunning' : 'snapshotNoPictures')));
    }
    if (save.pictures.length > newest.length) box.append(el('div', 'anomalous-snapshot-lines', t('snapshotMorePictures', { shown: newest.length, total: save.pictures.length })));
    const actions = el('div', 'anomalous-snapshot-actions');
    actions.append(
        button('anomalous-snapshot-action', t('snapshotGoBack'), () => void goBack(save)),
        button('anomalous-snapshot-action', t('snapshotOpenTab'), () => void openOnNewTab(save)),
        button('anomalous-snapshot-action is-danger', t('snapshotRemove'), () => void remove(save, at)),
    );
    box.append(actions);
    return box;
}

/** The bar as the saves stand; `clear`: the status line goes too. A tab with no saves has none. */
function draw(clear = true) {
    const saves = group?.saves || [];
    if (!saves.length && !branched) {
        bar?.remove();
        bar = null;
        return;
    }
    if (!bar) {
        bar = el('div', 'anomalous-snapshot-bar');
        bar.id = 'anomalous-snapshot-bar';
        bar.setAttribute('role', 'region');
        bar.setAttribute('aria-label', t('snapshotTitle'));
        document.body.append(bar);
    }
    if (folded) return void bar.replaceChildren(button('anomalous-snapshot-unfold', t('snapshotFolded', { count: saves.length }), () => fold(false)));
    const kept = bar.querySelector('.anomalous-snapshot-status');
    const line = el('div', 'anomalous-snapshot-status');
    if (kept && !clear) {
        line.textContent = kept.textContent;
        line.className = kept.className;
    }
    const row = el('div', 'anomalous-snapshot-row');
    const list = el('div', 'anomalous-snapshot-marks');
    list.append(...saves.map(chip), button('anomalous-snapshot-add', '+', () => void addMark(), t('snapshotAdd')));
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
    const go = button('anomalous-snapshot-run', t('snapshotRun', { count: runTotal(saves) }), () => void run());
    go.disabled = busy || !saves.length;
    row.append(el('span', 'anomalous-snapshot-title', t('snapshotTitle')), list, seeds, go, button('anomalous-snapshot-close', '⌄', () => fold(true), t('snapshotFold')));
    const at = saves.findIndex(save => save.id === opened);
    bar.replaceChildren(...at < 0 ? [] : [details(saves[at], at)], row, line);
}

/** Starts following the open tab and this page's runs. */
export function watchSaves() {
    app.extensionManager?.workflow?.$onAction?.(({ name, after }) => {
        if (name === 'openWorkflow') after(() => void followTab());
    });
    for (const event of ['execution_success', 'execution_error', 'execution_interrupted']) {
        api.addEventListener(event, ({ detail }) => void runEnded(detail?.prompt_id));
    }
    void followTab();
}
