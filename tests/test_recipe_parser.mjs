import assert from 'node:assert/strict';
import { extractRecipeMetadata } from '../web/modules/recipe_parser.js';

const checkpoint = {
    id: 1,
    type: 'CheckpointLoaderSimple',
    widgets: [{ name: 'ckpt_name', value: 'sdxl/base.safetensors' }],
};
const lora = {
    id: 2,
    type: 'LoraLoader',
    widgets: [
        { name: 'lora_name', value: 'styles/detail.safetensors' },
        { name: 'strength_model', value: 0.8 },
        { name: 'strength_clip', value: 0.65 },
    ],
};
const positive = {
    id: 3,
    type: 'CLIPTextEncode',
    widgets: [{ name: 'text', value: 'cinematic portrait, soft rim light' }],
};
const negative = {
    id: 4,
    type: 'CLIPTextEncode',
    widgets: [{ name: 'text', value: 'blurry, low quality' }],
};
const sampler = {
    id: 5,
    type: 'KSampler',
    inputs: [{ name: 'positive', link: 101 }, { name: 'negative', link: 102 }],
    widgets: [
        { name: 'seed', value: 42 },
        { name: 'control_after_generate', value: 'fixed' },
        { name: 'steps', value: 28 },
        { name: 'cfg', value: 6.5 },
        { name: 'sampler_name', value: 'dpmpp_2m' },
        { name: 'scheduler', value: 'karras' },
        { name: 'denoise', value: 0.9 },
    ],
};
const emptyLatent = {
    id: 6,
    type: 'EmptyLatentImage',
    widgets: [{ name: 'width', value: 1024 }, { name: 'height', value: 768 }],
};
const advancedSampler = {
    id: 7,
    type: 'KSamplerAdvanced',
    widgets: [
        { name: 'noise_seed', value: 123 },
        { name: 'control_after_generate', value: 'randomize' },
        { name: 'steps', value: 20 },
        { name: 'cfg', value: 4 },
        { name: 'sampler_name', value: 'euler' },
        { name: 'scheduler', value: 'normal' },
        { name: 'start_at_step', value: 7 },
    ],
};
const customNode = {
    id: 8,
    type: 'ThirdPartyDetailNode',
    title: 'Custom Detail Control',
    constructor: { nodeData: { category: 'third_party/image', python_module: 'custom_nodes.detail_pack' } },
    widgets: [
        { name: 'detail_strength', value: 0.72 },
        { name: 'mode', value: 'balanced' },
        { name: 'api_key', value: 'must-not-enter-the-card-summary' },
        { name: 'run_now', type: 'button', value: true },
    ],
};

const metadata = extractRecipeMetadata({
    _nodes: [checkpoint, lora, positive, negative, sampler, emptyLatent, advancedSampler, customNode],
    links: {
        101: { origin_id: 3, target_id: 5 },
        102: { origin_id: 4, target_id: 5 },
    },
});

assert.equal(metadata.baseModel, 'sdxl/base.safetensors');
assert.deepEqual(metadata.loras, [{
    name: 'styles/detail.safetensors',
    strength_model: 0.8,
    strength_clip: 0.65,
}]);
assert.deepEqual(metadata.promptPositive, ['cinematic portrait, soft rim light']);
assert.deepEqual(metadata.promptNegative, ['blurry, low quality']);
assert.equal(metadata.seed, 42);
assert.equal(metadata.steps, 28);
assert.equal(metadata.cfg, 6.5);
assert.equal(metadata.sampler_name, 'dpmpp_2m');
assert.equal(metadata.scheduler, 'karras');
assert.equal(metadata.denoise, 0.9);
assert.deepEqual(metadata.resolution, { width: 1024, height: 768 });
assert.equal(metadata.samplers[1].denoise, null);
assert.equal(metadata.nodeCount, 8);
const customSummary = metadata.nodes.find((node) => node.id === 8);
assert.equal(customSummary.module, 'custom_nodes.detail_pack');
assert.deepEqual(customSummary.widgets, [
    { name: 'detail_strength', value: 0.72 },
    { name: 'mode', value: 'balanced' },
]);

console.log('recipe_parser tests passed');
