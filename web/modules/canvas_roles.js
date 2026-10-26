/**
 * Where a ready-made block (api/reference_blocks.py) goes on the canvas: the roles its links name,
 * found on the graph by their sockets, never by title or position. "$sampler" is the sampler
 * (model, positive, negative and latent_image in), "$decode" the node decoding its latent,
 * "$save" the node taking that decode's picture. In a link, ["$decode", 0] is that node's own
 * output and ["$sampler.positive", "*"] whatever feeds that input, a longer path
 * ("$sampler.positive.clip") followed upstream one input at a time; wire_to may be a role too.
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

/** The roles on graph `g`: {sampler, decode, save}; decode and save may be missing. */
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
    const save = decode ? takers(g, decode, picture)[0] || null : null;
    return { sampler, decode, save };
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
        if (!node) throw new Error(`${ref}: no ${name} on the canvas (the sampler's ${name === 'decode' ? 'VAE Decode' : 'Save Image'}). Nothing added.`);
        return node;
    };
    const link = (value) => {
        if (!Array.isArray(value) || typeof value[0] !== 'string' || !value[0].startsWith('$')) return value;
        const [name, ...path] = value[0].slice(1).split('.');
        return path.length ? upstream(g, role(name, value[0]), path, value[0]) : [`#${role(name, value[0]).id}`, value[1]];
    };
    const target = value => (typeof value === 'string' && value.startsWith('$') ? role(value.slice(1), value).id : value);
    return Object.fromEntries(Object.entries(nodes).map(([key, spec]) => [key, {
        ...spec,
        inputs: Object.fromEntries(Object.entries(spec.inputs || {}).map(([name, value]) => [name, link(value)])),
        ...(spec.wire_to == null ? {} : { wire_to: Array.isArray(spec.wire_to) ? spec.wire_to.map(target) : target(spec.wire_to) }),
    }]));
}
