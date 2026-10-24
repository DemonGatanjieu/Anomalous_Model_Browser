/** Plans typed wiring without changing the graph, then applies the whole plan with rollback.
 * Automatic matching requires a concrete, unique type; explicit sockets retain typesFit.
 * Insertion replaces only the selected downstream branch. No browser or app state here. */
import { typesFit } from './canvas_build.js';
import { linkOf } from './mcp_canvas_brief.js';

const concrete = type => typeof type === 'string' && type.trim() && !/[*,]/.test(type);
const label = node => `#${node.id ?? 'new'}`;
const slotLabel = (node, slot, input) => `${label(node)}.${(input ? node.inputs : node.outputs)[slot].name}`;
const same = (a, b) => a.from === b.from && a.to === b.to && a.slot === b.slot && a.target === b.target;
const oldSource = (g, to, target) => {
    const link = linkOf(g, to.inputs[target].link);
    return link && { from: g.getNodeById(link.origin_id), slot: link.origin_slot, to, target };
};

function selected(slots, selector, input) {
    const all = (slots || []).map((value, index) => ({ value, index }));
    if (selector == null) return all.filter(({ value }) => !input || !value.widget);
    const found = all.filter(({ value, index }) => Number.isInteger(selector) ? index === selector
        : String(value.name).toLowerCase() === String(selector).toLowerCase());
    if (found.length) return found;
    if (!input) return all.filter(({ value }) => String(value.type).toLowerCase() === String(selector).toLowerCase());
    return [];
}

/** Every unique concrete type shared by two nodes, or one explicitly selected socket pair. */
export function pairWires(from, to, { output, input } = {}) {
    if (from === to) throw new Error('Cannot wire a node to itself.');
    const explicit = output != null && input != null;
    const pairs = [];
    for (const a of selected(from.outputs, output, false)) {
        for (const b of selected(to.inputs, input, true)) {
            const fits = explicit ? typesFit(a.value.type, b.value.type)
                : concrete(a.value.type) && concrete(b.value.type) && a.value.type === b.value.type;
            if (fits) pairs.push({ from, slot: a.index, to, target: b.index });
        }
    }
    if (!pairs.length) throw new Error(`No unique concrete type from ${label(from)} to ${label(to)}. Specify output and input; wildcards need explicit sockets.`);
    const ambiguous = pairs.some(a => pairs.some(b => a !== b && (a.slot === b.slot || a.target === b.target)));
    if (ambiguous || pairs.length > 8) {
        const choices = pairs.slice(0, 8).map(p => `${slotLabel(from, p.slot, false)} -> ${slotLabel(to, p.target, true)}`);
        throw new Error(`Ambiguous wiring; nothing changed. Choose output/input: ${choices.join('; ')}${pairs.length > 8 ? '; more candidates omitted' : ''}`);
    }
    return pairs;
}

/** Build a node's insertion or explicit-neighbour plan while the new node is still detached. */
export function addWires(g, node, { insert_after: after, insert_type: type, wire_from: from = [], wire_to: to = [] } = {}) {
    const get = id => {
        const found = g.getNodeById(id);
        if (!found) throw new Error(`No node #${id}; call get_situation.`);
        return found;
    };
    const upstream = from.map(get), downstream = to.map(get);
    if (after == null) return [...upstream.flatMap(n => pairWires(n, node)), ...downstream.flatMap(n => pairWires(node, n))];
    const anchor = get(after);
    const entry = pairWires(anchor, node).filter(p => !type || anchor.outputs[p.slot].type === type);
    const through = entry.flatMap(p => (node.outputs || []).flatMap((o, slot) =>
        concrete(o.type) && o.type === anchor.outputs[p.slot].type ? [{ entry: p, slot }] : []));
    if (through.length !== 1) throw new Error('Insertion needs one unambiguous through type. Give insert_type, or use explicit connections.');
    const chosen = through[0];
    const links = (anchor.outputs[chosen.entry.slot].links || []).map(id => linkOf(g, id)).filter(Boolean);
    if (!links.length) throw new Error('Nothing follows that output; use wire_from to extend its end.');
    if (!downstream.length && links.length > 1) {
        throw new Error(`Several downstream branches; choose wire_to: ${[...new Set(links.map(l => l.target_id))].slice(0, 8).join(', ')}. Nothing changed.`);
    }
    const chosenLinks = downstream.length ? links.filter(l => downstream.includes(g.getNodeById(l.target_id))) : links;
    if (downstream.some(n => !chosenLinks.some(l => l.target_id === n.id))) throw new Error('wire_to must name existing downstream branches of insert_after.');
    return [chosen.entry, ...upstream.flatMap(n => pairWires(n, node)), ...chosenLinks.map(l => ({
        from: node, slot: chosen.slot, to: get(l.target_id), target: l.target_slot, replace: true,
    }))];
}

/** Validate final topology, including replacements, before the first node/link is touched. */
export function validateWires(g, proposed, replace = false) {
    const plan = proposed.filter((p, i) => !proposed.slice(0, i).some(other => same(p, other)));
    if (plan.length > 32) throw new Error('Too many links in one change (maximum 32). Select fewer branches.');
    const targets = new Map();
    for (const p of plan) {
        if (!typesFit(p.from.outputs[p.slot]?.type, p.to.inputs[p.target]?.type)) throw new Error('Incompatible sockets.');
        if (!targets.has(p.to)) targets.set(p.to, new Set());
        if (targets.get(p.to).has(p.target)) throw new Error(`Several sources for ${slotLabel(p.to, p.target, true)}. Choose one source; nothing changed.`);
        targets.get(p.to).add(p.target);
        const old = oldSource(g, p.to, p.target);
        if (old && !same(old, p) && !p.replace && !replace) {
            throw new Error(`${slotLabel(p.to, p.target, true)} is already wired from ${label(old.from)}. Use replace:true to replace it; nothing changed.`);
        }
    }
    const edges = new Map();
    const edge = (from, to) => { if (!edges.has(from)) edges.set(from, []); edges.get(from).push(to); };
    for (const to of g._nodes || []) {
        (to.inputs || []).forEach((input, target) => {
            if (targets.get(to)?.has(target)) return;
            const old = oldSource(g, to, target);
            if (old?.from) edge(old.from, to);
        });
    }
    plan.forEach(p => edge(p.from, p.to));
    const visited = new Set(), pending = new Set();
    function visit(node) {
        if (pending.has(node)) throw new Error('These connections would make a loop. Nothing changed.');
        if (visited.has(node)) return;
        pending.add(node);
        for (const next of edges.get(node) || []) visit(next);
        pending.delete(node); visited.add(node);
    }
    for (const node of edges.keys()) visit(node);
    return plan;
}

/** The caller brackets this in one beforeChange/afterChange and records only success. */
export function applyWires(g, plan, added = null, prepare = () => {}) {
    const old = plan.map(p => oldSource(g, p.to, p.target));
    try {
        if (added) g.add(added);
        prepare();
        for (const p of plan) {
            const linked = p.from.connect(p.slot, p.to, p.target);
            const actual = oldSource(g, p.to, p.target);
            if (!linked || !actual || !same(p, actual)) throw new Error('ComfyUI refused a planned connection.');
        }
    } catch (error) {
        const problems = [];
        // Remove new connections first, then restore original sources even after a partial failure.
        for (const p of plan) {
            try { p.to.disconnectInput(p.target); } catch (e) { problems.push(e); }
        }
        if (added && (g._nodes || []).includes(added)) {
            try { g.remove(added); } catch (e) { problems.push(e); }
        }
        for (const p of old.filter(Boolean)) {
            try {
                p.from.connect(p.slot, p.to, p.target);
                const actual = oldSource(g, p.to, p.target);
                if (!actual || !same(actual, p)) throw new Error('Original connection could not be restored.');
            } catch (e) { problems.push(e); }
        }
        if (problems.length) throw new Error(`${error.message} Rollback incomplete: inspect the canvas before retrying.`);
        throw new Error(`${error.message} Original connections restored.`);
    }
    return plan.map((p, i) => ({ from: p.from.id, output: p.from.outputs[p.slot].name, to: p.to.id,
        input: p.to.inputs[p.target].name, ...(old[i] && !same(old[i], p) ? { replaced_from: old[i].from.id } : {}) }));
}

export function reachesOutput(g, node, seen = new Set()) {
    if (seen.has(node) || node.mode === 2 || node.mode === 4) return false;
    seen.add(node);
    if (node.constructor?.nodeData?.output_node) return true;
    return (node.outputs || []).some(o => (o.links || []).some(id => {
        const link = linkOf(g, id), next = link && g.getNodeById(link.target_id);
        return next && reachesOutput(g, next, seen);
    }));
}
