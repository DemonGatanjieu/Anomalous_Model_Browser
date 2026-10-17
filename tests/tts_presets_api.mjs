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

console.log('tts_presets_api: all checks passed');
