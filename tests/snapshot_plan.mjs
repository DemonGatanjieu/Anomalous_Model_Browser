// The saves bar's rules (web/modules/snapshot_plan.js): which widgets are seeds, what each run gets, what is compiled.
import assert from 'node:assert/strict';
import { jobLine, MAX_COUNT, applySeeds, baseSeed, changeKind, compiled, outputsAt, runCount, runTotal, seedWidgets, seedsOf, withoutEmptyValues } from '../web/modules/snapshot_plan.js';

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

assert.equal(changeKind([]), 'same');
assert.equal(changeKind([{ kind: 'changed' }]), 'values');
assert.equal(changeKind([{ kind: 'changed' }, { kind: 'added' }]), 'nodes');
assert.equal(changeKind([{ kind: 'wired' }]), 'nodes', 'a link moved is the structure, not a value');

class App {
    rootGraph = { id: 'canvas' };
    async graphToPrompt(graph = this.rootGraph) {
        return { workflow: { id: graph.id }, output: graph.id };
    }
}
const copy = { id: 'copy' };
assert.equal((await compiled(new App(), copy)).output, 'copy');
const wrapped = new App();
const own = wrapped.graphToPrompt;
wrapped.graphToPrompt = async function () { // ComfyUI-Manager's components-manager.js
    return await own.call(wrapped);
};
assert.equal((await wrapped.graphToPrompt(copy)).output, 'canvas');
assert.equal((await compiled(wrapped, copy)).output, 'copy', 'a plugin that leaves the graph out must not send the canvas instead');

// What is clicked goes in in the order of the clicks, one at a time; the same button twice adds nothing.
{
    const add = jobLine();
    const order = [];
    const job = (name, wait = 0) => async () => {
        await new Promise(resolve => setTimeout(resolve, wait));
        order.push(name);
        return name;
    };
    const answers = [add('2', job('second', 20)), add('2', job('again')), add('1', job('first'))];
    assert.deepEqual(await Promise.all(answers), ['second', 0, 'first']);
    assert.deepEqual(order, ['second', 'first']);
    await assert.rejects(add('bad', async () => { throw new Error('refused'); }), /refused/);
    assert.equal(await add('bad', job('after')), 'after', 'a refused one neither blocks the line nor stays waiting');
}

{
    const picture = (filename, type = 'output') => ({ filename, subfolder: '', type });
    const shown = { 2: { images: [picture('old.png')] }, 3: { images: [picture('old2.png', 'temp')] }, 4: { images: [picture('cat.png', 'input')] }, 5: { text: ['words'] } };
    assert.deepEqual(outputsAt(shown, { 2: [picture('b.png'), picture('a.png')] }),
        { 2: { images: [picture('b.png'), picture('a.png')] }, 4: shown[4], 5: shown[5] },
        "all the save's pictures on their node; none left from elsewhere; Load Image's picture and text stay");
    assert.deepEqual(outputsAt(shown), { 4: shown[4], 5: shown[5] }, 'a save with no pictures leaves the output nodes empty');
}

{
    const state = values => ({ links: [], nodes: [{ id: 1, type: 'SaveImage', ...values }] });
    assert.deepEqual(withoutEmptyValues(state({ widgets_values: [], widgets_values_named: {} })), state({}), 'a node showing a picture changed nothing');
    assert.deepEqual(withoutEmptyValues(state({ widgets_values: ['a'], widgets_values_named: { x: 'a' } })), state({ widgets_values: ['a'], widgets_values_named: { x: 'a' } }));
    assert.deepEqual(withoutEmptyValues(state({ widgets_values: { seed: 1 } })), state({ widgets_values: { seed: 1 } }), 'values kept by name stay');
}

console.log('snapshot_plan ok');
