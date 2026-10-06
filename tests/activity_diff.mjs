// node tests/activity_diff.mjs — canvas snapshots and their difference for the activity log.
import assert from 'node:assert/strict';
import { changeNodeId, diffSnapshots, snapshotGraph } from '../web/modules/activity_diff.js';

const graph = (nodes) => ({ _nodes: nodes });
const node = (id, title, widgets) => ({ id, type: title, title, widgets: Object.entries(widgets).map(([name, value]) => ({ name, value })) });

const before = snapshotGraph(graph([
    node(3, 'KSampler', { steps: 20, cfg: 7, seed: 1 }),
    node(4, 'CheckpointLoaderSimple', { ckpt_name: 'a.safetensors' }),
    node(9, 'Note', { text: 'hello' }),
]));
const after = snapshotGraph(graph([
    node(3, 'KSampler', { steps: 30, cfg: 7, seed: 1 }),
    node(4, 'CheckpointLoaderSimple', { ckpt_name: 'b.safetensors' }),
    node(12, 'LoraLoader', { lora_name: 'x.safetensors', strength_model: 1 }),
]));

assert.deepEqual(diffSnapshots(before, after).map(c => [c.kind, c.node, c.widget, c.before, c.after]), [
    ['changed', 'KSampler #3', 'steps', '20', '30'],
    ['changed', 'CheckpointLoaderSimple #4', 'ckpt_name', 'a.safetensors', 'b.safetensors'],
    ['added', 'LoraLoader #12', undefined, undefined, undefined],
    ['removed', 'Note #9', undefined, undefined, undefined],
]);
assert.deepEqual(diffSnapshots(before, before), []);

// Buttons and nameless widgets hold no value.
const withButton = snapshotGraph(graph([{ id: 1, type: 'X', title: 'X', widgets: [{ name: 'run', type: 'button', value: 1 }, { value: 5 }] }]));
assert.deepEqual(withButton.get('1').widgets, {});

// Object values compare by content; a widget that appears counts as a change.
const a = snapshotGraph(graph([node(1, 'Img', { image: { name: 'a.png' } })]));
const b = snapshotGraph(graph([node(1, 'Img', { image: { name: 'a.png' }, extra: 2 })]));
assert.deepEqual(diffSnapshots(a, b).map(c => [c.widget, c.before, c.after]), [['extra', '', '2']]);

assert.equal(changeNodeId({ node: 'KSampler #12' }), '12');
assert.equal(changeNodeId({ node: 'Title with # sign #7' }), '7');
assert.equal(changeNodeId({ node: 'no id' }), null);
console.log('activity_diff: ok');
