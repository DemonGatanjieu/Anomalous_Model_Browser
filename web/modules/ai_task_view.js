/**
 * The AI workbench's rules without DOM (ui_ai_workbench.js draws them): which steps fold
 * together, what each tool is called, what a task counts, and where a result leads. A task
 * and its steps are api/ai_tasks.py's shapes.
 */

/** The kinds of step, in the order a task's counts name them. */
export const KINDS = ['panel', 'user', 'canvas', 'run', 'speech', 'download', 'scan', 'show', 'note', 'act', 'look'];

/**
 * The timeline: each step, but completed reads that follow each other fold into one row (`looks`),
 * so looking around does not push the work out of sight. A running or failed read stays a row of its own.
 */
export function groupSteps(steps) {
    const items = [];
    for (const step of steps || []) {
        const last = items.at(-1);
        if (step.kind === 'look' && step.ok && step.state !== 'running') {
            if (last?.type === 'looks') last.steps.push(step);
            else items.push({ type: 'looks', steps: [step] });
        } else {
            items.push({ type: 'step', step });
        }
    }
    return items;
}

/** The locale key naming a step's tool. */
export function toolKey(tool) {
    return `aiTool_${String(tool || '').replace(/[^a-z_]/g, '')}`;
}

/** What a step was about: its summary without the tool's name ("place_combo: K" → "K"). */
export function stepDetail(step) {
    const summary = String(step?.summary || '');
    const tool = String(step?.tool || '');
    return summary.startsWith(`${tool}: `) ? summary.slice(tool.length + 2) : (summary === tool ? '' : summary);
}

/** The different tools of folded reads, in the order first used, with how often. */
export function lookTools(steps) {
    const counts = new Map();
    for (const step of steps) counts.set(step.tool, (counts.get(step.tool) || 0) + 1);
    return [...counts].map(([tool, count]) => ({ tool, count }));
}

/**
 * 'waiting' for a task the user started that no AI took yet, 'asks' while a question of the
 * AI's waits for the user, 'live' while the AI works (or a run
 * it started goes on), 'error' when a step failed, else 'done'.
 */
export function taskState(summary) {
    if (summary?.waiting) return 'waiting';
    if (summary?.asks) return 'asks';
    if (summary?.live) return 'live';
    return summary?.errors ? 'error' : 'done';
}

/** A task's counts for its row: changes, pictures, sounds… as `[{ key, values }]` (only those it has). */
export function taskCounts(summary) {
    const kinds = summary?.kinds || {};
    const counts = [
        ['aiCountAsks', summary?.asks], ['aiCountCanvas', kinds.canvas], ['aiCountImages', summary?.images], ['aiCountSpeech', kinds.speech],
        ['aiCountDownload', kinds.download], ['aiCountScan', kinds.scan], ['aiCountErrors', summary?.errors],
    ];
    return counts.filter(([, count]) => count > 0).map(([key, count]) => ({ key, values: { count } }));
}

/** Everything a task made, by kind of result, for its header. */
export function taskResults(task) {
    const out = { image: [], model: [], combo: [], audio: [], canvas: [] };
    for (const step of task?.steps || []) {
        for (const result of step.results || []) if (out[result.type]) out[result.type].push(result);
    }
    return out;
}

/** The address ComfyUI's /view serves an output picture or sound at. */
export function outputUrl(result) {
    const params = new URLSearchParams({ filename: result.filename, subfolder: result.subfolder || '', type: result.folder || 'output' });
    return `/view?${params}`;
}

/** An audio result's file ("audio/Aris/a.flac") as an output-folder result. */
export function audioResult(result) {
    const path = String(result.file || '').replace(/\\/g, '/');
    const at = path.lastIndexOf('/');
    return { filename: path.slice(at + 1), subfolder: at > 0 ? path.slice(0, at) : '', folder: 'output' };
}

export function isVideo(result) {
    return /\.(mp4|webm)$/i.test(String(result?.filename || ''));
}

/** Only output pictures can enter the gallery's parameter and keep workflows. */
export function outputPicture(result) {
    if (!result?.filename || isVideo(result) || (result.folder && result.folder !== 'output')) return null;
    if (!/\.(png|jpe?g|webp|gif)$/i.test(result.filename)) return null;
    return { type: 'output', filename: result.filename, subfolder: result.subfolder || '' };
}

export const pictureKey = image => JSON.stringify([image.folder || 'output', image.subfolder || '', image.filename]);

/** One file may be mentioned by both a run and a report; keep its first position. */
export function uniquePictures(images) {
    const seen = new Set();
    return (images || []).filter(image => {
        if (!image?.filename) return false;
        const key = pictureKey(image);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Thumbnails for output pictures; other media retain their actual ComfyUI address. */
export function picturePreview(result) {
    const source = outputPicture(result);
    return source ? `/anomalous/output_thumbnail?${new URLSearchParams({ filename: source.filename, subfolder: source.subfolder })}` : outputUrl(result);
}

/** How long a step took, as `{ key, values }`, or null for quick ones. */
export function duration(ms) {
    if (!(ms >= 1000)) return null;
    const seconds = Math.round(ms / 1000);
    return seconds < 60 ? { key: 'aiSeconds', values: { count: seconds } } : { key: 'aiMinutes', values: { count: Math.round(seconds / 60) } };
}
