/**
 * run_workflow's blanks on the canvas (api/mcp_fill.py), as a plan mcp_canvas_edit.js applies:
 * the positive and negative prompt boxes (prompt_boxes.js), every sampler's seed, the empty
 * latent's width and height, the picture a LoadImage reads, and any other setting by its name
 * (`values`, also set_values without a node: valuesPlan). Checked before anything changes: a
 * blank asked for with nothing on the canvas to take it stops it all, and so do several
 * LoadImage nodes without image_node, two prompt nodes into one sampler, or a setting name
 * several nodes have. Muted and bypassed nodes are left alone. Pure: the graph comes in.
 */

import { valuePlan } from './canvas_build.js';
import { promptBoxes, wiredRole } from './prompt_boxes.js';

const SEEDS = ['seed', 'noise_seed'];
const off = node => node.mode === 2 || node.mode === 4;
const has = (node, name) => (node.widgets || []).some(widget => widget?.name === name);
const label = node => `#${node.id}${node.title && node.title !== node.type ? ` "${node.title}"` : ''}`;

/**
 * Settings for whichever node has them, a third party's as well as ComfyUI's: {name: value} goes to
 * the one active node with a setting of that name, {node id: {name: value}} to that node. A name
 * several nodes have (two samplers' denoise) stops it, naming them: which one is the AI's to say.
 */
export function valuesPlan(g, values) {
    const wanted = new Map();
    const put = (node, name, value) => {
        const settings = wanted.get(node) || {};
        if (name in settings) throw new Error(`${name} of ${label(node)} is given twice.`);
        wanted.set(node, { ...settings, [name]: value });
    };
    for (const [key, value] of Object.entries(values || {})) {
        if (/^\d+$/.test(key)) {
            const node = (g._nodes || []).find(item => String(item.id) === key);
            if (!node) throw new Error(`No node ${key} on the canvas; get_situation lists them.`);
            for (const [name, setting] of Object.entries(value || {})) put(node, name, setting);
            continue;
        }
        const holders = (g._nodes || []).filter(node => !off(node) && has(node, key));
        if (!holders.length) throw new Error(`No node on the canvas has a setting ${key}.`);
        if (holders.length > 1) {
            throw new Error(`${key} is a setting of ${holders.slice(0, 6).map(label).join(', ')}: give the one to change as {"<node id>": {"${key}": …}}. Nothing changed.`);
        }
        put(holders[0], key, value);
    }
    return [...wanted].map(([node, settings]) => ({ node, plan: valuePlan(node, settings) }));
}

/** `{plans: [{node, plan: [[widget, value]]}], set: {blank: [node ids]}}` for what `wanted` fills in. */
export function fillPlan(g, { prompt, negative, seed, width, height, image, image_node: imageNode, values } = {}) {
    const nodes = (g._nodes || []).filter(node => !off(node));
    const plans = [];
    const set = {};
    const add = (blank, node, plan) => {
        if (!plan.length) return;
        plans.push({ node, plan });
        (set[blank] ||= []).push(node.id);
    };
    for (const [blank, text, role] of [['prompt', prompt, 'positive'], ['negative', negative, 'negative']]) {
        if (text == null) continue;
        const boxes = nodes.map(node => [node, promptBoxes(node).filter(box => box.role === role)]).filter(([, found]) => found.length);
        if (!boxes.length) throw new Error(`No ${role} prompt box on the canvas; set_prompt with node_id, or set_values.`);
        // Prompt nodes combined into one sampler (regional prompts) each say something else: not one text for all.
        const into = new Map();
        for (const [node] of boxes) for (const sampler of wiredRole(node).samplers) into.set(sampler, [...(into.get(sampler) || []), node]);
        const shared = [...into.values()].find(list => list.length > 1);
        if (shared) {
            throw new Error(`Several ${role} prompt boxes feed one sampler (${shared.map(label).join(', ')}): set each with values {"<node id>": {"<box name>": "…"}}. Nothing changed.`);
        }
        for (const [node, found] of boxes) add(blank, node, found.map(box => [box.widget, String(text)]));
    }
    if (seed != null) {
        for (const node of nodes) {
            const names = SEEDS.filter(name => has(node, name));
            if (names.length) add('seed', node, valuePlan(node, Object.fromEntries(names.map(name => [name, seed]))));
        }
        if (!set.seed) throw new Error('No sampler with a seed on the canvas.');
    }
    if (width != null || height != null) {
        const size = Object.fromEntries([['width', width], ['height', height]].filter(([, value]) => value != null));
        for (const node of nodes) {
            // A node that starts a latent: a hires fix's latent upscale takes one in and keeps its own size.
            const starts = (node.outputs || []).some(output => String(output.type) === 'LATENT')
                && !(node.inputs || []).some(input => String(input.type) === 'LATENT');
            if (starts && has(node, 'width') && has(node, 'height')) add('size', node, valuePlan(node, size));
        }
        if (!set.size) throw new Error('No empty latent with a width and height on the canvas; set_values on the node that sets the size.');
    }
    if (image != null) {
        const loaders = nodes.filter(node => /LoadImage/.test(node.type) && has(node, 'image'));
        const picked = imageNode != null ? loaders.filter(node => String(node.id) === String(imageNode)) : loaders;
        if (!picked.length) throw new Error(imageNode != null ? `Node ${imageNode} is no LoadImage on the canvas.` : 'No LoadImage on the canvas to take image.');
        if (picked.length > 1) throw new Error(`Several LoadImage nodes (${picked.map(label).join(', ')}): give image_node, the one to fill.`);
        add('image', picked[0], [[picked[0].widgets.find(widget => widget.name === 'image'), String(image)]]); // any picture: ComfyUI checks the file
    }
    if (values) for (const { node, plan } of valuesPlan(g, values)) add('values', node, plan);
    const widgets = plans.flatMap(({ plan }) => plan.map(([widget]) => widget));
    const twice = widgets.find((widget, at) => widgets.indexOf(widget) !== at);
    if (twice) throw new Error(`${twice.name} is set by a blank and by values; give it once.`);
    return { plans, set };
}
