// node tests/mcp_fill.mjs — run_workflow's blanks planned on the canvas: prompts, seeds, size, the
// picture a LoadImage reads; nothing planned when a blank has nowhere to go.
import assert from 'node:assert/strict';
import { fillPlan } from '../web/modules/mcp_fill.js';

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

console.log('mcp_fill: ok');
