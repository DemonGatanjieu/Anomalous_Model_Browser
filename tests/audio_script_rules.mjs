import assert from 'node:assert/strict';
import { buildScriptPackage, buildTtsPrompt, comboValueForPath, composeScript, joinSegments, parseTaggedSpeech, splitScriptLines, splitSegmentAt, ttsOutputPrefix, usableEmotions } from '../web/modules/audio_script.js';

// Sentence splitting keeps decimals and abbreviations without trailing space.
assert.deepEqual(splitScriptLines('老师好！今天3.5点开会。\nOK. Next line?'), ['老师好！', '今天3.5点开会。', 'OK.', 'Next line?']);
assert.deepEqual(splitScriptLines('  \n\n '), []);
// Ellipses never split; stacked marks and closing quotes stay with their sentence;
// punctuation-only pieces are attached to a neighbour instead of becoming a card.
assert.deepEqual(splitScriptLines('嗯……好吧。'), ['嗯……好吧。']);
assert.deepEqual(splitScriptLines('我……我不知道。那就这样吧！'), ['我……我不知道。', '那就这样吧！']);
assert.deepEqual(splitScriptLines('真的吗？！」他说。'), ['真的吗？！」', '他说。']);
assert.deepEqual(splitScriptLines('你好。\n……\n再见。'), ['你好。……', '再见。']);
assert.deepEqual(splitScriptLines('……你好。'), ['……你好。']);
assert.deepEqual(splitScriptLines('Wait... what? OK.'), ['Wait... what?', 'OK.']);
assert.deepEqual(splitScriptLines('（笑）好的。'), ['（笑）好的。']);
assert.deepEqual(splitScriptLines('好的。\n！！', 'line'), ['好的。！！']);
// Manual split at the caret.
assert.deepEqual(splitSegmentAt('早上好！今天开会。', 4), ['早上好！', '今天开会。']);
assert.equal(splitSegmentAt('早上好！', 0), null);
assert.equal(splitSegmentAt('早上好！', 4), null);
// Line mode keeps a whole paragraph line as one segment.
assert.deepEqual(splitScriptLines('老师好！今天开会。\n\n好开心！', 'line'), ['老师好！今天开会。', '好开心！']);
assert.equal(joinSegments('老师好！', '今天开会。'), '老师好！今天开会。');
assert.equal(joinSegments('Hello.', 'World'), 'Hello. World');
assert.equal(joinSegments('', 'x'), 'x');

// Once a line is tagged, untagged lines must be pinned to {main}; tags are single-braced.
assert.equal(composeScript([
    { text: '早上好', voice: null },
    { text: '好开心', voice: { tag: '{happy}' } },
    { text: '继续', voice: null },
]), '{main} 早上好\n{happy} 好开心\n{main} 继续');
assert.equal(composeScript([{ text: 'a', voice: null }, { text: 'b', voice: null }]), 'a\nb');

const slice = emotion => ({ emotion });
const arona = { group: 'gpt_sovits:Arona', node_value: 'Arona', has_main: true, slices: [slice('main'), slice('happy')] };
assert.deepEqual(usableEmotions(arona), ['main', 'happy']);

// A bundle names the character and tags each line with its emotion.
assert.deepEqual(buildScriptPackage([
    { text: '早上好', emotion: 'main' },
    { text: ' 好开心 ', emotion: 'happy' },
    { text: '   ', emotion: 'happy' },
], arona), { sample: 'Arona', speech: '{main} 早上好\n{happy} 好开心', lineCount: 2 });
// All-main scripts stay plain text.
assert.equal(buildScriptPackage([{ text: 'a', emotion: 'main' }, { text: 'b' }], arona).speech, 'a\nb');
assert.equal(buildScriptPackage([{ text: 'a', emotion: 'main' }], null).error, 'scriptDirectorPickCharacter');
assert.equal(buildScriptPackage([{ text: 'a', emotion: 'sad' }], arona).error, 'scriptDirectorVoiceUnusable');
assert.equal(buildScriptPackage([{ text: 'a', emotion: 'main' }], { ...arona, has_main: false }).error, 'scriptDirectorMainMissing');
assert.equal(buildScriptPackage([{ text: 'a', emotion: 'main' }], { ...arona, slices: [slice('happy')] }).error, 'scriptDirectorMainMissing');
assert.equal(buildScriptPackage([{ text: ' ', emotion: 'main' }], arona).error, 'scriptDirectorEmpty');

// Combo values keep the node's own separator; unknown files are not written.
const windowsCombo = { options: { values: ['阿罗娜\\日配', '普拉娜'] } };
assert.equal(comboValueForPath(windowsCombo, '阿罗娜/日配'), '阿罗娜\\日配');
assert.equal(comboValueForPath(windowsCombo, 'Mika'), null);
assert.equal(comboValueForPath({}, 'audio/x.wav'), 'audio/x.wav');
assert.equal(comboValueForPath(windowsCombo, ''), null);

// Saved speech reads back into segments at its tags.
assert.deepEqual(parseTaggedSpeech('开场\n{happy} 哇！\n{main} 好'), [
    { emotion: 'main', text: '开场' }, { emotion: 'happy', text: '哇！' }, { emotion: 'main', text: '好' },
]);
assert.deepEqual(parseTaggedSpeech(composeScript([{ text: 'a', voice: { tag: '{sad}' } }, { text: 'b', voice: null }])),
    [{ emotion: 'sad', text: 'a' }, { emotion: 'main', text: 'b' }]);
assert.deepEqual(parseTaggedSpeech(''), []);

// GPT-SoVITS direct runs: a retaken line gets [take:N] after its emotion tag, only when asked for.
const ttsGroup = { node_value: '阿罗娜/日配', slices: [{ emotion: 'main' }, { emotion: '开心' }] };
const retaken = [{ text: '一。', emotion: 'main', take: 1 }, { text: '二。', emotion: '开心', take: 3 }, { text: '三。', emotion: 'main', take: 2 }];
assert.equal(buildScriptPackage(retaken, ttsGroup, { takes: true }).speech, '{main} 一。\n{开心} [take:3]二。\n{main} [take:2]三。');
assert.equal(buildScriptPackage(retaken, ttsGroup).speech, '{main} 一。\n{开心} 二。\n{main} 三。');
assert.equal(composeScript([{ text: 'a', voice: null, take: 2 }]), '[take:2]a');

// The output folder follows the character, with characters Windows refuses replaced.
assert.equal(ttsOutputPrefix('阿罗娜/日配'), 'audio/阿罗娜/日配/日配');
assert.equal(ttsOutputPrefix('a:b?/..'), 'audio/a_b_/_/_');
const prompt = buildTtsPrompt({ character: '阿罗娜/日配', speech: '{main} 一。', seed: 5, language: 'zh', speed: 1.1 });
assert.deepEqual(prompt[1], { class_type: 'AnomalousTTS_CharacterSpeech', inputs: { character: '阿罗娜/日配', text: '{main} 一。', seed: 5, language: 'zh', speed: 1.1 } });
assert.deepEqual(prompt[2].inputs, { audio: ['1', 0], filename_prefix: 'audio/阿罗娜/日配/日配' });
assert.equal(buildTtsPrompt({ character: 'x', speech: 'a', seed: 1, top_k: 10, temperature: 0.8 })[1].inputs.top_k, 10);
assert.deepEqual(buildTtsPrompt({ character: 'x', speech: 'a', seed: 1, preview: true })[2], { class_type: 'PreviewAudio', inputs: { audio: ['1', 0] } });
assert.equal('preview' in buildTtsPrompt({ character: 'x', speech: 'a', seed: 1, preview: true })[1].inputs, false);

console.log('audio script rules OK');
