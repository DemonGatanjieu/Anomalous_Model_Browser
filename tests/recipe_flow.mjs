// node tests/recipe_flow.mjs — a saved workflow's flow (web/modules/recipe_flow.js): one stage per sampler
// in the order they run, the model each is fed, a split's steps, an enlargement, whether it runs; the
// model files, LoRAs, control models and picture nodes around them; and which stages a preset changes.
import assert from 'node:assert/strict';
import { changedNodes, nodeValues, readFlow, touched, usedIn } from '../web/modules/recipe_flow.js';

const NAMES = {
    UNETLoader: ['unet_name', 'weight_dtype'], LoraLoader: ['lora_name', 'strength_model', 'strength_clip'],
    KSamplerAdvanced: ['add_noise', 'noise_seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'start_at_step', 'end_at_step', 'return_with_leftover_noise'],
    KSampler: ['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
    LatentUpscaleBy: ['upscale_method', 'scale_by'], AnimaLLLiteApply_sdscripts: ['lllite_name', 'strength', 'start_percent', 'end_percent', 'preserve_wrapper'],
    ControlNetApplyAdvanced: ['strength', 'start_percent', 'end_percent'],
};
const names = type => NAMES[type] || [];
let links = 0;
const wires = [];
function node(id, type, values, feeds = {}) {
    const inputs = Object.entries(feeds).map(([name, from]) => {
        links += 1;
        wires.push([links, from, 0, id, 0, '*']);
        return { name, link: links };
    });
    return { id, type, widgets_values: values, inputs, mode: 0 };
}
const graph = nodes => ({ nodes, links: wires.map(wire => [...wire]) });
// Base model split at step 21 to a second model, then a Tile-guided 1.22 enlargement on the second, its colours matched to the base.
function workflow({ second = 'Anima/realskin.safetensors', switchAt = 21 } = {}) {
    links = 0;
    wires.length = 0;
    return graph([
        node(1, 'UNETLoader', ['Anima/harem.safetensors', 'default']),
        node(16, 'LoraLoader', ['style.safetensors', 1, 1], { model: 1 }),
        node(30, 'UNETLoader', [second, 'default']),
        node(31, 'LoraLoader', ['style.safetensors', 1, 1], { model: 30 }),
        node(2, 'CLIPTextEncode', ['1girl'], { clip: 16 }),
        node(6, 'EmptyLatentImage', [832, 1216, 1]),
        node(32, 'KSamplerAdvanced', ['enable', 7, 'fixed', 35, 4.4, 'euler', 'beta', 0, switchAt, 'enable'], { model: 16, positive: 2, negative: 2, latent_image: 6 }),
        node(33, 'KSamplerAdvanced', ['disable', 7, 'fixed', 35, 4.4, 'euler', 'beta', switchAt, 35, 'disable'], { model: 31, positive: 2, negative: 2, latent_image: 32 }),
        node(7, 'VAEDecode', [], { samples: 33 }),
        node(9, 'SaveImage', ['base'], { images: 7 }),
        node(10, 'VAEEncode', [], { pixels: 7 }),
        node(11, 'LatentUpscaleBy', ['bislerp', 1.22], { samples: 10 }),
        node(18, 'AnimaLLLiteApply_sdscripts', ['animaTileRepair_v20.safetensors', 0.7, 0, 0.8, true], { model: 31, image: 7 }),
        node(19, 'KSampler', [9, 'randomize', 30, 4.4, 'euler', 'sgm_uniform', 0.85], { model: 18, positive: 2, negative: 2, latent_image: 11 }),
        node(20, 'VAEDecode', [], { samples: 19 }),
        node(21, 'ColorMatch', ['mkl', 1, true], { image_ref: 7, image_target: 20 }),
        node(22, 'SaveImage', ['out'], { images: 21 }),
        { id: 40, type: 'MarkdownNote', widgets_values: ['about'], inputs: [], mode: 0 },
    ]);
}
const part = (flow, kind, name) => flow.parts.find(item => item.kind === kind && item.name === name);

const relay = workflow();
const flow = readFlow(relay, names);
const { stages } = flow;
assert.deepEqual(stages.map(stage => [stage.n, stage.sampler, stage.kind, stage.state]), [[1, '32', 'base', 'run'], [2, '33', 'continue', 'run'], [3, '19', 'upscale', 'run']],
    'in the order they run, whatever the node ids');
assert.deepEqual(stages.map(stage => stage.model), ['harem', 'realskin', 'realskin'], 'followed through LoRAs and the Tile patch');
assert.deepEqual([stages[0].window, stages[1].window, stages[2].window], [[0, 21], [21, 35], null]);
assert.deepEqual([stages[2].upscale, stages[2].denoise, stages[2].steps], [1.22, 0.85, 30]);
assert.ok(!stages[1].nodes.has('2'), 'a prompt shared by every stage is not one stage\'s');
assert.ok(stages[2].nodes.has('30') && !stages[0].nodes.has('30'), 'the second model is the later stages\'');
assert.deepEqual([part(flow, 'model', 'harem').stages, part(flow, 'model', 'realskin').stages], [[1], [2, 3]]);
assert.deepEqual(part(flow, 'lora', 'style'), { kind: 'lora', ids: ['16', '31'], file: 'style.safetensors', name: 'style', strength: 1, stages: [1, 2, 3], on: true },
    'one LoRA at one strength on both models is one part');
assert.deepEqual([part(flow, 'control', 'animaTileRepair_v20').strength, part(flow, 'control', 'animaTileRepair_v20').stages], [0.7, [3]]);
assert.deepEqual(flow.parts.filter(item => item.kind === 'post').map(item => [item.name, item.ids]), [['ColorMatch', ['21']]],
    'after the samplers: the colour match, not the decoders or saves');
assert.equal(flow.saves, 2);

const plain = workflow({ second: 'Anima/harem.safetensors', switchAt: 35 });
const own = readFlow(plain, names);
assert.deepEqual(own.stages.map(stage => stage.state), ['run', 'skipped', 'run'], 'a split from the last step leaves its second part unrun');
assert.deepEqual(part(own, 'model', 'harem').ids, ['1', '30'], 'the same file in two loaders is one part');
assert.deepEqual(touched(stages, changedNodes(plain, relay), own.stages), [1, 2, 3], 'the relay changes the split, runs the second part, and the later model');
const later = workflow({ switchAt: 35 });
assert.deepEqual(touched(readFlow(later, names).stages, changedNodes(plain, later), own.stages), [3],
    'a stage unrun with both is no change, though its model changed');
assert.ok(usedIn(flow, '33') && !usedIn(own, '33') && usedIn(own, '30'), 'the second sampler runs only with the relay; its loader feeds the enlargement anyway');
const reseeded = workflow({ second: 'Anima/harem.safetensors', switchAt: 35 });
reseeded.nodes.find(item => item.id === 19).widgets_values[1] = 'fixed';
assert.equal(changedNodes(plain, reseeded).size, 0, 'a seed\'s after-run choice is no change');

const bypassed = workflow();
bypassed.nodes.find(item => item.id === 16).mode = 4;
bypassed.nodes.find(item => item.id === 33).mode = 4;
const off = readFlow(bypassed, names);
assert.deepEqual([off.stages[0].model, off.stages[1].state], ['harem', 'off'], 'a bypassed LoRA is passed through; a bypassed sampler does not run');
assert.deepEqual(part(off, 'lora', 'style').ids, ['31'], 'nor is a bypassed LoRA shown');

links = 0;
wires.length = 0;
const controlled = graph([
    node(1, 'CheckpointLoaderSimple', ['sd15/dream.safetensors']),
    node(2, 'CLIPTextEncode', ['a cat'], { clip: 1 }),
    node(3, 'ControlNetLoader', ['canny.safetensors']),
    node(4, 'LoadImage', ['edges.png', 'image']),
    node(5, 'ControlNetApplyAdvanced', [0.6, 0, 1], { positive: 2, negative: 2, control_net: 3, image: 4 }),
    node(6, 'EmptyLatentImage', [512, 512, 1]),
    node(7, 'KSampler', [1, 'fixed', 20, 7, 'euler', 'normal', 1], { model: 1, positive: 5, negative: 5, latent_image: 6 }),
    node(8, 'VAEDecode', [], { samples: 7, vae: 1 }),
    node(9, 'SaveImage', ['cat'], { images: 8 }),
]);
const prompted = readFlow(controlled, names);
assert.deepEqual([prompted.stages[0].model, part(prompted, 'control', 'canny')?.ids, part(prompted, 'control', 'canny')?.strength], ['dream', ['5'], 0.6],
    'a ControlNet applied to the prompts, named by its loader\'s file');
assert.ok(prompted.stages[0].nodes.has('3'), 'its loader is the stage\'s too');
assert.deepEqual(nodeValues(controlled.nodes[4], names).map(item => item.name), ['strength', 'start_percent', 'end_percent']);
assert.equal(changedNodes({ nodes: [{ id: 1, widgets_values: { a: 1 } }] }, { nodes: [{ id: 1, widgets_values: { a: 2 } }] }).size, 1, 'values saved by name compare too');
assert.deepEqual(readFlow({ nodes: [{ id: 1, type: 'SaveImage', inputs: [] }], links: [] }, names).stages, [], 'no sampler, no stages');
console.log('recipe_flow ok');
