/**
 * Workflow share codes (分享码): one workflow as a short text for a chat or a comment. No DOM;
 * the dialog is ui_share.js.
 *
 * AMB2 keeps a workflow's lean form: each node's id, type, widget values and position (to
 * 10 px), and only what differs from a fresh node of its type (title, mode, colours, size,
 * collapse, properties; its inputs and outputs when they are not a fresh node's, or always for a
 * node pack's node, so the links survive on a computer still lacking the pack), the links by
 * slot, the groups, and the plugin's model fingerprints and links. It is compressed (deflate)
 * and written as Chinese characters, 14 bits each ("汉字码"), or as base64url ("字母码").
 * Encoding rebuilds the workflow from the lean form at once and compares; when anything differs
 * (subgraphs, native reroutes, an unusual node) the code holds the whole workflow instead.
 * AMB0 (the whole workflow) and AMB1 (without positions) codes still open.
 */

export const PREFIX = 'AMB2-';
const CJK_START = 0x4e00; // 16384 characters from here: U+4E00..U+8DFF, 14 bits each
const CJK_BITS = 14;
const GRID = 10; // positions and sizes are kept to this many pixels
const MAX_UNPACKED = 32 * 1024 * 1024;
const SEARCH_NAME = 'Node name for S&R';

// ---------- bytes ----------

async function deflate(text) {
    const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const parts = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_UNPACKED) throw new Error('The code unpacks to more than a workflow can be.');
        parts.push(value);
    }
    return new TextDecoder().decode(await new Blob(parts).arrayBuffer());
}

export function toLetters(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromLetters(text) {
    const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

/** Bytes as Chinese characters, 14 bits each. A first byte says whether the last decoded byte is padding. */
export function toHanzi(bytes) {
    const total = bytes.length + 1;
    const count = Math.ceil((total * 8) / CJK_BITS);
    const padding = Math.floor((count * CJK_BITS) / 8) - total; // 0 or 1
    const data = new Uint8Array(total + padding);
    data[0] = padding;
    data.set(bytes, 1);
    let out = '';
    let buffer = 0;
    let bits = 0;
    for (const byte of data) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= CJK_BITS) {
            bits -= CJK_BITS;
            out += String.fromCharCode(CJK_START + ((buffer >> bits) & 0x3fff));
        }
        buffer &= (1 << bits) - 1;
    }
    if (bits) out += String.fromCharCode(CJK_START + ((buffer << (CJK_BITS - bits)) & 0x3fff));
    return out;
}

export function fromHanzi(text) {
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (const char of text) {
        const value = char.codePointAt(0) - CJK_START;
        if (value < 0 || value > 0x3fff) throw new Error('The code has a character that is not part of it.');
        buffer = (buffer << CJK_BITS) | value;
        bits += CJK_BITS;
        while (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
        }
        buffer &= (1 << bits) - 1;
    }
    const padding = bytes[0];
    if (padding !== 0 && padding !== 1) throw new Error('The code is damaged.');
    return Uint8Array.from(bytes.slice(1, bytes.length - padding));
}

// ---------- the lean form ----------

const grid = (value) => Math.round((Number(value) || 0) / GRID);
const ports = (list, linkKey) => (list || []).map((port) => {
    const copy = { ...port };
    delete copy[linkKey];
    delete copy.slot_index;
    delete copy.localized_name;
    return copy;
});
const sameShape = (a, b) => a.length === b.length && a.every((port, index) => port.name === b[index]?.name
    && String(port.type) === String(b[index]?.type) && (port.widget?.name || '') === (b[index]?.widget?.name || '') && !port.label);

/** Why a workflow cannot be shared in its lean form ('' when it can). */
function leanBlocker(workflow) {
    if (workflow.definitions?.subgraphs?.length) return 'subgraph';
    if (workflow.extra?.reroutes?.length || workflow.extra?.linkExtensions?.length) return 'reroute';
    if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.links)) return 'shape';
    return '';
}

/**
 * The lean form of a workflow. `templateOf(type)`: a fresh node's { inputs, outputs, size } (null
 * when the type is not installed); `isCore(type)`: whether the type comes with ComfyUI.
 */
export function leanWorkflow(workflow, { templateOf, isCore }) {
    const nodes = workflow.nodes.map((node) => {
        const template = templateOf(node.type);
        const extra = {};
        if (node.title !== undefined) extra.t = node.title;
        if (node.mode) extra.m = node.mode;
        if (node.color) extra.c = node.color;
        if (node.bgcolor) extra.b = node.bgcolor;
        if (node.flags && Object.keys(node.flags).length) extra.f = node.flags;
        const size = Array.isArray(node.size) ? node.size : null;
        if (size && (!template?.size || Math.abs(size[0] - template.size[0]) > GRID || Math.abs(size[1] - template.size[1]) > GRID)) {
            extra.s = [grid(size[0]), grid(size[1])];
        }
        const properties = { ...(node.properties || {}) };
        if (properties[SEARCH_NAME] === node.type) delete properties[SEARCH_NAME];
        if (Object.keys(properties).length) extra.p = properties;
        const inputs = ports(node.inputs, 'link');
        const outputs = ports(node.outputs, 'links');
        const keepPorts = !template || !isCore(node.type);
        if (keepPorts || !sameShape(inputs, ports(template.inputs, 'link'))) extra.i = inputs;
        if (keepPorts || !sameShape(outputs, ports(template.outputs, 'links'))) extra.o = outputs;
        const pos = Array.isArray(node.pos) ? [grid(node.pos[0]), grid(node.pos[1])] : [0, 0];
        const item = [node.id, node.type, node.widgets_values ?? [], pos];
        if (Object.keys(extra).length) item.push(extra);
        return item;
    });
    const links = workflow.links.filter(Boolean).map(link => [link[1], link[2], link[3], link[4], link[5]]);
    const lean = { n: nodes, l: links };
    const groups = (workflow.groups || []).map(group => [group.title || '', (group.bounding || []).map(grid), group.color || '', group.font_size || 0]);
    if (groups.length) lean.g = groups;
    const extra = Object.fromEntries(Object.entries(workflow.extra || {}).filter(([key]) => key.startsWith('anomalous')));
    if (Object.keys(extra).length) lean.x = extra;
    return lean;
}

/** The workflow a lean form stands for, ready for ComfyUI to load. */
export function rebuildWorkflow(lean, { templateOf }) {
    const nodes = lean.n.map(([id, type, widgets, pos, extra = {}], order) => {
        const template = templateOf(type) || { inputs: [], outputs: [], size: null };
        const node = {
            id, type, pos: [pos[0] * GRID, pos[1] * GRID],
            size: extra.s ? [extra.s[0] * GRID, extra.s[1] * GRID] : (template.size ? [...template.size] : [300, 100]),
            flags: extra.f || {}, order, mode: extra.m || 0,
            inputs: (extra.i || ports(template.inputs, 'link')).map(port => ({ ...port, link: null })),
            outputs: (extra.o || ports(template.outputs, 'links')).map(port => ({ ...port, links: [] })),
            properties: { [SEARCH_NAME]: type, ...(extra.p || {}) },
            widgets_values: widgets,
        };
        if (extra.t !== undefined) node.title = extra.t;
        if (extra.c) node.color = extra.c;
        if (extra.b) node.bgcolor = extra.b;
        return node;
    });
    const byId = new Map(nodes.map(node => [node.id, node]));
    const links = lean.l.map(([from, fromSlot, to, toSlot, type], index) => {
        const id = index + 1;
        const origin = byId.get(from)?.outputs[fromSlot];
        const target = byId.get(to)?.inputs[toSlot];
        if (origin) origin.links.push(id);
        if (target) target.link = id;
        return [id, from, fromSlot, to, toSlot, type];
    });
    for (const node of nodes) for (const output of node.outputs) if (!output.links.length) output.links = null;
    return {
        last_node_id: Math.max(0, ...nodes.map(node => Number(node.id) || 0)),
        last_link_id: links.length,
        nodes, links,
        groups: (lean.g || []).map(([title, bounding, color, size]) => ({
            title, bounding: bounding.map(value => value * GRID), ...(color ? { color } : {}), ...(size ? { font_size: size } : {}),
        })),
        config: {},
        extra: { ...(lean.x || {}) },
        version: 0.4,
    };
}

/** Whether the rebuilt workflow is the shared one in all that matters (positions are rounded). */
export function sameWorkflow(original, rebuilt) {
    const key = (link) => link && `${link[1]}:${link[2]}>${link[3]}:${link[4]}`;
    const linksA = new Set(original.links.filter(Boolean).map(key));
    const linksB = new Set(rebuilt.links.map(key));
    if (linksA.size !== linksB.size || [...linksA].some(link => !linksB.has(link))) return false;
    const names = (list) => JSON.stringify((list || []).map(port => [port.name, String(port.type), port.widget?.name || '', port.label || '']));
    const rebuiltNodes = new Map(rebuilt.nodes.map(node => [node.id, node]));
    return original.nodes.length === rebuilt.nodes.length && original.nodes.every((node) => {
        const other = rebuiltNodes.get(node.id);
        return other && other.type === node.type && JSON.stringify(node.widgets_values ?? []) === JSON.stringify(other.widgets_values ?? [])
            && (node.mode || 0) === (other.mode || 0) && node.title === other.title
            && names(node.inputs) === names(other.inputs) && names(node.outputs) === names(other.outputs);
    });
}

// ---------- codes ----------

/** { hanzi, letters, whole, chars }: the two spellings of one code, and whether it holds the whole workflow. */
export async function encodeShareCode(workflow, helpers) {
    let payload = null;
    if (!leanBlocker(workflow)) {
        const lean = leanWorkflow(workflow, helpers);
        if (sameWorkflow(workflow, rebuildWorkflow(lean, helpers))) payload = { v: 2, ...lean };
    }
    const whole = !payload;
    if (whole) {
        const copy = JSON.parse(JSON.stringify(workflow));
        if (copy.extra) delete copy.extra.ds;
        payload = { v: 2, w: copy };
    }
    const bytes = await deflate(JSON.stringify(payload));
    return { hanzi: PREFIX + toHanzi(bytes), letters: PREFIX + toLetters(bytes), whole };
}

/** The workflow a code holds; AMB0 and AMB1 codes too. Spaces and line breaks a chat added are ignored. */
export async function decodeShareCode(code, helpers) {
    const text = String(code || '').replace(/[\s​-‍﻿]/g, '');
    if (text.startsWith(PREFIX)) {
        const body = text.slice(PREFIX.length);
        const first = body.codePointAt(0) || 0;
        const bytes = first >= CJK_START ? fromHanzi(body) : fromLetters(body);
        const payload = JSON.parse(await inflate(bytes));
        if (payload.w) return payload.w;
        if (!Array.isArray(payload.n) || !Array.isArray(payload.l)) throw new Error('The code holds no workflow.');
        return rebuildWorkflow(payload, helpers);
    }
    if (text.startsWith('AMB0-') || text.startsWith('AMB1-')) {
        const binary = atob(text.slice(5));
        const workflow = JSON.parse(await inflate(Uint8Array.from(binary, char => char.charCodeAt(0))));
        return text.startsWith('AMB1-') ? layOut(workflow) : workflow;
    }
    throw new Error('This is not a share code (they start with AMB2-, AMB1- or AMB0-).');
}

/** AMB1 codes carry no positions: columns by link depth. */
function layOut(workflow) {
    const nodes = workflow.nodes || [];
    const depth = new Map(nodes.map(node => [node.id, 0]));
    for (let pass = 0; pass < nodes.length; pass += 1) {
        let moved = false;
        for (const link of workflow.links || []) {
            if (!link || !depth.has(link[1]) || !depth.has(link[3])) continue;
            const next = depth.get(link[1]) + 1;
            if (next > depth.get(link[3])) {
                depth.set(link[3], next);
                moved = true;
            }
        }
        if (!moved) break;
    }
    const rows = new Map();
    for (const node of nodes) {
        const column = depth.get(node.id);
        const row = rows.get(column) || 0;
        rows.set(column, row + 1);
        node.pos = [column * 400, row * 300];
    }
    return workflow;
}
