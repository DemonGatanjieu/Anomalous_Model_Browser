// Pure Privacy Overview model & preview masking (web/modules/ai_privacy_view.js):
// tokens sort numerically, user messages/gists show what stayed unsealed vs masked tokens,
// model names follow privacy_models, generated pictures & unassigned materials count cleanly.
import assert from 'node:assert/strict';
import { buildPrivacyOverview, formatModelRef, maskTextForView, parsePictureRef } from '../web/modules/ai_privacy_view.js';

assert.deepEqual(parsePictureRef('ai_inbox\\ref_01.png'), {
    path: 'ai_inbox/ref_01.png', subfolder: 'ai_inbox', filename: 'ref_01.png',
});
assert.deepEqual(formatModelRef('checkpoints:0:2D_Anime/Anima/animaTurbo.safetensors'), {
    type: 'checkpoints',
    file: '2D_Anime/Anima/animaTurbo.safetensors',
    name: 'animaTurbo.safetensors',
    raw: 'checkpoints:0:2D_Anime/Anima/animaTurbo.safetensors',
});

const masked = maskTextForView(
    '正面提示词原样用这个：『1girl, swimsuit』，底模用 animaTurbo，参考 sub/pose.png',
    {
        '[P1]': '1girl, swimsuit',
        '[M1]': 'checkpoints:0:2D_Anime/Anima/animaTurbo.safetensors',
        '[img1]': 'sub/pose.png',
    },
    [{ token: '[P1]', text: '1girl, swimsuit' }],
);
assert.equal(masked.preview, '正面提示词原样用这个：『[P1]』，底模用 [M1]，参考 [img1]');
assert.equal(masked.hasPlaintext, true);

const onlyToken = maskTextForView('「[P1]」', { '[P1]': 'secret words' });
assert.equal(onlyToken.preview, '「[P1]」');
assert.equal(onlyToken.hasPlaintext, false);

const exposedModel = maskTextForView(
    '只用 animaTurbo 和 [P1]',
    { '[P1]': 'secret', '[M1]': 'checkpoints:0:Anima/animaTurbo.safetensors' },
    null,
    { hideModels: false },
);
assert.equal(exposedModel.preview, '只用 animaTurbo 和 [P1]');

const overview = buildPrivacyOverview({
    id: 't1',
    title: '双人少女抱姿',
    private: true,
    privacy_models: true,
    reads_disk: true,
    client: 'Antigravity',
    sealed: {
        '[P10]': 'tenth prompt',
        '[P2]': 'second prompt',
        '[P1]': 'main hug tags',
        '[img1]': 'ai_inbox/ref.png',
        '[M1]': 'checkpoints:0:Anima/animaTurbo.safetensors',
    },
    sealed_notes: {
        '[P1]': '主正面提示词',
        '[img1]': '只借鉴站位，不照搬画风',
        '[P99]': 'ignored stale key',
    },
    toolbox: {
        models: [
            { model_id: 'checkpoints:0:Anima/animaTurbo.safetensors' },
            { model_id: 'loras:0:hug_v1.safetensors' },
        ],
    },
    decisions: [{ type: 'privacy', on: true }],
    steps: [
        { id: 's1', kind: 'user', tool: 'user_route', delivered: true, text: '只用 animaTurbo 一次出图' },
        { id: 's2', kind: 'user', tool: 'user_message', delivered: false, text: '正面：『main hug tags』', sealed_parts: [{ token: '[P1]', text: 'main hug tags' }] },
        { id: 's3', kind: 'panel', answers: { prompts: { gist: '雨夜海边', delivered: true } } },
        { id: 's4', kind: 'tool', results: [{ type: 'image', filename: 'out_01.png', subfolder: '' }, { type: 'image', filename: 'out_02.png', subfolder: '' }] },
    ],
});

assert.equal(overview.readsDisk, true);
assert.deepEqual(overview.hidden.prompts.map(x => x.token), ['[P1]', '[P2]', '[P10]']);
assert.equal(overview.hidden.prompts[0].note, '主正面提示词');
assert.equal(overview.hidden.pictures[0].filename, 'ref.png');
assert.equal(overview.hidden.models[0].activeHidden, true);
assert.equal(overview.hidden.generatedPictureCount, 2);
assert.equal(overview.hidden.total, 5);
assert.equal(overview.unassignedToolboxModels, 1);
assert.equal(overview.visible.title, '双人少女抱姿');
assert.deepEqual(overview.visible.notes, [
    { token: '[P1]', note: '主正面提示词' },
    { token: '[img1]', note: '只借鉴站位，不照搬画风' },
]);
assert.deepEqual(overview.visible.messages.map(m => [m.stepId, m.preview, m.delivered]), [
    ['s1', '只用 [M1] 一次出图', true],
    ['s2', '正面：『[P1]』', false],
    ['s3', '雨夜海边', true],
]);
assert.equal(overview.visible.decisionsCount, 1);

console.log('ai_privacy_view: ok');
