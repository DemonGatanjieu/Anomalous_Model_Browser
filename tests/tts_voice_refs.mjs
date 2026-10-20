// The reference audio editor's rules (web/modules/tts_voice_refs.js): voices with a main and
// auxiliary references, fixed lines, the settings written back, and the list's order.
import assert from 'node:assert/strict';
import {
    clearMain, fitsMain, listClips, nameProblem, readVoices, roleOf, setMain, toggleAux, usesOf, voiceCount, voicesProblem, writeSettings,
} from '../web/modules/tts_voice_refs.js';

const settings = {
    format: 1,
    keep: { me: true },
    reference: { language: 'ja', aux: ['b.wav', 'b.wav', 7] }, // the main reference is automatic
    emotions: {
        开心: { audio: 'h.wav', text: '自分の台詞', aux: ['h.wav', 'b.wav'] },
        main: { audio: 'x.wav' },
    },
    lines: { 'c.wav': '直した', 'd.wav': ' ' },
};
const detail = {
    reference: { audio: 'a.wav', source: 'auto' },
    emotions: { 开心: { audio: 'h.wav', source: 'settings' }, 生气: { audio: 'a.生气.wav', source: 'filename' } },
};

// Reading: the main voice, the saved emotions, then the ones found from file names.
const { voices, fixes } = readVoices(settings, detail, { lineFixes: true });
assert.deepEqual(voices.map(voice => [voice.name, voice.main, voice.aux, voice.filename]), [
    ['main', null, ['b.wav'], false],
    ['开心', 'h.wav', ['b.wav'], false],
    ['生气', 'a.生气.wav', [], true],
]);
assert.deepEqual([...fixes], [['c.wav', '直した'], ['h.wav', '自分の台詞']], "a voice's own text becomes its clip's line");
assert.equal('text' in voices[1].kept, false);
// A voice's text that is the clip's line anyway is not a fix.
assert.equal(readVoices(settings, detail, { lineFixes: true, found: new Map([['h.wav', '自分の台詞']]) }).fixes.has('h.wav'), false);
// An older node: the voice keeps its own text, no lines are fixed here.
const old = readVoices(settings, detail);
assert.equal(old.fixes.size, 0);
assert.equal(old.voices[1].kept.text, '自分の台詞');

// Main and auxiliary references for one voice.
const [main, happy, angry] = voices;
assert.equal(roleOf(happy, 'h.wav'), 'main');
assert.equal(roleOf(happy, 'b.wav'), 'aux');
assert.equal(roleOf(happy, 'z.wav'), null);
toggleAux(happy, 'h.wav');
assert.deepEqual(happy.aux, ['b.wav'], 'the main reference is not also an auxiliary one');
setMain(happy, 'b.wav');
assert.deepEqual([happy.main, happy.aux], ['b.wav', []]);
toggleAux(happy, 'h.wav');
toggleAux(main, 'c.wav');
assert.deepEqual(usesOf(voices, 'b.wav', happy), [{ name: 'main', role: 'aux' }]);
assert.deepEqual(usesOf(voices, 'b.wav'), [{ name: 'main', role: 'aux' }, { name: '开心', role: 'main' }]);
setMain(main, 'a.wav');
clearMain(main);
assert.equal(main.main, null);
clearMain(happy);
assert.equal(happy.main, 'b.wav', 'only the main voice can go back to the automatic pick');

// Lengths and names.
assert.equal(fitsMain(0), true);
assert.equal(fitsMain(5), true);
assert.equal(fitsMain(12.3), false);
assert.equal(fitsMain(1), false);
assert.equal(nameProblem('  ', voices), 'ttsRefsNameMissing');
assert.equal(nameProblem('main', voices), 'ttsEditorNameInvalid');
assert.equal(nameProblem('a{b}', voices), 'ttsEditorNameInvalid');
assert.equal(nameProblem('开心', voices), 'ttsEditorNameDuplicate');
assert.equal(nameProblem('开心', voices, happy), '');
assert.equal(nameProblem('害羞', voices), '');

// What keeps them from being saved.
const files = ['a.wav', 'b.wav', 'c.wav', 'h.wav', 'a.生气.wav'];
assert.equal(voicesProblem(voices, files), null);
const shy = { key: 'e:害羞', name: '害羞', main: null, aux: [], kept: {}, filename: false, touched: true };
assert.deepEqual(voicesProblem([...voices, shy], files), { key: 'ttsRefsNoMain', values: { name: '害羞' } });
assert.deepEqual(voicesProblem(voices, ['a.wav']), { key: 'ttsEditorUnknownAudio', values: { file: 'b.wav' } });

// Writing back: unknown fields stay; an emotion from a file name only once changed; fixed lines.
fixes.set('h.wav', '  変えた  ');
const next = writeSettings(settings, voices, fixes, { aux: true, lines: true });
assert.deepEqual(next, {
    format: 1,
    keep: { me: true },
    reference: { language: 'ja', aux: ['b.wav', 'c.wav'] },
    emotions: { 开心: { audio: 'b.wav', aux: ['h.wav'] } },
    lines: { 'c.wav': '直した', 'h.wav': '変えた' },
});
toggleAux(angry, 'c.wav');
assert.deepEqual(writeSettings(settings, voices, fixes, { aux: true, lines: true }).emotions['生气'], { audio: 'a.生气.wav', aux: ['c.wav'] });
// An older node: auxiliary references and lines stay as they were.
const older = writeSettings(settings, voices, new Map(), {});
assert.deepEqual(older.reference.aux, settings.reference.aux);
assert.deepEqual(older.emotions['开心'].aux, ['h.wav', 'b.wav']);
assert.deepEqual(older.lines, settings.lines);
// Nothing left: the entries go.
const bare = writeSettings({ format: 1, reference: { audio: 'a.wav' }, emotions: {}, lines: { 'a.wav': 'x' } },
    [{ key: 'main', name: 'main', main: null, aux: [], kept: {}, filename: false, touched: true }], new Map(), { aux: true, lines: true });
assert.deepEqual(bare, { format: 1 });

// The list: this voice's main, then its auxiliary ones, then the rest in folder order; filters and search.
const lineOf = path => ({ 'a.wav': 'おはよう', 'c.wav': '直した' })[path] || '';
const order = listClips(files, { voice: happy, voices, lineOf });
assert.deepEqual(order, ['b.wav', 'h.wav', 'a.wav', 'c.wav', 'a.生气.wav']);
assert.deepEqual(listClips(files, { voice: happy, voices, lineOf, filter: 'here' }), ['b.wav', 'h.wav']);
assert.deepEqual(listClips(files, { voice: happy, voices, lineOf, filter: 'noline' }), ['b.wav', 'h.wav', 'a.生气.wav']);
assert.deepEqual(listClips(files, { voice: happy, voices, lineOf, query: 'おはよ' }), ['a.wav']);
assert.deepEqual(listClips(files, { voice: happy, voices, lineOf, query: '生气' }), ['a.生气.wav']);

// The counts on the voice tabs.
assert.deepEqual(voiceCount(main), { key: 'ttsRefsCountAutoAux', values: { aux: 2 } });
assert.deepEqual(voiceCount(happy), { key: 'ttsRefsCountAux', values: { aux: 1 } });
assert.deepEqual(voiceCount({ main: 'x', aux: [] }), { key: 'ttsRefsCountMain', values: { aux: 0 } });

console.log('tts_voice_refs: ok');
