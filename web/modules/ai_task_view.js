/**
 * The AI workbench's rules without DOM (ui_ai_workbench.js and ui_ai_chain.js draw them): which
 * steps fold together, what each tool is called, what a task counts, and where a result leads. A task
 * and its steps are api/ai_tasks.py's shapes.
 */

/**
 * The task list by family: a task comes with all that go on from it (`from`, however far), those
 * one step in under it, by when they started. Families stand by their latest news, as `tasks`
 * (newest first) has them; a task whose `from` is not in `tasks` starts a family.
 * Items: { task, child, size (the family's, on its first task), newest (its latest news) }.
 */
export function taskFamilies(tasks) {
    const byId = new Map(tasks.map(task => [task.id, task]));
    const headOf = (task) => {
        const seen = new Set();
        let head = task;
        while (byId.has(head.from)) {
            if (seen.has(head.id)) return task; // going round: set_from refuses that, a hand-edited file need not
            seen.add(head.id);
            head = byId.get(head.from);
        }
        return head;
    };
    const families = new Map(); // first task -> the family, newest first; in the order first met
    for (const task of tasks) {
        const head = headOf(task);
        families.set(head, [...(families.get(head) || []), task]);
    }
    return [...families].flatMap(([head, members]) => {
        const rest = members.filter(task => task !== head).sort((a, b) => a.started - b.started);
        return [head, ...rest].map(task => ({ task, child: task !== head, size: task === head ? members.length : 1, newest: members[0].updated }));
    });
}

/** The kinds of step, in the order a task's counts name them. */
export const KINDS = ['panel', 'user', 'decision', 'canvas', 'run', 'speech', 'download', 'scan', 'show', 'note', 'act', 'outside', 'skill', 'look'];

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
 * hand in pictures count as the picture stage. `first`: the stage's first step, `count` its steps;
 * `sheet` {done, total} when the stage's last step is a job sheet (api/job_sheets.py).
 */
export function flowStages(task) {
    const stages = new Map();
    for (const step of task?.steps || []) {
        const stage = step.stage || ((step.results || []).some(result => result.type === 'image') ? 'picture' : null);
        if (!stage) continue;
        const item = stages.get(stage) || { stage, first: step.id, count: 0 };
        item.count += 1;
        item.state = stepState(step);
        delete item.sheet;
        if (step.sheet) {
            item.sheet = { done: step.progress ? Math.max(0, (step.progress.prompt || 1) - 1) : step.prompts || 0,
                total: step.sheet_total || step.progress?.prompts || step.prompts || 0 };
        }
        stages.set(stage, item);
    }
    return [...stages.values()];
}

const stepState = step => (step.state === 'asking' ? 'asking'
    : step.state === 'running' || step.state === 'allowed' ? 'running'
        : step.ok === false ? 'error' : 'done');

const planBlock = step => (step?.panel?.blocks || []).find(block => block?.type === 'plan') || null;

/** The steps of plan card `block` the user kept (answer.plan, in order), each with the model they left on it. */
function keptSteps(block, answer) {
    const all = block.steps || [];
    if (!answer?.plan?.length) return all;
    let from = 0;
    return answer.plan.map((item) => {
        const at = all.findIndex((step, index) => index >= from && step.block === item.block);
        from = at + 1;
        const step = all[at] || { block: item.block, title: item.block };
        const name = !item.model || item.model === step.model ? step.model_name
            : (step.choices || []).find(choice => choice.model_id === item.model)?.name;
        return { ...step, model_name: name || step.model_name };
    });
}

/**
 * The task's newest blueprint (a plan card, api/ai_plans.py) as the flow's second line, read from what came after
 * the card, so the AI does nothing for it: before the user's nod every step is 'ahead'; built, the first pass is the
 * bases run (a run with `bases`), then picking one (`pick_base`: 'asking' until picked, 'skipped' when the whole ran
 * without), then the rest, the whole run after that. null with no plan card. {state: 'waiting' (the nod), 'change'
 * (they asked for changes) or 'built', card: its step, items: [{title, model} or {key}, state, first: the step to go
 * to]}; an item's state is 'ahead' (not yet), 'running', 'asking', 'skipped', 'error' or 'done'.
 */
export function planFlow(task) {
    const steps = task?.steps || [];
    let at = -1;
    steps.forEach((step, index) => { if (planBlock(step)) at = index; });
    if (at < 0) return null;
    const card = steps[at];
    const block = planBlock(card);
    const answer = card.answers?.[block.id];
    const built = Boolean(answer?.plan);
    const kept = keptSteps(block, answer);
    const later = steps.slice(at + 1);
    const runs = later.filter(step => step.tool === 'run_workflow' && !step.sheet);
    const bases = built ? runs.find(step => step.bases) : null;
    const whole = built ? runs.find(step => !step.bases && (!bases || later.indexOf(step) > later.indexOf(bases))) : null;
    const pick = bases ? later.find(step => step.tool === 'pick_base' && later.indexOf(step) > later.indexOf(bases)) : null;
    const picked = pick?.answers?.base && !pick.answers.base.skipped;
    const first = bases || whole;
    const items = [{ title: kept[0]?.title, model: kept[0]?.model_name, state: first ? stepState(first) : 'ahead', first: (first || card).id }];
    if (kept.length > 1) {
        const pickState = !bases ? (whole ? 'skipped' : 'ahead') : picked ? 'done' : whole ? 'skipped'
            : stepState(bases) === 'done' ? 'asking' : 'ahead';
        items.push({ key: 'aiFlowPick', state: pickState, first: (pick || bases || card).id });
        for (const step of kept.slice(1)) {
            items.push({ title: step.title, model: step.model_name, state: whole ? stepState(whole) : 'ahead', first: (whole || card).id });
        }
    }
    return { state: built ? 'built' : answer ? 'change' : 'waiting', card: card.id, items };
}

/**
 * What a panel holds, for its card in the timeline: `icon` (question, image, nodes, models or
 * panel) and `parts` `[{ key, values }]`: what it asks, pictures, a before-and-after, models, a
 * node structure; none for words only.
 */
export function panelGist(panel) {
    const blocks = (panel?.blocks || []).filter(Boolean);
    const has = type => blocks.some(block => block.type === type);
    const count = type => blocks.filter(block => block.type === type).reduce((sum, block) => sum + (block.items?.length || 0), 0);
    const parts = [];
    const choices = blocks.find(block => block.type === 'choices');
    if (choices) parts.push({ key: 'aiGistAsk', values: { count: choices.options?.length || 0 } });
    else if (has('input')) parts.push({ key: 'aiGistAskFree', values: {} });
    if (has('picks')) parts.push({ key: 'aiGistPick', values: { count: count('picks') } });
    if (has('slider')) parts.push({ key: 'aiGistCompare', values: {} });
    if (has('images')) parts.push({ key: 'aiGistPictures', values: { count: count('images') } });
    if (has('models')) parts.push({ key: 'aiGistModels', values: { count: count('models') } });
    if (has('run_map') || has('diagram')) parts.push({ key: 'aiGistMap', values: {} });
    const icon = choices || has('input') ? 'question' : has('picks') || has('slider') || has('images') ? 'image'
        : has('run_map') || has('diagram') ? 'nodes' : has('models') ? 'models' : 'panel';
    return { icon, parts };
}

/** The locale key naming a step's tool. */
export function toolKey(tool) {
    return `aiTool_${String(tool || '').replace(/[^a-z_]/g, '')}`;
}

/** The skills the AI fetched (use_skill steps, api/ai_skills.py) after the run before `step` and before it. */
export function skillsBefore(steps, step) {
    const list = steps || [];
    const found = [];
    for (let at = list.findIndex(item => item.id === step?.id) - 1; at >= 0 && list[at].tool !== 'run_workflow'; at--) {
        if (list[at].tool === 'use_skill') found.unshift(list[at]);
    }
    return found;
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

/**
 * What a task made, for the side column's Results view, each thing once: `runs` (the steps that
 * brought pictures, newest first, with their pictures), the combos placed, the models used, the
 * downloads, the sounds, and `canvas`, how many canvas changes.
 */
export function taskOutputs(task) {
    const out = { runs: [], combos: [], models: [], downloads: [], audio: [], canvas: 0 };
    const seen = new Set();
    const first = key => !seen.has(key) && Boolean(seen.add(key));
    for (const step of task?.steps || []) {
        const pictures = [];
        for (const result of step.results || []) {
            if (result.type === 'image') {
                if (result.filename && first(`image ${pictureKey(result)}`)) pictures.push(result);
            } else if (result.type === 'combo') {
                if (first(`combo ${result.name}`)) out.combos.push(result);
            } else if (result.type === 'model') {
                if (first(`model ${result.model_id}`)) out.models.push(result);
            } else if (result.type === 'download') {
                if (result.file && first(`download ${result.file}`)) out.downloads.push(result);
            } else if (result.type === 'audio') {
                if (first(`audio ${result.file}`)) out.audio.push(result);
            } else if (result.type === 'canvas') out.canvas += 1;
        }
        if (pictures.length) out.runs.unshift({ step, pictures });
    }
    return out;
}

/** How many things `outputs` (taskOutputs) holds: what the task made, not its canvas changes. */
export function outputCount(outputs) {
    return outputs.runs.reduce((sum, run) => sum + run.pictures.length, 0)
        + outputs.combos.length + outputs.models.length + outputs.downloads.length + outputs.audio.length;
}

/** The newest output picture of `outputs` still there, as the keep menu takes it: what Results keeps from. */
export function newestPicture(outputs) {
    for (const run of outputs.runs) {
        const image = run.pictures.find(result => !result.gone && outputPicture(result));
        if (image) return outputPicture(image);
    }
    return null;
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

/** What a view larger than a thumbnail shows of an output picture: itself, or a 4096 px copy of a very large one (gallery_routes.py output_preview). */
export function pictureShown(result) {
    const source = outputPicture(result);
    return source ? `/anomalous/output_preview?${new URLSearchParams({ filename: source.filename, subfolder: source.subfolder })}` : outputUrl(result);
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
