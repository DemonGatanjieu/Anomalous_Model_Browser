// Which entries the left rail shows (web/modules/rail_pins.js): the core only for a browser new to
// Anomalous, what was used kept after an upgrade, Voices with Anomalous_TTS, and the user's own choice
// never overridden again.
import assert from 'node:assert/strict';
import {
    CORE_RAIL_ENTRIES, OPTIONAL_RAIL_ENTRIES, RAIL_PINS_KEY, applyRailHints, isRailPinned, loadRailPins,
    resetRailPinsToMinimal, saveRailPins, toggleRailPin,
} from '../web/modules/rail_pins.js';

const store = (values = {}) => {
    const data = new Map(Object.entries(values));
    return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), data };
};
const optional = state => state.pinned.filter(id => OPTIONAL_RAIL_ENTRIES.includes(id));
const ALL_HINTS = { combos: true, prompts: true, ai: true, saves: true, assistant: true, scan: true };

// A browser new to Anomalous: the core five only.
const fresh = loadRailPins(store());
assert.equal(fresh.seeded, 'fresh');
assert.deepEqual(fresh.pinned, [...CORE_RAIL_ENTRIES]);
assert.ok(CORE_RAIL_ENTRIES.every(id => isRailPinned(fresh, id)));
assert.ok(!isRailPinned(fresh, 'combos'));
assert.deepEqual(loadRailPins(store({ anomalous_last_page: '' })).seeded, 'fresh'); // an empty value is no trace

// An earlier version's browser keeps what its storage shows was used.
const upgraded = loadRailPins(store({ anomalous_last_page: 'prompts', 'anomalous.aiToolboxState': '{}', anomalous_applied_sets: '{}' }));
assert.equal(upgraded.seeded, 'upgraded');
assert.deepEqual(optional(upgraded), ['prompts', 'ai', 'assistant']);
assert.deepEqual(optional(loadRailPins(store({ anomalous_last_page: 'script' }))), ['voices']); // a view of Voices
assert.deepEqual(optional(loadRailPins(store({ anomalous_active_domain: 'audio' }))), ['voices']);
assert.deepEqual(optional(loadRailPins(store({ anomalous_last_page: 'combos' }))), ['combos']);
const quiet = loadRailPins(store({ anomalous_view_mode: 'compact' })); // used, nothing optional
assert.equal(quiet.seeded, 'upgraded');
assert.deepEqual(quiet.pinned, [...CORE_RAIL_ENTRIES]);

// Kept state is read back, cleaned: core always in, unknown ids and repeats out, the rail's order.
const kept = store({ [RAIL_PINS_KEY]: JSON.stringify({ pinned: ['voices', 'nope', 'combos', 'combos'], seeded: 'upgraded', customized: true }) });
assert.deepEqual(loadRailPins(kept).pinned, [...CORE_RAIL_ENTRIES, 'combos', 'voices']);
assert.equal(loadRailPins(kept).customized, true);
assert.equal(loadRailPins(store({ [RAIL_PINS_KEY]: '{bad' })).seeded, 'fresh'); // unreadable: decided again
const saved = store();
saveRailPins(upgraded, saved);
assert.deepEqual(loadRailPins(saved), upgraded);

// What is on disk: kept for both, but a scan only after an upgrade.
const freshHinted = applyRailHints(fresh, ALL_HINTS);
assert.deepEqual(optional(freshHinted), ['combos', 'prompts', 'ai', 'saves', 'assistant']);
assert.equal(freshHinted.hintsApplied, true);
assert.ok(optional(applyRailHints(quiet, { scan: true })).includes('scan'));
assert.deepEqual(optional(applyRailHints(freshHinted, { scan: true })), optional(freshHinted)); // taken once only
assert.deepEqual(applyRailHints(fresh, null), fresh); // not read: asked again next time

// Anomalous_TTS pins Voices once, at the first load or when installed later.
const withTts = applyRailHints(fresh, {}, { ttsInstalled: true });
assert.ok(isRailPinned(withTts, 'voices'));
assert.equal(withTts.ttsAutoPinned, true);
const later = applyRailHints(freshHinted, null, { ttsInstalled: true });
assert.ok(isRailPinned(later, 'voices'));
assert.ok(!isRailPinned(applyRailHints(fresh, {}), 'voices'));

// The user's choice: core cannot leave, and nothing pins over it afterwards.
assert.equal(toggleRailPin(fresh, 'home'), fresh);
assert.equal(toggleRailPin(fresh, 'nope'), fresh);
const chosen = toggleRailPin(withTts, 'voices');
assert.ok(!isRailPinned(chosen, 'voices'));
assert.equal(chosen.customized, true);
assert.deepEqual(applyRailHints(chosen, ALL_HINTS, { ttsInstalled: true }), chosen);
assert.ok(isRailPinned(toggleRailPin(chosen, 'prompts'), 'prompts'));

// Reset: the core five, locked against hints too.
const minimal = resetRailPinsToMinimal(applyRailHints(upgraded, ALL_HINTS, { ttsInstalled: true }));
assert.deepEqual(minimal.pinned, [...CORE_RAIL_ENTRIES]);
assert.equal(minimal.seeded, 'upgraded');
assert.equal(minimal.customized, true);
assert.deepEqual(applyRailHints(minimal, ALL_HINTS, { ttsInstalled: true }), minimal);
