/**
 * Canvas snapshots and their difference, for the activity log. Pure: takes a graph-like
 * object (`_nodes` or `nodes`, each with `id`, `type`, `title`, `widgets`), no DOM.
 */

/** Text form of a widget value, so values compare and store the same way. */
export function valueText(value) {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value) ?? '';
    } catch (_) {
        return String(value);
    }
}

/**
 * `Map(node id → { type, title, widgets: { name → text }, links })`; buttons have no value.
 * `links`: the node's input links, so a rewiring shows (canvas_undo.js uses it).
 */
export function snapshotGraph(graph) {
    const nodes = new Map();
    for (const node of graph?._nodes || graph?.nodes || []) {
        if (node?.id === undefined || node.id === null) continue;
        const widgets = {};
        for (const widget of node.widgets || []) {
            if (!widget?.name || widget.type === 'button') continue;
            widgets[widget.name] = valueText(widget.value);
        }
        const links = (node.inputs || []).map(input => input?.link ?? '').join(',');
        nodes.set(String(node.id), { type: node.type || '', title: node.title || node.type || '', widgets, links });
    }
    return nodes;
}

const nodeLabel = (id, node) => `${node.title} #${id}`;

/**
 * What changed from `before` to `after` (both from snapshotGraph): widget values
 * (`changed`), nodes `added` and `removed`, in canvas order.
 */
export function diffSnapshots(before, after) {
    const changes = [];
    for (const [id, now] of after) {
        const was = before.get(id);
        if (!was) {
            changes.push({ kind: 'added', node: nodeLabel(id, now), type: now.type });
            continue;
        }
        for (const name of new Set([...Object.keys(was.widgets), ...Object.keys(now.widgets)])) {
            if (was.widgets[name] === now.widgets[name]) continue;
            changes.push({
                kind: 'changed', node: nodeLabel(id, now), type: now.type, widget: name,
                before: was.widgets[name] ?? '', after: now.widgets[name] ?? '',
            });
        }
    }
    for (const [id, was] of before) {
        if (!after.has(id)) changes.push({ kind: 'removed', node: nodeLabel(id, was), type: was.type });
    }
    return changes;
}

/** The node id in a change's `node` label (`KSampler #12` → `12`), or null. */
export function changeNodeId(change) {
    const match = /#([^#\s]+)$/.exec(String(change?.node || ''));
    return match ? match[1] : null;
}
