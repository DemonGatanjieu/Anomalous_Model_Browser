/**
 * Browser state for the single materials picker (web/modules/ui_ai_toolbox.js), no DOM: remembered
 * rail kind, last "other" kind for "+" menu, per-kind facet and model base chip (with fallback to
 * null when not offered), plus recent items handed over via messages (up to 30, skipped in
 * privacy mode). Tested in tests/ai_toolbox_state.mjs.
 */

export const KIND_ORDER = Object.freeze(['models', 'ways', 'combos', 'workflows', 'prompts', 'nodes']);
export const OTHER_KINDS = Object.freeze(['combos', 'workflows', 'prompts', 'nodes']);
export const DEFAULT_KIND = 'models';
export const DEFAULT_OTHER_KIND = 'combos';
export const RECENT_MAX = 30;
export const STATE_KEY = 'anomalous.aiToolboxState';
export const RECENT_KEY = 'anomalous.aiToolboxRecent';

export const keyOf = (kind, id) => `${kind}\0${id}`;
export const emptyPicks = kinds => Object.fromEntries(kinds.map(kind => [kind, []]));
export const totalPicks = (box, kinds) => kinds.reduce((sum, kind) => sum + (box?.[kind]?.length || 0), 0);
export const standingInWithFavorites = (task, favorites, kinds) => !task?.toolbox && totalPicks(favorites, kinds) > 0;
export const taskEffectivePicks = (task, favorites, kinds) => (task?.toolbox ? task.toolbox : (totalPicks(favorites, kinds) ? { mode: 'prefer', ...favorites } : null));

const defaultStorage = () => {
    try {
        return globalThis.localStorage || null;
    } catch (_) {
        return null;
    }
};

function readJson(storage, key, fallback) {
    if (!storage) return fallback;
    try {
        const raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
        return fallback;
    }
}

function writeJson(storage, key, value) {
    if (!storage) return;
    try {
        storage.setItem(key, JSON.stringify(value));
    } catch (_) { /* private mode or full storage */ }
}

/** Remembered picker view: `{kind, otherKind, facets: {kind: string|null}, base: string|null}`. */
export function readPickerState(storage = defaultStorage()) {
    const raw = readJson(storage, STATE_KEY, null);
    const kind = KIND_ORDER.includes(raw?.kind) ? raw.kind : DEFAULT_KIND;
    const otherKind = OTHER_KINDS.includes(raw?.otherKind) ? raw.otherKind : DEFAULT_OTHER_KIND;
    const facets = {};
    if (raw?.facets && typeof raw.facets === 'object') {
        for (const item of KIND_ORDER) {
            const value = raw.facets[item];
            if (typeof value === 'string' && value) facets[item] = value;
        }
    }
    const base = typeof raw?.base === 'string' ? raw.base : null;
    return { kind, otherKind, facets, base };
}

function writePickerState(next, storage = defaultStorage()) {
    writeJson(storage, STATE_KEY, next);
    return next;
}

/** Resolves the kind to open for `'other'` (last other or combos), a named kind, or default/last kind. */
export function resolveOpenKind(requested = null, storage = defaultStorage()) {
    const state = readPickerState(storage);
    if (requested === 'other') return state.otherKind;
    if (KIND_ORDER.includes(requested)) return requested;
    return state.kind;
}

/** Remembers the rail kind just shown (and updates `otherKind` when it is one of OTHER_KINDS). */
export function rememberKind(kind, storage = defaultStorage()) {
    if (!KIND_ORDER.includes(kind)) return readPickerState(storage);
    const state = readPickerState(storage);
    state.kind = kind;
    if (OTHER_KINDS.includes(kind)) state.otherKind = kind;
    return writePickerState(state, storage);
}

/** Remembers `facet` (`null` for All) under `kind`. */
export function rememberFacet(kind, facet, storage = defaultStorage()) {
    if (!KIND_ORDER.includes(kind)) return readPickerState(storage);
    const state = readPickerState(storage);
    if (facet) state.facets[kind] = String(facet);
    else delete state.facets[kind];
    return writePickerState(state, storage);
}

/** Remembers the model `base` chip (`null` for All, `""` for unknown). */
export function rememberBase(base, storage = defaultStorage()) {
    const state = readPickerState(storage);
    state.base = base === null || base === undefined ? null : String(base);
    return writePickerState(state, storage);
}

/** Returns `remembered` if it is in `offered`, else `null`. */
export function pickOffered(remembered, offered) {
    if (remembered === null || remembered === undefined) return null;
    return offered.includes(remembered) ? remembered : null;
}

/** Recent `{kind, id}` items sent on messages from this browser, newest first, up to RECENT_MAX. */
export function readRecent(storage = defaultStorage()) {
    const raw = readJson(storage, RECENT_KEY, []);
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const entry of raw) {
        const kind = typeof entry?.kind === 'string' ? entry.kind : '';
        const id = typeof entry?.id === 'string' ? entry.id : '';
        const key = `${kind}\0${id}`;
        if (!kind || !id || seen.has(key)) continue;
        seen.add(key);
        out.push({ kind, id });
        if (out.length >= RECENT_MAX) break;
    }
    return out;
}

/**
 * Adds items from `refs` attached from the picker (`ref.attached === true`, excluding pictures) to
 * the browser's recent list, newest first, up to RECENT_MAX. Writes nothing when `privateTask` is true.
 */
export function recordRecent(refs, { privateTask = false, storage = defaultStorage() } = {}) {
    const existing = readRecent(storage);
    if (privateTask || !Array.isArray(refs) || !refs.length) return existing;
    const picked = refs.filter(ref => ref?.attached && typeof ref.kind === 'string' && ref.kind && ref.kind !== 'pictures' && typeof ref.id === 'string' && ref.id);
    if (!picked.length) return existing;
    const next = [];
    const seen = new Set();
    for (const ref of [...picked].reverse()) {
        const key = keyOf(ref.kind, ref.id);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ kind: ref.kind, id: ref.id });
    }
    for (const entry of existing) {
        const key = keyOf(entry.kind, entry.id);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(entry);
        if (next.length >= RECENT_MAX) break;
    }
    const capped = next.slice(0, RECENT_MAX);
    writeJson(storage, RECENT_KEY, capped);
    return capped;
}

/**
 * Live items of `kind` (`'nodes'` accepts both `'nodes'` and `'packs'`) from `recentEntries`
 * (newest first), skipping entries missing from `byKey`.
 */
export function resolveRecentItems(kind, recentEntries, byKey) {
    const accept = kind === 'nodes' ? new Set(['nodes', 'packs']) : new Set([kind]);
    const out = [];
    for (const entry of recentEntries || []) {
        if (!accept.has(entry.kind)) continue;
        const found = byKey.get(keyOf(entry.kind, entry.id));
        if (found) out.push(found);
    }
    return out;
}

/**
 * Counts valid `recentEntries` (keeping unloaded entries provisional until their source loads).
 */
export function countRecent(recentEntries, byKey, isKindLoaded) {
    let count = 0;
    for (const entry of recentEntries || []) {
        if (!isKindLoaded(entry.kind) || byKey.has(keyOf(entry.kind, entry.id))) count++;
    }
    return count;
}

/**
 * Filters and ranks items for a picker filter tab (`all` | `given` | `liked` | `recent`).
 */
export function filterPickerItems({ kind, filter, query, rawItems, recentEntries, byKey, favIds, given, liked, search }) {
    if (filter === 'recent') {
        const recent = resolveRecentItems(kind, recentEntries, byKey);
        return query ? search(recent, query, favIds) : recent;
    }
    const base = search(rawItems, query, favIds);
    if (filter === 'given') return base.filter(given);
    if (filter === 'liked') return base.filter(liked);
    return base;
}
