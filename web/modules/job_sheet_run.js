/**
 * Runs the job sheet on this page (api/job_sheets.py keeps it, ui_job_sheet.js draws it). The workflow kept at
 * the sheet's start goes on a detached graph for each run (detached_graph.js), the run's row is filled in as
 * run_workflow's blanks are (mcp_fill.js fillPlan: the positive and negative prompt boxes, settings by name),
 * its seed written (snapshot_plan.js), and it is queued from there: the canvas and its seeds stay as they are.
 * With a pause the next run goes in once the one before has left ComfyUI's queue and the pause is over; with
 * none one waits behind the one going, so the card never idles (job_sheet_plan.js room). A run that fails or is
 * interrupted pauses the sheet and says why. Every change is reported to the server, and at least every
 * HEARTBEAT while it goes or waits; its word (`want`: pause, stop, go on, from any page or the AI) is acted on.
 * The tab that ran a sheet goes on with it after a reload; another page reads a going sheet every LOOK, so it
 * sees when the page running it is gone. No DOM.
 */

import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { readDetached } from './detached_graph.js';
import { jobAt, outcomeOf, restLeft, room, seedOf, slotsOf } from './job_sheet_plan.js';
import { fillPlan } from './mcp_fill.js';
import { aiWords, canvasPrompts, firstTime, languageProblem } from './prompt_language.js';
import { applySeeds, compiled, seedWidgets } from './snapshot_plan.js';

const TICK = 1500; // ms between looks at ComfyUI's queue
const HEARTBEAT = 15000; // ms: the server counts a page silent for 45 s as gone
const LOOK = 20000; // ms: a page not running a going sheet reads it again, to see whether its page is gone
const PROBES = 12; // rows checked with ComfyUI before a sheet starts
const ENDED = ['done', 'stopped'];

let page = '';
let sheet = null; // as the server last said
let flow = null; // the sheet's workflow, while this page runs it
let looping = false;
let wake = () => {};
let resting = 0; // when the pause before the next run ends
let ended = 0; // when this page last saw a run of the sheet leave the queue
let lastWord = 0;
const watchers = new Set();

const post = async (path, body) => {
    const response = await fetch(`/anomalous/job_sheet${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
};

function setSheet(next) {
    sheet = next || null;
    if (!sheet || sheet.page !== page) flow = null;
    for (const watcher of watchers) watcher();
    wake();
}

/** {sheet, mine (this page runs it), resting (ms of the pause left)}. */
export const jobSheet = () => ({ sheet, mine: looping, resting: Math.max(0, resting - Date.now()) });

export const onJobSheet = watcher => watchers.add(watcher);

/** ComfyUI's own words when it refuses a run. */
function refusal(failure) {
    const response = failure?.response;
    const nodes = Object.values(response?.node_errors || {}).flatMap(item => (item?.errors || []).map(error => `${item.class_type}: ${error.message} ${error.details || ''}`.trim()));
    return (nodes[0] || response?.error?.message || failure?.message || String(failure)).slice(0, 300);
}

function fill(graph, row) {
    for (const { plan } of fillPlan(graph, slotsOf(row)).plans) for (const [widget, value] of plan) widget.value = value;
}

/** Why `rows` cannot run on `workflow`: what no box takes, a row run several times with no seed to change, ComfyUI's own check. */
export async function sheetProblems(workflow, rows) {
    const found = [];
    const probes = rows.map((row, at) => ({ row, at })).filter(({ row, at }) => at === 0 || row.values || row.negative != null).slice(0, PROBES);
    for (const { row, at } of probes) {
        await readDetached(workflow, async (graph) => {
            try {
                fill(graph, row);
            } catch (error) {
                found.push(`${at + 1}: ${error.message || error}`);
                return;
            }
            if (rows.some(item => item.count > 1) && !seedWidgets(graph).length) found.push('no seed');
            const { output } = await compiled(app, graph);
            const response = await fetch('/anomalous/snapshot_check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: output }) });
            for (const line of (await response.json()).problems || []) found.push(`${at + 1}: ${line}`);
        });
        if (found.length) break;
    }
    return [...new Set(found)];
}

/** Starts `given` ({rows, pause, same_seeds, title, task}) on `workflow`, run by this page. Throws its problems. */
export async function startSheet(given, workflow) {
    const problems = await sheetProblems(workflow, given.rows);
    if (problems.length) throw Object.assign(new Error(problems.join('\n')), { problems });
    const { sheet: made } = await post('/start', { ...given, workflow, page });
    flow = workflow;
    ended = 0;
    setSheet(made);
    void loop();
    return made;
}

/** The prompts a sheet of `rows` sends: its rows', and the canvas's for a row with none. */
export const sheetPrompts = (rows, graph) => [...rows.filter(row => row.prompt).map(row => row.prompt),
    ...(rows.some(row => !row.prompt) ? canvasPrompts(graph) : [])];

/** The AI's sheet (run_workflow(sheet=…), api/mcp_actions.py) on the canvas the run would run; refused once when
 * its prompts are in a language the canvas's model cannot read (prompt_language.js). */
export async function startFromAi({ rows, pause, same_seeds: same, task }) {
    const root = app.rootGraph || app.graph;
    if (!(root?._nodes || []).length) throw new Error('Nothing was run: the canvas is empty. Open a workflow first.');
    const title = app.extensionManager?.workflow?.activeWorkflow?.filename || '';
    const texts = sheetPrompts(rows, root);
    const odd = firstTime(await languageProblem(root, texts), texts, 'ai');
    if (odd) throw new Error(aiWords(odd));
    let made;
    try {
        made = await startSheet({ rows, pause, same_seeds: same, title, task }, root.serialize());
    } catch (error) {
        const lines = (error.problems || [String(error.message || error)]).map(line => (line === 'no seed' ? 'a row runs several times but no sampler has a seed to change' : line));
        throw new Error(`Nothing was run: ${lines.slice(0, 4).join('; ')}`);
    }
    return { sheet: made.id, total: made.total, rows: made.rows.length, pause: made.pause };
}

/** Pause, stop or go on, asked from this page; going on where no live page runs it makes this page run it. */
export async function askSheet(want) {
    if (!sheet) return;
    const { sheet: now, run } = await post('/ask', { id: sheet.id, want, page });
    setSheet(now);
    if (run) await own();
}

/** Takes away a sheet that is not going. */
export async function clearSheet() {
    if (!sheet) return;
    await post('/clear', { id: sheet.id });
    setSheet(null);
}

/** This page runs the sheet: its workflow from the server when the page has none, then the loop. */
async function own() {
    if (!flow) flow = (await (await fetch('/anomalous/job_sheet/workflow')).json()).workflow;
    if (!flow) throw new Error('The sheet\'s workflow is gone.');
    void loop();
}

async function report(fields = {}) {
    lastWord = Date.now();
    try {
        setSheet((await post('/report', { id: sheet.id, page, at: sheet.at, ...fields })).sheet);
    } catch (error) {
        if (/gone|Another page/.test(error.message)) {
            setSheet(sheet && { ...sheet, page: '' });
            return;
        }
        console.warn('[AMB] Job sheet: could not report.', error); // ComfyUI restarting: said again with the next word
    }
}

const rest = ms => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => { clearTimeout(timer); resolve(); };
});

/** The sheet's runs that have left ComfyUI's queue, with how each ended: [[id, outcome, why]]. */
async function leftQueue() {
    if (!sheet.pending?.length) return [];
    const queue = await (await fetch('/queue')).json();
    const there = new Set([...(queue.queue_running || []), ...(queue.queue_pending || [])].map(item => item[1]));
    const out = [];
    for (const id of sheet.pending.filter(item => !there.has(item))) {
        const history = await (await fetch(`/history/${encodeURIComponent(id)}`)).json();
        const { outcome, why } = outcomeOf(history?.[id]);
        out.push([id, outcome, why]);
    }
    return out;
}

async function queueRun(index) {
    const { row, round } = jobAt(sheet.rows, index);
    return readDetached(flow, async (graph) => {
        fill(graph, sheet.rows[row]);
        applySeeds(graph, seedOf(sheet, round));
        const answer = await api.queuePrompt(0, await compiled(app, graph));
        if (typeof answer?.prompt_id !== 'string' || !answer.prompt_id) throw new Error('ComfyUI did not return a prompt id.');
        return answer.prompt_id;
    });
}

/** One look: acts on what was asked and on the queue; false once the sheet is no longer this page's to run. */
async function step() {
    if (!sheet || sheet.page !== page || ENDED.includes(sheet.state)) return false;
    const asked = { stop: { state: 'stopped' }, pause: { state: 'paused' }, go: { state: 'running', note: '' } }[sheet.want];
    if (asked && asked.state !== sheet.state) {
        await report(asked);
        return true;
    }
    const left = await leftQueue();
    if (left.length) {
        ended = Date.now();
        const bad = left.find(([, outcome]) => outcome === 'error' || outcome === 'interrupted');
        await report({ finished: left.map(([id, outcome]) => [id, outcome]),
            ...(bad && sheet.state === 'running' ? { state: 'paused', note: bad[1] === 'interrupted' ? 'interrupted' : bad[2] || 'error' } : {}) });
        return true;
    }
    if (sheet.state !== 'running') return 'idle';
    if (sheet.at >= sheet.total) {
        if (sheet.pending.length) return 'idle';
        await report({ state: 'done' });
        return true;
    }
    if (!room(sheet)) return 'idle';
    const wait = restLeft(sheet, ended, Date.now());
    if (wait > 0) {
        resting = Date.now() + wait;
        for (const watcher of watchers) watcher();
        await rest(Math.min(wait, TICK));
        return true;
    }
    resting = 0;
    const index = sheet.at;
    let id;
    try {
        id = await queueRun(index);
    } catch (failure) {
        await report({ state: 'paused', note: refusal(failure) });
        return true;
    }
    await report({ queued: [[id, index]], at: index + 1 });
    return true;
}

async function loop() {
    if (looping) return wake();
    looping = true;
    for (const watcher of watchers) watcher();
    try {
        for (;;) {
            let went;
            try {
                went = await step();
            } catch (error) {
                console.warn('[AMB] Job sheet:', error); // ComfyUI's queue unreadable for a moment: the next look tries again
                went = 'idle';
            }
            if (!went) break;
            if (Date.now() - lastWord > HEARTBEAT) await report();
            if (went === 'idle') await rest(TICK);
        }
    } finally {
        looping = false;
        resting = 0;
        for (const watcher of watchers) watcher();
    }
}

/** Follows the sheet from this page (`pageId`: the bridge's, kept over a reload); the tab that ran it goes on. */
export async function watchJobSheet(pageId) {
    page = pageId;
    api.addEventListener('anomalous.job_sheet', ({ detail }) => setSheet(detail?.sheet));
    api.addEventListener('status', () => wake()); // ComfyUI's queue changed: look now
    setInterval(() => {
        if (!sheet || looping || ENDED.includes(sheet.state)) return;
        void fetch('/anomalous/job_sheet').then(response => response.json()).then(data => setSheet(data.sheet)).catch(() => {});
    }, LOOK);
    try {
        setSheet((await (await fetch('/anomalous/job_sheet')).json()).sheet);
        if (sheet && sheet.page === page && !ENDED.includes(sheet.state)) await own();
    } catch (error) {
        console.warn('[AMB] Job sheet: could not read it.', error);
    }
}
