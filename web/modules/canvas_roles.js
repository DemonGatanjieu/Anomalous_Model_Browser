/**
 * Where a ready-made block (api/reference_blocks.py) goes on the canvas: the roles its links name,
 * found on the graph by their sockets, never by title or position. "$sampler" is the sampler
 * (model, positive, negative and latent_image in), "$decode" the node decoding its latent,
 * "$save" the output node that decode's picture reaches (past a stitch put in between). In a link,
 * ["$decode", 0] is that node's own output and ["$sampler.positive", "*"] whatever feeds that
 * input, a longer path ("$sampler.positive.clip") followed upstream one input at a time; wire_to
 * may be a role too. A node of the block "like" a role takes that node's settings of the same
 * name (a second sampler with the first one's steps and cfg); one that "replaces" a role also
 * takes its links in and out, and the old node goes (LanPaint's sampler in the KSampler's place).
 * "$loader" is the node the sampler's model comes from, past its LoRAs (a second model loader "like" it).
 * Several samplers: near_node_id names the one, else nothing changes and they are listed.
 */

import { linkOf } from './mcp_canvas_brief.js';

const SAMPLER_INPUTS = ['model', 'positive', 'negative', 'latent_image'];
const OFF = new Set([2, 4]); // muted, bypassed

const upper = type => String(type ?? '').toUpperCase();
const inputNamed = (node, name) => (node?.inputs || []).find(item => String(item.name).toLowerCase() === name.toLowerCase());
const label = node => `#${node.id} ${node.title || node.type}`;

function takers(g, node, slot) {
    return ((node.outputs || [])[slot]?.links || []).map(id => linkOf(g, id)).filter(Boolean)
        .map(link => g.getNodeById(link.target_id)).filter(item => item && !OFF.has(item.mode));
}

const isOutput = node => node.constructor?.nodeData?.output_node || !(node.outputs || []).length;

/** The output node the picture at `node`'s `slot` reaches, through nodes passing a picture on. */
function outputOf(g, node, slot, seen = new Set()) {
    for (const next of takers(g, node, slot)) {
        if (seen.has(next)) continue;
        seen.add(next);
        if (isOutput(next)) return next;
        const picture = (next.outputs || []).findIndex(item => upper(item.type) === 'IMAGE');
        const found = picture < 0 ? null : outputOf(g, next, picture, seen);
        if (found) return found;
    }
    return null;
}

/** A node's settings by name ({steps: 30, cfg: 5}), buttons left out. */
function settingsOf(node) {
    return Object.fromEntries((node.widgets || []).filter(item => item?.name && item.type !== 'button').map(item => [item.name, item.value]));
}

/** The node `node`'s model comes from, through the nodes passing a MODEL on (LoRAs): the loader. */
function loaderOf(g, node) {
    let at = node;
    for (let hop = 0; hop < 30; hop++) {
        const id = inputNamed(at, 'model')?.link;
        const link = id == null ? null : linkOf(g, id);
        const from = link && g.getNodeById(link.origin_id);
        if (!from) break;
        at = from;
    }
    return at === node ? null : at;
}

/** The roles on graph `g`: {sampler, decode, save, loader}; decode, save and loader may be missing. */
export function findRoles(g, nearId = null) {
    const samplers = (g._nodes || []).filter(node => !OFF.has(node.mode) && SAMPLER_INPUTS.every(name => inputNamed(node, name)));
    let sampler = nearId == null ? null : samplers.find(node => String(node.id) === String(nearId));
    if (!sampler) {
        if (samplers.length !== 1) {
            throw new Error(samplers.length
                ? `Several samplers on the canvas (${samplers.map(label).join(', ')}): near_node_id names the one this block goes with. Nothing added.`
                : 'No sampler (KSampler) on the canvas: open a workflow that makes the picture first (open_workflow). Nothing added.');
        }
        [sampler] = samplers;
    }
    const latent = (sampler.outputs || []).findIndex(item => upper(item.type) === 'LATENT');
    const decode = takers(g, sampler, latent).find(node => inputNamed(node, 'samples')
        && (node.outputs || []).some(item => upper(item.type) === 'IMAGE')) || null;
    const picture = decode ? decode.outputs.findIndex(item => upper(item.type) === 'IMAGE') : -1;
    const save = decode ? outputOf(g, decode, picture) || takers(g, decode, picture)[0] || null : null;
    return { sampler, decode, save, loader: loaderOf(g, sampler) };
}

function upstream(g, node, path, ref) {
    let at = node, slot = null;
    for (const name of path) {
        const id = inputNamed(at, name)?.link;
        const link = id == null ? null : linkOf(g, id);
        if (!link) throw new Error(`${ref}: nothing is wired into ${label(at)}'s ${name}. Nothing added.`);
        at = g.getNodeById(link.origin_id);
        slot = link.origin_slot;
    }
    return [`#${at.id}`, slot];
}

/** Group `nodes` (add_nodes' API form) with its roles resolved on graph `g`; a group naming none comes back as it is. */
export function placeRoles(g, nodes, nearId = null) {
    if (!JSON.stringify(nodes).includes('"$')) return nodes;
    const roles = findRoles(g, nearId);
    const role = (name, ref) => {
        const node = roles[name];
        const what = { decode: 'VAE Decode', save: 'Save Image', loader: 'model loader' }[name] || name;
        if (!node) throw new Error(`${ref}: no ${name} on the canvas (the sampler's ${what}). Nothing added.`);
        return node;
    };
    const link = (value) => {
        if (!Array.isArray(value) || typeof value[0] !== 'string' || !value[0].startsWith('$')) return value;
        const [name, ...path] = value[0].slice(1).split('.');
        return path.length ? upstream(g, role(name, value[0]), path, value[0]) : [`#${role(name, value[0]).id}`, value[1]];
    };
    const target = value => (typeof value === 'string' && value.startsWith('$') ? role(value.slice(1), value).id : value);
    // "like" a path ("$sampler.positive"): the node feeding it (a second prompt with the first one's text).
    const nodeAt = (ref) => {
        const [name, ...path] = ref.slice(1).split('.');
        return path.length ? g.getNodeById(Number(upstream(g, role(name, ref), path, ref)[0].slice(1))) : role(name, ref);
    };
    const gone = new Set(Object.values(nodes).filter(spec => spec.replaces).map(spec => role(spec.replaces.slice(1), spec.replaces)));
    return Object.fromEntries(Object.entries(nodes).map(([key, { like, replaces, ...spec }]) => {
        const inputs = Object.fromEntries(Object.entries(spec.inputs || {}).map(([name, value]) => [name, link(value)]));
        const placed = { ...spec, inputs,
            ...(spec.wire_to == null ? {} : { wire_to: Array.isArray(spec.wire_to) ? spec.wire_to.map(target) : target(spec.wire_to) }) };
        const model = like || replaces ? nodeAt(like || replaces) : null;
        if (model) placed.carry = settingsOf(model);
        if (replaces) Object.assign(placed, takenOver(g, model, inputs, gone));
        return [key, placed];
    }));
}

/** What a node replacing `old` takes from it: the links into it the block does not give (`kept`,
 * wired where the new node has that input), where its outputs went (`feeds`), and its id to remove. */
function takenOver(g, old, inputs, gone) {
    const kept = {}, feeds = [];
    for (const input of old.inputs || []) {
        const link = input.link == null ? null : linkOf(g, input.link);
        const from = link && g.getNodeById(link.origin_id);
        if (from && !gone.has(from) && !Object.keys(inputs).some(name => name.toLowerCase() === String(input.name).toLowerCase())) {
            kept[input.name] = [`#${from.id}`, link.origin_slot];
        }
    }
    (old.outputs || []).forEach((output, slot) => (output.links || []).map(id => linkOf(g, id)).filter(Boolean).forEach(link => {
        const to = g.getNodeById(link.target_id);
        if (to && !gone.has(to)) feeds.push({ output: output.name, to: to.id, input: to.inputs[link.target_slot].name });
    }));
    return { kept, feeds, replaces: old.id };
}
