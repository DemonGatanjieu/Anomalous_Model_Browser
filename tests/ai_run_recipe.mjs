// Pure run recipe extraction (web/modules/ai_run_recipe.js):
// verifies LoadImage inputs + candidate URLs, base models, LoRAs + weights, sampler/size
// settings, parameter deltas, and private token alignment ([img*], [M*], [P*]).
import assert from 'node:assert/strict';
import { inputImageUrls, recipeOfRun } from '../web/modules/ai_run_recipe.js';

assert.deepEqual(inputImageUrls('anomalous_ai/pose_01.png'), [
    '/view?filename=pose_01.png&subfolder=anomalous_ai&type=input',
    '/anomalous/output_thumbnail?filename=pose_01.png&subfolder=anomalous_ai',
]);

const task = {
    private: true,
    sealed: {
        '[img1]': 'anomalous_ai/pose_01.png',
        '[M1]': 'checkpoints:0:Anima/animaTurbo.safetensors',
        '[M2]': 'loras:0:hug_pose.safetensors',
        '[P1]': 'two girls hugging, soft lighting',
    },
};

const step = {
    id: 'run_2',
    map: {
        boxes: [
            { id: '1', role: 'image', facts: { file: 'anomalous_ai/pose_01.png' } },
            { id: '2', role: 'model', facts: { file: 'animaTurbo' } },
            { id: '3', role: 'lora', facts: { file: 'hug_pose', strength: 0.75 } },
            { id: '4', role: 'prompt', facts: { polarity: 'positive', text: 'two girls hugging, soft lighting' } },
            { id: '5', role: 'prompt', facts: { polarity: 'negative', text: 'lowres, bad hands' } },
            { id: '6', role: 'size', facts: { width: 1024, height: 1536, batch: 2 } },
            { id: '7', role: 'sampler', facts: { steps: 24, cfg: 5.5, sampler_name: 'euler', scheduler: 'simple', denoise: 0.65 } },
            { id: '8', role: 'upscale', facts: { file: '4x-UltraSharp' } },
        ],
    },
    changes: [
        { node: '7', title: 'KSampler', key: 'denoise', from: '0.8', to: '0.65' },
    ],
    results: [{ type: 'image', filename: 'out_01.png', subfolder: '' }],
};

const recipe = recipeOfRun(step, task);
assert.equal(recipe.hasDetails, true);
assert.equal(recipe.images.length, 1);
assert.equal(recipe.images[0].filename, 'pose_01.png');
assert.equal(recipe.images[0].token, '[img1]');
assert.equal(recipe.models[0].token, '[M1]');
assert.equal(recipe.loras[0].strength, 0.75);
assert.equal(recipe.loras[0].token, '[M2]');
assert.equal(recipe.prompts[0].token, '[P1]');
assert.equal(recipe.prompts[1].polarity, 'negative');
assert.equal(recipe.sampler.steps, 24);
assert.equal(recipe.sampler.width, 1024);
assert.equal(recipe.sampler.batch, 2);
assert.equal(recipe.sampler.denoise, 0.65);
assert.equal(recipe.sampler.upscale, '4x-UltraSharp');
assert.equal(recipe.changes.length, 1);
assert.equal(recipe.pictures.length, 1);

const emptyRecipe = recipeOfRun({ id: 'r0', results: [] }, { private: false });
assert.equal(emptyRecipe.hasDetails, false);

console.log('ai_run_recipe: ok');
