/**
 * A workflow's focus values (重点参数): the few node values marked as what matters in this
 * workflow (a LoRA's strength, an upscale factor), each with a short note. Kept in the recipe's
 * params as `focusParams` ([{ node, type, widget, note }]; the server checks them,
 * api/recipe_schema.py). `node` is the node's id in the recipe's workflow, which its parameter
 * sets, the canvas it opens and its pictures share. Pure: no DOM, no requests.
 */

export const MAX_FOCUS = 12;
export const MAX_FOCUS_NOTE = 120;

const sameValue = (entry, node, widget) => entry.node === String(node) && entry.widget === widget;

/** The marks in `params` still true of `workflow`: a node of that id (and type) is there. */
export function focusEntries(params, workflow) {
    const types = new Map((workflow?.nodes || []).map(node => [String(node?.id), node?.type || '']));
    const list = Array.isArray(params?.focusParams) ? params.focusParams : [];
    return list.filter(entry => entry && typeof entry.node === 'string' && typeof entry.widget === 'string'
        && types.has(entry.node) && (!entry.type || types.get(entry.node) === entry.type));
}

/** (type, widget, ...node ids) → that value's mark in `recipe`, or null: an isKey for compareParams. */
export function focusTest(recipe) {
    const entries = focusEntries(recipe?.params, recipe?.workflow);
    return (type, widget, ...ids) => entries.find(entry => (!entry.type || entry.type === type)
        && ids.some(id => sameValue(entry, id, widget))) || null;
}

/** `params` with `widget` of `node` ({ id, type }) marked, or unmarked when it was; null when the list is full. */
export function toggledFocus(params, node, widget) {
    const list = Array.isArray(params?.focusParams) ? params.focusParams : [];
    const kept = list.filter(entry => !sameValue(entry, node.id, widget));
    if (kept.length === list.length) {
        if (list.length >= MAX_FOCUS) return null;
        kept.push({ node: String(node.id), type: node.type || '', widget, note: '' });
    }
    return { ...params, focusParams: kept };
}

/** `params` with the note of `entry`'s value set, trimmed and cut to MAX_FOCUS_NOTE. */
export function notedFocus(params, entry, note) {
    const text = String(note ?? '').trim().slice(0, MAX_FOCUS_NOTE);
    const list = Array.isArray(params?.focusParams) ? params.focusParams : [];
    return { ...params, focusParams: list.map(item => (sameValue(item, entry.node, entry.widget) ? { ...item, note: text } : item)) };
}
