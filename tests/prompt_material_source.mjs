import assert from 'node:assert/strict';
import { loadPromptSourceCards, mergePromptSourceCards } from '../web/modules/prompt_material_source.js';

const requests = [];
globalThis.fetch = async (url, options) => {
    requests.push([url, options]);
    const parsed = new URL(url, 'http://test');
    const page = Number(parsed.searchParams.get('page'));
    const filename = parsed.searchParams.get('filename');
    return { ok: true, json: async () => filename
        ? { status: 'success', data: { kind: 'prompt_text', note: { promptEn: filename } } }
        : { status: 'success', pages: 2, materials: page === 1 ? [{ filename: 'first.json' }] : [{ filename: 'first.json' }, { filename: 'last.json' }] } };
};
const controller = new AbortController();
const cards = await loadPromptSourceCards(controller.signal);
assert.deepEqual(cards.map(card => card.content), ['first.json', 'last.json']);
assert.equal(requests.length, 4, 'two pages and two unique details');
assert.equal(requests.every(([, options]) => options.signal === controller.signal), true);
const deck = [];
assert.equal(mergePromptSourceCards(deck, cards), 2);
assert.equal(mergePromptSourceCards(deck, cards), 0);
const local = { id: 'local', role: 'positive', content: 'local draft' };
deck.unshift(local);
const updated = { ...cards[0], title: 'Renamed source', content: 'Updated prompt' };
const otherSource = { ...updated, id: 'mat_positive_other.json', filename: 'other.json' };
mergePromptSourceCards(deck, [updated, otherSource]);
assert.deepEqual(deck, [local, updated, otherSource], 'refresh edits/removes by source identity, preserving equal text from different materials');
mergePromptSourceCards(deck, []);
assert.deepEqual(deck, [local], 'deleted library sources disappear without clearing local cards');
controller.abort();
await assert.rejects(loadPromptSourceCards(controller.signal), { name: 'AbortError' });
assert.equal(requests.length, 4);
console.log('prompt material source: later pages, deduplication, counts and cancellation passed');
