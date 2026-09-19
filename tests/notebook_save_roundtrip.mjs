import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = (await fs.readFile(new URL('../web/modules/ui_notebooks.js', import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '')
    .replace("const t = (key, params) => translate(key, params);", 'const t = key => key;');
const { saveCurrentNotebook } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const calls = [];
let release;
globalThis.fetch = async (_, options) => {
    calls.push(JSON.parse(options.body));
    if (calls.length === 1) await new Promise(resolve => { release = resolve; });
    return { ok: true, json: async () => ({ status: 'success' }) };
};
const owner = { currentNotebook: { filename: 'one.json', data: { text: 'first' } }, refreshNotebooks: async () => {} };
const first = saveCurrentNotebook.call(owner);
owner.currentNotebook.data.text = 'second';
const second = saveCurrentNotebook.call(owner);
await new Promise(resolve => setImmediate(resolve));
assert.equal(calls.length, 1);
release();
assert.deepEqual(await Promise.all([first, second]), [true, true]);
assert.deepEqual(calls.map(item => item.data.text), ['first', 'second']);
globalThis.document = { createElement: () => ({ setAttribute() {} }) };
owner.nbEditor = { prepend(element) { element.isConnected = true; } };
globalThis.fetch = async () => ({ ok: false, json: async () => ({ status: 'error' }) });
assert.equal(await saveCurrentNotebook.call(owner), false);
assert.equal(owner.nbSaveStatus.textContent, 'notebookSaveError');
assert.equal(owner.currentNotebook.data.text, 'second');
console.log('notebook save ordering and failure: ok');
