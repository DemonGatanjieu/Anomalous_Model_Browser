/**
 * Which pages and tools the left rail shows ("pinned"); the others wait under its More button
 * (ui_rail_more.js). Pure state, no DOM: ui_shell_rail.js owns it and keeps it in localStorage.
 *
 * The core entries are always on the rail. What else is, the first load decides: a browser that never
 * ran Anomalous gets the core only; one that ran an earlier version keeps what it used, read at once
 * from its own storage and once from what is on disk (GET /anomalous/rail_hints, applyRailHints).
 * Character voices come on by themselves when Anomalous_TTS is installed. Once the user pins, unpins
 * or resets, nothing pins for them again (`customized`).
 */

export const RAIL_PINS_KEY = 'anomalous_rail_pins';
export const CORE_RAIL_ENTRIES = Object.freeze(['home', 'models', 'gallery', 'recipes', 'doctor']);
export const OPTIONAL_RAIL_ENTRIES = Object.freeze(['combos', 'prompts', 'ai', 'activity', 'voices', 'saves', 'assistant', 'scan']);
// Written by earlier versions as they were used: any of them means this browser ran Anomalous before.
export const LEGACY_STORAGE_KEYS = Object.freeze([
    'anomalous_last_page', 'anomalous_model_scope', 'anomalous_user_sidebar_closed', 'anomalous_audio_list_closed',
    'anomalous_first_run_hidden', 'anomalous_canvas_menu', 'anomalous_view_mode', 'anomalous_pos_x', 'anomalous_applied_sets',
    'anomalous.aiToolboxState', 'anomalous_ai_starter_start_from', 'anomalous_active_domain', 'anomalous_ai_tour_seen',
]);
const AI_KEYS = ['anomalous.aiToolboxState', 'anomalous_ai_starter_start_from', 'anomalous_ai_tour_seen'];
// Voice-over and Audio are views of Voices (ui_shell_nav.js).
const VOICE_PAGES = new Set(['voices', 'script', 'audio-gallery']);
// What rail_hints finds on disk keeps these on the rail. A scan only after an upgrade: a new install's
// first scan is no habit yet, and the scan stays one click away under More.
const HINTED = ['combos', 'prompts', 'ai', 'saves', 'assistant'];

const read = (storage, key) => {
    try {
        return storage?.getItem(key) ?? null;
    } catch (_) {
        return null; // a private window may refuse storage
    }
};

/** The state with the core entries in, unknown ids and repeats out, in the rail's order. */
function normalize(state) {
    const pinned = new Set([...CORE_RAIL_ENTRIES, ...(Array.isArray(state?.pinned) ? state.pinned : [])]);
    return {
        version: 1,
        pinned: [...CORE_RAIL_ENTRIES, ...OPTIONAL_RAIL_ENTRIES].filter(id => pinned.has(id)),
        seeded: state?.seeded === 'upgraded' ? 'upgraded' : 'fresh',
        hintsApplied: Boolean(state?.hintsApplied),
        customized: Boolean(state?.customized),
        ttsAutoPinned: Boolean(state?.ttsAutoPinned),
    };
}

/**
 * The kept state, or the first one: core only for a browser new to Anomalous, else (`upgraded`) with what
 * its storage shows was used. Synchronous, so the rail is drawn right the first time; it must run before the
 * window writes keys of its own (ui_sidebar.js), or a first visit would look like an upgrade.
 */
export function loadRailPins(storage = globalThis.localStorage) {
    try {
        const saved = JSON.parse(read(storage, RAIL_PINS_KEY) || 'null');
        if (saved && typeof saved === 'object' && Array.isArray(saved.pinned)) return normalize(saved);
    } catch (_) { /* unreadable: decided again below */ }
    if (!LEGACY_STORAGE_KEYS.some(key => read(storage, key))) return normalize({ seeded: 'fresh' });
    const pinned = [];
    const last = read(storage, 'anomalous_last_page');
    pinned.push(VOICE_PAGES.has(last) ? 'voices' : last);
    if (AI_KEYS.some(key => read(storage, key))) pinned.push('ai');
    if (read(storage, 'anomalous_applied_sets')) pinned.push('assistant');
    if (read(storage, 'anomalous_active_domain') === 'audio' || read(storage, 'anomalous_audio_list_closed')) pinned.push('voices');
    return normalize({ pinned, seeded: 'upgraded' });
}

export function saveRailPins(state, storage = globalThis.localStorage) {
    try {
        storage?.setItem(RAIL_PINS_KEY, JSON.stringify(state));
    } catch (_) { /* the rail still works for this visit */ }
}

export function isRailPinned(state, id) {
    return CORE_RAIL_ENTRIES.includes(id) || state.pinned.includes(id);
}

/**
 * Adds what was used before and Anomalous_TTS, unless the user chose. `hints`: GET /anomalous/rail_hints,
 * taken once; null when it could not be read (asked again next time). `ttsInstalled` pins Voices once:
 * at the first load, or later when the pack is installed after it.
 */
export function applyRailHints(state, hints, { ttsInstalled = false } = {}) {
    if (state.customized) return state;
    const pinned = [...state.pinned];
    let { hintsApplied, ttsAutoPinned } = state;
    if (hints && !hintsApplied) {
        pinned.push(...HINTED.filter(id => hints[id]));
        if (hints.scan && state.seeded === 'upgraded') pinned.push('scan');
        hintsApplied = true;
    }
    if (ttsInstalled && !ttsAutoPinned) {
        pinned.push('voices');
        ttsAutoPinned = true;
    }
    return normalize({ ...state, pinned, hintsApplied, ttsAutoPinned });
}

/** Pins an optional entry or takes it off; from then on the user decides (`customized`). */
export function toggleRailPin(state, id) {
    if (!OPTIONAL_RAIL_ENTRIES.includes(id)) return state;
    const pinned = state.pinned.includes(id) ? state.pinned.filter(entry => entry !== id) : [...state.pinned, id];
    return normalize({ ...state, pinned, customized: true, hintsApplied: true });
}

/** "Reset to minimal rail": the core entries only, chosen by the user. */
export function resetRailPinsToMinimal(state) {
    return normalize({ ...state, pinned: [], customized: true, hintsApplied: true });
}
