/**
 * Model Doctor's check: which model files the open workflow uses, whether this computer
 * has each of them, and putting a found file into its node. A file counts as the same
 * model only by the hash (and size) the workflow carries; a file of the same size is only
 * offered (docs/architecture/model-resolution.md). Checking changes nothing; only
 * applyModelFix / fixWorkflowModels write to nodes. No DOM: ui_doctor.js and
 * ui_doctor_banner.js show the result.
 *
 * An entry: { node, widget, value, state, target, via, record, local }, state one of
 * ready · changed (there, but not the file the workflow was saved with) · fixable (target
 * is the same file, via 'hash' or 'spelling') · candidate (target has the same size only)
 * · conflict · ambiguous · missing (`record` says whether the workflow carries a hash).
 */

import { app } from "../../../scripts/app.js";
import { findWorkflowHashRecord } from './recipe_provenance.js';
import { inferModelFolderTypes, requiresHashForModelRecovery } from './model_policies.js';

const MODEL_FILE = /\.(safetensors|ckpt|pt|bin|pth|sft)$/i;
const BATCH = 256;
const PROBLEMS = new Set(['fixable', 'candidate', 'conflict', 'ambiguous', 'missing']);

const slashes = (value) => String(value).replace(/\\/g, '/');
const choices = (widget) => (Array.isArray(widget.options?.values) ? widget.options.values : []);
const nativeValue = (widget, filename) => choices(widget).find(v => typeof v === 'string' && slashes(v) === slashes(filename)) || null;

/** Entries that keep the workflow from running as saved. */
export const isProblem = (entry) => PROBLEMS.has(entry.state);

function modelRefs() {
    const refs = [];
    for (const node of app.graph?._nodes || []) {
        for (const widget of node.widgets || []) {
            if (widget.type === 'combo' && typeof widget.value === 'string' && MODEL_FILE.test(widget.value)) {
                refs.push({ node, widget, value: widget.value });
            }
        }
    }
    return refs;
}

function asRecord(data) {
    if (!data) return null;
    return typeof data === 'string' ? { hash: data, size: '' } : { hash: data.hash || '', size: data.size || '' };
}

/** This computer's hash for a model value (filled from /anomalous/all_hashes). */
function localRecord(value) {
    const cache = window.anomalous_hash_cache || {};
    const path = slashes(value);
    return asRecord(cache[value] || cache[path] || cache[path.split('/').pop()]);
}

const savedRecord = (ref) => asRecord(findWorkflowHashRecord(app.graph, ref.node.id, ref.value));

/** What identifies the model: the workflow's record, or for ordinary models (not the
 * hash-only foundation components) the local cache's entry under the same name. */
function evidence(ref) {
    const saved = savedRecord(ref);
    if (saved || requiresHashForModelRecovery(ref.node, ref.widget)) return saved;
    return localRecord(ref.value);
}

function identityChanged(ref) {
    if (!requiresHashForModelRecovery(ref.node, ref.widget)) return false;
    const saved = savedRecord(ref)?.hash;
    const local = localRecord(ref.value)?.hash;
    return Boolean(saved && local && saved.toUpperCase() !== local.toUpperCase());
}

/** The backend's answers by key; the single-item route when the batch route fails. */
async function resolveItems(items) {
    const results = new Map();
    try {
        for (let offset = 0; offset < items.length; offset += BATCH) {
            const res = await fetch('/anomalous/resolve_hash_batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: items.slice(offset, offset + BATCH) }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            for (const entry of (await res.json()).results || []) results.set(entry.key, entry.result);
        }
    } catch (error) {
        console.warn('[AMB] Model check: batch lookup failed, asking one by one.', error);
        for (const item of items) {
            if (results.has(item.key)) continue;
            const query = new URLSearchParams({ hash: item.hash, size: item.size, type: item.type });
            try {
                results.set(item.key, await (await fetch(`/anomalous/resolve_hash?${query}`)).json());
            } catch (single) {
                console.warn('[AMB] Model check: lookup failed.', single);
            }
        }
    }
    return results;
}

async function reloadModelLists() {
    try {
        await fetch('/anomalous/clear_cache', { method: 'POST' });
        await app.refreshComboInNodes?.();
    } catch (error) {
        console.warn('[AMB] Model check: could not reload the model lists.', error);
    }
}

/**
 * Checks every model of the open workflow. `refresh` first reloads ComfyUI's model lists
 * and the local hashes (an explicit check); the check after a workflow opens skips that.
 */
export async function checkWorkflowModels({ refresh = false } = {}) {
    if (refresh) {
        try {
            await app.refreshComboInNodes?.();
            await window.anomalous_reload_hashes?.();
        } catch (error) {
            console.warn('[AMB] Model check: could not reload the model lists.', error);
        }
    }
    const entries = [];
    const items = [];
    for (const ref of modelRefs()) {
        const record = evidence(ref);
        const entry = { ...ref, record, local: localRecord(ref.value), state: 'missing', target: null, via: '' };
        entries.push(entry);
        if (choices(ref.widget).includes(ref.value)) {
            entry.state = identityChanged(ref) ? 'changed' : 'ready';
            continue;
        }
        const spelled = nativeValue(ref.widget, ref.value);
        if (spelled) {
            Object.assign(entry, { state: 'fixable', target: spelled, via: 'spelling' });
        } else if (record?.hash || record?.size) {
            const type = inferModelFolderTypes(ref.node, ref.widget).join(',');
            items.push({ key: String(entries.length - 1), hash: record.hash, size: record.size, type });
        }
    }
    if (!items.length) return entries;

    const results = await resolveItems(items);
    let listsReloaded = false;
    for (const item of items) {
        const entry = entries[Number(item.key)];
        const result = results.get(item.key) || {};
        if (result.identity_conflict) entry.state = 'conflict';
        else if (result.ambiguous) entry.state = 'ambiguous';
        if (!result.found && !result.confirmation_required) continue;
        let target = nativeValue(entry.widget, result.filename);
        if (!target && !listsReloaded) {
            // On disk but not in the drop-down yet (added after ComfyUI read the folders).
            listsReloaded = true;
            await reloadModelLists();
            target = nativeValue(entry.widget, result.filename);
        }
        if (!target) continue; // not a file this node can load
        Object.assign(entry, result.found
            ? { state: 'fixable', target, via: 'hash' }
            : { state: 'candidate', target, via: 'size' });
    }
    return entries;
}

/** Remembers on the widget what it held before the doctor (or its picker) changed it. */
export function markReplaced(widget, from, to) {
    widget.anomalous_replaced = { from, to };
}

/** What a widget held before the doctor changed it, while it still holds the new value. */
export function replacedFrom(widget) {
    const replaced = widget.anomalous_replaced;
    return replaced && replaced.to === widget.value ? replaced.from : '';
}

/**
 * Puts `target` (by default the found file) into the entry's node. False when the node
 * or its value changed since the check, or there is nothing to put in.
 */
export function applyModelFix(entry, target = entry.target) {
    const { node, widget, value } = entry;
    if (!target || app.graph?.getNodeById?.(node.id) !== node || widget.value !== value) return false;
    widget.value = target;
    const index = node.widgets.indexOf(widget);
    if (index >= 0 && Array.isArray(node.widgets_values)) node.widgets_values[index] = target;
    widget.callback?.(target, app.canvas, node, app.canvas?.graph_mouse, null);
    // ComfyUI clears its own missing-model mark through this hook.
    node.onWidgetChanged?.(widget.name, target, value, widget);
    if (app.lastNodeErrors?.[node.id]) delete app.lastNodeErrors[node.id];
    markReplaced(widget, value, target);
    return true;
}

/** Puts in every fixable entry's file; the number put in. */
export function fixWorkflowModels(entries) {
    const fixable = entries.filter(entry => entry.state === 'fixable');
    if (!fixable.length) return 0;
    app.graph?.beforeChange?.();
    const count = fixable.filter(entry => applyModelFix(entry)).length;
    app.graph?.afterChange?.();
    if (count) app.graph?.setDirtyCanvas?.(true, true);
    return count;
}
