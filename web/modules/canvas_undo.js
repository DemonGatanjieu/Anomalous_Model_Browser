/**
 * Undo from the activity log. When a canvas entry is recorded, what it did is kept here in
 * full (the server shortens long values) for as long as the page stays open. An entry can
 * be undone while everything it did is as it left it: the values it set unchanged since,
 * the nodes it added still there and unconnected. Entries that removed nodes or rewired
 * existing ones are never offered, nor anything from before the page was opened.
 */

import { valueText } from './activity_diff.js';
import { recordCanvasStep } from './canvas_history.js';
import { applyNodeMaterialValues, isVolatileWidget } from './node_material_actions.js';

const MAX_KEPT = 100;
const kept = new Map(); // entry id → { workflow, changes }

/** The open workflow, as entries name it. */
export function workflowKey(app) {
    const workflow = app.extensionManager?.workflow?.activeWorkflow;
    return String(workflow?.key || workflow?.path || workflow?.filename || '');
}

/** Keeps what entry `entryId` did (two snapshotGraph maps), when it can be undone at all. */
export function keepUndo(entryId, workflow, before, after) {
    if (!entryId) return;
    const changes = [];
    for (const [id, now] of after) {
        const was = before.get(id);
        if (!was) {
            changes.push({ kind: 'added', id, type: now.type });
            continue;
        }
        if (was.links !== now.links) return;
        for (const name of new Set([...Object.keys(was.widgets), ...Object.keys(now.widgets)])) {
            if (was.widgets[name] === now.widgets[name]) continue;
            if (!(name in was.widgets) || !(name in now.widgets)) return;
            changes.push({ kind: 'changed', id, name, before: was.widgets[name], after: now.widgets[name] });
        }
    }
    for (const id of before.keys()) if (!after.has(id)) return;
    if (!changes.length) return;
    kept.set(entryId, { workflow, changes });
    while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value);
}

const nodeById = (graph, id) => graph?.getNodeById?.(Number(id)) ?? graph?.getNodeById?.(id) ?? null;
const connected = node => (node.inputs || []).some(input => input?.link != null)
    || (node.outputs || []).some(output => output?.links?.length);

/** A value from its text form, of the kind the widget holds now. */
function restoredValue(current, text) {
    if (typeof current === 'string') return text;
    try { return JSON.parse(text); } catch (_) { return text; }
}

/** What undoing entry `id` does now, or null when it cannot. */
function undoPlan(app, id) {
    const record = kept.get(id);
    const graph = app.canvas?.graph || app.graph;
    if (!record || !graph || record.workflow !== workflowKey(app)) return null;
    const values = new Map();
    const remove = [];
    for (const change of record.changes) {
        const node = nodeById(graph, change.id);
        if (!node) return null;
        if (change.kind === 'added') {
            if (node.type !== change.type || connected(node)) return null;
            remove.push(node);
            continue;
        }
        const index = (node.widgets || []).findIndex(widget => widget?.name === change.name);
        const widget = node.widgets?.[index];
        if (!widget || valueText(widget.value) !== change.after) return null;
        if (isVolatileWidget(node, widget, index)) continue; // seeds are never written back
        const value = restoredValue(widget.value, change.before);
        const choices = typeof widget.options?.values === 'function' ? widget.options.values() : widget.options?.values;
        if (Array.isArray(choices) && !choices.includes(value)) return null; // that choice is gone
        if (!values.has(node)) values.set(node, []);
        values.get(node).push({ index, value });
    }
    return values.size || remove.length ? { graph, values, remove } : null;
}

export function canUndo(app, entry) {
    return Boolean(entry?.id && undoPlan(app, entry.id));
}

/** Puts back what the entry changed and removes the nodes it added; one Ctrl+Z step. */
export function undoEntry(app, entry) {
    const plan = undoPlan(app, entry?.id);
    if (!plan) throw new Error('activityUndoGone');
    const { graph } = plan;
    graph.beforeChange?.();
    try {
        for (const [node, values] of plan.values) applyNodeMaterialValues(app, node, values, { record: false });
        for (const node of plan.remove) graph.remove(node);
    } finally {
        graph.afterChange?.();
    }
    graph.setDirtyCanvas?.(true, true);
    kept.delete(entry.id);
    recordCanvasStep(app);
}
