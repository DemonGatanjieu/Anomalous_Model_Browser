// node tests/mcp_fill.mjs — run_workflow's blanks planned on the canvas: prompts, seeds, size, the
// picture a LoadImage reads; nothing planned when a blank has nowhere to go.
import assert from 'node:assert/strict';
import { fillPlan, valuesPlan } from '../web/modules/mcp_fill.js';

const text = (name, value = '') => ({ name, value });
const number = (name, value, min = 0, max = 0xffffffffffffffff) => ({ name, value, options: { min, max } });
function node(id, type, widgets, { outputs = [], inputs = [], mode = 0, title, required = {} } = {}) {
    const made = { id, type, title: title ?? type, mode, widgets, outputs, inputs };
    Object.defineProperty(made, 'constructor', { value: { nodeData: { input: { required } } } });
    return made;
}
const multiline = ['STRING', { multiline: true }];

const prompts = node(1, 'PromptPair', [text('positive', 'old'), text('negative', 'bad')], { required: { positive: multiline, negative: multiline } });
const sampler = node(2, 'KSampler', [number('seed', 1), number('steps', 20, 1, 10000)]);
const custom = node(3, 'SamplerCustom', [number('noise_seed', 5)]);
const latent = node(4, 'EmptyLatentImage', [number('width', 512, 16, 16384), number('height', 512, 16, 16384), number('batch_size', 1, 1, 64)], { outputs: [{ name: 'LATENT', type: 'LATENT' }] });
const scale = node(5, 'ImageScale', [number('width', 512, 16, 16384), number('height', 512, 16, 16384)], { outputs: [{ name: 'IMAGE', type: 'IMAGE' }] });
const base = node(6, 'LoadImage', [text('image', 'a.png')], { title: '原图' });
const marks = node(7, 'LoadImage', [text('image', 'b.png')], { title: '标注' });
const resting = node(8, 'KSampler', [number('seed', 9)], { mode: 4 }); // bypassed: left alone
const upscale = node(9, 'LatentUpscale', [number('width', 1152, 16, 16384), number('height', 1728, 16, 16384)],
    { outputs: [{ name: 'LATENT', type: 'LATENT' }], inputs: [{ name: 'samples', type: 'LATENT' }] }); // a hires fix keeps its size
const g = { _nodes: [prompts, sampler, custom, latent, scale, base, marks, resting, upscale] };

const { plans, set } = fillPlan(g, { prompt: '海边少女', negative: 'blurry', seed: 42, width: 1024, height: 1536, image: 'x.png [output]', image_node: 7 });
assert.deepEqual(set, { prompt: [1], negative: [1], seed: [2, 3], size: [4], image: [7] }, 'not the IMAGE scaler, the latent upscale or the bypassed sampler');
const values = plans.flatMap(({ node: item, plan }) => plan.map(([widget, value]) => [item.id, widget.name, value]));
assert.deepEqual(values, [[1, 'positive', '海边少女'], [1, 'negative', 'blurry'], [2, 'seed', 42], [3, 'noise_seed', 42],
    [4, 'width', 1024], [4, 'height', 1536], [7, 'image', 'x.png [output]']]);
assert.equal(prompts.widgets[0].value, 'old', 'only planned: the page applies it');

assert.deepEqual(fillPlan(g, { width: 768 }).set, { size: [4] }, 'one side alone');
assert.deepEqual(fillPlan(g, {}).plans, []);
assert.throws(() => fillPlan(g, { image: 'x.png' }), /Several LoadImage nodes \(#6 "原图", #7 "标注"\): give image_node/);
assert.throws(() => fillPlan(g, { image: 'x.png', image_node: 2 }), /Node 2 is no LoadImage/);
assert.throws(() => fillPlan(g, { width: 8 }), /width of node 4 is between 16 and 16384/);
assert.throws(() => fillPlan({ _nodes: [sampler] }, { prompt: 'a' }), /No positive prompt box/);
assert.throws(() => fillPlan({ _nodes: [prompts] }, { seed: 1 }), /No sampler with a seed/);
assert.throws(() => fillPlan({ _nodes: [scale] }, { height: 768 }), /No empty latent/);

// Any other setting by name, a third-party node's too; a name several nodes have asks for the node.
const sharpen = node(10, 'ImageSharpen_ThirdParty', [number('sharpen_radius', 1, 1, 31)]);
const second = node(11, 'KSampler', [number('seed', 3), number('steps', 20, 1, 10000)]);
assert.deepEqual(fillPlan({ _nodes: [sampler, sharpen] }, { values: { steps: 30, sharpen_radius: 3 } }).set, { values: [2, 10] });
assert.throws(() => fillPlan({ _nodes: [sampler, second] }, { values: { steps: 30 } }), /steps is a setting of #2, #11: give the one to change as \{"<node id>"/);
const both = valuesPlan({ _nodes: [sampler, second] }, { 11: { steps: 8 } });
assert.deepEqual(both.map(({ node: item, plan }) => [item.id, plan.map(([widget, value]) => [widget.name, value])]), [[11, [['steps', 8]]]]);
assert.throws(() => valuesPlan({ _nodes: [sampler] }, { cfg: 5 }), /No node on the canvas has a setting cfg/);
assert.throws(() => valuesPlan({ _nodes: [sampler] }, { 99: { steps: 5 } }), /No node 99/);
assert.throws(() => fillPlan({ _nodes: [sampler] }, { seed: 1, values: { 2: { seed: 2 } } }), /seed is set by a blank and by values/);

// Two prompts combined into one sampler (regional prompts) are not given one text; a refiner's own prompt is.
{
    const links = { 1: { target_id: 33, target_slot: 0 }, 2: { target_id: 33, target_slot: 1 }, 3: { target_id: 34, target_slot: 0 }, 4: { target_id: 35, target_slot: 0 } };
    const g2 = { links, getNodeById(id) { return this._nodes.find(item => item.id === id); } };
    const encoder = (id, link) => node(id, 'CLIPTextEncode', [text('text', '')], { outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [link] }], required: { text: multiline } });
    const combine = node(33, 'ConditioningCombine', [], { outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [3] }],
        inputs: [{ name: 'conditioning_1', type: 'CONDITIONING' }, { name: 'conditioning_2', type: 'CONDITIONING' }] });
    const into = id => node(id, 'KSampler', [number('seed', 1)], { inputs: [{ name: 'positive', type: 'CONDITIONING' }] });
    g2._nodes = [encoder(31, 1), encoder(32, 2), combine, into(34)];
    g2._nodes.forEach(item => { item.graph = g2; });
    assert.throws(() => fillPlan(g2, { prompt: 'a castle' }), /Several positive prompt boxes feed one sampler \(#31, #32\)/);
    g2._nodes = [encoder(31, 1), encoder(36, 4), combine, into(34), into(35)];
    links[1] = { target_id: 34, target_slot: 0 };
    g2._nodes.forEach(item => { item.graph = g2; });
    assert.deepEqual(fillPlan(g2, { prompt: 'a castle' }).set, { prompt: [31, 36] }, 'base and refiner prompts each feed their own sampler');
}

console.log('mcp_fill: ok');
