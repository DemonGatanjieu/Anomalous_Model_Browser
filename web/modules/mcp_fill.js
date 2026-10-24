/**
 * run_workflow's blanks on the canvas (api/mcp_fill.py), as a plan mcp_canvas_edit.js applies:
 * the positive and negative prompt boxes (prompt_boxes.js), every sampler's seed, the empty
 * latent's width and height, the picture a LoadImage reads. Checked before anything changes: a
 * blank asked for with nothing on the canvas to take it stops it all, and so do several
 * LoadImage nodes without image_node. Muted and bypassed nodes are left alone. Pure: the graph
 * comes in.
 */

import { valuePlan } from './canvas_build.js';
import { promptBoxes } from './prompt_boxes.js';

const SEEDS = ['seed', 'noise_seed'];
const off = node => node.mode === 2 || node.mode === 4;
const has = (node, name) => (node.widgets || []).some(widget => widget?.name === name);
const label = node => `#${node.id}${node.title && node.title !== node.type ? ` "${node.title}"` : ''}`;

/** `{plans: [{node, plan: [[widget, value]]}], set: {blank: [node ids]}}` for what `wanted` fills in. */
export function fillPlan(g, { prompt, negative, seed, width, height, image, image_node: imageNode } = {}) {
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
        for (const node of nodes) add(blank, node, promptBoxes(node).filter(box => box.role === role).map(box => [box.widget, String(text)]));
        if (!set[blank]) throw new Error(`No ${role} prompt box on the canvas; set_prompt with node_id, or set_values.`);
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
    return { plans, set };
}
