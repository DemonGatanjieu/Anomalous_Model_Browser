// node tests/param_compare.mjs — two sets of workflow parameters side by side.
import assert from 'node:assert/strict';
import { compareParams, readParams, shownValue, textDifference } from '../web/modules/param_compare.js';

const node = (id, type, widgets, extra = {}) => ({
    id, type, title: type, mode: 0, inputs: [],
    widgets: Object.entries(widgets).map(([name, value]) => ({ name, value })), ...extra,
});
const graph = (nodes, links = {}) => ({ _nodes: nodes, links });

const imageA = graph([
    node(3, 'KSampler', { seed: 11, steps: 20, cfg: 7 }, { inputs: [{ name: 'model', link: 1 }] }),
    node(4, 'CheckpointLoaderSimple', { ckpt_name: 'a.safetensors' }),
    node(6, 'CLIPTextEncode', { text: '1girl, red dress, smile, outdoors' }),
], { 1: [1, 4, 0, 3, 0, 'MODEL'] });
const imageB = graph([
    node(3, 'KSampler', { seed: 99, steps: 30, cfg: 7 }, { inputs: [{ name: 'model', link: 1 }] }),
    node(4, 'CheckpointLoaderSimple', { ckpt_name: 'a.safetensors' }),
    node(6, 'CLIPTextEncode', { text: '1girl, white dress, smile, outdoors' }),
], { 1: [1, 4, 0, 3, 0, 'MODEL'] });

const same = compareParams(readParams(imageA), readParams(imageB));
assert.equal(same.sameStructure, true);
assert.equal(same.sameCount, 2); // cfg and ckpt_name
assert.deepEqual(same.nodes.map(n => [n.id, n.rows.map(r => [r.name, r.aText, r.bText, r.volatile])]), [
    ['3', [['seed', '11', '99', true], ['steps', '20', '30', false]]],
    ['6', [['text', '1girl, red dress, smile, outdoors', '1girl, white dress, smile, outdoors', false]]],
]);
assert.equal(same.nodes[0].rows[1].index, 1); // the widget's place on the B side, to write it

// A node bypassed on one side, one only on one side, and an input wired elsewhere.
const imageC = graph([
    node(3, 'KSampler', { seed: 11, steps: 20, cfg: 7 }, { mode: 4, inputs: [{ name: 'model', link: 2 }] }),
    node(4, 'CheckpointLoaderSimple', { ckpt_name: 'a.safetensors' }),
    node(9, 'LoraLoader', { lora_name: 'x.safetensors' }),
], new Map([[2, { origin_id: 9, origin_slot: 0 }]]));
const changed = compareParams(readParams(imageA), readParams(imageC));
assert.equal(changed.sameStructure, false);
assert.deepEqual(changed.onlyA.map(n => n.id), ['6']);
assert.deepEqual(changed.onlyB.map(n => n.id), ['9']);
assert.deepEqual(changed.rewired.map(n => n.id), ['3']);
assert.deepEqual(changed.nodes[0].rows[0], { name: '', mode: true, a: 0, b: 4 });

// A node of another type under the same id is not compared value by value.
const retyped = compareParams(readParams(graph([node(5, 'A', { x: 1 })])), readParams(graph([node(5, 'B', { x: 2 })])));
assert.deepEqual([retyped.onlyA.map(n => n.type), retyped.onlyB.map(n => n.type), retyped.nodes], [['A'], ['B'], []]);

// Two workflows numbered differently: a type found once on each side still pairs, by type.
const other = compareParams(
    readParams(graph([node(3, 'KSampler', { steps: 20 }), node(6, 'CLIPTextEncode', { text: 'a' }), node(7, 'CLIPTextEncode', { text: 'b' })])),
    readParams(graph([node(70, 'KSampler', { steps: 30 }), node(71, 'CLIPTextEncode', { text: 'c' }), node(72, 'CLIPTextEncode', { text: 'd' })])),
);
assert.equal(other.sameStructure, false);
assert.deepEqual(other.nodes.map(n => [n.aId, n.bId, n.id, n.rows[0].aText, n.rows[0].bText]), [['3', '70', '70', '20', '30']]);
assert.deepEqual([other.onlyA.map(n => n.id), other.onlyB.map(n => n.id), other.compared], [['6', '7'], ['71', '72'], 1]);
assert.equal(compareParams(readParams(graph([node(1, 'A', {})])), readParams(graph([node(2, 'B', {})]))).compared, 0);

// Prompts as tags: the tags only one side has, each once.
assert.deepEqual(textDifference('1girl, red dress, smile, red dress', '1girl, smile, white dress, hat'),
    { tags: true, onlyA: ['red dress'], onlyB: ['white dress', 'hat'] });
// Other text: the changed part with a little around it.
const long = `${'a'.repeat(50)} cat ${'b'.repeat(50)}`;
assert.deepEqual(textDifference(long, long.replace('cat', 'dog')), {
    tags: false, before: `…${'a'.repeat(39)} `, aPart: 'cat', bPart: 'dog', after: ` ${'b'.repeat(39)}…`,
});
assert.deepEqual(textDifference('steps 20', 'steps 30'), { tags: false, before: 'steps ', aPart: '2', bPart: '3', after: '0' });

assert.equal(shownValue(0.30000000000000004), '0.3');
assert.equal(shownValue(''), '—');
assert.equal(shownValue(['x', 1]), '["x",1]');

console.log('param_compare ok');