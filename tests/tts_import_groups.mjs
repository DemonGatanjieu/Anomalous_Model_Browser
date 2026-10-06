import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const load = (rel) => import(pathToFileURL(path.resolve(rel)).href);
globalThis.localStorage = { getItem: () => null, setItem() {} };
const g = await load('web/modules/tts_import_groups.js');

assert.equal(g.weightStem('ALuoNa-e15.ckpt', 'gpt'), 'ALuoNa');
assert.equal(g.weightStem('ALuoNa_e16_s224.pth', 'sovits'), 'ALuoNa');
assert.equal(g.weightStem('plain.ckpt', 'gpt'), 'plain');
assert.equal(g.groupKey('Hoshino Takanashi_v2'), 'hoshinotakanashiv2');

// A package: two characters' weights, clips in per-character folders, one stray clip.
const items = [
    { name: 'ALuoNa-e15.ckpt', dir: 'GPT_weights_v2', kind: 'gpt' },
    { name: 'ALuoNa_e16_s224.pth', dir: 'SoVITS_weights_v2', kind: 'sovits' },
    { name: 'Hoshino-e10.ckpt', dir: 'GPT_weights_v2', kind: 'gpt' },
    { name: 'Hoshino_e8_s96.pth', dir: 'SoVITS_weights_v2', kind: 'sovits' },
    { name: 'talk_1.wav', dir: 'refs/aluona', kind: 'audio' },
    { name: 'Hoshino_happy.wav', dir: '', kind: 'audio' },
    { name: 'hoshino.list', dir: 'lists', kind: 'text' },
    { name: 'misc.wav', dir: 'other', kind: 'audio' },
];
const first = g.groupFiles(items, []);
assert.deepEqual(first.added, [{ key: 'aluona', name: 'ALuoNa' }, { key: 'hoshino', name: 'Hoshino' }]);
assert.deepEqual(first.assign, ['aluona', 'aluona', 'hoshino', 'hoshino', 'aluona', 'hoshino', 'hoshino', null]);

// A later drop joins the characters already open; one character takes everything.
assert.deepEqual(g.groupFiles([{ name: 'x.wav', dir: 'ALuoNa voice', kind: 'audio' }], [{ key: 'aluona' }, { key: 'hoshino' }]).assign, ['aluona']);
assert.deepEqual(g.groupFiles([{ name: 'x.wav', dir: '', kind: 'audio' }], [{ key: 'aluona' }]).assign, ['aluona']);
// Adding to an existing character: even weights go into it.
assert.deepEqual(g.groupFiles([{ name: 'New-e5.ckpt', dir: '', kind: 'gpt' }], [{ key: 'arona', target: 'Arona' }]), { added: [], assign: ['arona'], shared: [] });
// Nothing open and no weights: one blank character.
assert.deepEqual(g.groupFiles([{ name: 'a.wav', dir: '', kind: 'audio' }], []), { added: [{ key: '', name: '' }], assign: [''], shared: [] });

// Draft states.
const row = (kind, extra = {}) => ({ kind, name: `${kind}.x`, emotion: '', error: '', uploaded: true, progress: 1, existing: null, ...extra });
const full = [row('gpt'), row('sovits'), row('audio')];
assert.equal(g.draftState({ name: 'A', rows: full, main: 'a.wav' }).tone, 'ready');
assert.equal(g.draftState({ name: 'A', rows: full }).problem[0], 'ttsBatchNoMain');
assert.equal(g.draftState({ name: 'A', rows: [row('gpt'), row('sovits')] }).problem[0], 'ttsBatchNoAudio');
assert.equal(g.draftState({ name: '', rows: full }).problem[0], 'ttsImportNameMissing');
assert.equal(g.draftState({ name: 'A', rows: [...full, row('audio', { uploaded: false })] }).tone, 'busy');
assert.equal(g.draftState({ name: 'A', rows: [...full, row('audio', { error: 'x' })] }).tone, 'error');
assert.equal(g.draftState({ name: 'A', rows: full, main: 'a.wav', duplicate: true }).problem[0], 'ttsBatchDuplicateName');
assert.equal(g.draftState({ name: 'A', rows: full, done: true }).tone, 'done');
assert.equal(g.draftState({ target: 'A', rows: [row('audio')] }).tone, 'ready');
assert.equal(g.draftState({ name: 'A', rows: [row('gpt'), row('sovits', { supported: false, version: 'v4' }), row('audio')] }).tone, 'error');

// Checklist: the first open item is the next step.
const next = list => list.find(item => !item.done)?.id ?? null;
assert.equal(next(g.draftChecklist({ name: '', rows: [] })), 'gpt');
assert.equal(next(g.draftChecklist({ name: 'A', rows: [row('gpt')] })), 'sovits');
assert.equal(next(g.draftChecklist({ name: 'A', rows: [row('gpt'), row('sovits')] })), 'audio');
assert.equal(next(g.draftChecklist({ name: 'A', rows: full })), 'main');
// Clips outside 3–10 s (and their same-name line files) are left out: all short → the clip step is open again.
const short = [row('gpt'), row('sovits'), row('audio', { name: 's.wav', seconds: 1 })];
assert.equal(next(g.draftChecklist({ name: 'A', rows: short })), 'audio');
assert.equal(g.draftChecklist({ name: 'A', rows: short }).find(i => i.id === 'audio').key, 'ttsCheckAudioNoneUsable');
assert.equal(g.draftState({ name: 'A', rows: short }).problem[0], 'ttsBatchNoAudio');
assert.deepEqual([...g.leftOut([{ kind: 'audio', name: 's.wav', seconds: 1 }, { kind: 'text', name: 's.lab' }, { kind: 'text', name: 'all.list' },
    { kind: 'audio', name: 'ok.wav', seconds: 5 }, { kind: 'text', name: 'ok.txt' }, { kind: 'audio', name: 'wait.wav' }])], [0, 1]);

// Program and training folders are skipped.
// Program and training folders only inside a package; environments always.
assert.equal(g.skipFolder('runtime', false), true);
assert.equal(g.skipFolder('logs', true), true);
assert.equal(g.skipFolder('logs', false), false, 'a folder of your own called logs is read');
assert.equal(g.skipFolder('参考音频', true), false);
assert.equal(g.isPackage(['runtime', 'GPT_weights_v2']), true);

// A folder per character: the weights inside a folder own the files around them, even when
// the names do not match (pinyin weights, Chinese folders, English clips).
const perFolder = [
    { name: 'ALuoNa-e15.ckpt', dir: '阿罗娜/日配/成品模型/GPT_weights_v2', kind: 'gpt' },
    { name: 'ALuoNa_cn-e15.ckpt', dir: '阿罗娜/中配/成品模型/GPT_weights_v2', kind: 'gpt' },
    { name: 'Guang-e15.ckpt', dir: '光/GPT_weights_v2', kind: 'gpt' },
    { name: 'Guang_v4-e15.ckpt', dir: '光/GPT_weights_v4', kind: 'gpt' },
    { name: 'Arona_Talk_1.wav', dir: '阿罗娜/日配/参考音频', kind: 'audio' },
    { name: 'cn_1.wav', dir: '阿罗娜/中配/参考音频', kind: 'audio' },
    { name: 'ch0242_1.wav', dir: '光/all', kind: 'audio' },
    { name: 'all.txt', dir: '光', kind: 'text' },
    { name: 'stray.wav', dir: '', kind: 'audio' },
];
assert.deepEqual(g.groupFiles(perFolder, []).assign, ['aluona', 'aluonacn', 'guang', 'guangv4', 'aluona', 'aluonacn', 'guang', 'guang', null]);
// One character: files beside its folders are its own; another top folder without weights waits.
const lone = [{ name: 'K-e15.ckpt', dir: '佳代子/GPT_weights_v2', kind: 'gpt' }, { name: 'a.wav', dir: '佳代子/ref', kind: 'audio' }, { name: 'm.wav', dir: '杂项', kind: 'audio' }];
assert.deepEqual(g.groupFiles(lone, []).assign, ['k', 'k', null]);
const siblings = [{ name: 'K-e15.ckpt', dir: 'GPT_weights_v2', kind: 'gpt' }, { name: 'a.wav', dir: '参考音频', kind: 'audio' }];
assert.deepEqual(g.groupFiles(siblings, []).assign, ['k', 'k']);
assert.equal(next(g.draftChecklist({ name: '', rows: full, main: 'a.wav' })), 'name');
assert.equal(g.draftChecklist({ name: 'A', rows: full, main: 'a.wav', conflict: { kind: 'exact' } }).find(i => i.id === 'name').key, 'ttsCheckNameTaken');
assert.equal(next(g.draftChecklist({ name: 'A', rows: full, main: 'a.wav' })), null);
assert.equal(g.draftChecklist({ name: 'A', rows: [row('gpt'), row('sovits', { supported: false, version: 'v4' })] }).find(i => i.id === 'sovits').key, 'ttsCheckSovitsUnsupported');
assert.deepEqual(g.draftChecklist({ target: 'A', rows: [] }).map(i => [i.id, i.done]), [['files', false]]);

console.log('tts_import_groups: all checks passed');
