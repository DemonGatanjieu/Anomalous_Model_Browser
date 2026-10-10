/**
 * Two sets of workflow parameters side by side (an output image's workflow, the canvas):
 * whether they are the same node structure, and which node values differ. Pure: takes
 * graph-like objects (`_nodes` or `nodes`, each with `id`, `type`, `title`, `mode`,
 * `widgets`, `inputs`; `links` to read the wiring), no DOM. The view is ui_param_compare.js.
 */

import { valueText } from './activity_diff.js';
import { isVolatileWidget } from './node_material_actions.js';
import { promptBoxes } from './prompt_boxes.js';

const CONTEXT_CHARS = 40;
const MIN_TAGS = 3;

function linkOrigin(graph, linkId) {
    if (linkId === null || linkId === undefined) return '';
    const link = graph?.links?.get?.(linkId) ?? graph?.links?.[linkId];
    if (!link) return '';
    const origin = Array.isArray(link) ? [link[1], link[2]] : [link.origin_id, link.origin_slot];
    return `${origin[0]}:${origin[1]}`;
}

/**
 * `Map(node id → { id, type, title, mode, wiring, widgets: [{ name, index, value, text, volatile, role }] })`
 * in canvas order. Buttons and nameless widgets hold no value. `wiring`: where each input comes from;
 * `role`: a prompt box's 'positive' / 'negative' / 'both' (prompt_boxes.js), else ''.
 */
export function readParams(graph) {
    const nodes = new Map();
    for (const node of graph?._nodes || graph?.nodes || []) {
        if (node?.id === undefined || node.id === null) continue;
        const widgets = [];
        const roles = new Map(promptBoxes(node).map(box => [box.index, box.role]));
        (node.widgets || []).forEach((widget, index) => {
            if (!widget?.name || widget.type === 'button') return;
            widgets.push({ name: widget.name, index, value: widget.value, text: valueText(widget.value), volatile: isVolatileWidget(node, widget, index), role: roles.get(index) || '' });
        });
        const wiring = (node.inputs || []).map(input => `${input?.name || ''}<${linkOrigin(graph, input?.link)}`).join('|');
        const id = String(node.id);
        nodes.set(id, { id, type: node.type || '', title: node.title || node.type || '', mode: node.mode ?? 0, wiring, widgets });
    }
    return nodes;
}

const nodeRef = node => ({ id: node.id, type: node.type, title: node.title });

/** One node pair's values: the differing ones (`rows`; equal ones too with `includeSame`), the starred ones equal or not (`keys`). */
function compareValues(left, right, isKey, includeSame) {
    const rows = [];
    const keys = [];
    let same = 0;
    if (left.mode !== right.mode) rows.push({ name: '', mode: true, a: left.mode, b: right.mode });
    const rightByName = new Map(right.widgets.map(widget => [widget.name, widget]));
    for (const widget of left.widgets) {
        const other = rightByName.get(widget.name);
        if (!other) continue;
        const equal = other.text === widget.text;
        if (equal) same += 1;
        const row = { name: widget.name, index: other.index, a: widget.value, b: other.value, aText: widget.text, bText: other.text, volatile: widget.volatile || other.volatile, role: other.role || widget.role, same: equal };
        if (isKey(right.type, widget.name)) keys.push(row);
        else if (!equal || includeSame) rows.push(row);
    }
    return { rows, keys, same };
}

/** Unpaired nodes of a type found once on each side: two workflows' only KSampler, say. */
function pairsByType(leftovers, others) {
    const once = nodes => {
        const byType = new Map();
        for (const node of nodes) byType.set(node.type, byType.has(node.type) ? null : node);
        return byType;
    };
    const left = once(leftovers);
    const right = once(others);
    return [...left].filter(([type, node]) => node && right.get(type)).map(([type, node]) => [node, right.get(type)]);
}

/**
 * What differs from `a` to `b` (both from readParams). Nodes pair by id and type; nodes left
 * over pair by type when each side has one node of it. Returns { sameStructure, nodes: [{ id,
 * aId, bId, type, title, rows }], keys, onlyA, onlyB, rewired, sameCount, compared } (`id` is `bId`):
 * a row is { name, index, a, b, aText, bText, volatile, role, same } or, for a node bypassed or
 * muted on one side only, { name: '', mode: true, a, b }. Values `isKey(type, widget)` stars are
 * not in `nodes` but in `keys` ([{ node, row }], equal ones too); with `includeSame` the other
 * equal values are in `nodes` too (`same: true`). `sameCount` counts the values equal on both
 * sides, `compared` all values set side by side (none: nothing could be paired).
 */
export function compareParams(a, b, { isKey = () => false, includeSame = false } = {}) {
    const nodes = [];
    const keys = [];
    const rewired = [];
    let sameCount = 0;
    let differing = 0;
    const pair = (left, right) => {
        const values = compareValues(left, right, isKey, includeSame);
        const node = { id: right.id, aId: left.id, bId: right.id, type: right.type, title: right.title };
        sameCount += values.same;
        differing += [...values.rows, ...values.keys].filter(row => !row.same).length;
        if (values.rows.length) nodes.push({ ...node, rows: values.rows });
        keys.push(...values.keys.map(row => ({ node, row })));
    };
    const leftovers = [];
    for (const [id, left] of a) {
        const right = b.get(id);
        if (!right || right.type !== left.type) {
            leftovers.push(left);
            continue;
        }
        if (left.wiring !== right.wiring) rewired.push(nodeRef(right));
        pair(left, right);
    }
    const others = [...b.values()].filter(right => a.get(right.id)?.type !== right.type);
    const paired = new Set();
    for (const [left, right] of pairsByType(leftovers, others)) {
        pair(left, right);
        paired.add(left).add(right);
    }
    const onlyA = leftovers.filter(node => !paired.has(node)).map(nodeRef);
    const onlyB = others.filter(node => !paired.has(node)).map(nodeRef);
    const sameStructure = !leftovers.length && !others.length && !rewired.length;
    return { sameStructure, nodes, keys, onlyA, onlyB, rewired, sameCount, compared: sameCount + differing };
}

const tagsOf = text => String(text).split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean);

/**
 * How two texts differ, for showing: prompts written as tags by the tags only one side has
 * ({ tags: true, onlyA, onlyB }, each tag once), anything else by the part that differs with a
 * little of what surrounds it ({ tags: false, before, aPart, bPart, after }, cut ends marked …).
 */
export function textDifference(aText, bText) {
    const aTags = tagsOf(aText);
    const bTags = tagsOf(bText);
    if (aTags.length >= MIN_TAGS && bTags.length >= MIN_TAGS) {
        const inA = new Set(aTags);
        const inB = new Set(bTags);
        const onlyA = [...inA].filter(tag => !inB.has(tag));
        const onlyB = [...inB].filter(tag => !inA.has(tag));
        if (onlyA.length || onlyB.length) return { tags: true, onlyA, onlyB };
    }
    const a = String(aText);
    const b = String(bText);
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
    let end = 0;
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
    return {
        tags: false,
        before: (start > CONTEXT_CHARS ? '…' : '') + a.slice(Math.max(0, start - CONTEXT_CHARS), start),
        aPart: a.slice(start, a.length - end),
        bPart: b.slice(start, b.length - end),
        after: a.slice(a.length - end, a.length - end + CONTEXT_CHARS) + (end > CONTEXT_CHARS ? '…' : ''),
    };
}

/** A value as it reads in the comparison: long decimals rounded, nothing as —. */
export function shownValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number' && !Number.isInteger(value)) return String(Math.round(value * 10000) / 10000);
    return typeof value === 'string' ? value : valueText(value);
}

/** Long text is shown by textDifference rather than whole. */
export const isLongText = row => typeof row.a === 'string' && typeof row.b === 'string' && Math.max(row.a.length, row.b.length) > 60;