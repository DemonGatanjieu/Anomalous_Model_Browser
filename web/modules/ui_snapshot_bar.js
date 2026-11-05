/**
 * The saves bar: whole workflows kept while the user works on one. The saves live in
 * api/workflow_saves.py, a group for each canvas: the workflow carries the group's key in its extra, so
 * they follow it through a rename, a reload and a picture dragged back. The right-click entry of a node
 * or the empty canvas, or the bar's +, keeps the canvas as it is now; a bar under the canvas shows the
 * open tab's saves and goes with the tab. It holds what is used while working on the canvas: the newest
 * saves' numbers go back to those states and Run runs them all (snapshot_run.js); folded it is a handle on
 * the canvas's bottom edge. Their pictures and the rest are in the Workflows page's Saves view
 * (ui_saves_list.js), which comes here to change the canvas.
 */

import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { changeLine } from './activity_log.js';
import { diffSnapshots, snapshotGraph } from './activity_diff.js';
import { recordCanvasStep } from './canvas_history.js';
import { freshId, readDetached } from './detached_graph.js';
import { translate as t } from './locales.js';
import { runCount, runTotal } from './snapshot_plan.js';
import { runSaves, seedMode, setSeedMode, watchRuns, watchSeedMode } from './snapshot_run.js';
import { addSave, findGroup, onSavesChange, readWorkflow, setCount } from './snapshot_store.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const EXTRA_KEY = 'anomalous_saves'; // in a workflow's extra: the group of saves it belongs to
const FOLDED_KEY = 'anomalous_saves_folded';
const TOOLTIP_LINES = 8;
const MARKS_SHOWN = 6; // on the bar, the newest; all of them are on the Saves page

let group = null; // the open tab's saves: {key, title, path, saves: [{id, at, count, changes, pictures, running}]}
let shownTab = ''; // the tab `group` is for
let following = Promise.resolve(); // reading the open tab's saves, one tab after another
let current = null; // the save the canvas stands at, while it is unchanged since
let said = null; // what the bar is saying: {text, bad}
let branched = false; // the tab was just opened from a save: an empty bar to start its own
let folded = readFolded();
let bar = null;
let browser = () => null;

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
 * `parent` comes to show `fresh` on the elements it has. The browser sends no click to an element that left
 * the page during the press, and ComfyUI's graphChanged, an answer to a count or a run ending can all come
 * during one; a box being typed in would lose its digits. A save's part is only kept for that save.
 * Handlers move over to the kept element, so they read `event.target`, not the element made with them.
 */
function settle(parent, fresh) {
    const there = [...parent.children];
    fresh.forEach((node, at) => {
        const old = there[at];
        if (!old) return void parent.append(node);
        if (old.tagName !== node.tagName || old.dataset.save !== node.dataset.save) return void old.replaceWith(node);
        for (const { name, value } of node.attributes) old.setAttribute(name, value);
        old.onclick = node.onclick;
        old.onchange = node.onchange;
        if (node.tagName === 'INPUT') {
            if (old !== document.activeElement) old.value = node.value;
        } else if (!node.children.length) old.textContent = node.textContent;
        settle(old, [...node.children]);
    });
    for (const extra of there.slice(fresh.length)) extra.remove();
}

/**
 * Writes `key` on the open workflow without it counting as a change: the tab's undo states take it too,
 * so nothing asks to be saved and Ctrl+Z does not lose it. It reaches the file when the user next saves;
 * ComfyUI's draft of the tab, what a reload brings back, is written on the event sent here.
 */
function tagCanvas(key) {
    canvasGraph().extra[EXTRA_KEY] = key;
    const tracker = activeTab()?.changeTracker;
    for (const state of [tracker?.activeState, tracker?.initialState, ...tracker?.undoQueue || [], ...tracker?.redoQueue || []]) {
        if (state) state.extra = { ...state.extra, [EXTRA_KEY]: key };
    }
    api.dispatchCustomEvent('graphChanged', tracker?.activeState);
}

function showGroup(found) {
    if (found?.key !== group?.key) current = null;
    group = found;
    draw(false);
}

/** The key of the open tab's saves, if it has any. */
export const shownKey = () => group?.key || '';

async function readTab() {
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
    if (found && found.key !== key) {
        tagCanvas(found.key);
        shownTab = `${tab.path}\n${found.key}`;
    }
    showGroup(found);
}

/** The bar for the tab now open; a tab with no saves has none. */
function followTab() {
    following = following.then(readTab);
    return following;
}

/** Keeps the canvas as it is now as its next save; the canvas stays as it is. */
export async function addMark() {
    try {
        if (!canvasKey()) tagCanvas(freshId());
        const key = canvasKey();
        const tab = activeTab();
        const kept = copied(canvasGraph().serialize());
        kept.extra = { ...kept.extra, [EXTRA_KEY]: key };
        const last = group?.key === key ? group.saves[group.saves.length - 1] : null;
        const changes = last ? diffSnapshots(readDetached(await readWorkflow(key, last.id), snapshotGraph), readDetached(kept, snapshotGraph)) : [];
        const stands = await addSave({ key, workflow: kept, title: String(tab?.filename || ''), path: tabPath(tab), changes });
        shownTab = `${tab?.path}\n${key}`;
        branched = false;
        current = stands.saves[stands.saves.length - 1].id;
        draw();
        showWorkbenchToast(t('snapshotMarked', { number: stands.saves.length }));
    } catch (error) {
        console.warn('[AMB] Saves:', error);
        showWorkbenchToast(t('snapshotSaveFailed', { why: String(error?.message || error).slice(0, 200) }));
    }
}

/** The open tab with `item`'s group of saves on it, or null. */
export function tabOfGroup(item) {
    const tabs = app.extensionManager?.workflow?.openWorkflows || [];
    return tabs.find(tab => tab.activeState?.extra?.[EXTRA_KEY] === item.key || (item.path && tab.path === item.path)) || null;
}

/** `tab` to the front, laid on the canvas, as a click on it does. */
async function front(tab) {
    const store = app.extensionManager.workflow;
    if (store.activeWorkflow === tab) return;
    const tabButton = document.querySelectorAll('.workflow-tabs > button')[store.openWorkflows.indexOf(tab)];
    if (!tabButton) throw new Error(t('snapshotNoTab'));
    await new Promise((resolve) => {
        const stop = store.$onAction(({ name, after }) => {
            if (name !== 'openWorkflow') return;
            after(() => {
                stop();
                resolve();
            });
        });
        tabButton.click();
    });
    await followTab();
}

/**
 * The canvas back at `save`, on the same tab, by ComfyUI's own undo step: what the canvas was goes on the
 * undo list, so Ctrl+Z comes back to it, and the tab still compares with its file. loadGraphData alone
 * would take the save for the tab's starting state and keep no step.
 */
async function goBack(key, save) {
    const workflow = copied(await readWorkflow(key, save.id));
    const tracker = activeTab().changeTracker;
    recordCanvasStep(app);
    await tracker.updateState([workflow], tracker.undoQueue);
    tracker.redoQueue.length = 0;
    current = save.id;
    draw();
}

/** `save` of `item`'s group back on its canvas, that tab to the front first. */
export async function backTo(item, save) {
    await front(tabOfGroup(item));
    await goBack(item.key, save);
}

/**
 * `save` of `item`'s group on a tab of its own, as ComfyUI opens a workflow. With the group's canvas open
 * that is a branch, with saves of its own from here on; with its canvas gone the group goes on there.
 */
export async function openSave(item, save) {
    const workflow = copied(await readWorkflow(item.key, save.id));
    const branch = Boolean(tabOfGroup(item));
    if (branch) delete workflow.extra?.[EXTRA_KEY];
    await app.loadGraphData({ ...workflow, id: freshId() });
    await followTab();
    branched = branch;
    draw();
}

const runsLeft = saves => saves.reduce((sum, save) => sum + save.running, 0);

/** The line over the bar: what was said, else how many runs are left, else nothing. */
function showStatus() {
    const line = bar?.querySelector('.anomalous-snapshot-status');
    if (!line) return;
    const left = runsLeft(group?.saves || []);
    line.textContent = said?.text || (left ? t('savesRunsLeft', { count: left }) : '');
    line.classList.toggle('is-bad', Boolean(said?.bad));
}

function status(text = '', bad = false) {
    said = text ? { text, bad } : null;
    showStatus();
}

async function run() {
    if (await runSaves(group, group.saves, seedMode(), status)) status();
}

/** What `save` changes from the one before. */
export function saveWords(save, at) {
    if (at === 0) return t('snapshotFirst');
    const lines = save.changes.slice(0, TOOLTIP_LINES).map(changeLine);
    return lines.length ? lines.join('\n') : t('snapshotKind_same');
}

/** The box for how many runs `save` of group `key` gets. */
export function runsBox(key, save) {
    const count = el('input', 'anomalous-snapshot-count');
    count.type = 'number';
    count.min = 1;
    count.value = save.count;
    count.title = t('snapshotCount');
    count.setAttribute('aria-label', t('snapshotCount'));
    count.onchange = event => void setCount(key, save.id, runCount(event.target.value)).catch(error => console.warn('[AMB] Saves:', error));
    return count;
}

/** Random or locked seeds, for a whole group's runs. */
export function seedSwitch() {
    const seeds = el('div', 'anomalous-snapshot-modes');
    seeds.setAttribute('role', 'radiogroup');
    seeds.setAttribute('aria-label', t('snapshotSeeds'));
    for (const value of ['random', 'locked']) {
        const option = button(`anomalous-snapshot-mode${seedMode() === value ? ' is-on' : ''}`, t(`snapshotMode_${value}`), () => setSeedMode(value), t(`snapshotModeHint_${value}`));
        option.setAttribute('role', 'radio');
        option.setAttribute('aria-checked', String(seedMode() === value));
        seeds.append(option);
    }
    return seeds;
}

function chip(save, at) {
    const box = el('span', `anomalous-snapshot-mark${save.id === current ? ' is-current' : ''}`);
    box.dataset.save = save.id;
    box.append(button('anomalous-snapshot-number', String(at + 1), () => void goBack(group.key, save), `${t('snapshotBack')}\n${saveWords(save, at)}`), el('span', 'anomalous-snapshot-times', '×'), runsBox(group.key, save));
    return box;
}

function lookButton(saves) {
    const pictures = saves.reduce((sum, save) => sum + save.pictures.length, 0);
    const label = `${t('snapshotLook')} ${pictures || ''}${runsLeft(saves) ? '…' : ''}`.trim();
    return button('anomalous-snapshot-look', label, () => browser()?.showSaves(group.key), t('snapshotLookHint'));
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
    }
    // Inside the canvas's panel: it centers on the canvas and leaves the panel under it, the logs, uncovered.
    const home = document.querySelector('.graph-canvas-panel') || document.body;
    if (bar.parentElement !== home) home.append(bar);
    if (clear) said = null;
    bar.classList.toggle('is-folded', folded);
    if (folded) {
        const label = `${t('snapshotFolded', { count: saves.length })}${runsLeft(saves) ? '…' : ''} ⌃`;
        return void settle(bar, [button('anomalous-snapshot-unfold', label, () => fold(false), t('snapshotUnfold'))]);
    }
    const row = el('div', 'anomalous-snapshot-row');
    const list = el('div', 'anomalous-snapshot-marks');
    const older = Math.max(0, saves.length - MARKS_SHOWN);
    if (older) list.append(button('anomalous-snapshot-older', t('snapshotOlder', { count: older }), () => browser()?.showSaves(group.key), t('snapshotOlderHint')));
    list.append(...saves.slice(older).map((save, at) => chip(save, older + at)), button('anomalous-snapshot-add', '+', () => void addMark(), t('snapshotAdd')));
    row.append(el('span', 'anomalous-snapshot-title', t('snapshotTitle')), list);
    if (saves.length) row.append(seedSwitch(), lookButton(saves), button('anomalous-snapshot-run', t('snapshotRun', { count: runTotal(saves) }), () => void run(), t('snapshotRunHint')));
    row.append(button('anomalous-snapshot-close', '⌄', () => fold(true), t('snapshotFold')));
    settle(bar, [row, el('div', 'anomalous-snapshot-status')]);
    showStatus();
}

/** Starts following the open tab and this page's runs; `getBrowser` gives AMB's window. */
export function watchSaves(getBrowser) {
    browser = getBrowser;
    app.extensionManager?.workflow?.$onAction?.(({ name, after }) => {
        if (name === 'openWorkflow') after(() => void followTab());
    });
    onSavesChange((key, found) => {
        if (key === group?.key || key === canvasKey()) showGroup(found);
    });
    // Any change, an undo too, leaves the save the canvas stood at. goBack and addMark say so after theirs.
    api.addEventListener('graphChanged', () => {
        if (!current) return;
        current = null;
        draw(false);
    });
    watchSeedMode(() => draw(false));
    watchRuns();
    void followTab();
}
