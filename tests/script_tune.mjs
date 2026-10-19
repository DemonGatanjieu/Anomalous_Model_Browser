// How each voice-over line is read: its own values over its character's, and the tags for them
// (web/modules/script_tune.js), written into the script and read back (audio_script.js).
import assert from 'node:assert/strict';
import { buildScriptPackage, parseTaggedSpeech } from '../web/modules/audio_script.js';
import {
    characterLayer, clearLineTune, hasOwnTune, lineLayer, lineValues, readTuneTag, scriptLayer, setLineTune, sharedValue, tuneTags,
} from '../web/modules/script_tune.js';

const character = { language: 'auto', speed: 1, preset: '' };
const stored = { language: 'auto', speed: 1, preset: '' };

// A line follows its character until it sets something itself; setting undefined follows again.
const line = { text: 'a' };
assert.deepEqual(lineValues(line, character), character);
setLineTune([line], 'speed', 1.2);
setLineTune([line], 'preset', 'lively');
assert.deepEqual(lineValues(line, character), { language: 'auto', speed: 1.2, preset: 'lively' });
assert.equal(hasOwnTune(line), true);
setLineTune([line], 'speed', undefined);
assert.deepEqual(line.tune, { preset: 'lively' });
setLineTune([line], 'preset', undefined);
assert.equal('tune' in line, false);
setLineTune([line], 'language', 'ja');
clearLineTune([line]);
assert.equal(hasOwnTune(line), false);

// Tags: what differs from what the node gives by itself; back to auto is written as auto.
assert.equal(tuneTags(character, stored), '');
assert.equal(tuneTags({ language: 'ja', speed: 1.15000001, preset: 'stable' }, stored), '[lang:ja][speed:1.15][preset:stable]');
assert.equal(tuneTags({ language: 'auto', speed: 1.1, preset: '' }, { speed: 1.1 }), '');
assert.equal(tuneTags({ language: 'auto', speed: 1, preset: '' }, { language: 'zh', speed: 1, preset: 'lively' }), '[lang:auto][preset:auto]');

// Setting a line to what its character reads it with lets it follow again.
const same = { text: 'x' };
setLineTune([same], 'speed', 1.3, () => 1.3);
assert.equal(hasOwnTune(same), false);

// Three layers, the most particular first, and where each value comes from.
const base = { language: 'auto', speed: 1, preset: '' };
assert.deepEqual(scriptLayer({ speed: 0.9 }, base), { values: { language: 'auto', speed: 0.9, preset: '' }, from: { language: 'default', speed: 'script', preset: 'default' } });
const arisLayer = characterLayer({ preset: 'lively' }, { speed: 0.9, preset: 'stable' }, { language: 'ja', speed: 1.1, preset: '' }, base);
assert.deepEqual(arisLayer.values, { language: 'ja', speed: 0.9, preset: 'lively' });
assert.deepEqual(arisLayer.from, { language: 'usual', speed: 'script', preset: 'character' });
const own = lineLayer({ text: 'a', tune: { speed: 1.2 } }, arisLayer);
assert.deepEqual([own.values.speed, own.from.speed, own.from.language], [1.2, 'line', 'usual']);

// One value over several lines: mixed, all set by the lines, or some.
const lines = [{ text: 'a', tune: { speed: 1.2 } }, { text: 'b' }];
assert.deepEqual(sharedValue(lines, 'speed', l => lineValues(l, character)), { value: 1.2, mixed: true, own: false, some: true });
assert.deepEqual(sharedValue(lines, 'language', l => lineValues(l, character)), { value: 'auto', mixed: false, own: false, some: false });

// The tag reader: settings only, a name stays a name.
assert.deepEqual(readTuneTag('speed:1.2'), { field: 'speed', value: 1.2 });
assert.deepEqual(readTuneTag('语言：中文'), { field: 'language', value: 'zh' });
assert.deepEqual(readTuneTag('lang:fr'), { field: 'language', value: undefined });
assert.deepEqual(readTuneTag('lang:JA'), { field: 'language', value: 'ja' });
assert.deepEqual(readTuneTag('预设:custom_a1'), { field: 'preset', value: 'custom_a1' });
assert.deepEqual(readTuneTag('preset:auto'), { field: 'preset', value: '' });
assert.deepEqual(readTuneTag('lang:auto'), { field: 'language', value: 'auto' });
assert.equal(readTuneTag('普拉娜'), null);

// Written into a bundle (before [take:N], after the speaker and emotion) and read back for "voice it again".
const slice = emotion => ({ emotion });
const arona = { group: 'gpt_sovits:Arona', node_value: 'Arona', has_main: true, slices: [slice('main'), slice('happy')] };
const aris = { group: 'gpt_sovits:Aris', node_value: 'Aris', has_main: true, slices: [slice('main')] };
const script = [
    { text: '早上好', emotion: 'happy', take: 2, tune: { speed: 0.9 } },
    { text: '你好', emotion: 'main', speaker: 'gpt_sovits:Aris', tune: { language: 'ja', preset: 'lively' } },
    { text: '再见', emotion: 'main', speaker: 'gpt_sovits:Aris' },
];
const tagsOf = (l, speaker) => tuneTags(lineValues(l, character), speaker === aris ? { speed: 1 } : stored);
const pkg = buildScriptPackage(script, arona, { takes: true, groups: [arona, aris], tagsOf });
assert.equal(pkg.speech, '{happy} [speed:0.9][take:2]早上好\n[Aris]{main} [lang:ja][preset:lively]你好\n{main} 再见');
assert.deepEqual(parseTaggedSpeech(pkg.speech), [
    { emotion: 'happy', text: '早上好', tune: { speed: 0.9 } },
    { emotion: 'main', text: '你好', speaker: 'Aris', tune: { language: 'ja', preset: 'lively' } },
    { emotion: 'main', text: '再见', speaker: 'Aris' },
]);
// Without tagsOf nothing changes.
assert.equal(buildScriptPackage(script, arona, { groups: [arona, aris] }).speech, '{happy} 早上好\n[Aris]{main} 你好\n{main} 再见');

console.log('script_tune ok');
