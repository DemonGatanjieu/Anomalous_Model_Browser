import assert from 'node:assert/strict';
import { fixture, Element, all } from './ui_fixture.mjs';

const f = fixture();
let name = 'Library source';
let content = 'original library prompt';
let available = true;
let fail = false;
f.fetch = async url => {
    if (fail) throw new Error('offline');
    return { ok: true, json: async () => url.includes('/materials?')
        ? { status: 'success', pages: 1, materials: available ? [{ filename: 'source.json', name }] : [] }
        : { status: 'success', data: { kind: 'prompt_text', note: { promptEn: content } } } };
};
const { createPromptSourceDeck } = await f.module('ui_prompt_source_deck.js');
const { createViewScope } = await f.module('ui_lifecycle.js');
const scope = createViewScope();
const grid = new Element('div');
f.document.body.appendChild(grid);
const selected = [];
createPromptSourceDeck(grid, grid, scope, card => selected.push(card));
await f.flush();
const libraryCards = () => all(grid).filter(el => el.dataset.sourceFilename === 'source.json');
assert.equal(libraryCards().length, 1, 'initial sync needs no manual action');
assert.match(libraryCards()[0].textContent, /From Material Library/);
assert.equal(all(libraryCards()[0]).some(el => el.tagName === 'button'), false, 'source has no destructive action');
await libraryCards()[0].click();
assert.equal(selected[0].content, content);
assert.equal(selected[0].sourceKind, 'material');

name = 'Renamed source'; content = 'updated library prompt';
f.window.dispatch('focus'); await f.flush();
assert.match(libraryCards()[0].textContent, /Renamed source/);
await libraryCards()[0].click();
assert.equal(selected.at(-1).content, content);
assert.equal(selected[0].content, 'original library prompt', 'existing mixer copies are independent');

fail = true;
f.window.dispatch('focus'); await f.flush();
assert.equal(libraryCards().length, 1, 'failure must not erase cached source cards');
assert.match(grid.querySelector('.anomalous-source-sync-status').textContent, /sync failed/);
fail = false; available = false;
f.runTimers(); await f.flush();
assert.equal(libraryCards().length, 0, 'background retry reconciles deleted source');
assert.equal(grid.querySelectorAll('.anomalous-source-card-compact').length, 6, 'starter cards remain');

scope.dispose();
const requestCount = f.requests.length;
f.window.dispatch('focus'); f.runTimers(); await f.flush();
assert.equal(f.requests.length, requestCount, 'closing cancels background sync and listeners');

const lateScope = createViewScope();
let complete;
f.fetch = () => new Promise(resolve => { complete = resolve; });
createPromptSourceDeck(grid, grid, lateScope, () => {});
await f.flush();
lateScope.dispose();
complete({ ok: true, json: async () => ({ status: 'success', materials: [{ filename: 'late.json' }], pages: 1 }) });
await f.flush();
assert.equal(all(grid).some(el => el.dataset.sourceFilename === 'late.json'), false);
assert.equal(f.window.listenerCount(), 0);
assert.equal(f.document.listenerCount(), 0);
console.log('Library sync: automatic load, provenance, refresh, deletion, retry and close cancellation passed.');
