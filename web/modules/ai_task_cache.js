/**
 * The AI workbench's tasks as last read from the server (ui_ai_workbench.js), so picking one is
 * quick: a task read before shows at once from here while the page reads it again, and the pointer
 * resting on a task in the list reads that task ahead. One read per task at a time; the latest few
 * tasks are kept.
 */

const KEEP = 8;
const AHEAD_MS = 90; // the pointer passing over the list reads nothing

const kept = new Map(); // task id -> its record as last read, the latest last
const reading = new Map(); // task id -> the read on its way
let aheadTimer = null;

function keep(id, task) {
    kept.delete(id);
    if (!task) return;
    kept.set(id, task);
    while (kept.size > KEEP) kept.delete(kept.keys().next().value);
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
            keep(id, data.task || null);
            return data.task || null;
        })
        .finally(() => reading.delete(id));
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
