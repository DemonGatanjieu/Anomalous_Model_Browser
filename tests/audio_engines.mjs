// Run: node tests/audio_engines.mjs  (fetch is stubbed; no ComfyUI needed)
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const calls = [];
const character = {
    name: '阿罗娜/日配', aliases: ['阿罗娜'], language: 'ja', settings: { format: 1, keep: 1 },
    counts: { gpt: 1, sovits: 1, audio: 2 },
    reference: { audio: 'ref/a.wav', text: 'こんにちは', language: 'ja', source: 'auto' },
    emotions: { 开心: { audio: 'ref/a.开心.wav', text: '', language: 'ja', source: 'filename' } },
};
globalThis.fetch = async (url) => {
    calls.push(url);
    const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
    if (url.startsWith('/object_info/')) {
        const cls = decodeURIComponent(url.slice('/object_info/'.length));
        return json(cls === 'AnomalousTTS_CharacterSpeech' ? { [cls]: {} } : {});
    }
    if (url.startsWith('/anomalous_tts/characters?name=')) {
        return json({ format: 2, character: { ...character, audio: ['ref/a.wav', 'ref/a.开心.wav'] } });
    }
    if (url.startsWith('/anomalous_tts/characters')) return json({ format: 2, characters: [character, { name: 'broken', error: 'x' }] });
    return json(null, 404);
};

const engines = await import(pathToFileURL(path.join(root, 'web/modules/audio_engines.js')).href);

// Summary list → voice groups; main first, filename emotions kept.
const first = await engines.loadVoices();
assert.equal(first.installed, true);
assert.equal(first.error, '');
const arona = first.groups.find(g => g.character === '阿罗娜/日配');
assert.deepEqual(arona.slices.map(s => s.emotion), ['main', '开心']);
assert.equal(arona.has_main, true);
assert.equal(first.groups.find(g => g.character === 'broken').has_main, false);

// Re-rendering (sidebar click, studio + sidebar together) does not hit the server again.
const before = calls.length;
await Promise.all([engines.loadVoices(), engines.loadVoices(), engines.isTtsInstalled()]);
assert.equal(calls.length, before, `unexpected requests: ${calls.slice(before)}`);
assert.equal(await engines.isTtsInstalled(), true);
assert.ok(!calls.some(url => url.includes('F5TTS')), 'no F5-TTS probe');

// Refresh asks the node to rescan once; later loads use its cache again.
engines.invalidateEngineCache({ rescan: true });
await engines.loadVoices();
assert.ok(calls.includes('/anomalous_tts/characters?refresh=1'));
engines.invalidateEngineCache();
await engines.loadVoices();
assert.equal(calls.at(-1), '/anomalous_tts/characters');

// File lists come from the per-character detail.
const detail = await engines.fetchGptSovitsCharacter('阿罗娜/日配');
assert.deepEqual(detail.audio, ['ref/a.wav', 'ref/a.开心.wav']);
assert.equal(calls.at(-1), `/anomalous_tts/characters?name=${encodeURIComponent('阿罗娜/日配')}`);

// Saving keeps fields Anomalous does not know.
const merged = engines.mergeGptSovitsSettings({ format: 1, keep: 1, reference: { audio: 'old.wav', language: 'ja' } }, {
    main: { audio: 'ref/a.wav', text: '' },
    emotions: [{ name: '开心', audio: 'ref/a.开心.wav', text: 'x' }, { name: 'main', audio: 'y.wav' }],
});
assert.deepEqual(merged, {
    format: 1, keep: 1,
    reference: { audio: 'ref/a.wav', language: 'ja' },
    emotions: { 开心: { audio: 'ref/a.开心.wav', text: 'x' } },
});

console.log('audio_engines: ok');
