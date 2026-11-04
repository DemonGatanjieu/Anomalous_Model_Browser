// The snapshot queue's rules (web/modules/snapshot_plan.js): which widgets are seeds, what each run gets.
import assert from 'node:assert/strict';
import { MAX_COUNT, applySeeds, baseSeed, runCount, runTotal, seedWidgets, seedsOf } from '../web/modules/snapshot_plan.js';

const control = { name: 'control_after_generate', value: 'fixed' };
const seed = (name, value = 7, options = {}) => ({ name, value, options, linkedWidgets: [control] });

const inner = seed('rand_seed', 1, { min: 10, max: 20 });
const graph = { _nodes: [
    { widgets: [seed('noise_seed'), { name: 'steps', value: 30 }, control] },
    { widgets: [{ name: 'sampler_name', value: 'euler', linkedWidgets: [control] }] },
    { widgets: [], subgraph: { _nodes: [{ widgets: [inner] }] } },
] };

assert.deepEqual(seedWidgets(graph).map(widget => widget.name), ['noise_seed', 'rand_seed'],
    "any name with ComfyUI's control beside it, in subgraphs too; a choice with a control is no seed");

applySeeds(graph, 42);
assert.deepEqual(seedWidgets(graph).map(widget => widget.value), [42, 42], 'locked: the same seed everywhere');
applySeeds(graph, null, () => 0.5);
assert.equal(inner.value, 15, "random: inside the widget's own range");
assert.equal(seedWidgets(graph)[0].value, 562949953421312);
applySeeds(graph, 0);
assert.equal(inner.value, 0, 'a seed of 0 is a seed');

const marks = [{ count: 3 }, { count: 2 }];
assert.equal(runTotal(marks), 5);
assert.deepEqual(seedsOf(marks[0], 'locked', 100), [100, 101, 102], 'one seed a round: a repeat would come from the cache');
assert.deepEqual(seedsOf(marks[1], 'locked', 100), [100, 101], 'the same rounds in every mark');
assert.deepEqual(seedsOf(marks[1], 'random', 100), [null, null]);

assert.equal(runCount('3'), 3);
assert.equal(runCount('0'), 1);
assert.equal(runCount('nope'), 1);
assert.equal(runCount(999), MAX_COUNT);
assert.ok(baseSeed(() => 0.999999999) + MAX_COUNT <= 1125899906842624);

console.log('snapshot_plan ok');
