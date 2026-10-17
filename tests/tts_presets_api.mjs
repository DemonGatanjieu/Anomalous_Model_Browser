// Run: node tests/tts_presets_api.mjs  (pure helpers of the generation presets; no ComfyUI needed)
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = await import(pathToFileURL(path.join(root, 'web/modules/tts_presets_api.js')).href);

const builtin = {
    stable: { top_k: 10, top_p: 1, temperature: 0.8, repetition_penalty: 1.35 },
    standard: { top_k: 15, top_p: 1, temperature: 1, repetition_penalty: 1.35 },
    lively: { top_k: 30, top_p: 1, temperature: 1.1, repetition_penalty: 1.35 },
};
const view = { default: 'standard', presets: structuredClone(builtin), builtin, languages: { 'ja>en': 'standard' }, cross: 'stable' };

// Language table: every pair the characters can meet, plus rules already in the file.
const groups = [{ language: 'ja', raw: { reference: { language: 'ja' } } }, { language: 'zh', raw: {} }, { language: '', raw: {} }];
assert.deepEqual(api.languagePairs(groups), ['ja>zh', 'ja>en', 'zh>ja', 'zh>en']);
assert.deepEqual(api.languagePairs([], { 'en>ja': 'lively', cross: 'stable' }), ['en>ja']);

// The file keeps only what differs from the built-in values.
assert.deepEqual(api.presetsFile(view, { defaultName: 'standard', numbers: structuredClone(builtin), rules: {}, cross: 'stable' }),
    { format: 1, default: 'standard' });
const changed = structuredClone(builtin);
changed.lively.temperature = 1.2;
assert.deepEqual(api.presetsFile(view, { defaultName: 'lively', numbers: changed, rules: { 'ja>zh': 'stable', 'ja>en': 'standard' }, cross: 'standard' }),
    { format: 1, default: 'lively', presets: { lively: { temperature: 1.2 } }, languages: { 'ja>zh': 'stable', cross: 'standard' } });

// What "general" means for a line: the default preset, or the rule for its pair of languages.
assert.equal(api.generalPreset(view, 'ja', 'ja'), 'standard');
assert.equal(api.generalPreset(view, 'ja', 'en'), 'standard');
assert.equal(api.generalPreset(view, 'ja', 'zh'), 'stable');

// A character's settings as rows and back, keeping every other field.
const settings = { format: 1, aliases: ['阿罗娜'], keep: 1, defaults: { language: 'ja', top_k: 20, by_language: { zh: { preset: 'lively', speed: 1.1, extra: 'x' } } } };
const rows = api.tuningRows(settings);
assert.deepEqual(rows.all, { preset: '', numbers: { top_k: 20 }, speed: null });
assert.deepEqual(rows.zh, { preset: 'lively', numbers: {}, speed: 1.1 });
assert.deepEqual(rows.en, { preset: '', numbers: {}, speed: null });
rows.zh = { preset: '', numbers: {}, speed: null };
rows.en = { preset: 'stable', numbers: { temperature: 0.7 }, speed: 0.9 };
const next = api.mergeTuning(settings, rows);
assert.deepEqual(next.defaults, { language: 'ja', top_k: 20, by_language: { zh: { extra: 'x' }, en: { preset: 'stable', temperature: 0.7, speed: 0.9 } } });
assert.equal(next.keep, 1);
const cleared = api.mergeTuning({ defaults: { preset: 'lively' } }, api.tuningRows({}));
assert.equal(cleared.defaults, undefined);

// Presets made here: written whole with their name, the built-in ones only where changed.
const mine = { ...structuredClone(builtin), custom_a1: { top_k: 12, top_p: 1, temperature: 0.9, repetition_penalty: 1.35 } };
assert.deepEqual(api.presetsFile(view, { defaultName: 'custom_a1', numbers: mine, labels: { custom_a1: '念旁白' }, rules: { 'ja>zh': 'custom_a1' }, cross: 'stable' }),
    { format: 1, default: 'custom_a1', presets: { custom_a1: { label: '念旁白', top_k: 12, top_p: 1, temperature: 0.9, repetition_penalty: 1.35 } }, languages: { 'ja>zh': 'custom_a1' } });
assert.equal(api.presetLabel({ custom_a1: '念旁白' }, 'custom_a1', key => key), '念旁白');
assert.equal(api.presetLabel({}, 'lively', key => key), 'ttsPreset_lively');
const id = api.newPresetId(['custom_a1'], 1000);
assert.match(id, /^custom_[a-z0-9]{1,12}$/);
assert.notEqual(api.newPresetId([id], 1000), id);

// The state the settings and the Script Director change, and back to the same file.
const loaded = { ...view, presets: mine, labels: { custom_a1: '念旁白' }, default: 'custom_a1' };
const editable = api.stateFromView(loaded);
editable.numbers.custom_a1.top_k = 14;
assert.equal(loaded.presets.custom_a1.top_k, 12);
assert.deepEqual(api.presetsFile(loaded, editable).presets.custom_a1, { label: '念旁白', top_k: 14, top_p: 1, temperature: 0.9, repetition_penalty: 1.35 });

// Deleting a preset: where it was used, and those places back on the general setting.
const state = { defaultName: 'custom_a1', numbers: structuredClone(mine), labels: { custom_a1: '念旁白' }, rules: { 'ja>zh': 'custom_a1', 'ja>en': 'lively' }, cross: 'custom_a1' };
const users = [{ raw: { name: '阿罗娜', settings: { defaults: { by_language: { zh: { preset: 'custom_a1' } } } } } }, { raw: { name: '爱丽丝', settings: {} } }];
assert.deepEqual(api.presetUses(state, 'custom_a1', users), { general: ['default', 'ja>zh', 'cross'], characters: ['阿罗娜'] });
api.removePreset(state, 'custom_a1');
assert.deepEqual([state.defaultName, state.rules, state.cross, Object.keys(state.numbers), state.labels],
    ['standard', { 'ja>en': 'lively' }, 'stable', ['stable', 'standard', 'lively'], {}]);

// A dialog row's numbers in effect next to the general ones (layers 1 to 4).
const general = { ...view, default: 'standard', languages: { 'ja>en': 'standard' }, cross: 'stable' };
const tuning = api.tuningRows({ defaults: { preset: 'lively', speed: 1.2, by_language: { zh: { top_k: 5 } } } });
const own = api.lineTuning(general, tuning, 'ja', 'ja');
assert.deepEqual([own.values.top_k, own.values.speed, own.general.top_k, own.general.speed], [30, 1.2, 15, 1]);
const chinese = api.lineTuning(general, tuning, 'ja', 'zh'); // the rule for other languages over the character's preset, then its own number
assert.deepEqual([chinese.values.top_k, chinese.values.temperature, chinese.values.speed, chinese.general.top_k], [5, 0.8, 1.2, 10]);
const gone = api.lineTuning(general, api.tuningRows({ defaults: { preset: 'custom_zz' } }), 'ja', 'all'); // deleted since: skipped
assert.deepEqual(gone.values, gone.general);

// Steady to lively: the built-in presets in order, and words against a base.
assert.deepEqual(['stable', 'standard', 'lively'].map(name => api.liveliness(builtin[name])), [28, 49, 70]);
assert.equal(api.compareFeel(builtin.standard, builtin.stable), 'steadier');
assert.equal(api.compareFeel(builtin.stable, builtin.lively), 'muchLivelier');
assert.equal(api.compareFeel(builtin.standard, { ...builtin.standard, temperature: 1.1 }), 'livelier');
assert.equal(api.compareFeel(builtin.standard, { ...builtin.standard, repetition_penalty: 1.5 }), 'about');

console.log('tts_presets_api: all checks passed');
