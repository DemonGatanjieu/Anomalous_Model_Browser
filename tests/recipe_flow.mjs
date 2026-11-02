// node tests/recipe_flow.mjs — a saved workflow's stages (web/modules/recipe_flow.js): one per sampler in
// the order they run, the model each is fed through LoRAs and a Tile patch, a split's steps, an
// enlargement; and which stages a preset changes.
import assert from 'node:assert/strict';
import { changedNodes, flowStages, touched } from '../web/modules/recipe_flow.js';

const NAMES = {
    UNETLoader: ['unet_name', 'weight_dtype'], LoraLoader: ['lora_name', 'strength_model', 'strength_clip'],
    KSamplerAdvanced: ['add_noise', 'noise_seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'start_at_step', 'end_at_step', 'return_with_leftover_noise'],
    KSampler: ['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
    LatentUpscaleBy: ['upscale_method', 'scale_by'], AnimaLLLiteApply_sdscripts: ['lllite_name', 'strength', 'start_percent', 'end_percent', 'preserve_wrapper'],
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
// Base model split at step 21 to a second model, then a Tile-guided 1.22 enlargement on the second.
function workflow({ second = 'Anima/realskin.safetensors', switchAt = 21 } = {}) {
    links = 0;
    wires.length = 0;
    const nodes = [
        node(1, 'UNETLoader', ['Anima/harem.safetensors', 'default']),
        node(16, 'LoraLoader', ['style.safetensors', 1, 1], { model: 1 }),
        node(30, 'UNETLoader', [second, 'default']),
        node(31, 'LoraLoader', ['style.safetensors', 1, 1], { model: 30 }),
        node(2, 'CLIPTextEncode', ['1girl'], { clip: 16 }),
        node(6, 'EmptyLatentImage', [832, 1216, 1]),
        node(32, 'KSamplerAdvanced', ['enable', 7, 'fixed', 35, 4.4, 'euler', 'beta', 0, switchAt, 'enable'], { model: 16, positive: 2, negative: 2, latent_image: 6 }),
        node(33, 'KSamplerAdvanced', ['disable', 7, 'fixed', 35, 4.4, 'euler', 'beta', switchAt, 35, 'disable'], { model: 31, positive: 2, negative: 2, latent_image: 32 }),
        node(7, 'VAEDecode', [], { samples: 33 }),
        node(10, 'VAEEncode', [], { pixels: 7 }),
        node(11, 'LatentUpscaleBy', ['bislerp', 1.22], { samples: 10 }),
        node(18, 'AnimaLLLiteApply_sdscripts', ['animaTileRepair_v20.safetensors', 0.7, 0, 0.8, true], { model: 31, image: 7 }),
        node(19, 'KSampler', [9, 'randomize', 30, 4.4, 'euler', 'sgm_uniform', 0.85], { model: 18, positive: 2, negative: 2, latent_image: 11 }),
        node(22, 'SaveImage', ['out'], { images: 19 }),
        { id: 40, type: 'MarkdownNote', widgets_values: ['about'], inputs: [], mode: 0 },
    ];
    return { nodes, links: wires.map(wire => [...wire]) };
}

const relay = workflow();
const stages = flowStages(relay, names);
assert.deepEqual(stages.map(stage => [stage.n, stage.sampler, stage.kind]), [[1, '32', 'base'], [2, '33', 'continue'], [3, '19', 'upscale']],
    'in the order they run, whatever the node ids');
assert.deepEqual(stages.map(stage => stage.model.name), ['harem', 'realskin', 'realskin'], 'followed through LoRAs and the Tile patch');
assert.deepEqual([stages[0].model.loras, stages[2].model.control], [1, 'Tile']);
assert.deepEqual([stages[0].window, stages[1].window, stages[2].window], [[0, 21], [21, 35], null]);
assert.deepEqual([stages[2].upscale, stages[2].denoise, stages[2].steps], [1.22, 0.85, 30]);
assert.ok(!stages[1].nodes.has('2'), 'a prompt shared by every stage is not one stage\'s');
assert.ok(stages[2].nodes.has('30') && !stages[0].nodes.has('30'), 'the second model is the later stages\'');

const plain = workflow({ second: 'Anima/harem.safetensors', switchAt: 35 });
const own = flowStages(plain, names);
assert.ok(own[1].skipped && !own[0].skipped, 'a split from the last step leaves its second part unrun');
assert.deepEqual(touched(own, changedNodes(plain, relay)), [1, 2, 3], 'the relay changes the split and both later models');
assert.deepEqual(touched(own, changedNodes(plain, workflow({ switchAt: 35 }))), [2, 3], 'only the second model');
const reseeded = workflow({ second: 'Anima/harem.safetensors', switchAt: 35 });
reseeded.nodes.find(item => item.id === 19).widgets_values[1] = 'fixed';
assert.equal(changedNodes(plain, reseeded).size, 0, 'a seed\'s after-run choice is no change');
assert.deepEqual(flowStages({ nodes: [{ id: 1, type: 'SaveImage', inputs: [] }], links: [] }, names), [], 'no sampler, no stages');
console.log('recipe_flow ok');
