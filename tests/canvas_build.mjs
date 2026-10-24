// node tests/canvas_build.mjs — the pure part of building a workflow on the canvas.
import assert from 'node:assert/strict';
import { apiLinks, checkedValue, freeSpot, layered, placedBlock, typesFit, valuePlan } from '../web/modules/canvas_build.js';

assert.ok(typesFit('MODEL', 'MODEL'));
assert.ok(typesFit('model', 'MODEL'), 'case does not matter');
assert.ok(typesFit('*', 'LATENT') && typesFit('IMAGE', '*'));
assert.ok(typesFit('INT', 'INT,FLOAT'), 'one of a list');
assert.ok(!typesFit('CLIP', 'MODEL'));

const sampler = {
    id: 3, type: 'KSampler',
    widgets: [
        { name: 'steps', value: 20, options: { min: 1, max: 10000 } },
        { name: 'sampler_name', value: 'euler', options: { values: ['euler', 'dpmpp_2m', 'dpmpp_2m_sde'] } },
        { name: 'denoise', value: 1, options: { min: 0, max: 1 } },
        { name: 'run', type: 'button', value: null },
    ],
};
const ckpt = { name: 'ckpt_name', value: 'a.safetensors', options: { values: () => ['SDXL\\b.safetensors', 'a.safetensors'] } };
const note = { name: 'text', value: '' };
const flag = { name: 'tiled', value: false };

assert.equal(checkedValue(3, sampler.widgets[0], 30), 30);
assert.equal(checkedValue(3, sampler.widgets[0], '30'), 30, 'a number in text');
assert.throws(() => checkedValue(3, sampler.widgets[0], 0), /between 1 and 10000/);
assert.throws(() => checkedValue(3, sampler.widgets[0], 'many'), /takes a number/);
assert.equal(checkedValue(4, ckpt, 'sdxl/B.safetensors'), 'SDXL\\b.safetensors', 'a choice by its path, either slash, any case');
assert.throws(() => checkedValue(3, sampler.widgets[1], 'dpmpp_2m_karras'), /close: dpmpp_2m$/);
assert.throws(() => checkedValue(3, sampler.widgets[1], 'ddim'), /choices: euler \| dpmpp_2m/);
assert.equal(checkedValue(5, note, 'hello'), 'hello');
assert.throws(() => checkedValue(5, note, 3), /takes text/);
assert.throws(() => checkedValue(6, flag, 'yes'), /true or false/);

const plan = valuePlan(sampler, { steps: 28, sampler_name: 'dpmpp_2m' });
assert.deepEqual(plan.map(([widget, value]) => [widget.name, value]), [['steps', 28], ['sampler_name', 'dpmpp_2m']]);
assert.throws(() => valuePlan(sampler, { cfg_scale: 7 }), /no setting cfg_scale; it has: steps, sampler_name, denoise\./);
assert.deepEqual(valuePlan(sampler, undefined), []);

// A new node goes right of everything, below what it would cover.
const box = (x, y, w = 300, h = 200) => ({ pos: [x, y], size: [w, h] });
const fresh = box(0, 0, 300, 120);
assert.deepEqual(freeSpot(fresh, []), [100, 100]);
assert.deepEqual(freeSpot(fresh, [box(100, 100), box(500, 50)]), [880, 50]);
const near = box(100, 100);
const under = freeSpot(fresh, [near, box(480, 100)], near);
assert.equal(under[0], 480);
assert.ok(under[1] >= 100 + 200 + 30, 'moved below the node it would cover');

// A workflow in API form: its links, and columns by distance from the sources.
const workflow = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a.safetensors' } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: 'girl', clip: ['1', 1] } },
    3: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], steps: 20 } },
    4: { class_type: 'EmptyLatentImage', inputs: { width: 1024 } },
    5: { class_type: 'Note', inputs: { text: ['9', 0] } },
};
const links = apiLinks(workflow);
assert.deepEqual(links, [
    { from: '1', slot: 1, to: '2', input: 'clip' },
    { from: '1', slot: 0, to: '3', input: 'model' },
    { from: '2', slot: 0, to: '3', input: 'positive' },
], 'a link to a node not in the workflow is not a link');
const sized = Object.fromEntries(Object.keys(workflow).map(key => [key, box(0, 0, 300, 100)]));
const spots = layered(sized, links);
assert.equal(spots[1][0], spots[4][0], 'sources share the first column');
assert.ok(spots[2][0] > spots[1][0] && spots[3][0] > spots[2][0], 'each step right of what feeds it');
assert.notEqual(spots[1][1], spots[4][1], 'one column, one above the other');
assert.deepEqual(Object.keys(layered(sized, [{ from: '1', to: '2' }, { from: '2', to: '1' }])).sort(), ['1', '2', '3', '4', '5'], 'a loop still lays out');
// A group added to a canvas keeps its columns and moves as one block right of the node it is near, clear of others.
const block = placedBlock(sized, links, [near, box(480, 100)], near);
assert.equal(block[1][0], 480, 'the first column starts where a single node would');
assert.equal(block[2][0] - block[1][0], spots[2][0] - spots[1][0], 'columns kept');
assert.ok(block[1][1] >= 100 + 200 + 30, 'the whole block below what it would cover');
console.log('canvas_build: ok');
