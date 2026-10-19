/**
 * What the canvas's right-click menus offer from AMB, as the user set it (Settings -> Canvas):
 * the entries of a node's menu and of the empty canvas's menu, each on or off, in the user's
 * order, and whether they sit in one "Anomalous" submenu or right in the menu. A per-viewer
 * convenience in localStorage; entries added in a later version join at their default place.
 * No DOM.
 */

const KEY = 'anomalous_canvas_menu';

// Each list in its default order, with whether an entry is on at first.
export const NODE_ENTRIES = Object.freeze([
    { id: 'open', on: true },
    { id: 'replaceModel', on: true },
    { id: 'loraBefore', on: true },
    { id: 'loraAfter', on: true },
    { id: 'parameters', on: true },
    { id: 'modelOutputs', on: true },
    { id: 'modelDetails', on: false },
    { id: 'saveParameters', on: false },
    { id: 'saveCombo', on: true },
]);
export const CANVAS_ENTRIES = Object.freeze([
    { id: 'quickSearch', on: true },
    { id: 'openPage', on: true },
]);
export const PLACEMENTS = Object.freeze(['submenu', 'top']);

function storage() {
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
}

/** The saved `list` in its order, entries it does not know dropped and new ones added at their place. */
function merged(saved, defaults) {
    const known = new Map(defaults.map(entry => [entry.id, entry]));
    const kept = (Array.isArray(saved) ? saved : [])
        .filter(entry => known.has(entry?.id))
        .filter((entry, index, all) => all.findIndex(other => other.id === entry.id) === index)
        .map(entry => ({ id: entry.id, on: entry.on !== false }));
    defaults.forEach((entry, index) => {
        if (kept.some(other => other.id === entry.id)) return;
        // After the entry that comes before it by default, else first.
        const before = defaults.slice(0, index).reverse().find(other => kept.some(item => item.id === other.id));
        const at = before ? kept.findIndex(item => item.id === before.id) + 1 : 0;
        kept.splice(at, 0, { ...entry });
    });
    return kept;
}

/** { placement, node: [{ id, on }], canvas: [{ id, on }] }. */
export function menuSettings(store = storage()) {
    let saved = {};
    try {
        saved = JSON.parse(store?.getItem(KEY) || '{}') || {};
    } catch {
        saved = {};
    }
    return {
        placement: PLACEMENTS.includes(saved.placement) ? saved.placement : 'submenu',
        node: merged(saved.node, NODE_ENTRIES),
        canvas: merged(saved.canvas, CANVAS_ENTRIES),
    };
}

/** Keeps `settings` (as menuSettings returns them); false when the browser would not keep it. */
export function saveMenuSettings(settings, store = storage()) {
    try {
        store.setItem(KEY, JSON.stringify({ placement: settings.placement, node: settings.node, canvas: settings.canvas }));
        return true;
    } catch {
        return false;
    }
}

/** Back to the defaults. */
export function resetMenuSettings(store = storage()) {
    try {
        store?.removeItem(KEY);
    } catch { /* the defaults show anyway */ }
    return menuSettings(store);
}

/** `list` with the entry `id` moved by `step` (-1 up, +1 down), or as it was at an end. */
export function moveEntry(list, id, step) {
    const from = list.findIndex(entry => entry.id === id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= list.length) return list;
    const next = [...list];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
}
