/**
 * Puts a Prompt Note into the open workflow instead of building new nodes: the main model
 * loader takes the note's model, the LoRA chain right after it is rebuilt with the note's
 * LoRAs (what the chain fed keeps its wiring; a LoRA kept keeps its strengths), and the
 * positive prompt box of the sampler that model reaches takes the note's prompt. A
 * selected loader or prompt node is taken first. planNoteApply() only reads the canvas and
 * says what would change; applyNotePlan() makes the change as one Ctrl+Z step.
 */

import { recordCanvasStep } from './canvas_history.js';
import { inferModelFolderTypes } from './model_policies.js';
import { promptBoxes, wiredRole } from './prompt_boxes.js';

const MAIN_TYPES = ['checkpoints', 'diffusion_models', 'unet'];
const MAX_HOPS = 12;

const slashes = (value) => String(value).replace(/\\/g, '/');
export const modelName = (value) => slashes(value).split('/').pop().replace(/\.(safetensors|ckpt|pt|pth|bin|sft|gguf)$/i, '');

/** A note model's value as a loader shows it: `subfolder/filename`. */
export function notePath(model) {
    const sub = String(model?.subfolder || '').replace(/^\/+|\/+$/g, '');
    return sub ? `${sub}/${model.filename}` : String(model?.filename || '');
}

function modelWidget(node, types) {
    return (node?.widgets || []).find(w => w.type === 'combo' && inferModelFolderTypes(node, w).some(type => types.includes(type))) || null;
}

function choices(values) {
    return typeof values === 'function' ? values() : values;
}

function choiceFor(values, path) {
    const wanted = slashes(path);
    return (choices(values) || []).find(value => typeof value === 'string' && slashes(value) === wanted) || null;
}

const outSlot = (node, type) => (node.outputs || []).findIndex(output => output.type === type);
const inSlot = (node, type) => (node.inputs || []).findIndex(input => input.type === type);
const linkOf = (graph, id) => (id == null ? null : graph.getLink?.(id) ?? graph.links?.[id] ?? null);

function linksFrom(graph, node, slot) {
    if (slot < 0) return [];
    return (node.outputs[slot].links || [])
        .map(id => linkOf(graph, id))
        .filter(Boolean)
        .map(link => ({ node: graph.getNodeById(link.target_id), slot: link.target_slot }))
        .filter(target => target.node);
}

const isLoraNode = (node) => Boolean(modelWidget(node, ['loras'])) && inSlot(node, 'MODEL') >= 0;

/** LoRA loaders fed one after another from the loader's MODEL output. */
function loraChain(graph, loader) {
    const chain = [];
    for (let current = loader; ;) {
        const targets = linksFrom(graph, current, outSlot(current, 'MODEL'));
        const next = targets.length === 1 ? targets[0] : null;
        if (!next || !isLoraNode(next.node) || next.slot !== inSlot(next.node, 'MODEL')) return chain;
        chain.push(next.node);
        current = next.node;
    }
}

/**
 * The CLIP path through the chain: `source`/`slot` feed the first LoRA's CLIP (the loader
 * when there is no chain), `end` is the last LoRA it passes. A chain without CLIP: null.
 */
function clipPath(graph, loader, chain) {
    if (!chain.length) return { source: loader, slot: outSlot(loader, 'CLIP'), end: loader };
    const first = linkOf(graph, chain[0].inputs?.[inSlot(chain[0], 'CLIP')]?.link);
    const source = first && graph.getNodeById(first.origin_id);
    if (!source) return null;
    let end = chain[0];
    for (const node of chain.slice(1)) {
        const link = linkOf(graph, node.inputs?.[inSlot(node, 'CLIP')]?.link);
        if (!link || link.origin_id !== end.id) break;
        end = node;
    }
    return { source, slot: first.origin_slot, end };
}

/** Samplers (or guiders) the loader's model reaches. */
function samplersOf(graph, loader) {
    const found = new Set();
    const seen = new Set([loader.id]);
    let frontier = linksFrom(graph, loader, outSlot(loader, 'MODEL')).map(target => target.node);
    for (let hop = 0; hop < MAX_HOPS && frontier.length; hop++) {
        const next = [];
        for (const node of frontier) {
            if (seen.has(node.id)) continue;
            seen.add(node.id);
            if (/guider/i.test(node.type) || (node.inputs || []).some(input => /positive/i.test(input.name))) {
                found.add(node.id);
                continue;
            }
            (node.outputs || []).forEach((_, slot) => next.push(...linksFrom(graph, node, slot).map(target => target.node)));
        }
        frontier = next;
    }
    return found;
}

function positiveBox(graph, selected, samplers) {
    if (selected) {
        const boxes = promptBoxes(selected);
        const own = boxes.filter(box => box.role === 'positive');
        if (own.length === 1) return { node: selected, box: own[0] };
        if (boxes.length === 1 && !boxes[0].role) return { node: selected, box: boxes[0] };
    }
    const found = [];
    for (const node of graph._nodes || []) {
        const boxes = promptBoxes(node).filter(box => box.role === 'positive');
        if (!boxes.length) continue;
        const reach = wiredRole(node, graph).samplers;
        if (!samplers.size || [...reach].some(id => samplers.has(id))) found.push(...boxes.map(box => ({ node, box })));
    }
    return found.length === 1 ? found[0] : found.length;
}

/** The LoRA choices a loader type offers, from ComfyUI's definition (null: unknown). */
function loraChoices(type) {
    const input = globalThis.LiteGraph?.registered_node_types?.[type]?.nodeData?.input;
    const spec = input?.required?.lora_name || input?.optional?.lora_name;
    return Array.isArray(spec?.[0]) ? spec[0] : null;
}

/**
 * What putting `note` into the canvas would change: { graph, loader, widget, modelTo,
 * chain, loras, loraType, prompt, lines, skipped }. `lines` and `skipped` are
 * [key, params] pairs for the confirmation; nothing is written.
 */
export function planNoteApply(app, note, selected = null) {
    const graph = app.canvas?.graph || app.graph;
    const plan = { graph, lines: [], skipped: [], loras: null, prompt: null, modelTo: null };
    if (!graph) return plan;
    const loaders = (graph._nodes || []).filter(node => modelWidget(node, MAIN_TYPES) && outSlot(node, 'MODEL') >= 0);
    const loader = selected && loaders.includes(selected) ? selected : loaders.length === 1 ? loaders[0] : null;
    if (!loader) plan.skipped.push(loaders.length ? ['noteApplyManyLoaders', { count: loaders.length }] : ['noteApplyNoLoader']);

    if (loader) {
        plan.loader = loader;
        plan.widget = modelWidget(loader, MAIN_TYPES);
        const loaderIsUnet = !inferModelFolderTypes(loader, plan.widget).includes('checkpoints');
        const main = note.mainModel;
        if (main) {
            const noteIsUnet = main.type === 'unet' || main.type === 'diffusion_models';
            const value = choiceFor(plan.widget.options?.values, notePath(main));
            if (noteIsUnet !== loaderIsUnet) plan.skipped.push(['noteApplyKindMismatch', { name: modelName(main.filename) }]);
            else if (!value) plan.skipped.push(['noteApplyModelMissing', { name: modelName(main.filename) }]);
            else if (value !== plan.widget.value) {
                plan.modelTo = value;
                plan.lines.push(['noteApplyModel', { from: modelName(plan.widget.value), to: modelName(value) }]);
            }
        }

        plan.chain = loraChain(graph, loader);
        plan.loraType = plan.chain[0]?.type || (loaderIsUnet ? 'LoraLoaderModelOnly' : 'LoraLoader');
        const available = loraChoices(plan.loraType);
        const wanted = [];
        for (const lora of note.loras || []) {
            const value = available ? choiceFor(available, notePath(lora)) : notePath(lora);
            if (value) wanted.push(value);
            else plan.skipped.push(['noteApplyLoraMissing', { name: modelName(lora.filename) }]);
        }
        const current = plan.chain.map(node => modelWidget(node, ['loras']).value);
        if (wanted.map(slashes).join('|') !== current.map(slashes).join('|')) {
            plan.loras = wanted;
            const list = (values) => values.map(modelName).join('、');
            plan.lines.push(['noteApplyLoras', { from: list(current), to: list(wanted) }]);
        }
    }

    const text = String(note.promptEn || '').trim();
    if (text) {
        const target = positiveBox(graph, selected, loader ? samplersOf(graph, loader) : new Set());
        if (typeof target === 'number') plan.skipped.push([target ? 'noteApplyManyPromptBoxes' : 'noteApplyNoPromptBox']);
        else if (target.box.widget.value !== text) {
            plan.prompt = { ...target, text };
            plan.lines.push(['noteApplyPrompt', { count: text.length }]);
        }
    }
    return plan;
}

function setValue(app, node, widget, value) {
    const before = widget.value;
    const index = node.widgets.indexOf(widget);
    widget.value = value;
    if (Array.isArray(node.widgets_values) && index >= 0) node.widgets_values[index] = value;
    widget.callback?.(value, app.canvas, node);
    node.onWidgetChanged?.(widget.name, value, before, widget);
}

function rebuildChain(plan) {
    const { graph, loader, chain } = plan;
    const last = chain.at(-1) || loader;
    const modelTargets = linksFrom(graph, last, outSlot(last, 'MODEL')).filter(target => !chain.includes(target.node));
    const takesClip = Boolean(globalThis.LiteGraph.registered_node_types?.[plan.loraType]?.nodeData?.input?.required?.clip);
    const path = takesClip && outSlot(loader, 'CLIP') >= 0 ? clipPath(graph, loader, chain) : null;
    const clipTargets = path ? linksFrom(graph, path.end, outSlot(path.end, 'CLIP')).filter(target => !chain.includes(target.node)) : [];
    // A LoRA the note keeps keeps its strengths.
    const kept = new Map(chain.map(node => [slashes(modelWidget(node, ['loras']).value),
        Object.fromEntries((node.widgets || []).map(widget => [widget.name, widget.value]))]));
    const spots = chain.map(node => [...node.pos]);
    const base = spots.at(-1) || [loader.pos[0], loader.pos[1] + (loader.size?.[1] || 100) + 40];
    for (const node of chain) graph.remove(node);

    let model = loader;
    let clip = path ? { node: path.source, slot: path.slot } : null;
    plan.loras.forEach((value, index) => {
        const node = globalThis.LiteGraph.createNode(plan.loraType);
        node.pos = spots[index] || [base[0], base[1] + (index - spots.length + (spots.length ? 1 : 0)) * 130];
        graph.add(node);
        const values = kept.get(slashes(value)) || {};
        for (const widget of node.widgets || []) {
            if (widget === modelWidget(node, ['loras'])) widget.value = value;
            else if (values[widget.name] !== undefined) widget.value = values[widget.name];
        }
        model.connect(outSlot(model, 'MODEL'), node, inSlot(node, 'MODEL'));
        if (clip) clip.node.connect(clip.slot, node, inSlot(node, 'CLIP'));
        model = node;
        if (clip) clip = { node, slot: outSlot(node, 'CLIP') };
    });
    for (const target of modelTargets) model.connect(outSlot(model, 'MODEL'), target.node, target.slot);
    if (clip) for (const target of clipTargets) clip.node.connect(clip.slot, target.node, target.slot);
}

/** Makes the planned changes as one Ctrl+Z step. */
export function applyNotePlan(app, plan) {
    const { graph } = plan;
    graph.beforeChange?.();
    try {
        if (plan.modelTo) setValue(app, plan.loader, plan.widget, plan.modelTo);
        if (plan.loras) rebuildChain(plan);
        if (plan.prompt) setValue(app, plan.prompt.node, plan.prompt.box.widget, plan.prompt.text);
    } finally {
        graph.afterChange?.();
    }
    graph.setDirtyCanvas?.(true, true);
    recordCanvasStep(app);
}
