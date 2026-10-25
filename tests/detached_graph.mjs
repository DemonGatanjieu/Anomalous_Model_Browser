// node tests/detached_graph.mjs — a workflow read off the canvas never takes the canvas's graph id,
// and readDetached clears the graph after reading (its widgets' DOM elements leave the page).
import assert from 'node:assert/strict';
import { detachedGraph, readDetached } from '../web/modules/detached_graph.js';

const configured = [];
let cleared = 0;
globalThis.LiteGraph = { LGraph: class { configure(data) { configured.push(data); } clear() { cleared += 1; } } };

const workflow = { id: '3675a66f-fd88-4261-ab21-5b285bd54a02', nodes: [{ id: 3, widgets_values: [20] }] };
detachedGraph(workflow);
detachedGraph(workflow);
const [first, second] = configured;
assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.notEqual(first.id, workflow.id);
assert.notEqual(first.id, second.id);
assert.deepEqual(first.nodes, workflow.nodes);
assert.equal(workflow.id, '3675a66f-fd88-4261-ab21-5b285bd54a02'); // the caller's workflow is left as it was

// Without crypto.randomUUID (a page over plain http on another computer) the id is made by hand.
const realCrypto = globalThis.crypto;
Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: array => realCrypto.getRandomValues(array) }, configurable: true });
detachedGraph(workflow);
assert.match(configured[2].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true });

// readDetached: the graph is cleared after a plain read, after an async one settles, and after a throw.
assert.equal(readDetached(workflow, graph => (assert.equal(cleared, 0), 'read')), 'read');
assert.equal(cleared, 1);
const later = readDetached(workflow, async () => 'later');
assert.equal(cleared, 1); // not before the promise settles
assert.equal(await later, 'later');
assert.equal(cleared, 2);
assert.throws(() => readDetached(workflow, () => { throw new Error('bad'); }), /bad/);
assert.equal(cleared, 3);
await assert.rejects(readDetached(workflow, async () => { throw new Error('bad'); }), /bad/);
assert.equal(cleared, 4);

console.log('detached_graph ok');