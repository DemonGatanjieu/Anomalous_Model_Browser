/**
 * A saved workflow's stages, read from its serialized graph alone (no page, no canvas): one per
 * sampler in the order they run (a sampler fed, through any nodes, by another runs after it), each
 * with the nodes it rests on (not through its prompts), the main model it is fed through LoRAs and
 * patches (a Tile LLLite or a ControlNet named), its steps or the part of a split it runs, its
 * redraw strength and an enlargement before it; and which nodes two saved workflows set differently.
 * ui_recipe_flow.js draws it. Widget names come from ComfyUI's node types when there are some
 * (`names` stands in for them in tests).
 */

const CONTROL = /lllite|controlnet|t2iadapter|ipadapter/i;
const UPSCALE = /upscale|scaleby|imagescale/i;
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

/** The saved workflow as lookups: nodes by id, each input's source node. */
function graphOf(workflow, names = widgetNames) {
    const nodes = new Map((workflow?.nodes || []).filter(node => node.mode !== 2 && node.mode !== 4).map(node => [String(node.id), node]));
    const links = new Map((workflow?.links || []).map(link => (Array.isArray(link)
        ? [String(link[0]), String(link[1])] : [String(link.id), String(link.origin_id)])));
    const from = input => (input?.link == null ? null : nodes.get(links.get(String(input.link))) || null);
    const value = (node, name) => {
        const at = names(node.type).indexOf(name);
        return at >= 0 ? node.widgets_values?.[at] : undefined;
    };
    return { nodes, from, value };
}

const inputs = node => node.inputs || [];
const isSampler = node => ['model', 'positive'].every(name => inputs(node).some(input => input.name === name))
    && inputs(node).some(input => /latent/.test(input.name));

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

/** The main model a sampler is fed, through LoRAs and patches: {name, loras, control}. */
function modelOf(g, sampler) {
    let node = g.from(inputs(sampler).find(input => input.name === 'model'));
    const out = { name: '', loras: 0, control: '' };
    for (let hop = 0; node && hop < 16; hop += 1) {
        if (/lora/i.test(node.type)) out.loras += 1;
        else if (CONTROL.test(node.type)) out.control = (node.widgets_values || []).some(value => /tile/i.test(String(value))) ? 'Tile' : 'control';
        const file = (node.widgets_values || []).find(value => typeof value === 'string' && LOADER_VALUE.test(value));
        if (file && !/lora/i.test(node.type) && !inputs(node).some(input => input.name === 'model')) {
            out.name = file.split(/[\\/]/).pop().replace(LOADER_VALUE, '');
            return out;
        }
        node = g.from(inputs(node).find(input => input.name === 'model'));
    }
    return out;
}

/**
 * The stages of `workflow`: [{n, kind (base | upscale | continue), sampler, nodes (ids it rests on),
 * model, steps, window ([from, to] of a split, or null), skipped, denoise, upscale}] in the order they run.
 */
export function flowStages(workflow, names = widgetNames) {
    const g = graphOf(workflow, names);
    const samplers = [...g.nodes.values()].filter(isSampler);
    const fed = new Map(samplers.map(node => [String(node.id), feeders(g, node)]));
    const depth = new Map();
    const level = (key, guard = 0) => {
        if (!depth.has(key)) depth.set(key, guard > 16 ? 0 : 1 + Math.max(0, ...[...fed.get(key).before].map(before => level(before, guard + 1))));
        return depth.get(key);
    };
    return samplers.map(node => ({ node, key: String(node.id) }))
        .sort((a, b) => level(a.key) - level(b.key) || Number(a.key) - Number(b.key))
        .map(({ node, key }, at) => {
            const steps = Number(g.value(node, 'steps'));
            const start = g.value(node, 'start_at_step');
            const end = g.value(node, 'end_at_step');
            const window = start === undefined ? null : [Number(start), Math.min(Number(end ?? steps), steps)];
            const upscale = [...fed.get(key).nodes].map(id => g.nodes.get(id)).find(item => UPSCALE.test(item.type));
            return {
                n: at + 1, sampler: key, nodes: new Set([key, ...fed.get(key).nodes]), model: modelOf(g, node), steps,
                window, skipped: Boolean(window && window[0] >= window[1]), denoise: Number(g.value(node, 'denoise') ?? 1),
                upscale: upscale ? Number(g.value(upscale, 'scale_by')) || true : null,
                kind: fed.get(key).before.size ? (upscale ? 'upscale' : 'continue') : 'base',
            };
        });
}

/** The node ids whose values differ between saved workflows `a` and `b` (a seed's after-run choice aside). */
export function changedNodes(a, b) {
    const others = new Map((b?.nodes || []).map(node => [String(node.id), node]));
    const changed = new Set();
    for (const node of a?.nodes || []) {
        const other = others.get(String(node.id));
        const mine = node.widgets_values || [];
        const theirs = other?.widgets_values || [];
        if (!other || mine.length !== theirs.length) {
            if (other) changed.add(String(node.id));
            continue;
        }
        if (mine.some((value, at) => !CONTROL_VALUES.has(value) && JSON.stringify(value) !== JSON.stringify(theirs[at]))) changed.add(String(node.id));
    }
    return changed;
}

/** The stage numbers a preset's changed nodes touch. */
export const touched = (stages, changed) => stages.filter(stage => [...changed].some(id => stage.nodes.has(id))).map(stage => stage.n);
