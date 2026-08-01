import assert from 'node:assert/strict';
import {
    collectMainModelContextRequests,
    formatModelTypeLabel,
    getBaseModelFamily,
    inferPickerModelType,
} from '../web/modules/model_picker.js';

assert.deepEqual(
    inferPickerModelType({ type: 'LoraLoader' }, { name: 'lora_name' }),
    { label: 'LoRA', folderTypes: ['loras'], isLora: true },
);
assert.deepEqual(
    inferPickerModelType({ type: 'UNETLoader' }, { name: 'unet_name' }),
    { label: 'UNET', folderTypes: ['diffusion_models', 'unet'], isLora: false },
);
assert.equal(formatModelTypeLabel('checkpoints'), 'Checkpoint');
assert.equal(formatModelTypeLabel('custom_type', 'Custom'), 'Custom');

assert.equal(getBaseModelFamily('SDXL 1.0'), 'sdxl');
assert.equal(getBaseModelFamily('Stable Diffusion 1.5'), 'sd15');
assert.equal(getBaseModelFamily('Pony Diffusion V6 XL'), 'pony');
assert.equal(getBaseModelFamily('Illustrious XL v1.1'), 'illustrious');
assert.equal(getBaseModelFamily('FLUX.1 D'), 'flux');

const checkpoint = {
    id: 1,
    type: 'CheckpointLoaderSimple',
    inputs: [],
    widgets: [{ name: 'ckpt_name', value: 'SDXL/main.safetensors' }],
};
const lora = {
    id: 2,
    type: 'LoraLoader',
    inputs: [
        { type: 'MODEL', link: 10 },
        { type: 'CLIP', link: 11 },
    ],
    widgets: [{ name: 'lora_name', value: 'styles/detail.safetensors' }],
};
const sampler = {
    id: 3,
    type: 'KSampler',
    inputs: [{ type: 'MODEL', link: 12 }],
    widgets: [],
};
const graph = {
    links: {
        10: { origin_id: 1 },
        11: { origin_id: 1 },
        12: { origin_id: 2 },
    },
    _nodes: [checkpoint, lora, sampler],
};

assert.deepEqual(collectMainModelContextRequests(graph, lora), [{
    path: 'SDXL/main.safetensors',
    folder_types: ['checkpoints'],
}]);
assert.deepEqual(collectMainModelContextRequests(graph, sampler), [{
    path: 'SDXL/main.safetensors',
    folder_types: ['checkpoints'],
}]);

console.log('model_picker tests passed');
