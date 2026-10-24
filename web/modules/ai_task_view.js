/**
 * The AI workbench's rules without DOM (ui_ai_workbench.js and ui_ai_chain.js draw them): which
 * steps fold together, what each tool is called, what a task counts, and where a result leads. A task
 * and its steps are api/ai_tasks.py's shapes.
 */

/** The kinds of step, in the order a task's counts name them. */
export const KINDS = ['panel', 'user', 'decision', 'canvas', 'run', 'speech', 'download', 'scan', 'show', 'note', 'act', 'outside', 'look'];

const WORK = new Set(['look', 'canvas', 'decision']); // the AI going about the work, not what the user looks for
const CHAIN_MIN = 3;
const settled = step => step.ok && !['running', 'asking', 'allowed'].includes(step.state);

/**
 * The timeline. Reads, canvas changes and decisions that follow each other, finished and fine,
 * fold into one row (`chain`) when there are three or more and two are not reads, so the work does
 * not push what the user looks for (their words, the AI's notes and questions, panels, runs,
 * errors) out of sight; else the reads among them fold alone (`looks`). A running, waiting or
 * failed step stays a row of its own.
 */
export function groupSteps(steps) {
    const items = [];
    let work = [];
    const close = () => {
        if (work.length >= CHAIN_MIN && work.filter(step => step.kind !== 'look').length >= 2) items.push({ type: 'chain', steps: work });
        else items.push(...foldLooks(work));
        work = [];
    };
    for (const step of steps || []) {
        if (WORK.has(step.kind) && settled(step)) {
            work.push(step);
        } else {
            close();
            items.push({ type: 'step', step });
        }
    }
    close();
    return items;
}

/** `steps` with the finished reads that follow each other as one `looks` item (a chain opens to these). */
export function foldLooks(steps) {
    const items = [];
    for (const step of steps) {
        const last = items.at(-1);
        if (step.kind === 'look' && settled(step)) {
            if (last?.type === 'looks') last.steps.push(step);
            else items.push({ type: 'looks', steps: [step] });
        } else {
            items.push({ type: 'step', step });
        }
    }
    return items;
}

/** What a chain did, in the order first done: each tool with its kind and how often, the reads counted together as `look`. */
export function chainTools(steps) {
    const counts = new Map();
    for (const step of steps) {
        const tool = step.kind === 'look' ? 'look' : step.tool;
        const item = counts.get(tool) || { tool, kind: step.kind, count: 0 };
        item.count += 1;
        counts.set(tool, item);
    }
    return [...counts.values()];
}

/**
 * The stages a task's steps went through, in the order they first came, with the last step's
 * state for each: 'asking' (waits for the user's OK), 'running', 'error' or 'done'. Notes that
 * hand in pictures count as the picture stage. `first`: the stage's first step, `count` its steps.
 */
export function flowStages(task) {
    const stages = new Map();
    for (const step of task?.steps || []) {
        const stage = step.stage || ((step.results || []).some(result => result.type === 'image') ? 'picture' : null);
        if (!stage) continue;
        const item = stages.get(stage) || { stage, first: step.id, count: 0 };
        item.count += 1;
        item.state = step.state === 'asking' ? 'asking'
            : step.state === 'running' || step.state === 'allowed' ? 'running'
                : step.ok === false ? 'error' : 'done';
        stages.set(stage, item);
    }
    return [...stages.values()];
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
    return summary?.errors ? 'error' : summary?.ended ? 'done' : 'idle';
}

/** A task's counts for its row: changes, pictures, sounds… as `[{ key, values }]` (only those it has). */
export function taskCounts(summary) {
    const kinds = summary?.kinds || {};
    const counts = [
        ['aiCountAsks', summary?.asks], ['aiCountCanvas', kinds.canvas], ['aiCountImages', summary?.images], ['aiCountSpeech', kinds.speech],
        ['aiCountDownload', kinds.download], ['aiCountScan', kinds.scan], ['aiCountOutside', kinds.outside], ['aiCountErrors', summary?.errors],
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

/** The activity log entries a task's steps show: the AI's canvas changes and the user's own. */
export function activityIds(task) {
    return (task?.steps || []).flatMap(step => [
        ...(step.results || []).filter(result => result.type === 'canvas').map(result => result.activity),
        ...(step.tool === 'user_activity' && step.activity ? [step.activity] : []),
    ]);
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

/**
 * When the AI last wrote the numbers of panel step `step` (its progress bars), if the task went on
 * past them since: a run ended, the AI drew another panel or left a note, or the task ended. Else 0.
 */
export function panelPassed(task, step) {
    const written = step.panel?.changed || step.at;
    const later = (task.steps || []).some(other => other !== step && (
        (['panel', 'note'].includes(other.kind) && other.at > written)
        || (other.kind === 'run' && !['running', 'asking', 'allowed'].includes(other.state) && other.at + (other.ms || 0) / 1000 > written)));
    return later || task.ended > written ? written : 0;
}

/** How long a step took, as `{ key, values }`, or null for quick ones. */
export function duration(ms) {
    if (!(ms >= 1000)) return null;
    const seconds = Math.round(ms / 1000);
    return seconds < 60 ? { key: 'aiSeconds', values: { count: seconds } } : { key: 'aiMinutes', values: { count: Math.round(seconds / 60) } };
}
