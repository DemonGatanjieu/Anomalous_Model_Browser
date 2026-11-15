/**
 * Pure helpers for the message box's "+" menu and per-ref notes (no DOM): ordering models with the
 * user's favourites first and building clean ref payloads.
 */

import { searchItems } from './ai_toolbox_data.js';

export const MAX_REF_NOTE = 120;

/**
 * `models` matching `query` with the user's favourite model IDs first (in favourite order among
 * matching favourites, then the rest in search/list order), each favourite marked `{favourite: true}`.
 */
export function orderModelsFavoritesFirst(models, favoriteIds = [], query = '') {
    const matched = searchItems(models || [], query);
    const favOrder = new Map();
    for (const id of favoriteIds || []) {
        if (typeof id === 'string' && !favOrder.has(id)) favOrder.set(id, favOrder.size);
    }
    if (!favOrder.size) return matched.map(item => ({ ...item, favourite: false }));
    const tagged = matched.map((item, index) => ({
        item: { ...item, favourite: favOrder.has(item.id) },
        favAt: favOrder.get(item.id) ?? Infinity,
        index,
    }));
    tagged.sort((a, b) => (a.favAt - b.favAt) || (a.index - b.index));
    return tagged.map(entry => entry.item);
}

/** `note` capped at `MAX_REF_NOTE` characters for a tray chip's input. */
export function refNote(note) {
    return String(note ?? '').slice(0, MAX_REF_NOTE);
}

/** Shapes an attached `ref` for POST /message, omitting empty `note`. */
export function serializeRef(ref) {
    const note = String(ref?.note ?? '').trim().slice(0, MAX_REF_NOTE);
    return {
        kind: ref.kind,
        id: ref.id,
        label: ref.label,
        ...(note ? { note } : {}),
    };
}

/** Maps `refs` with `serializeRef`. */
export const serializeRefs = refs => (refs || []).map(serializeRef);
