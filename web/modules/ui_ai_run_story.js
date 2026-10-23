/**
 * A run's shape told simply (the run map's "Simple" view, ui_ai_run_map.js): what feeds what, at a
 * glance. One part per sampler, in the order they ran: the model with the LoRAs on it, the prompts
 * (said once: a part with the same ones as the part before says so),
 * where the picture starts (an empty canvas of a size, a picture, or the part before, upscaled or
 * not), and at the end what was done after the last part and where it was saved. Read from the
 * map's boxes and links (api/ai_run_map.py); every name leads to its node on the canvas.
 */

import { translate as t } from './locales.js';
import { icon } from './ui_ai_icons.js';

const HOPS = 8; // how far back a chain is followed

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** The map as lookups: boxes by id, the links into each box. */
function graph(map) {
    const boxes = new Map((map.boxes || []).map(box => [box.id, box]));
    const into = new Map();
    for (const link of map.links || []) {
        if (!into.has(link.to)) into.set(link.to, []);
        into.get(link.to).push(link);
    }
    const from = (id, input) => {
        const link = (into.get(id) || []).find(item => item.input === input);
        return link ? boxes.get(link.from) : null;
    };
    /** Every box upstream of `id`, nearest first (breadth first, at most HOPS away). */
    const upstream = (id) => {
        const seen = new Set([id]);
        const out = [];
        let layer = [id];
        for (let hop = 0; hop < HOPS && layer.length; hop++) {
            const next = [];
            for (const at of layer) {
                for (const link of into.get(at) || []) {
                    if (seen.has(link.from) || !boxes.has(link.from)) continue;
                    seen.add(link.from);
                    out.push(boxes.get(link.from));
                    next.push(link.from);
                }
            }
            layer = next;
        }
        return out;
    };
    return { boxes, into, from, upstream };
}

/** The model a sampler uses: the base model and the LoRAs on the way (the input "model", followed back). */
function modelChain(g, sampler) {
    const loras = [];
    let at = g.from(sampler.id, 'model');
    for (let hop = 0; at && hop < HOPS; hop++) {
        if (at.role === 'model') return { base: at, loras };
        if (at.role === 'lora') loras.unshift(at);
        at = g.from(at.id, 'model') || (g.into.get(at.id) || []).map(link => g.boxes.get(link.from)).find(box => box && ['model', 'lora'].includes(box.role)) || null;
    }
    return { base: null, loras };
}

/** The prompt box behind a sampler's input `input` (through conditioning helpers). */
function promptOf(g, sampler, input) {
    const first = g.from(sampler.id, input);
    if (!first) return null;
    return first.role === 'prompt' ? first : g.upstream(first.id).find(box => box.role === 'prompt') || null;
}

/** A step that makes the picture bigger: an upscale (not its model's loader) or a scale node. */
const resizes = box => !/loader/i.test(box.type || '') && !box.facts?.file && (box.role === 'upscale' || /scale/i.test(box.type || ''));

/** A resize step in words: "upscale with 4x-UltraSharp", "Scale image ×1.5". */
function stepName(g, box) {
    const loader = g.from(box.id, 'upscale_model');
    if (loader?.facts?.file) return t('aiStoryUpscaleWith', { model: loader.facts.file });
    const scale = (box.facts?.values || []).find(([key]) => key === 'scale_by' || key === 'scale');
    return scale ? `${box.title} ×${scale[1]}` : box.title;
}

/** Where a sampler's picture starts: {kind: size | sampler | image, box, via: [resize boxes]}. */
function startOf(g, sampler) {
    const first = g.from(sampler.id, 'latent_image');
    if (!first) return null;
    const chain = [first, ...g.upstream(first.id)];
    const via = [];
    for (const box of chain) {
        if (box.role === 'size' || (box.facts?.width && box.role !== 'sampler' && box.role !== 'upscale')) return { kind: 'size', box, via };
        if (box.role === 'sampler') return { kind: 'sampler', box, via };
        if (box.role === 'image') return { kind: 'image', box, via };
        if (resizes(box)) via.unshift(box);
    }
    return null;
}

/** The samplers in the order they ran (one fed by another comes after it). */
function inOrder(g) {
    const samplers = [...g.boxes.values()].filter(box => box.role === 'sampler');
    const depth = new Map();
    const deep = (box, guard = 0) => {
        if (depth.has(box.id)) return depth.get(box.id);
        const before = guard < HOPS ? g.upstream(box.id).filter(item => item.role === 'sampler') : [];
        const value = before.length ? 1 + Math.max(...before.map(item => deep(item, guard + 1))) : 0;
        depth.set(box.id, value);
        return value;
    };
    return samplers.sort((a, b) => deep(a) - deep(b));
}

function chip(box, words, role, ctx) {
    const node = el('button', `anomalous-ai-story-chip is-${role}`);
    node.type = 'button';
    node.title = t('aiStoryLocate', { title: box.title });
    node.append(el('span', '', words));
    node.onclick = () => ctx.locateNode?.(box.id);
    return node;
}

function line(label, ...parts) {
    const row = el('div', 'anomalous-ai-story-line');
    const what = el('div', 'anomalous-ai-story-what');
    what.append(...parts.filter(Boolean));
    row.append(el('span', 'anomalous-ai-story-label', label), what);
    return row;
}

const name = box => box.facts?.file || box.title;
const size = facts => `${facts.width}×${facts.height}${facts.batch > 1 ? ` ×${facts.batch}` : ''}`;
const plus = () => el('span', 'anomalous-ai-story-plus', '+');

/** The simple view of `map` (ctx: {locateNode(id)}), or null when it has nothing to tell. */
export function runStory(map, ctx) {
    if (!map?.boxes?.length) return null;
    const g = graph(map);
    const samplers = inOrder(g);
    const box = el('div', 'anomalous-ai-story');
    const number = new Map(samplers.map((item, at) => [item.id, at + 1]));
    let before = null; // the part before's model and prompts, to say "same as part N" instead of again
    samplers.forEach((sampler, at) => {
        const part = el('div', 'anomalous-ai-story-part');
        const facts = sampler.facts || {};
        const how = [facts.steps ? t('aiRunSteps', { steps: facts.steps }) : '', facts.cfg !== undefined ? `CFG ${facts.cfg}` : '', facts.sampler_name || '',
            facts.denoise !== undefined && facts.denoise < 1 ? t('aiMapDenoise', { value: facts.denoise }) : ''].filter(Boolean).join(' · ');
        const head = el('div', 'anomalous-ai-story-head');
        head.append(el('span', 'anomalous-ai-story-number', samplers.length > 1 ? t('aiStoryPart', { number: at + 1 }) : t('aiStoryOne')),
            chip(sampler, how || sampler.title, 'sampler', ctx));
        part.append(head);
        const { base, loras } = modelChain(g, sampler);
        const positive = promptOf(g, sampler, 'positive');
        const negative = promptOf(g, sampler, 'negative');
        const modelKey = [base?.id, ...loras.map(item => item.id)].join(' ');
        const promptKey = `${positive?.id} ${negative?.id}`;
        const same = key => before && before[key] === (key === 'model' ? modelKey : promptKey);
        if (same('model')) {
            part.append(line(t('aiStoryModel'), el('span', 'anomalous-ai-story-none', t('aiStorySame', { number: before.number }))));
        } else if (base || loras.length) {
            const parts = [base ? chip(base, name(base), 'model', ctx) : el('span', 'anomalous-ai-story-none', t('aiStoryNoModel'))];
            for (const lora of loras) parts.push(plus(), chip(lora, `${name(lora)}${Number.isFinite(lora.facts?.strength) ? ` ${lora.facts.strength}` : ''}`, 'lora', ctx));
            part.append(line(t('aiStoryModel'), ...parts));
        }
        if (same('prompt') && (positive || negative)) {
            part.append(line(t('aiStoryPrompts'), el('span', 'anomalous-ai-story-none', t('aiStorySame', { number: before.number }))));
        } else {
            if (positive) part.append(line(t('aiMapPositive'), chip(positive, positive.facts?.text || positive.title, 'prompt', ctx)));
            if (negative) part.append(line(t('aiMapNegative'), chip(negative, negative.facts?.text || negative.title, 'negative', ctx)));
        }
        const start = startOf(g, sampler);
        if (start) {
            const parts = start.kind === 'size' ? [chip(start.box, t('aiStoryEmpty', { size: size(start.box.facts) }), 'size', ctx)]
                : start.kind === 'image' ? [chip(start.box, name(start.box), 'image', ctx)]
                    : [chip(start.box, t('aiStoryAfter', { number: number.get(start.box.id) || '?' }), 'sampler', ctx)];
            for (const step of start.via) parts.push(el('span', 'anomalous-ai-story-arrow', '→'), chip(step, stepName(g, step), 'upscale', ctx));
            part.append(line(t('aiStoryFrom'), ...parts));
        }
        before = { model: modelKey, prompt: promptKey, number: at + 1 };
        box.append(part);
        if (at < samplers.length - 1) box.append(el('div', 'anomalous-ai-story-down', '↓'));
    });
    // The end: what happens after the last part, and where it is saved.
    const saves = [...g.boxes.values()].filter(item => item.role === 'save');
    if (saves.length) {
        const end = el('div', 'anomalous-ai-story-part is-end');
        for (const save of saves) {
            const after = g.upstream(save.id);
            const stop = after.findIndex(item => item.role === 'sampler');
            const of = saves.length > 1 && stop >= 0 ? number.get(after[stop].id) : null;
            const steps = (stop >= 0 ? after.slice(0, stop) : after).filter(resizes).reverse();
            const parts = [];
            for (const step of steps) parts.push(chip(step, stepName(g, step), 'upscale', ctx), el('span', 'anomalous-ai-story-arrow', '→'));
            parts.push(chip(save, save.facts?.prefix ? t('aiStorySaved', { prefix: save.facts.prefix }) : save.title, 'save', ctx));
            end.append(line(of ? t('aiStoryAfterPart', { number: of }) : t('aiStoryEnd'), ...parts));
        }
        if (samplers.length) box.append(el('div', 'anomalous-ai-story-down', '↓'));
        box.append(end);
    }
    if (!samplers.length && !saves.length) return null;
    const hint = el('div', 'anomalous-ai-story-hint');
    hint.append(icon('target', 12), el('span', '', t('aiStoryHint')));
    box.append(hint);
    return box;
}
