/**
 * The canvas in brief for an AI, so a small model need not hold the whole graph in mind:
 * bounded flow chains and node lines (id, type, what feeds each input), the inputs a run
 * needs that nothing feeds yet with the outputs on the canvas that fit them (`unwired`), and the
 * errors ComfyUI gave for the last run it refused. get_situation reads it (mcp_bridge.js
 * describe_canvas with brief), and every change of the AI's answers with what is still unwired
 * (mcp_canvas_edit.js). Kept short: Antigravity files away answers past about 4,000 characters.
 * Pure: the graph and ComfyUI's errors come in.
 */

import { typesFit } from './canvas_build.js';

const MAX_LINES = 8;
const MAX_UNWIRED = 8;
const MAX_FITS = 3;
const MAX_ERRORS = 6;
const LINE_CHARS = 140;

export const linkOf = (g, id) => g.getLink?.(id) ?? g.links?.get?.(id) ?? g.links?.[id] ?? null;
export const sockets = node => (node.inputs || []).filter(input => !input.widget);
const off = node => node.mode === 2 || node.mode === 4; // muted or bypassed: not run as it is

/** Whether `node` is fed, through any number of nodes, by node `id`. */
export function fedBy(g, node, id, seen = new Set()) {
    for (const input of node.inputs || []) {
        const origin = input.link != null ? linkOf(g, input.link)?.origin_id : null;
        if (origin == null || seen.has(String(origin))) continue;
        if (String(origin) === String(id)) return true;
        seen.add(String(origin));
        const upstream = g.getNodeById?.(origin);
        if (upstream && fedBy(g, upstream, id, seen)) return true;
    }
    return false;
}

/** Whether a run needs input `input` of `node` fed (ComfyUI's required inputs; a node it has no data on: no). */
function needed(node, input) {
    const required = node.constructor?.nodeData?.input?.required;
    return Boolean(required && Object.prototype.hasOwnProperty.call(required, input.name));
}

function line(g, node) {
    const title = node.title && node.title !== node.type ? ` "${String(node.title).slice(0, 30)}"` : '';
    const state = node.mode === 4 ? ' [bypassed]' : node.mode === 2 ? ' [muted]' : '';
    const fed = sockets(node).map((input) => {
        if (input.link == null) return needed(node, input) ? `${input.name}←?${input.type}` : null;
        return `${input.name}←#${linkOf(g, input.link)?.origin_id ?? '?'}`;
    }).filter(Boolean);
    const gives = [...new Set((node.outputs || []).map(output => String(output.type)))];
    const text = `#${node.id} ${node.type}${title}${state}${fed.length ? ` | ${fed.join(' ')}` : ''}${gives.length ? ` | gives ${gives.join(',')}` : ''}`;
    return text.length > LINE_CHARS ? `${text.slice(0, LINE_CHARS - 1)}…` : text;
}

/** The inputs a run needs that nothing feeds, each with up to three outputs on the canvas that fit (none that would make a loop). */
export function unwired(g, limit = MAX_UNWIRED) {
    const nodes = g._nodes || [];
    const out = [];
    let total = 0;
    for (const node of nodes) {
        if (off(node)) continue;
        for (const input of sockets(node)) {
            if (input.link != null || !needed(node, input)) continue;
            total += 1;
            if (out.length >= limit) continue;
            const fits = [];
            for (const other of nodes) {
                if (other === node || off(other) || fits.length >= MAX_FITS || fedBy(g, other, node.id)) continue;
                const slot = (other.outputs || []).findIndex(output => typesFit(output.type, input.type));
                if (slot >= 0) fits.push(`#${other.id} ${other.outputs[slot].name}`);
            }
            out.push({ node: node.id, input: input.name, type: String(input.type), ...(fits.length ? { fits } : {}) });
        }
    }
    return { unwired: out, ...(total > out.length ? { more_unwired: total - out.length } : {}) };
}

/** ComfyUI's errors for the last run it refused (app.lastNodeErrors), a line each. */
function errorsOf(nodeErrors) {
    return Object.entries(nodeErrors || {}).flatMap(([id, item]) => (item?.errors || []).map(error => ({
        node: Number(id) || id, error: [error.message, error.details].filter(Boolean).join(': ').slice(0, 160),
    }))).slice(0, MAX_ERRORS);
}

/** The canvas in brief: `{node_count, chains, lines, unwired, errors}` and omitted counts. */
export function canvasBrief(g, nodeErrors = null) {
    const nodes = g._nodes || [];
    const errors = errorsOf(nodeErrors);
    return {
        node_count: nodes.length,
        ...flowChains(g),
        lines: nodes.slice(0, MAX_LINES).map(node => line(g, node)),
        ...(nodes.length > MAX_LINES ? { more_nodes: nodes.length - MAX_LINES } : {}),
        ...unwired(g),
        ...(errors.length ? { errors } : {}),
    };
}

/** Collapse unbranched paths within a flow (IMAGE/LATENT share the picture flow).
 * Auxiliary VAE/MASK inputs don't split the picture spine; positive/negative stay named.
 * Walk each edge once, never enumerate all paths through a branching graph. */
export function flowChains(g) {
    const edges = [], incoming = new Map(), outgoing = new Map();
    const family = type => ['IMAGE', 'LATENT'].includes(type) ? 'picture' : type;
    const bucket = (index, node, kind) => index.get(node)?.get(kind) || [];
    function put(index, node, edge) {
        if (!index.has(node)) index.set(node, new Map());
        if (!index.get(node).has(edge.family)) index.get(node).set(edge.family, []);
        index.get(node).get(edge.family).push(edge);
    }
    for (const to of g._nodes || []) {
        if (off(to)) continue;
        for (const input of to.inputs || []) {
            const link = input.link != null && linkOf(g, input.link);
            const from = link && g.getNodeById(link.origin_id);
            if (!from || off(from)) continue;
            const edge = { from, to, type: String(input.type), input: input.name, family: family(String(input.type)) };
            edges.push(edge);
            put(outgoing, from, edge);
            put(incoming, to, edge);
        }
    }
    const seen = new Set(), chains = [];
    const name = n => `#${n.id} ${String(n.type).slice(0, 32)}`;
    function walk(first) {
        if (seen.has(first)) return;
        let edge = first, text = name(first.from);
        while (edge && !seen.has(edge)) {
            seen.add(edge);
            text += ` --${edge.type}:${edge.input}--> ${name(edge.to)}`;
            const next = bucket(outgoing, edge.to, edge.family);
            edge = bucket(incoming, edge.to, edge.family).length === 1 && next.length === 1 ? next[0] : null;
        }
        chains.push(text.length > 240 ? text.slice(0, 239) + '…' : text);
    }
    const priority = ['picture', 'MODEL', 'CONDITIONING', 'CLIP', 'VAE', 'MASK'];
    const rank = edge => { const n = priority.indexOf(edge.family); return n < 0 ? priority.length : n; };
    edges.sort((a, b) => rank(a) - rank(b));
    for (const edge of edges) {
        if (bucket(incoming, edge.from, edge.family).length !== 1 || bucket(outgoing, edge.from, edge.family).length !== 1) walk(edge);
    }
    edges.forEach(walk);
    return { chains: chains.slice(0, 6), ...(chains.length > 6 ? { more_chains: chains.length - 6 } : {}) };
}
