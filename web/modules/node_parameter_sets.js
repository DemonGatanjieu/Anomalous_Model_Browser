/**
 * The saved parameters for a node type, as one list: material blocks
 * (GET /anomalous/materials/by_node_type) and recipes' parameter sets
 * (GET /anomalous/parameters/by_node_type), with the same values saved twice merged into
 * one entry that names both sources. For a live node, what an entry would change: every
 * differing value, except seeds and how they change after a run, model files (the model
 * section changes those) and choices this computer does not have, which stay. No DOM.
 */

import { applyNodeMaterialValues, isModelFilePath, isVolatileWidget } from './node_material_actions.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function fetchJson(url, signal) {
    const response = await fetch(url, { cache: 'no-store', signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

/**
 * [{ name, role, timestamp, values, sources: [{ kind: 'material' | 'recipe', label }] }],
 * newest first.
 */
export async function loadParameterSets(type, { signal } = {}) {
    const query = `type=${encodeURIComponent(type)}`;
    const [materials, recipes] = await Promise.all([
        fetchJson(`/anomalous/materials/by_node_type?${query}`, signal),
        fetchJson(`/anomalous/parameters/by_node_type?${query}`, signal),
    ]);
    const entries = new Map();
    const add = (values, entry) => {
        if (!Array.isArray(values) || !values.length) return;
        const key = JSON.stringify(values);
        const known = entries.get(key);
        if (!known) entries.set(key, { ...entry, values });
        else {
            known.sources.push(...entry.sources);
            known.timestamp = Math.max(known.timestamp, entry.timestamp);
        }
    };
    for (const material of materials.materials || []) {
        const blocks = material.blocks || [];
        for (const block of blocks) {
            add(block.widgets_values, {
                name: blocks.length > 1 ? `${material.name} · ${block.title || block.type}` : material.name,
                role: block.role || '',
                timestamp: material.timestamp || 0,
                sources: [{ kind: 'material', label: material.name }],
            });
        }
    }
    for (const group of recipes.groups || []) {
        const recipe = String(group.recipe_name || group.recipe_filename || '');
        // Sets not bound to a recipe, or whose recipe is gone (only its file name is left).
        if (group.recipe_filename === 'unbound' || recipe.endsWith('.json')) continue;
        for (const notebook of group.notebooks || []) {
            const nodes = notebook.nodes || [];
            for (const node of nodes) {
                add(node.widgets_values, {
                    name: nodes.length > 1 ? `${notebook.name} · ${node.title}` : notebook.name,
                    role: node.role || '',
                    timestamp: notebook.timestamp || 0,
                    sources: [{ kind: 'recipe', label: recipe }],
                });
            }
        }
    }
    return [...entries.values()].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * What putting `values` into `node` would change: [{ index, label, from, to, keep }], keep
 * being '' for a change that is made, or why the value stays: 'seed' | 'model' | 'missing'.
 */
export function parameterChanges(node, values) {
    const changes = [];
    values.forEach((to, index) => {
        const widget = node.widgets?.[index];
        if (!widget || to === undefined || to === null || same(widget.value, to)) return;
        if (widget.value != null && typeof widget.value !== typeof to) return; // not the same input
        const choices = Array.isArray(widget.options?.values) ? widget.options.values : null;
        const keep = isVolatileWidget(node, widget, index) || widget.name === 'control_after_generate' ? 'seed'
            : isModelFilePath(to) || isModelFilePath(widget.value) ? 'model'
                : choices && !choices.includes(to) ? 'missing' : '';
        changes.push({ index, label: widget.label || widget.name || `#${index}`, from: widget.value, to, keep });
    });
    return changes;
}

/** Puts the changes that are made into the node; the undoable result of node_material_actions. */
export function applyParameterChanges(app, node, changes) {
    return applyNodeMaterialValues(app, node, changes.filter(change => !change.keep).map(({ index, to }) => ({ index, value: to })));
}

/** Saves the node's current values as a material; { status: 'success' | 'duplicate', name }. */
export async function saveNodeParameters(node, name) {
    const values = node.serialize?.().widgets_values || node.widgets_values || (node.widgets || []).map(widget => widget.value);
    const response = await fetch('/anomalous/save_node_material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, node: { type: node.type, title: node.title || node.type, widgets_values: values } }),
    });
    const payload = await response.json().catch(() => ({}));
    if (payload.status === 'success') return { status: 'success', name: payload.material?.name || name };
    if (payload.status === 'duplicate') return { status: 'duplicate', name: payload.name };
    throw new Error(payload.message || `HTTP ${response.status}`);
}
