/**
 * Pure helpers for building a workflow on the canvas (mcp_canvas_edit.js): whether an output
 * fits an input, a widget value checked against what the widget takes, where a new node goes
 * so it covers nothing, and a left-to-right layout for a workflow given in ComfyUI's API form.
 * No DOM, no app: nodes are plain objects with pos, size, widgets, inputs, outputs.
 */

const GAP = 80;
const ROW_GAP = 60;
const TITLE = 30;
const MAX_SHOWN = 12;

/** Whether an output of type `given` may feed an input of type `wanted` (LiteGraph's rule). */
export function typesFit(given, wanted) {
    const a = String(given ?? '*').toUpperCase();
    const b = String(wanted ?? '*').toUpperCase();
    if (a === '*' || b === '*' || a === '' || b === '' || a === b) return true;
    const right = b.split(',');
    return a.split(',').some(type => right.includes(type));
}

/** A widget's drop-down choices, or null when it has none. */
export function widgetChoices(widget) {
    const values = typeof widget?.options?.values === 'function' ? widget.options.values() : widget?.options?.values;
    return Array.isArray(values) ? values : null;
}

const plain = value => String(value).replace(/\\/g, '/').toLowerCase();
const shown = list => `${list.slice(0, MAX_SHOWN).join(' | ')}${list.length > MAX_SHOWN ? ` … (${list.length} in all)` : ''}`;

/** `value` as widget `widget` of node `nodeId` takes it, or an Error saying what it takes. */
export function checkedValue(nodeId, widget, value) {
    const where = `${widget.name} of node ${nodeId}`;
    const choices = widgetChoices(widget);
    if (choices) {
        const found = choices.find(item => item === value)
            ?? choices.find(item => typeof item === 'string' && typeof value === 'string' && plain(item) === plain(value));
        if (found !== undefined) return found;
        const name = text => plain(text).split('/').pop().replace(/\.[^.]+$/, '');
        const stem = name(value);
        const close = stem ? choices.filter(item => name(item).includes(stem) || (name(item).length > 2 && stem.includes(name(item)))) : [];
        throw new Error(`${where} has no choice "${value}"; ${close.length ? `close: ${shown(close)}` : `choices: ${shown(choices)}`}`);
    }
    if (typeof widget.value === 'number') {
        const number = typeof value === 'string' && value.trim() ? Number(value) : value;
        if (typeof number !== 'number' || !Number.isFinite(number)) throw new Error(`${where} takes a number.`);
        const { min, max } = widget.options || {};
        if ((Number.isFinite(min) && number < min) || (Number.isFinite(max) && number > max)) {
            throw new Error(`${where} is between ${min} and ${max}.`);
        }
        return number;
    }
    if (typeof widget.value === 'boolean') {
        if (typeof value !== 'boolean') throw new Error(`${where} is true or false.`);
        return value;
    }
    if (typeof value !== 'string') throw new Error(`${where} takes text.`);
    return value;
}

/** Widget values `values` ({name: value}) checked for `node`: [[widget, value]], or an Error naming them all. */
export function valuePlan(node, values) {
    const plan = [];
    for (const [name, value] of Object.entries(values || {})) {
        const widget = (node.widgets || []).find(item => item?.name === name && item.type !== 'button');
        if (!widget) {
            const names = (node.widgets || []).filter(item => item?.name && item.type !== 'button').map(item => item.name);
            throw new Error(`Node ${node.id ?? ''} (${node.type}) has no setting ${name}; it has: ${names.join(', ') || 'none'}.`);
        }
        plan.push([widget, checkedValue(node.id ?? node.type, widget, value)]);
    }
    return plan;
}

const overlaps = (x, y, node, other) => x < other.pos[0] + other.size[0] + 20 && x + node.size[0] + 20 > other.pos[0]
    && y < other.pos[1] + other.size[1] + TITLE + 20 && y + node.size[1] + TITLE + 20 > other.pos[1];

/** Where `node` goes among `others`: right of `near` (or of everything), moved down past what it would cover. */
export function freeSpot(node, others, near = null) {
    let x = 100;
    let y = 100;
    if (near) {
        x = near.pos[0] + near.size[0] + GAP;
        y = near.pos[1];
    } else if (others.length) {
        x = Math.max(...others.map(other => other.pos[0] + other.size[0])) + GAP;
        y = Math.min(...others.map(other => other.pos[1]));
    }
    for (let i = 0; i < 100; i++) {
        const hit = others.find(other => overlaps(x, y, node, other));
        if (!hit) break;
        y = hit.pos[1] + hit.size[1] + TITLE + ROW_GAP;
    }
    return [x, y];
}

/** The links of a workflow in API form: [{from, slot, to, input}] between its own node keys. */
export function apiLinks(nodes) {
    const links = [];
    for (const [key, spec] of Object.entries(nodes)) {
        for (const [input, value] of Object.entries(spec?.inputs || {})) {
            if (Array.isArray(value) && value.length === 2 && String(value[0]) in nodes && Number.isInteger(value[1])) {
                links.push({ from: String(value[0]), slot: value[1], to: key, input });
            }
        }
    }
    return links;
}

/** Positions for the nodes `sized` ({key: node with size}) of an API-form workflow: columns by how far each is from its sources. */
export function layered(sized, links, origin = [100, 100]) {
    const feeds = new Map();
    for (const link of links) feeds.set(link.to, [...(feeds.get(link.to) || []), link.from]);
    const depth = new Map();
    const depthOf = (key, seen = new Set()) => {
        if (depth.has(key)) return depth.get(key);
        if (seen.has(key)) return 0; // a loop: ComfyUI will refuse it, the layout need not
        seen.add(key);
        const value = Math.max(-1, ...(feeds.get(key) || []).map(from => depthOf(from, seen))) + 1;
        depth.set(key, value);
        return value;
    };
    const columns = [];
    for (const key of Object.keys(sized)) (columns[depthOf(key)] ||= []).push(key);
    const out = {};
    let x = origin[0];
    for (const column of columns.filter(Boolean)) {
        let y = origin[1];
        for (const key of column) {
            out[key] = [x, y];
            y += sized[key].size[1] + TITLE + ROW_GAP;
        }
        x += Math.max(...column.map(key => sized[key].size[0])) + GAP;
    }
    return out;
}
