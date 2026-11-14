/**
 * Runs presets of a saved workflow with no AI ("Run my preset" with nothing to change,
 * ui_ai_preset_sheet.js). The saved workflow opens in a new tab, or the chosen open canvas is copied into
 * one, so the user's own tab stays as it is; each pick is put on as the preset's Apply button does
 * (recipe_actions.js) and queued so many times, one after another: ComfyUI keeps a prompt as it was
 * queued, so one tab does for all of them. A canvas run with no preset is queued where it stands. The tab
 * the user was on comes back to the front. When the last prompt has ended and nobody changed, saved or is
 * looking at the tab made here, it closes (mcp_task_tab.js closeCopy); the pictures are in the gallery.
 */

import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { recordCanvasStep } from './canvas_history.js';
import { freshId } from './detached_graph.js';
import { translate as t } from './locales.js';
import { tabName } from './mcp_canvas_edit.js';
import { queueTracked } from './mcp_run.js';
import { closeCopy, frame, showTab } from './mcp_task_tab.js';
import { OWN, shapeOf, total, valuesOf } from './preset_run_list.js';
import { applyRecipeParametersToCanvas, assertRecipeSkeleton } from './recipe_actions.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const SETTLE_MS = 4000;
const ENDS = ['execution_success', 'execution_error', 'execution_interrupted'];

const store = () => app.extensionManager?.workflow || null;
const tabOf = path => store()?.openWorkflows?.find(workflow => workflow.path === path) || null;
const front = () => store()?.activeWorkflow?.path || '';
const stateOf = path => (front() === path ? app.graph.serialize() : tabOf(path)?.activeState) || null;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The open canvas tabs, the one in front first: [{path, name, shape, runs}]; `runs`: it has a node that puts something out. */
export function openTabs() {
    const tabs = (store()?.openWorkflows || []).map((workflow) => {
        const nodes = stateOf(workflow.path)?.nodes || [];
        return {
            path: workflow.path, name: String(workflow.filename || workflow.path).replace(/\.json$/i, ''), shape: shapeOf(nodes),
            runs: nodes.some(node => LiteGraph.registered_node_types?.[node.type]?.nodeData?.output_node),
        };
    });
    return tabs.sort((a, b) => (b.path === front()) - (a.path === front()));
}

/** The presets saved under workflow `file`: {preset file: the set, as its Apply button takes it}. */
export async function presetSets(file) {
    const response = await fetch(`/anomalous/parameters?recipe_filename=${encodeURIComponent(file)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    return Object.fromEntries((payload.notebooks || []).map(set => [set.filename, set.data]));
}

/** Whether preset `set` can be put on open tab `path`, by the rule its Apply button goes by. */
export function fitsTab(set, path) {
    try {
        assertRecipeSkeleton(set?.workflow, stateOf(path));
        return true;
    } catch (_) {
        return false;
    }
}

async function savedWorkflow(card) {
    const response = await fetch(`/anomalous/recipe_full?filename=${encodeURIComponent(card.file)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.data?.workflow) throw new Error(t('aiPresetNoWorkflow', { name: card.name }));
    return payload.data.workflow;
}

/** The new tab is the one in front and done loading: ComfyUI lays its workflow on the canvas a moment after it opens. */
async function settled() {
    for (let waited = 0; waited < SETTLE_MS && store()?.activeWorkflow?.isLoading; waited += 50) await wait(50);
    await frame();
}

/** `done()` once every prompt of `ids` has ended, or left ComfyUI's queue another way (the user cleared it). */
function whenEnded(ids, done) {
    const left = new Set(ids);
    let over = false;
    const finish = () => {
        if (over) return;
        over = true;
        ENDS.forEach(name => api.removeEventListener(name, ended));
        api.removeEventListener('status', emptied);
        done();
    };
    const ended = (event) => {
        left.delete(event.detail?.prompt_id);
        if (!left.size) finish();
    };
    const emptied = async (event) => {
        if (event.detail?.exec_info?.queue_remaining !== 0) return;
        const queue = await api.fetchApi('/queue').then(response => response.json(), () => null);
        const waiting = new Set([...(queue?.queue_running || []), ...(queue?.queue_pending || [])].map(item => item[1]));
        if (queue && !ids.some(id => waiting.has(id))) finish();
    };
    ENDS.forEach(name => api.addEventListener(name, ended));
    api.addEventListener('status', emptied);
}

/**
 * The run has ended. Tab `made` (the one made for it, if any) goes when `values` says what it held when
 * queued and nobody changed, saved or is looking at it since.
 */
async function tidy(made, values, name, toGallery) {
    const tab = tabOf(made);
    const untouched = Boolean(values && tab?.activeState && front() !== made && valuesOf(tab.activeState) === values);
    const closed = untouched && await closeCopy(made);
    showWorkbenchToast(t(closed ? 'aiPresetDoneClosed' : tab ? 'aiPresetDoneKept' : 'aiPresetDone', { name }), { label: t('aiPresetSee'), run: toGallery });
}

/**
 * Queues `picks` ([{file, name, times}]; OWN: the settings it opens with) of saved workflow `card` ({file, name})
 * on a new tab, or on a copy of open tab `tab`; picks of OWN alone on `tab` are queued on that tab itself
 * (`card` null). `close`: the tab made here goes when the run has ended; `toGallery()` opens the gallery from
 * the line saying so. Returns {queued, wanted, name, stopped: {name, reason} | null}; a pick ComfyUI refuses
 * stops the rest, and the tab stays in front with ComfyUI's own marks on it.
 */
export async function runPresets({ card, tab = '', picks, close = true, toGallery }) {
    const presets = picks.some(pick => pick.file !== OWN);
    const sets = presets ? await presetSets(card.file) : {};
    const gone = picks.find(pick => pick.file !== OWN && !sets[pick.file]);
    if (gone) throw new Error(t('aiPresetGone', { name: gone.name }));
    const saved = tab ? null : await savedWorkflow(card); // all of it is read before a tab opens
    const back = front();
    if (tab && !await showTab(tab)) throw new Error(t('aiPresetTabGone'));
    const own = tab ? app.graph.serialize() : saved;
    const name = card?.name || tabOf(tab)?.filename || '';
    let made = '';
    if (!tab || presets) {
        // Its own tab: a new id (ComfyUI would show an open tab of the same id instead), and without the marks
        // of the tab or card it comes from: the saved workflow an AI's run would take it for, its group of saves.
        const { anomalous_saved: _saved, anomalous_saves: _saves, ...extra } = own.extra || {};
        await app.loadGraphData({ ...structuredClone(own), id: freshId(), extra }, true, true, tabName(name));
        await settled();
        made = front();
    }
    const result = { queued: 0, wanted: total(picks), name, stopped: null };
    const ids = [];
    let put = false; // a preset lies on the canvas
    for (const pick of picks) {
        try {
            if (pick.file !== OWN) applyRecipeParametersToCanvas(sets[pick.file]);
            else if (put) applyRecipeParametersToCanvas({ workflow: own });
            put = pick.file !== OWN;
            const receipt = await queueTracked(app, api, pick.times);
            ids.push(...receipt.prompt_ids);
            result.queued += receipt.queued;
            if (receipt.submission_error) throw new Error(receipt.submission_error);
        } catch (error) {
            result.stopped = { name: pick.name, reason: error.code === 'recipe_parameter_skeleton_mismatch' ? t('aiPresetNoFit') : error.message };
            break;
        }
    }
    let values = '';
    if (made && !result.stopped) {
        recordCanvasStep(app); // the seeds ComfyUI moved after queueing belong to what the tab held
        if (back && back !== made) await showTab(back);
        const state = front() === made ? null : tabOf(made)?.activeState;
        if (close && state) values = valuesOf(state);
    }
    if (ids.length) whenEnded(ids, () => tidy(made, values, name, toGallery));
    return result;
}
