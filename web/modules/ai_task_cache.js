/**
 * The AI workbench's tasks as last read from the server (ui_ai_workbench.js), so picking one is
 * quick: a task read before shows at once from here while the page reads it again, and the pointer
 * resting on a task in the list reads that task ahead. One read per task at a time; the latest few
 * tasks are kept, along with missing activity-log entry lookups for task steps.
 */

import { fetchActivity } from './activity_log.js';
import { activityIds } from './ai_task_view.js';

const KEEP = 8;
const AHEAD_MS = 90; // the pointer passing over the list reads nothing

const kept = new Map(); // task id -> its record as last read, the latest last
const reading = new Map(); // task id -> the read on its way
const unknownEntries = new Set(); // activity ids the log no longer has: not asked for again
let aheadTimer = null;
let cacheGeneration = 0;

/** Changing rehearsal contexts discards old reads, including those still on their way. */
export function clearTaskCache() {
    cacheGeneration++;
    kept.clear();
    reading.clear();
    unknownEntries.clear();
    clearTimeout(aheadTimer);
    aheadTimer = null;
}

function keep(id, task) {
    kept.delete(id);
    if (!task) return;
    kept.set(id, task);
    while (kept.size > KEEP) kept.delete(kept.keys().next().value);
}

/** Task list from the server (`limit` newest summaries). */
export async function fetchTasks(limit = 100) {
    const response = await fetch(`/anomalous/ai_tasks?limit=${limit}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.tasks || [];
}

/** Sends a JSON POST to task `id` (or `id/action`) and returns the parsed payload. */
export async function postTask(id, body, action = '') {
    const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(id)}${action ? `/${action}` : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
}

/** Task `id` from the server (null when there is none); kept for keptTask. */
export function readTask(id) {
    if (reading.has(id)) return reading.get(id);
    const read = fetch(`/anomalous/ai_tasks/${encodeURIComponent(id)}`)
        .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then((data) => {
            if (reading.get(id) === read) keep(id, data.task || null);
            return data.task || null;
        })
        .finally(() => { if (reading.get(id) === read) reading.delete(id); });
    reading.set(id, read);
    return read;
}

/** Task `id` as last read, or null. */
export const keptTask = id => kept.get(id) || null;

/** The pointer rests on task `id` in the list: read it ahead (once it has stayed a moment). */
export function readAhead(id) {
    clearTimeout(aheadTimer);
    aheadTimer = setTimeout(() => { if (!reading.has(id)) readTask(id).catch(() => {}); }, AHEAD_MS);
}

export function stopReadAhead() {
    clearTimeout(aheadTimer);
}

/** A task removed: not shown again from here. */
export function forgetTask(id) {
    kept.delete(id);
}

/** The activity entries of `task`'s canvas steps already held in `knownEntries`. */
export function keptEntries(task, knownEntries) {
    const wanted = new Set(activityIds(task));
    return new Map([...(knownEntries || [])].filter(([id]) => wanted.has(id)));
}

/** Those and the missing ones from the activity log; null when none was missing. */
export async function missingEntries(task, knownEntries) {
    const map = keptEntries(task, knownEntries);
    const missing = activityIds(task).filter(id => !map.has(id) && !unknownEntries.has(id));
    if (!missing.length) return null;
    const generation = cacheGeneration;
    const entries = await fetchActivity({ limit: 500 });
    if (cacheGeneration !== generation) return null;
    for (const entry of entries) if (missing.includes(entry.id)) map.set(entry.id, entry);
    for (const id of missing) if (!map.has(id)) unknownEntries.add(id);
    return map;
}
