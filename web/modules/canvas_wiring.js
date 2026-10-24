/** Plans typed wiring without changing the graph, then applies the whole plan with rollback.
 * Automatic matching requires a concrete, unique type, or same-type sockets of the same name
 * (positive to positive); explicit sockets retain typesFit. Insertion replaces only the selected
 * downstream branch, and an input the new node feeds that was already fed is spliced: its old
 * source feeds the new node's matching input. No browser or app state here. */
import { typesFit } from './canvas_build.js';
import { linkOf } from './mcp_canvas_brief.js';

const concrete = type => typeof type === 'string' && type.trim() && !/[*,]/.test(type);
const label = node => (node.graph ? `#${node.id}` : '#new');
const slotLabel = (node, slot, input) => `${label(node)}.${(input ? node.inputs : node.outputs)[slot].name}`;
const same = (a, b) => a.from === b.from && a.to === b.to && a.slot === b.slot && a.target === b.target;
const clash = pairs => pairs.some(a => pairs.some(b => a !== b && (a.slot === b.slot || a.target === b.target)));
const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const oldSource = (g, to, target) => {
    const link = linkOf(g, to.inputs[target].link);
    return link && { from: g.getNodeById(link.origin_id), slot: link.origin_slot, to, target };
};

function selected(slots, selector, input) {
    const all = (slots || []).map((value, index) => ({ value, index }));
    if (selector == null) return all.filter(({ value }) => !input || !value.widget);
    const found = all.filter(({ value, index }) => Number.isInteger(selector) ? index === selector : sameName(value.name, selector));
    if (found.length) return found;
    if (!input) return all.filter(({ value }) => sameName(value.type, selector));
    return [];
}

/** Every unique concrete type shared by two nodes, or one explicitly selected socket pair. */
export function pairWires(from, to, { output, input } = {}) {
    if (from === to) throw new Error('Cannot wire a node to itself.');
    const explicit = output != null && input != null;
    let pairs = [];
    for (const a of selected(from.outputs, output, false)) {
        for (const b of selected(to.inputs, input, true)) {
            const fits = explicit ? typesFit(a.value.type, b.value.type)
                : concrete(a.value.type) && concrete(b.value.type) && a.value.type === b.value.type;
            if (fits) pairs.push({ from, slot: a.index, to, target: b.index });
        }
    }
    if (!pairs.length) throw new Error(`No unique concrete type from ${label(from)} to ${label(to)}. Specify output and input; wildcards need explicit sockets.`);
    if (!explicit && clash(pairs)) {
        // Same-type sockets of the same name pair up: a ControlNet's positive/negative into a sampler's.
        const named = pairs.filter(p => sameName(from.outputs[p.slot].name, to.inputs[p.target].name));
        if (named.length) pairs = [...named, ...pairs.filter(p => !named.some(n => n.slot === p.slot || n.target === p.target))];
    }
    if (clash(pairs) || pairs.length > 8) {
        const choices = pairs.slice(0, 8).map(p => `${slotLabel(from, p.slot, false)} -> ${slotLabel(to, p.target, true)}`);
        throw new Error(`Ambiguous wiring; nothing changed: ${choices.join('; ')}${pairs.length > 8 ? '; more candidates omitted' : ''}. `
            + 'connect_nodes with output and input picks one.');
    }
    return pairs;
}

/** Wires from the new node into existing inputs; an input already fed is spliced when the new node
 * takes that type too (its old source feeds the new node: a LoRA or a ControlNet put in front). */
function splice(g, node, pairs) {
    return pairs.flatMap(p => {
        const old = oldSource(g, p.to, p.target);
        const type = old?.from?.outputs[old.slot]?.type;
        const fit = concrete(type) ? selected(node.inputs, null, true).filter(({ value }) => value.type === type) : [];
        if (!fit.length) return [p]; // a plain replacement: validateWires wants replace:true
        const takes = fit.length > 1 ? fit.filter(({ value }) => sameName(value.name, p.to.inputs[p.target].name)
            || sameName(value.name, node.outputs[p.slot].name)) : fit;
        if (takes.length !== 1) {
            throw new Error(`${slotLabel(p.to, p.target, true)} is fed by ${label(old.from)}; the new node could take that at `
                + `${fit.map(({ value }) => value.name).join(' or ')}. Add it, then connect_nodes with input; nothing changed.`);
        }
        return [{ from: old.from, slot: old.slot, to: node, target: takes[0].index }, { ...p, replace: true }];
    });
}

/** Build a node's insertion or explicit-neighbour plan while the new node is still detached. */
export function addWires(g, node, { insert_after: after, insert_type: type, wire_from: from = [], wire_to: to = [] } = {}) {
    const get = id => {
        const found = g.getNodeById(id);
        if (!found) throw new Error(`No node #${id}; call get_situation.`);
        return found;
    };
    const upstream = from.map(get), downstream = to.map(get);
    if (after == null) return [...upstream.flatMap(n => pairWires(n, node)), ...downstream.flatMap(n => splice(g, node, pairWires(node, n)))];
    const anchor = get(after);
    // Each type the new node passes through (a LoRA after a checkpoint: MODEL and CLIP) is spliced.
    const through = pairWires(anchor, node).filter(p => !type || anchor.outputs[p.slot].type === type).flatMap(entry => {
        const passes = (node.outputs || []).flatMap((o, slot) => (concrete(o.type) && o.type === anchor.outputs[entry.slot].type ? [slot] : []));
        return passes.length ? [{ entry, passes }] : [];
    });
    if (!through.length || through.some(t => t.passes.length > 1)) {
        throw new Error('Insertion needs one unambiguous through type. Give insert_type, or use explicit connections.');
    }
    const branches = through.map(({ entry, passes: [slot] }) => ({
        entry, slot, links: (anchor.outputs[entry.slot].links || []).map(id => linkOf(g, id)).filter(Boolean),
    }));
    if (!branches.some(b => b.links.length)) throw new Error('Nothing follows that output; use wire_from to extend its end.');
    if (!downstream.length && branches.some(b => b.links.length > 1)) {
        const ids = [...new Set(branches.flatMap(b => b.links.map(l => l.target_id)))];
        throw new Error(`Several downstream branches; choose wire_to (one or more of): ${ids.slice(0, 8).join(', ')}. Nothing changed.`);
    }
    const plan = upstream.flatMap(n => pairWires(n, node));
    for (const { entry, slot, links } of branches) {
        const chosen = downstream.length ? links.filter(l => downstream.includes(g.getNodeById(l.target_id))) : links;
        if (chosen.length || !links.length) plan.push(entry, ...chosen.map(l => ({ from: node, slot, to: get(l.target_id), target: l.target_slot, replace: true })));
    }
    if (downstream.some(n => !plan.some(p => p.from === node && p.to === n))) throw new Error('wire_to must name existing downstream branches of insert_after.');
    return plan;
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
