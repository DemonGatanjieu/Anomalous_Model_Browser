// Pure Privacy Overview model & preview masking (web/modules/ai_privacy_view.js):
// numeric token order, selective prompt tag/text split detection, per-model hide/expose overrides
// with sealed_legacy support, matchingTokenFor, generated picture counts, and unmasked previews.
import assert from 'node:assert/strict';
import {
    buildPrivacyOverview, formatModelRef, maskTextForView, matchingTokenFor, parsePictureRef, partsShowingRange, partsShowingTags, promptChunks, promptMirror,
} from '../web/modules/ai_privacy_view.js';

// The side-by-side view: a prompt split by letting 'ocean' through reads as written, slot for slot.
{
    const task = {
        sealed: { '[P2]': '1girl, swimsuit', '[P3]': 'sunset', '[P4]': 'red hair, long hair, smile', '[P5]': 'ocean' },
        sealed_legacy: { '[P1]': '1girl, swimsuit, ocean, sunset' },
        sealed_views: { '[P1]': '[P2], ocean, [P3]' },
        exposed_prompts: [{ from: '[P1]', kept: ['[P2]', '[P3]'], text: 'ocean' }],
    };
    const prompts = ['[P2]', '[P3]', '[P4]'].map(token => ({ token, text: task.sealed[token], chunks: promptChunks(task.sealed[token]) }));
    const rows = promptMirror(task, prompts);
    assert.deepEqual(rows.map(row => row.token), ['[P1]', '[P4]'], 'what was kept of [P1] is inside it, not a prompt of its own');
    assert.deepEqual(rows[0].slots.map(slot => [slot.text, slot.shown, slot.token || '', slot.index ?? null]), [
        ['1girl', false, '[P2]', 0], ['swimsuit', false, '[P2]', 1], ['ocean', true, '', null], ['sunset', false, '[P3]', 0],
    ]);
    assert.deepEqual(rows[1].slots.map(slot => [slot.text, slot.index]), [['red hair', 0], ['long hair', 1], ['smile', 2]]);
    // 'ocean' hidden again afterwards ([P5] covers it): its slot says so, and [P5] is no row of its own.
    const again = promptMirror(task, [...prompts, { token: '[P5]', text: 'ocean', chunks: promptChunks('ocean') }]);
    assert.deepEqual(again[0].slots[2], { text: 'ocean', shown: false, token: '[P5]', index: -1 });
    assert.deepEqual(again.map(row => row.token), ['[P1]', '[P4]']);
}

assert.deepEqual(parsePictureRef('ai_inbox\\ref_01.png'), {
    path: 'ai_inbox/ref_01.png', subfolder: 'ai_inbox', filename: 'ref_01.png',
});
assert.deepEqual(formatModelRef('checkpoints:0:2D_Anime/Anima/animaTurbo.safetensors'), {
    type: 'checkpoints',
    file: '2D_Anime/Anima/animaTurbo.safetensors',
    name: 'animaTurbo.safetensors',
    raw: 'checkpoints:0:2D_Anime/Anima/animaTurbo.safetensors',
});

const chunks = promptChunks('1girl, swimsuit, ocean, sunset');
assert.equal(chunks.mode, 'tags');
assert.deepEqual(chunks.items.map(item => item.text), ['1girl', 'swimsuit', 'ocean', 'sunset']);
assert.equal(promptChunks('两个少女在夕阳海边互相抱着对方，光线柔和温暖').mode, 'text');
// Letting one tag through in the middle: the parts spell the text, each run of hidden tags one part.
const spelled = parts => parts.map(part => part.text).join('');
const middle = partsShowingTags('1girl,  swimsuit, ocean,sunset', new Set([2]));
assert.equal(spelled(middle), '1girl,  swimsuit, ocean,sunset');
assert.deepEqual(middle.filter(part => part.hide).map(part => part.text), ['1girl,  swimsuit', 'sunset']);
assert.deepEqual(middle.filter(part => !part.hide).map(part => part.text), [', ocean,']);
assert.deepEqual(partsShowingRange('海边的两个少女', 2, 3), [{ text: '海边', hide: true }, { text: '的', hide: false }, { text: '两个少女', hide: true }]);

assert.equal(matchingTokenFor('animaTurbo', { '[M1]': 'checkpoints:0:2D_Anime/Anima/animaTurbo.safetensors' }, '[M'), '[M1]');
assert.equal(matchingTokenFor('ref_01.png', { '[img2]': 'ai_inbox/ref_01.png' }, '[img'), '[img2]');

const masked = maskTextForView(
    '正面提示词原样用这个：『1girl, swimsuit』，底模用 animaTurbo，风格用 sensitiveLora，参考 sub/pose.png',
    {
        '[P1]': '1girl, swimsuit',
        '[M1]': 'checkpoints:0:2D_Anime/Anima/animaTurbo.safetensors',
        '[M2]': 'loras:0:sensitiveLora.safetensors',
        '[img1]': 'sub/pose.png',
    },
    [{ token: '[P1]', text: '1girl, swimsuit' }],
    { hideModels: true, publicModels: ['checkpoints:0:2D_Anime/Anima/animaTurbo.safetensors'] },
);
assert.equal(masked.preview, '正面提示词原样用这个：『[P1]』，底模用 animaTurbo，风格用 [M2]，参考 [img1]');
assert.equal(masked.hasPlaintext, true);

const onlyToken = maskTextForView('「[P1]」', { '[P1]': 'secret words' });
assert.equal(onlyToken.preview, '「[P1]」');
assert.equal(onlyToken.hasPlaintext, false);

const exposedTaskPrivateLora = maskTextForView(
    '只用 animaTurbo 和 sensitiveLora 和 [P1]',
    {
        '[P1]': 'secret',
        '[M1]': 'checkpoints:0:Anima/animaTurbo.safetensors',
        '[M2]': 'loras:0:sensitiveLora.safetensors',
    },
    null,
    { hideModels: false, privateModels: ['loras:0:sensitiveLora.safetensors'] },
);
assert.equal(exposedTaskPrivateLora.preview, '只用 animaTurbo 和 [M2] 和 [P1]');

const overview = buildPrivacyOverview({
    id: 't1',
    title: '双人少女抱姿',
    private: true,
    privacy_models: true,
    public_models: ['checkpoints:0:Anima/animaTurbo.safetensors'],
    reads_disk: true,
    client: 'Antigravity',
    sealed: {
        '[P10]': 'tenth prompt',
        '[P2]': 'second prompt',
        '[P1]': 'main hug, swimsuit, twintails',
        '[img1]': 'ai_inbox/ref.png',
        '[M2]': 'loras:0:hug_v1.safetensors',
    },
    sealed_legacy: {
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
            { model_id: 'loras:0:extra_lora.safetensors' },
        ],
    },
    exposed_prompts: [{ from: '[P0]', kept: '[P1]', text: 'sunset beach' }],
    decisions: [{ type: 'privacy', on: true }],
    steps: [
        { id: 's1', kind: 'user', tool: 'user_route', delivered: true, text: '只用 animaTurbo 配 hug_v1 一次出图' },
        { id: 's2', kind: 'user', tool: 'user_message', delivered: false, text: '正面：『main hug, swimsuit, twintails』', sealed_parts: [{ token: '[P1]', text: 'main hug, swimsuit, twintails' }] },
        { id: 's2b', kind: 'user', tool: 'user_message', delivered: true, delivered_at: 100, text: '海边 twintails 再来一张', sealed_parts: [{ token: '[P10]', text: 'twintails', at: 150 }] },
        { id: 's3', kind: 'panel', answers: { prompts: { gist: '雨夜海边', delivered: true } } },
        { id: 's4', kind: 'tool', results: [{ type: 'image', filename: 'out_01.png', subfolder: '' }, { type: 'image', filename: 'out_02.png', subfolder: '' }] },
    ],
});

assert.equal(overview.readsDisk, true);
assert.deepEqual(overview.hidden.prompts.map(x => x.token), ['[P1]', '[P2]', '[P10]']);
assert.equal(overview.hidden.prompts[0].chunks.mode, 'tags');
assert.equal(overview.hidden.prompts[0].note, '主正面提示词');
assert.equal(overview.hidden.pictures[0].filename, 'ref.png');
assert.equal(overview.hidden.generatedPictureCount, 2);
assert.equal(overview.modelCatalog.length, 3);
assert.equal(overview.modelCatalog.find(m => m.id.includes('animaTurbo')).hidden, false);
assert.equal(overview.modelCatalog.find(m => m.id.includes('animaTurbo')).legacyToken, '[M1]');
assert.equal(overview.modelCatalog.find(m => m.id.includes('hug_v1')).hidden, true);
assert.equal(overview.unassignedToolboxModels, 1);
assert.deepEqual(overview.visible.notes, [
    { token: '[P1]', note: '主正面提示词' },
    { token: '[img1]', note: '只借鉴站位，不照搬画风' },
]);
assert.deepEqual(overview.visible.messages.map(m => [m.stepId, m.preview, m.delivered]), [
    ['s1', '只用 animaTurbo 配 [M2] 一次出图', true],
    ['s2', '正面：『[P1]』', false],
    ['s2b', '海边 [P10] 再来一张', true],
    ['s3', '雨夜海边', true],
]);
assert.deepEqual(overview.visible.messages.map(m => m.late), [[], [], ['[P10]'], []], 'a phrase hidden after the AI read the message is marked');
assert.equal(overview.exposedPrompts.length, 1);

// A hidden model's trigger words show under it (model_words from the task's GET), not as prompts of their own.
const withWords = buildPrivacyOverview({
    id: 't2',
    private: false,
    private_models: ['loras:0:lamp.safetensors'],
    model_words: { 'loras:0:lamp.safetensors': ['lampglow'] },
    sealed: { '[M1]': 'loras:0:lamp.safetensors', '[P1]': 'lampglow', '[P2]': 'a quiet street' },
});
assert.deepEqual(withWords.hidden.prompts.map(x => x.token), ['[P2]']);
assert.deepEqual(withWords.modelCatalog[0].words, [{ token: '[P1]', text: 'lampglow' }]);
assert.equal(withWords.modelCatalog[0].hidden, true);
assert.equal(withWords.hidden.total, 2);

console.log('ai_privacy_view: ok');
