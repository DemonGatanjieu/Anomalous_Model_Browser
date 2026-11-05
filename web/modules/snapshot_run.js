/**
 * Running saves, from the bar under the canvas or the Saves view. Every save is first checked with
 * ComfyUI, so a broken one stops the queue before it starts; then each runs on a detached copy
 * (detached_graph.js): seeds are written to the copy's widgets and it is compiled on its own, so a
 * canvas, open or not, and the seeds on it stay as they are. What is clicked goes in in the order of
 * the clicks, and ComfyUI's queue keeps that order. No DOM.
 */

import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { postCanvasActivity } from './activity_log.js';
import { readDetached } from './detached_graph.js';
import { translate as t } from './locales.js';
import { MAX_RUNS, applySeeds, baseSeed, compiled, jobLine, runTotal, seedWidgets, seedsOf } from './snapshot_plan.js';
import { countsAnswered, findGroup, noteRuns, readWorkflow, refreshGroup } from './snapshot_store.js';

let mode = 'random';
const inLine = jobLine(); // what was clicked, going in one after another
const going = new Set(); // keys of the groups with runs from this page on ComfyUI's queue
const modeWatchers = new Set();

export const seedMode = () => mode;

export function setSeedMode(value) {
    mode = value;
    for (const watcher of modeWatchers) watcher();
}

export const watchSeedMode = watcher => modeWatchers.add(watcher);

/** Why `saves` cannot run, each saying its save: ComfyUI's own check, and a save asked for several runs with no seed to vary. */
async function problems(group, saves) {
    const found = [];
    for (const save of saves) {
        const number = group.saves.indexOf(save) + 1;
        await readDetached(await readWorkflow(group.key, save.id), async (graph) => {
            if (save.count > 1 && !seedWidgets(graph).length) found.push(t('snapshotProblem', { number, line: t('snapshotNoSeed') }));
            const { output } = await compiled(app, graph);
            const response = await fetch('/anomalous/snapshot_check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: output }) });
            const data = await response.json();
            for (const problem of data.problems || []) found.push(t('snapshotProblem', { number, line: problem }));
        });
    }
    return found;
}

/** Every run of `saves` into ComfyUI's queue, in order. How many went in. */
async function submit(key, saves, seeds, say) {
    const base = baseSeed();
    const total = runTotal(saves);
    let done = 0;
    for (const save of saves) {
        const prompts = [];
        await readDetached(await readWorkflow(key, save.id), async (graph) => {
            for (const seed of seedsOf(save, seeds, base)) {
                applySeeds(graph, seed);
                const answer = await api.queuePrompt(0, await compiled(app, graph));
                prompts.push(answer.prompt_id);
                say(t('snapshotQueueing', { done: ++done, total }));
            }
        });
        await noteRuns(key, save.id, prompts);
        going.add(key); // only now: until its runs are noted the group looks done
    }
    return done;
}

async function queue(key, ids, seeds, say) {
    try {
        say(t('snapshotChecking'));
        await countsAnswered();
        const group = await findGroup(key, '');
        const saves = group.saves.filter(save => ids.includes(save.id));
        if (runTotal(saves) > MAX_RUNS) {
            say(t('snapshotTooMany', { most: MAX_RUNS }), true);
            return 0;
        }
        const found = await problems(group, saves);
        if (found.length) {
            say(found.slice(0, 4).join('\n'), true);
            return 0;
        }
        const queued = await submit(key, saves, seeds, say);
        await refreshGroup(key); // a quick run may have ended before it was noted
        await postCanvasActivity({ changes: [{ kind: 'changed', node: t('snapshotTitle'), widget: t(`snapshotMode_${seeds}`), before: '',
            after: t('snapshotLogged', { marks: saves.length, count: queued }) }], total: 1, workflow: '' }).catch(() => {});
        return queued;
    } catch (error) {
        console.warn('[AMB] Saves:', error);
        say(t('snapshotRefused', { why: String(error?.message || error).slice(0, 200) }), true);
        return 0;
    }
}

/**
 * Queues `saves` of `group` after whatever was clicked before them, `seeds` 'random' or 'locked'. They
 * go as they stand at their turn: the click can come before the answer to a count typed just before it.
 * `say(text, bad)` tells how it goes. How many runs went in; none when refused, or already waiting.
 */
export function runSaves(group, saves, seeds, say) {
    const ids = saves.map(save => save.id);
    return inLine(ids.join(), () => queue(group.key, ids, seeds, say));
}

/** ComfyUI says its queue changed: a run has left it for the history, where its pictures are. */
async function queueChanged() {
    for (const key of going) {
        const found = await refreshGroup(key).catch(() => null);
        if (!found?.saves.some(save => save.running)) going.delete(key);
    }
}

/** Starts following this page's runs. */
export function watchRuns() {
    api.addEventListener('status', () => void queueChanged());
}
