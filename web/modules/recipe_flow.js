/**
 * A saved workflow's flow, read from its serialized graph alone (no page, no canvas). Its stages:
 * one per sampler in the order they run (a sampler fed, through any nodes, by another runs after
 * it), each with the nodes it rests on (not through its prompts, but with the control models in
 * them), the model file it is fed, its steps or the part of a split it runs, its redraw strength,
 * an enlargement before it, and whether it runs (a split's empty part is skipped, a bypassed or
 * muted sampler is off). Its parts around the stages: the model files and LoRAs the stages are fed,
 * the control models patched in (a Tile LLLite, a ControlNet) and the picture nodes after the
 * samplers (a colour match), each with the stages it feeds and whether it is used. And which nodes
 * two saved workflows set differently, and which stages that changes. The parts laid in lanes over
 * the stages they feed (flowLanes) are what ui_recipe_flow.js draws.
 * Widget names come from ComfyUI's node types when there are some (`names` stands in for them in tests).
 */

const CONTROL = /lllite|controlnet|t2iadapter|ipadapter/i;
const UPSCALE = /upscale|scaleby|imagescale/i;
const SAVE = /^(SaveImage|PreviewImage)|save/i;
const PLUMBING = /^(VAEDecode|VAEEncode|Reroute|Primitive|Note|MarkdownNote)/;
const LOADER_VALUE = /\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i;
const CONDITIONING = new Set(['positive', 'negative']);
const CONTROL_VALUES = new Set(['fixed', 'increment', 'decrement', 'randomize']); // a seed's "after run" choice
const namesCache = new Map();

/** A node type's widget names in order (ComfyUI's own), to read a saved node's values by name. */
function widgetNames(type) {
    if (!namesCache.has(type)) {
        let names = [];
        try {
            names = (globalThis.LiteGraph?.createNode?.(type)?.widgets || []).map(widget => widget.name || '');
        } catch (_) { /* a node type that cannot be made off the canvas: its values stay unnamed */ }
        namesCache.set(type, names);
    }
    return namesCache.get(type);
}

const inputs = node => node.inputs || [];
const valuesOf = node => (Array.isArray(node?.widgets_values) ? node.widgets_values : Object.values(node?.widgets_values || {}));
const isOff = node => node.mode === 2 || node.mode === 4;
const fileOf = node => valuesOf(node).find(value => typeof value === 'string' && LOADER_VALUE.test(value)) || '';
const isSampler = node => ['model', 'positive'].every(name => inputs(node).some(input => input.name === name))
    && inputs(node).some(input => /latent/.test(input.name));

const NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
/** A stage's number as it is drawn. */
export const stageMark = n => NUMBERS[n - 1] || String(n);

/** A model file's name without its folders and extension. */
export const shortName = file => String(file).split(/[\\/]/).pop().replace(LOADER_VALUE, '');

/** Two saved values alike (a seed's after-run choice is never a change). */
export const sameValue = (a, b) => CONTROL_VALUES.has(a) || JSON.stringify(a) === JSON.stringify(b);

/** A saved node's values by name: [{name, value}] (an unnamed one by its place). */
export function nodeValues(node, names = widgetNames) {
    const known = names(node?.type);
    return valuesOf(node).map((value, at) => ({ name: known[at] || `#${at + 1}`, value }));
}

/** The saved workflow as lookups: nodes by id, each input's source node, each node's users. */
function graphOf(workflow, names) {
    const nodes = new Map((workflow?.nodes || []).map(node => [String(node.id), node]));
    const links = new Map((workflow?.links || []).map(link => (Array.isArray(link)
        ? [String(link[0]), String(link[1])] : [String(link.id), String(link.origin_id)])));
    const from = input => (input?.link == null ? null : nodes.get(links.get(String(input.link))) || null);
    const value = (node, name) => {
        const at = names(node.type).indexOf(name);
        return at >= 0 ? valuesOf(node)[at] : undefined;
    };
    const users = new Map();
    for (const node of nodes.values()) {
        for (const input of inputs(node)) {
            const source = from(input);
            if (source) users.set(String(source.id), [...(users.get(String(source.id)) || []), node]);
        }
    }
    return { nodes, from, value, users };
}

/** The nodes feeding `node` (not through its prompts), up to the samplers before it, which are returned apart. */
function feeders(g, node) {
    const seen = new Set();
    const before = new Set();
    const walk = (current) => {
        for (const input of inputs(current)) {
            if (current === node && CONDITIONING.has(input.name)) continue;
            const source = g.from(input);
            const key = source && String(source.id);
            if (!source || seen.has(key) || before.has(key)) continue;
            if (isSampler(source)) {
                before.add(key);
                continue;
            }
            seen.add(key);
            walk(source);
        }
    };
    walk(node);
    return { nodes: seen, before };
}

/** The control nodes in a sampler's prompts (a ControlNet applied to them, with its loader), not up through the text encoders. */
function promptControls(g, sampler) {
    const seen = new Set();
    const walk = (current) => {
        for (const input of inputs(current)) {
            if (current === sampler ? !CONDITIONING.has(input.name) : input.name === 'clip' || input.name === 'model') continue;
            const source = g.from(input);
            const key = source && String(source.id);
            if (!source || seen.has(key) || isSampler(source)) continue;
            seen.add(key);
            walk(source);
        }
    };
    walk(sampler);
    return [...seen].filter(id => CONTROL.test(g.nodes.get(id).type));
}

/** The model file a sampler is fed and the LoRAs and patches on the way, bypassed ones passed through. */
function modelOf(g, sampler) {
    const out = { file: '', loader: null, loras: [], controls: [] };
    let node = g.from(inputs(sampler).find(input => input.name === 'model'));
    for (let hop = 0; node && hop < 16; hop += 1) {
        const file = fileOf(node);
        if (!isOff(node)) {
            if (/lora/i.test(node.type)) out.loras.push(String(node.id));
            else if (CONTROL.test(node.type)) out.controls.push(String(node.id));
            else if (file && !inputs(node).some(input => input.name === 'model')) {
                Object.assign(out, { file, loader: String(node.id) });
                return out;
            }
        }
        node = g.from(inputs(node).find(input => input.name === 'model'));
    }
    return out;
}

/** A control node's model file: its own, or its control loader's. */
const controlFile = (g, node) => fileOf(node)
    || fileOf(inputs(node).map(g.from).find(source => source && CONTROL.test(source.type) && fileOf(source)));

/**
 * The flow of `workflow`: { stages, parts, saves }. stages: [{n, kind (base | continue | upscale),
 * sampler, state (run | skipped | off), nodes (ids it rests on), model, steps, window ([from, to]
 * of a split, or null), denoise, upscale}] in the order they run. parts: [{kind (model | lora |
 * control | post), ids, file, name, strength, stages (the numbers it feeds), on (used)}], one per
 * file and strength. saves: the save nodes that run.
 */
export function readFlow(workflow, names = widgetNames) {
    const g = graphOf(workflow, names);
    const samplers = [...g.nodes.values()].filter(isSampler);
    const fed = new Map(samplers.map(node => [String(node.id), feeders(g, node)]));
    const depth = new Map();
    const level = (key, guard = 0) => {
        if (!depth.has(key)) depth.set(key, guard > 16 ? 0 : 1 + Math.max(0, ...[...fed.get(key).before].map(before => level(before, guard + 1))));
        return depth.get(key);
    };
    const parts = new Map();
    const add = (kind, id, n, file = '', strength = undefined) => {
        const node = g.nodes.get(id);
        const key = `${kind}|${file || id}|${strength ?? ''}`;
        const part = parts.get(key) || { kind, ids: [], file, name: file ? shortName(file) : node.title || node.type, strength, stages: [], off: [] };
        if (!part.ids.includes(id)) part.ids.push(id);
        if (isOff(node)) part.off.push(id);
        if (n && !part.stages.includes(n)) part.stages.push(n);
        parts.set(key, part);
    };
    const stages = samplers.map(node => ({ node, key: String(node.id) }))
        .sort((a, b) => level(a.key) - level(b.key) || Number(a.key) - Number(b.key))
        .map(({ node, key }, at) => {
            const n = at + 1;
            const steps = Number(g.value(node, 'steps'));
            const start = g.value(node, 'start_at_step');
            const end = g.value(node, 'end_at_step');
            const window = start === undefined ? null : [Number(start), Math.min(Number(end ?? steps), steps)];
            const upscale = [...fed.get(key).nodes].map(id => g.nodes.get(id)).find(item => UPSCALE.test(item.type));
            const model = modelOf(g, node);
            const prompted = promptControls(g, node);
            if (model.loader) add('model', model.loader, n, model.file);
            for (const id of model.loras) add('lora', id, n, fileOf(g.nodes.get(id)), g.value(g.nodes.get(id), 'strength_model'));
            for (const id of [...model.controls, ...prompted.filter(id => inputs(g.nodes.get(id)).some(input => input.link != null))]) {
                add('control', id, n, controlFile(g, g.nodes.get(id)), g.value(g.nodes.get(id), 'strength'));
            }
            return {
                n, sampler: key, kind: fed.get(key).before.size ? (upscale ? 'upscale' : 'continue') : 'base',
                state: isOff(node) ? 'off' : window && window[0] >= window[1] ? 'skipped' : 'run',
                nodes: new Set([key, ...fed.get(key).nodes, ...prompted]), model: model.file ? shortName(model.file) : '', steps,
                window, denoise: Number(g.value(node, 'denoise') ?? 1), upscale: upscale ? Number(g.value(upscale, 'scale_by')) || true : null,
            };
        });
    // the picture nodes after the samplers: not a stage's, not decoding or saving
    const staged = new Set(stages.flatMap(stage => [...stage.nodes]));
    const after = new Set();
    const forward = (node) => {
        for (const user of g.users.get(String(node.id)) || []) {
            const key = String(user.id);
            if (after.has(key) || staged.has(key) || isSampler(user)) continue;
            after.add(key);
            if (!PLUMBING.test(user.type) && !SAVE.test(user.type)) add('post', key, null);
            forward(user);
        }
    };
    samplers.forEach(forward);
    const running = new Set(stages.filter(stage => stage.state === 'run').map(stage => stage.n));
    return {
        stages,
        parts: [...parts.values()].map(({ off, ...part }) => ({
            ...part, on: off.length < part.ids.length && (part.kind === 'post' || part.stages.some(n => running.has(n))),
        })),
        saves: [...g.nodes.values()].filter(node => SAVE.test(node.type) && !isOff(node)).length,
    };
}

/** The node ids whose values differ between saved workflows `a` and `b` (a seed's after-run choice aside). */
export function changedNodes(a, b) {
    const others = new Map((b?.nodes || []).map(node => [String(node.id), node]));
    const changed = new Set();
    for (const node of a?.nodes || []) {
        const other = others.get(String(node.id));
        if (!other) continue;
        const mine = valuesOf(node);
        const theirs = valuesOf(other);
        if (mine.length !== theirs.length || mine.some((value, at) => !sameValue(value, theirs[at]))) changed.add(String(node.id));
    }
    return changed;
}

/**
 * The stage numbers of `stages` a preset changes from `base` (the workflow's own stages): run
 * there and not here or the other way round, or running with one of its nodes `changed`. A stage
 * left unrun in both is no change, whatever feeds it.
 */
export const touched = (stages, changed, base) => stages.filter((stage) => {
    const before = base.find(item => item.sampler === stage.sampler);
    return !before || before.state !== stage.state || (stage.state === 'run' && [...stage.nodes].some(id => changed.has(id)));
}).map(stage => stage.n);

const LANES = ['model', 'lora', 'control'];

/** Stage numbers as runs of neighbours: [[from, to], …]. */
const runsOf = numbers => [...numbers].sort((a, b) => a - b).reduce((runs, n) => {
    const last = runs[runs.length - 1];
    if (last && last[1] === n - 1) last[1] = n;
    else runs.push([n, n]);
    return runs;
}, []);

/**
 * The parts of `flow` laid over its stages: one lane per kind (model files, LoRAs, control models),
 * each in as few rows as fit, a part as one bar per run of neighbouring stages it feeds.
 * [{kind, rows: [[{part, from, to}]]}], kinds without parts left out.
 */
export function flowLanes(flow) {
    return LANES.map((kind) => {
        const rows = [];
        for (const part of flow.parts.filter(item => item.kind === kind && item.stages.length)) {
            const bars = runsOf(part.stages).map(([from, to]) => ({ part, from, to }));
            const fits = row => bars.every(bar => row.every(other => bar.to < other.from || bar.from > other.to));
            const row = rows.find(fits);
            if (row) row.push(...bars);
            else rows.push(bars);
        }
        return { kind, rows: rows.map(row => row.sort((a, b) => a.from - b.from)) };
    }).filter(lane => lane.rows.length);
}

/** Whether node `id` is used in `flow`: the sampler of a stage that runs, or in a part used. */
export const usedIn = (flow, id) => flow.stages.some(stage => stage.sampler === id && stage.state === 'run')
    || flow.parts.some(part => part.on && part.ids.includes(id));
