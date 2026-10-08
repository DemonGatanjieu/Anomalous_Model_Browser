// Run: node tests/tts_setup_api.mjs  (fetch is stubbed; no ComfyUI needed)
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const calls = [];
let statusCalls = 0;
let failNextChunk = false;
let received = 0;
globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    const reply = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data), json: async () => data });
    if (url === '/anomalous_tts/status') {
        statusCalls += 1;
        return reply({ format: 3, local: true, libraries: [{ path: 'D:/v', characters: 2, writable: true }],
            pretrained: [{ id: 'hubert', state: 'ok', required: true }, { id: 'g2pw', state: 'missing', required: false }],
            dependencies: { ja: { ok: true, missing: [] } } });
    }
    if (url === '/anomalous_tts/import/upload' && opts.body && !url.includes('?')) { received = 0; return reply({ upload: 'u1' }); }
    if (url.startsWith('/anomalous_tts/import/upload?')) {
        const offset = Number(new URL(url, 'http://x').searchParams.get('offset'));
        if (failNextChunk) { failNextChunk = false; received = offset + 3; return reply({ error: 'offset', received }, 409); }
        received = offset + (await opts.body.arrayBuffer()).byteLength;
        return reply({ received });
    }
    if (url === '/anomalous_tts/import/commit') return reply({ ok: true, character: { name: 'X' } });
    if (url === '/anomalous_tts/pretrained/download') {
        const body = JSON.parse(opts.body);
        return body.ids.includes('nope') ? reply({ error: '不认识的底模：nope' }, 400) : reply({ ok: true });
    }
    return reply(null, 404);
};

const engines = await import(pathToFileURL(path.join(root, 'web/modules/audio_engines.js')).href);
const api = await import(pathToFileURL(path.join(root, 'web/modules/tts_setup_api.js')).href);

// Status is cached across re-renders; any change drops the cache; `force` skips it.
await engines.loadGptSovitsStatus();
await engines.loadGptSovitsStatus();
assert.equal(statusCalls, 1);
await engines.loadGptSovitsStatus({ force: true });
assert.equal(statusCalls, 2);
await api.commitImport({ files: [] });
await engines.loadGptSovitsStatus();
assert.equal(statusCalls, 3);

// File kinds match the node's importer.kind_of.
assert.deepEqual(['a.CKPT', 'b.pth', 'c.Wav', 'd.list', 'e.txt', 'f.md', 'noext'].map(api.importKind),
    ['gpt', 'sovits', 'audio', 'text', 'text', null, null]);

// Chunked upload: 8 MB pieces, resumes from the node's count after a 409.
const size = api.UPLOAD_CHUNK * 2 + 10;
const file = new Blob([new Uint8Array(size)]);
file.name = 'x.ckpt';
const progress = [];
let started = null;
failNextChunk = true;
const id = await api.uploadFile(file, { onStart: u => { started = u; }, onProgress: p => progress.push(p) });
assert.equal(id, 'u1');
assert.equal(started, 'u1');
assert.equal(received, size);
assert.equal(progress.at(-1), 1);
const offsets = calls.filter(c => c.url.includes('offset=')).map(c => Number(new URL(c.url, 'http://x').searchParams.get('offset')));
assert.deepEqual(offsets, [0, 3, 3 + api.UPLOAD_CHUNK, 3 + 2 * api.UPLOAD_CHUNK]);

// Errors carry the node's message.
await assert.rejects(api.startPretrainedDownload(['nope']), /不认识的底模：nope/);
const before = statusCalls;
await api.startPretrainedDownload(['g2pw']);
await engines.loadGptSovitsStatus();
assert.equal(statusCalls, before + 1); // a download drops the cached status
assert.deepEqual(JSON.parse(calls.findLast(c => c.url === '/anomalous_tts/pretrained/download').opts.body), { ids: ['g2pw'] });

// Interface 13: nothing here sends a folder or file path on the computer to the node.
for (const name of ['changeStorage', 'forgetLibrary', 'changePretrainedSource', 'browseFolder', 'scanFolder', 'previewUrl']) {
    assert.equal(name in api, false, name);
}
assert.ok(calls.every(c => !/\/anomalous_tts\/(storage|libraries|browse|pretrained\/source|import\/preview)/.test(c.url)));
assert.deepEqual([1536, 5 * 1024 ** 2, 3 * 1024 ** 3].map(api.formatSize), ['2 KB', '5.0 MB', '3.0 GB']);

// Commit body: file indexes, main voice, emotions; the main row's emotion is ignored.
const rows = [
    { spec: { upload: 'g' }, kind: 'gpt', emotion: '', text: '' },
    { spec: { upload: 's' }, kind: 'sovits', emotion: '', text: '' },
    { spec: { upload: 'a' }, kind: 'audio', emotion: 'ignored', text: '台词' },
    { spec: { upload: 'b' }, kind: 'audio', emotion: '开心', text: '' },
    { spec: { upload: 'c' }, kind: 'audio', emotion: '', text: 'x' },
];
assert.deepEqual(api.buildImportBody({ library: 'D:/v', character: '阿罗娜', rows, referenceIndex: 2, language: 'ja' }), {
    files: rows.map(r => r.spec), library: 'D:/v', character: '阿罗娜',
    settings: { language: 'ja', reference: { file: 2, text: '台词', language: 'ja' }, emotions: { 开心: { file: 3 } } },
});
assert.deepEqual(api.buildImportBody({ target: '普拉娜', rows: rows.slice(3, 4), referenceIndex: null }),
    { files: [{ upload: 'b' }], target: '普拉娜', settings: { emotions: { 开心: { file: 0 } } } });

// Form checks, in the order the user meets them.
assert.deepEqual(api.importProblem({ rows: [] }), ['ttsImportNoFiles', {}]);
assert.deepEqual(api.importProblem({ rows }), ['ttsImportNameMissing', {}]);
assert.deepEqual(api.importProblem({ character: 'X', rows: rows.slice(1) }), ['ttsImportWeightsMissing', {}]);
assert.equal(api.importProblem({ target: 'Y', rows: rows.slice(3) }), null); // adding needs no weights
const dup = [...rows, { ...rows[3], spec: { upload: 'd' } }];
assert.deepEqual(api.importProblem({ character: 'X', rows: dup }), ['ttsEditorNameDuplicate', { name: '开心' }]);
assert.deepEqual(api.importProblem({ character: 'X', rows: [rows[0], rows[1], { ...rows[3], emotion: 'main' }] }),
    ['ttsEditorNameInvalid', { name: 'main' }]);

// One GPT and one SoVITS per form: the latest epoch of a batch wins.
assert.ok(api.weightEpoch('A-e15.ckpt', 'gpt') > api.weightEpoch('A-e5.ckpt', 'gpt'));
assert.ok(api.weightEpoch('A_e16_s224.pth', 'sovits') > api.weightEpoch('A_e16_s100.pth', 'sovits'));
assert.equal(api.weightEpoch('plain.ckpt', 'gpt'), -1);
const batch = [{ name: 'A-e5.ckpt', kind: 'gpt' }, { name: 'A-e15.ckpt', kind: 'gpt' }, { name: 'A-e10.ckpt', kind: 'gpt' },
    { name: 'A_e8_s112.pth', kind: 'sovits' }, { name: 'r.wav', kind: 'audio' }];
const picked = api.pickWeights(batch);
assert.deepEqual([...picked.skip].sort(), [0, 2]);
assert.deepEqual(picked.kept, [{ kind: 'gpt', name: 'A-e15.ckpt', others: 2 }]);

// Name clashes: an exact character, or versions stored under that name.
const names = ['阿罗娜/日配', '阿罗娜/中配', '普拉娜'];
assert.deepEqual(api.nameConflict(' 普拉娜 ', names), { kind: 'exact', name: '普拉娜' });
assert.deepEqual(api.nameConflict('阿罗娜', names), { kind: 'variant', name: '阿罗娜', variants: ['阿罗娜/日配', '阿罗娜/中配'] });
assert.equal(api.nameConflict('阿', names), null);
assert.equal(api.nameConflict('', names), null);
const weights = rows.slice(0, 2);
assert.deepEqual(api.importProblem({ character: '普拉娜', rows: weights, conflict: api.nameConflict('普拉娜', names) }),
    ['ttsImportNameTaken', { name: '普拉娜' }]);
assert.equal(api.importProblem({ character: 'X', rows: weights }), null);
assert.deepEqual(api.importProblem({ character: 'X', rows: [weights[0], { kind: 'sovits', name: 'v4.pth', supported: false, version: 'v4' }] }),
    ['ttsImportUnsupportedBlock', { file: 'v4.pth', version: 'v4' }]);
assert.deepEqual([undefined, 2.9, 3, 10, 10.1].map(api.usableAsReference), [true, false, true, true, false]);

// A text file dropped on a clip's text box: a plain file is the line; an annotation file is searched.
assert.equal(api.importKind('x.LAB'), 'text');
assert.equal(api.textFromFile('\uFEFF  先生、おはよう \r\n', 'a.wav'), '先生、おはよう');
const bs = String.fromCharCode(92); // a Windows path in the annotation file
const list = `D:${bs}data${bs}Talk_1.wav|arona|JA|最初の台詞
D:/data/Happy.wav|arona|ja|嬉しい
`;
assert.equal(api.textFromFile(list, 'talk_1.WAV'), '最初の台詞');
assert.equal(api.textFromFile(list, 'Happy.开心.wav'), '嬉しい'); // without the emotion part, like the node
assert.equal(api.textFromFile(list, 'missing.wav'), null);

// Setup summary: ready needs characters, required pretrained files and packages.
const status = await engines.loadGptSovitsStatus();
assert.deepEqual(api.setupSummary(status), { characters: 2, missing: 1, requiredMissing: 0, packages: 0, downloading: false, ready: true });
assert.equal(api.setupSummary({ ...status, libraries: [] }).ready, false);
assert.equal(api.setupSummary({ ...status, pretrained: [{ id: 'hubert', state: 'downloading', required: true }] }).downloading, true);

// Reminder dot: nothing for an empty studio; only files the characters will load.
const pre = { pretrained: [
    { id: 'hubert', needed_for: 'all', state: 'missing', size: 10, required: true },
    { id: 'roberta', needed_for: 'zh', state: 'missing', size: 20, required: true },
    { id: 'ja_userdic', needed_for: 'ja', state: 'missing', size: 5, required: false },
    { id: 'english', needed_for: 'en', state: 'ok', size: 3, required: true },
] };
assert.deepEqual(api.pretrainedReminder(pre, []), { items: [], size: 0, due: false });
const ja = api.pretrainedReminder(pre, ['ja']);
assert.deepEqual(ja.items.map(i => i.id), ['hubert', 'ja_userdic']);
assert.equal(ja.size, 15);
assert.equal(ja.due, true);
assert.equal(api.pretrainedReminder(pre, ['ja'], ['hubert', 'ja_userdic']).due, false);
assert.equal(api.pretrainedReminder(pre, ['ja', 'zh'], ['hubert', 'ja_userdic']).due, true); // first Chinese character
assert.deepEqual(api.pretrainedReminder(pre, ['']).items.map(i => i.id), ['hubert', 'roberta', 'ja_userdic']);
assert.deepEqual(api.missingForLanguage(pre, 'zh').map(i => i.id), ['hubert', 'roberta']);
assert.deepEqual(api.missingForLanguage(pre, 'ja').map(i => i.id), ['hubert']);

// Row tones and section marks in the import form.
assert.equal(api.rowState({ progress: 0.42 }).tone, 'busy');
assert.deepEqual(api.rowState({ progress: 0.42 }).params, { percent: 42 });
assert.equal(api.rowState({ uploaded: true }).tone, 'ready');
assert.equal(api.rowState({ uploaded: true, existing: 'same' }).tone, 'skip');
assert.equal(api.rowState({ uploaded: true, existing: 'merge' }).tone, 'merge');
assert.equal(api.rowState({ uploaded: true, existing: 'different' }).tone, 'error');
assert.equal(api.rowState({ uploaded: true, unsupported: true }).tone, 'error');
assert.equal(api.rowState({ error: 'x', uploaded: true }).key, 'ttsImportRowError');
assert.deepEqual(api.importProblem({ target: 'A', rows: [{ kind: 'audio', name: 'a.wav', existing: 'different' }] }),
    ['ttsImportExistingDifferent', { file: 'a.wav' }]);
assert.equal(api.importProblem({ target: 'A', rows: [{ kind: 'audio', name: 'a.wav', existing: 'same' }] }), null);

console.log('tts_setup_api: all checks passed');
