import assert from 'node:assert/strict';
import {
    extractMaterialPromptEnvelope,
    fillPrompt as dispatchPromptInjection,
    applyNodeMaterialValues,
    isModelFilePath,
    sanitizePromptText,
    PROMPT_EXTRACTORS,
} from '../web/modules/node_material_actions.js';
import { promptBoxes, typeTakesPrompt } from '../web/modules/prompt_boxes.js';

// A saved block's values into a node of its type (the library's block apply, removed with the
// Material Library page), to exercise applyNodeMaterialValues' value and hash rules.
function applyMaterialBlock(app, node, block, workflowHashes) {
    if (node?.type !== block?.type || !Array.isArray(block.widgets_values)
        || block.widgets_values.length > (node.widgets?.length || 0)) throw new Error('materialNoCompatibleValues');
    return applyNodeMaterialValues(app, node, block.widgets_values.map((value, index) => ({ index, value })),
        { sourceNodeId: block.node_id, workflowHashes });
}

const multiline = ['STRING', { multiline: true }];
globalThis.LiteGraph = { registered_node_types: {
    'easy a1111Loader': { nodeData: { input: { required: { positive: multiline, negative: multiline } } } },
    'easy fullLoader': { nodeData: { input: { required: { positive: multiline, negative: multiline } } } },
    'easy positive': { nodeData: { input: { required: { positive: multiline } } } },
    'easy negative': { nodeData: { input: { required: { negative: multiline } } } },
    CLIPTextEncode: { nodeData: { input: { required: { text: multiline, clip: ['CLIP'] } } } },
    LoraLoader: { nodeData: { input: { required: { lora_name: [[]], strength_model: ['FLOAT'] } } } },
} };


function createEasyA1111LoaderFixture() {
    const widgets = [
        { name: 'ckpt_name', value: 'v1-5-pruned-emaonly.safetensors', type: 'combo' },
        { name: 'vae_name', value: 'vae-ft-mse-840000-ema_pruned.safetensors', type: 'combo' },
        { name: 'clip_skip', value: -1, type: 'number' },
        { name: 'lora_name', value: 'None', type: 'combo' },
        { name: 'lora_model_strength', value: 1.0, type: 'number' },
        { name: 'lora_clip_strength', value: 1.0, type: 'number' },
        { name: 'positive', value: 'initial positive prompt', type: 'customtext', options: { multiline: true } },
        { name: 'negative', value: 'initial negative prompt', type: 'customtext', options: { multiline: true } },
        { name: 'empty_latent_width', value: 512, type: 'number' },
        { name: 'empty_latent_height', value: 768, type: 'number' },
        { name: 'batch_size', value: 1, type: 'number' },
        { name: 'seed', value: 123456789, type: 'number' },
        { name: 'control_after_generate', value: 'fixed', type: 'combo' },
        { name: 'steps', value: 25, type: 'number' },
        { name: 'cfg', value: 7.5, type: 'number' },
        { name: 'sampler_name', value: 'euler_ancestral', type: 'combo' },
        { name: 'scheduler', value: 'karras', type: 'combo' },
    ];
    const node = {
        id: 10,
        type: 'easy a1111Loader',
        title: 'Easy A1111 Loader',
        widgets,
        widgets_values: widgets.map(w => w.value),
    };
    const calls = [];
    node.onWidgetChanged = (index, value, old, widget) => {
        calls.push({ index, value, old, name: widget.name });
    };
    const graph = {
        getNodeById: id => (id === node.id ? node : null),
        beforeChange: () => calls.push('before'),
        afterChange: () => calls.push('after'),
        change() {},
        setDirtyCanvas() {},
    };
    const app = {
        graph,
        canvas: { selected_nodes: { 10: node }, setDirty() {} },
    };
    return { node, graph, app, calls };
}

// ============================================================================
// Test 1: promptBoxes on easy a1111Loader (boxes by definition, roles by name)
// ============================================================================
{
    const { node } = createEasyA1111LoaderFixture();
    assert.deepEqual(promptBoxes(node).map(box => [box.index, box.name, box.role]), [[6, 'positive', 'positive'], [7, 'negative', 'negative']]);
}

// ============================================================================
// Test 2: Strategy ① - Dual-Slot Pair Injection into easy a1111Loader
// ============================================================================
{
    const { node, app, calls } = createEasyA1111LoaderFixture();
    const envelope = {
        hasPrompt: true,
        positive: '1girl, cyberpunk city, neon lights, masterpiece',
        negative: 'bad hands, low quality, deformed, blurry',
        singleText: '1girl, cyberpunk city, neon lights, masterpiece',
        primaryRole: 'both',
    };

    const result = dispatchPromptInjection(app, node, envelope);
    assert.equal(result.widgets, 2);

    // Verify positive and negative injected into their respective slots
    assert.equal(node.widgets[6].value, '1girl, cyberpunk city, neon lights, masterpiece');
    assert.equal(node.widgets[7].value, 'bad hands, low quality, deformed, blurry');
    assert.equal(node.widgets_values[6], '1girl, cyberpunk city, neon lights, masterpiece');
    assert.equal(node.widgets_values[7], 'bad hands, low quality, deformed, blurry');

    // Verify other widgets completely untouched
    assert.equal(node.widgets[0].value, 'v1-5-pruned-emaonly.safetensors');
    assert.equal(node.widgets[11].value, 123456789);

    // Verify atomic undo
    result.undo();
    assert.equal(node.widgets[6].value, 'initial positive prompt');
    assert.equal(node.widgets[7].value, 'initial negative prompt');
    assert.equal(node.widgets_values[6], 'initial positive prompt');
    assert.equal(node.widgets_values[7], 'initial negative prompt');
}

// ============================================================================
// Test 3: Strategy ② - Role-Matched Negative Prompt Injection (Fixes index 0 bug)
// ============================================================================
{
    const { node, app } = createEasyA1111LoaderFixture();
    const envelope = {
        hasPrompt: true,
        positive: '',
        negative: 'ugly, bad anatomy, bad feet, lowres',
        singleText: 'ugly, bad anatomy, bad feet, lowres',
        primaryRole: 'negative',
    };

    const result = dispatchPromptInjection(app, node, envelope);
    assert.equal(result.widgets, 1);

    // Positive must REMAIN unchanged!
    assert.equal(node.widgets[6].value, 'initial positive prompt');
    assert.equal(node.widgets_values[6], 'initial positive prompt');

    // Negative must be accurately updated!
    assert.equal(node.widgets[7].value, 'ugly, bad anatomy, bad feet, lowres');
    assert.equal(node.widgets_values[7], 'ugly, bad anatomy, bad feet, lowres');

    // Undo restores negative
    result.undo();
    assert.equal(node.widgets[7].value, 'initial negative prompt');
}

// ============================================================================
// Test 4: Single-Slot Role Nodes (easy positive & easy negative)
// ============================================================================
{
    // easy positive
    const posWidgets = [{ name: 'positive', value: 'old pos' }];
    const posNode = {
        id: 20,
        type: 'easy positive',
        title: 'Easy Positive',
        widgets: posWidgets,
        widgets_values: ['old pos'],
    };
    const appPos = {
        graph: { getNodeById: id => id === 20 ? posNode : null, beforeChange() {}, afterChange() {}, change() {}, setDirtyCanvas() {} },
        canvas: { selected_nodes: { 20: posNode }, setDirty() {} },
    };

    assert.deepEqual(promptBoxes(posNode).map(box => [box.index, box.role]), [[0, 'positive']]);

    const dualEnvelope = {
        hasPrompt: true,
        positive: 'beautiful scenery, sunset',
        negative: 'clouds, rain',
        singleText: 'beautiful scenery, sunset',
        primaryRole: 'both',
    };

    dispatchPromptInjection(appPos, posNode, dualEnvelope);
    assert.equal(posNode.widgets[0].value, 'beautiful scenery, sunset');

    // easy negative
    const negWidgets = [{ name: 'negative', value: 'old neg' }];
    const negNode = {
        id: 21,
        type: 'easy negative',
        title: 'Easy Negative',
        widgets: negWidgets,
        widgets_values: ['old neg'],
    };
    const appNeg = {
        graph: { getNodeById: id => id === 21 ? negNode : null, beforeChange() {}, afterChange() {}, change() {}, setDirtyCanvas() {} },
        canvas: { selected_nodes: { 21: negNode }, setDirty() {} },
    };

    assert.deepEqual(promptBoxes(negNode).map(box => [box.index, box.role]), [[0, 'negative']]);

    dispatchPromptInjection(appNeg, negNode, dualEnvelope);
    assert.equal(negNode.widgets[0].value, 'clouds, rain');
}

// ============================================================================
// Test 5: Standard CLIPTextEncode (General Slot)
// ============================================================================
{
    const clipWidgets = [{ name: 'text', value: 'old clip text' }];
    const clipNode = {
        id: 30,
        type: 'CLIPTextEncode',
        title: 'CLIP Text Encode (Prompt)',
        widgets: clipWidgets,
        widgets_values: ['old clip text'],
    };
    const appClip = {
        graph: { getNodeById: id => id === 30 ? clipNode : null, beforeChange() {}, afterChange() {}, change() {}, setDirtyCanvas() {} },
        canvas: { selected_nodes: { 30: clipNode }, setDirty() {} },
    };

    assert.deepEqual(promptBoxes(clipNode).map(box => [box.index, box.role]), [[0, '']]);

    // Single positive
    dispatchPromptInjection(appClip, clipNode, {
        hasPrompt: true,
        positive: 'cyberpunk girl',
        negative: '',
        singleText: 'cyberpunk girl',
        primaryRole: 'positive',
    });
    assert.equal(clipNode.widgets[0].value, 'cyberpunk girl');

    // Single negative
    dispatchPromptInjection(appClip, clipNode, {
        hasPrompt: true,
        positive: '',
        negative: 'worst quality',
        singleText: 'worst quality',
        primaryRole: 'negative',
    });
    assert.equal(clipNode.widgets[0].value, 'worst quality');
}

// ============================================================================
// Test 6: extractMaterialPromptEnvelope Extraction Correctness
// ============================================================================
{
    // A: prompt_plan with positive and negative
    const planMaterial = {
        kind: 'prompt_plan',
        plan: {
            positive: 'masterpiece, 8k',
            negative: 'low quality, worst quality',
            parts: [],
        },
    };
    const envPlan = extractMaterialPromptEnvelope(planMaterial);
    assert.equal(envPlan.hasPrompt, true);
    assert.equal(envPlan.primaryRole, 'both');
    assert.equal(envPlan.positive, 'masterpiece, 8k');
    assert.equal(envPlan.negative, 'low quality, worst quality');

    // B: prompt_text note marked as negative
    const noteMaterial = {
        kind: 'prompt_text',
        name: '反向提示词常用',
        note: {
            promptEn: 'bad hands, blurry',
            promptZh: '坏手，模糊',
        },
    };
    const envNote = extractMaterialPromptEnvelope(noteMaterial);
    assert.equal(envNote.hasPrompt, true);
    assert.equal(envNote.primaryRole, 'negative');
    assert.equal(envNote.negative, 'bad hands, blurry');

    // C: image material with node_blocks and prompt_roles
    const imagePayload = {
        node_blocks: [
            { node_id: 6, type: 'CLIPTextEncode', widgets_values: ['high quality, 1girl'] },
            { node_id: 7, type: 'CLIPTextEncode', widgets_values: ['ugly, deformed'] },
        ],
        prompt_roles: {
            '6': { role: 'positive', source: 'automatic' },
            '7': { role: 'negative', source: 'automatic' },
        },
    };
    const envImage = extractMaterialPromptEnvelope({}, imagePayload);
    assert.equal(envImage.hasPrompt, true);
    assert.equal(envImage.primaryRole, 'both');
    assert.equal(envImage.positive, 'high quality, 1girl');
    assert.equal(envImage.negative, 'ugly, deformed');
}

// ============================================================================
// Test 7: Regression test - Same-type block application remains strictly isolated
// ============================================================================
{
    const ksamplerNode = {
        id: 50,
        type: 'KSampler',
        widgets: [
            { name: 'seed', value: 100 },
            { name: 'steps', value: 20 },
            { name: 'cfg', value: 8 },
        ],
        widgets_values: [100, 20, 8],
    };
    const appKS = {
        graph: { getNodeById: id => id === 50 ? ksamplerNode : null, beforeChange() {}, afterChange() {}, change() {}, setDirtyCanvas() {} },
        canvas: { selected_nodes: { 50: ksamplerNode }, setDirty() {} },
    };
    const ksamplerBlock = {
        node_id: 3,
        type: 'KSampler',
        widgets_values: [999, 35, 7.5],
    };

    // Applying same-type block
    const result = applyMaterialBlock(appKS, ksamplerNode, ksamplerBlock);
    assert.equal(ksamplerNode.widgets_values[0], 100); // seed is volatile
    assert.equal(ksamplerNode.widgets_values[1], 35);
    assert.equal(ksamplerNode.widgets_values[2], 7.5);

    // Mismatched node type must throw
    const otherBlock = {
        node_id: 4,
        type: 'DifferentNode',
        widgets_values: [1, 2, 3],
    };
    assert.throws(() => applyMaterialBlock(appKS, ksamplerNode, otherBlock), /materialNoCompatibleValues/);
}

// ============================================================================
// Test 8: isModelFilePath & isPromptNodeType filtering rules
// ============================================================================
{
    assert.equal(isModelFilePath('Tools\\Aesthetic Quality Modifiers - Masterpiece_v5.0 [anima-preview-3].safetensors'), true);
    assert.equal(isModelFilePath('2D_Anime/Anima/Style - Chen bin鬼针草 [Anima]_Anima v4.0.safetensors'), true);
    assert.equal(isModelFilePath('Anima\\qwen_3_06b_base.safetensors'), true);
    assert.equal(isModelFilePath('model.ckpt'), true);
    assert.equal(isModelFilePath('vae.pt'), true);
    assert.equal(isModelFilePath('model.gguf'), true);

    // Genuine prompts must NOT be flagged as model paths
    assert.equal(isModelFilePath('masterpiece, 1girl, cyberpunk city, neon lights'), false);
    assert.equal(isModelFilePath('bad hands, lowres, blurry'), false);
    assert.equal(isModelFilePath(''), false);

    // A type takes a prompt when its definition has a multiline text input.
    assert.equal(typeTakesPrompt('CLIPTextEncode'), true);
    assert.equal(typeTakesPrompt('easy positive'), true);
    assert.equal(typeTakesPrompt('LoraLoader'), false);
    assert.equal(typeTakesPrompt('NotInstalledNode'), false);
}

// ============================================================================
// Test 9: Realistic workflow snapshot with multiple LoRA / UNET / VAE blocks
// (Strictly prevents model filenames from leaking into prompt text boxes)
// ============================================================================
{
    // Simulating material_1789723104
    const workflowPayload = {
        node_blocks: [
            { node_id: 27, type: 'LoraLoader', widgets_values: ['Tools\\Aesthetic Quality Modifiers - Masterpiece_v5.0 [anima-preview-3].safetensors', 1.2, 1] },
            { node_id: 32, type: 'LoraLoader', widgets_values: ['2D_Anime\\Anima\\Style - Chen bin鬼针草 [Anima]_Anima v4.0.safetensors', 1, 1] },
            { node_id: 26, type: 'LoraLoader', widgets_values: ['2D_Anime\\Anima\\over-thigh-thighhighs_anima-base-v1.0.safetensors', 1, 1] },
            { node_id: 1, type: 'UNETLoader', widgets_values: ['Anima\\Kirazuri (Anima)_v4.0 [anima-base-1].safetensors', 'default'] },
            { node_id: 8, type: 'VAELoader', widgets_values: ['Anima\\qwenImageGGUF_vae.safetensors'] },
            { node_id: 22, type: 'CLIPTextEncode', widgets_values: ['masterpiece, high quality anime illustration, young adult woman'] },
            { node_id: 6, type: 'CLIPTextEncode', widgets_values: ['mature woman, older woman, onee-san, child, loli, bad hands'] },
        ],
        prompt_roles: {
            '22': { role: 'positive', source: 'automatic' },
            '6': { role: 'negative', source: 'automatic' },
        },
        prompt_groups: {
            positive: ['masterpiece, high quality anime illustration, young adult woman'],
            negative: ['mature woman, older woman, onee-san, child, loli, bad hands'],
        },
    };

    const envelope = extractMaterialPromptEnvelope({}, workflowPayload);
    assert.equal(envelope.hasPrompt, true);
    assert.equal(envelope.primaryRole, 'both');

    // CRITICAL: positive prompt must NOT contain ANY .safetensors file paths!
    assert.equal(envelope.positive, 'masterpiece, high quality anime illustration, young adult woman');
    assert.equal(envelope.positive.includes('.safetensors'), false);

    // Negative prompt must be purely the negative prompt
    assert.equal(envelope.negative, 'mature woman, older woman, onee-san, child, loli, bad hands');
    assert.equal(envelope.negative.includes('.safetensors'), false);

    // Now inject into easy fullLoader fixture
    const fullLoaderWidgets = [
        { name: 'ckpt_name', value: 'model.safetensors', type: 'combo' },
        { name: 'config_name', value: 'Default', type: 'combo' },
        { name: 'vae_name', value: 'Baked VAE', type: 'combo' },
        { name: 'clip_skip', value: -2, type: 'number' },
        { name: 'lora_name', value: 'None', type: 'combo' },
        { name: 'resolution', value: '512 x 512', type: 'combo' },
        { name: 'positive', value: 'old positive', type: 'customtext', options: { multiline: true } },
        { name: 'positive_token_normalization', value: 'none', type: 'combo' },
        { name: 'positive_weight_interpretation', value: 'comfy', type: 'combo' },
        { name: 'negative', value: 'old negative', type: 'customtext', options: { multiline: true } },
        { name: 'negative_token_normalization', value: 'none', type: 'combo' },
        { name: 'negative_weight_interpretation', value: 'comfy', type: 'combo' },
        { name: 'batch_size', value: 1, type: 'number' },
        { name: 'a1111_prompt_style', value: false, type: 'combo' },
    ];
    const fullLoaderNode = {
        id: 99,
        type: 'easy fullLoader',
        title: '简易加载器 (完整版)',
        widgets: fullLoaderWidgets,
        widgets_values: fullLoaderWidgets.map(w => w.value),
    };
    const appFull = {
        graph: { getNodeById: id => id === 99 ? fullLoaderNode : null, beforeChange() {}, afterChange() {}, change() {}, setDirtyCanvas() {} },
        canvas: { selected_nodes: { 99: fullLoaderNode }, setDirty() {} },
    };

    assert.deepEqual(promptBoxes(fullLoaderNode).map(box => [box.index, box.role]), [[6, 'positive'], [9, 'negative']]);

    dispatchPromptInjection(appFull, fullLoaderNode, envelope);

    // Verify positive textarea (index 6) has ONLY the positive prompt!
    assert.equal(fullLoaderNode.widgets[6].value, 'masterpiece, high quality anime illustration, young adult woman');
    assert.equal(fullLoaderNode.widgets[6].value.includes('.safetensors'), false);

    // Verify negative textarea (index 9) has ONLY the negative prompt!
    assert.equal(fullLoaderNode.widgets[9].value, 'mature woman, older woman, onee-san, child, loli, bad hands');
    assert.equal(fullLoaderNode.widgets[9].value.includes('.safetensors'), false);

    // Verify non-prompt widgets (ckpt_name, resolution, etc.) are untouched!
    assert.equal(fullLoaderNode.widgets[0].value, 'model.safetensors');
    assert.equal(fullLoaderNode.widgets[4].value, 'None');
    assert.equal(fullLoaderNode.widgets[5].value, '512 x 512');
}

// ============================================================================
// Test 10: sanitizePromptText unit guardrails
// ============================================================================
{
    assert.equal(sanitizePromptText(null), '');
    assert.equal(sanitizePromptText(undefined), '');
    assert.equal(sanitizePromptText(12345), '');
    assert.equal(sanitizePromptText('   '), '');
    assert.equal(sanitizePromptText('model.safetensors'), '');
    assert.equal(sanitizePromptText('checkpoints/v1-5-pruned.ckpt'), '');
    assert.equal(sanitizePromptText('loras/anime_style.safetensors\r\nsub/model.safetensors'), '');
    assert.equal(sanitizePromptText('vae.pt'), '');
    assert.equal(sanitizePromptText('onnx_model.onnx'), '');
    assert.equal(sanitizePromptText('llm.gguf'), '');
    assert.equal(sanitizePromptText('  1girl, beautiful lighting, cinematic shot  '), '1girl, beautiful lighting, cinematic shot');
}

// ============================================================================
// Test 11: prompt envelopes of plans, notes and loader blocks
// ============================================================================
{
    assert.equal(Array.isArray(PROMPT_EXTRACTORS), true);
    assert.equal(PROMPT_EXTRACTORS.length, 5);

    // 11.1 Prompt Plan SSOT
    const planMaterial = {
        kind: 'prompt_plan',
        plan: {
            positive: 'cyberpunk street, neon glow',
            negative: 'blurry, low quality',
        },
    };
    const envPlan = extractMaterialPromptEnvelope(planMaterial);
    assert.equal(envPlan.positive, 'cyberpunk street, neon glow');
    assert.equal(envPlan.negative, 'blurry, low quality');

    // 11.2 Negative Prompt Note SSOT
    const negNoteMaterial = {
        kind: 'prompt_note_bundle',
        name: 'Negative Base Prompts',
        tags: ['negative'],
        note: {
            promptEn: 'worst quality, bad anatomy, deformed limbs',
        },
    };
    const envNote = extractMaterialPromptEnvelope(negNoteMaterial);
    assert.equal(envNote.primaryRole, 'negative');
    assert.equal(envNote.negative, 'worst quality, bad anatomy, deformed limbs');

    // 11.3 Loader blocks with model file: info must NEVER contain .safetensors
    const loaderMaterial = {
        kind: 'recipe_parameter_selection',
        node_blocks: [
            {
                node_id: 1,
                type: 'easy fullLoader',
                widgets_values: ['epicrealism.safetensors', 'baked_vae.safetensors'],
            },
            {
                node_id: 2,
                type: 'CLIPTextEncode',
                promptRole: 'positive',
                widgets_values: ['photorealistic portrait, 8k'],
            },
        ],
    };
    const envLoader = extractMaterialPromptEnvelope(loaderMaterial);
    assert.equal(envLoader.positive, 'photorealistic portrait, 8k');
    assert.equal(envLoader.positive.includes('.safetensors'), false);
}

// ============================================================================
// Test 12: Prompt text never crosses roles
// ============================================================================
{
    const makeNode = (id, type, name) => {
        const node = { id, type, title: type, widgets: [{ name, value: 'keep me' }], widgets_values: ['keep me'] };
        const app = {
            graph: { getNodeById: nodeId => nodeId === id ? node : null, beforeChange() {}, afterChange() {}, change() {}, setDirtyCanvas() {} },
            canvas: { selected_nodes: { [id]: node }, setDirty() {} },
        };
        return { node, app };
    };
    const negativeOnly = { hasPrompt: true, positive: '', negative: 'lowres, blurry', singleText: 'lowres, blurry', primaryRole: 'negative' };
    const positiveOnly = { hasPrompt: true, positive: '1girl, garden', negative: '', singleText: '1girl, garden', primaryRole: 'positive' };

    const pos = makeNode(30, 'easy positive', 'positive');
    assert.throws(() => dispatchPromptInjection(pos.app, pos.node, negativeOnly), /materialNoCompatibleValues/);
    assert.equal(pos.node.widgets[0].value, 'keep me', 'negative text must not land in a positive-only node');

    const neg = makeNode(31, 'easy negative', 'negative');
    assert.throws(() => dispatchPromptInjection(neg.app, neg.node, positiveOnly), /materialNoCompatibleValues/);
    assert.equal(neg.node.widgets[0].value, 'keep me', 'positive text must not land in a negative-only node');

    // Role-neutral CLIPTextEncode still accepts either side.
    const clip = makeNode(32, 'CLIPTextEncode', 'text');
    dispatchPromptInjection(clip.app, clip.node, negativeOnly);
    assert.equal(clip.node.widgets[0].value, 'lowres, blurry');

    // Two-slot loader receives a one-sided envelope only in the matching slot.
    const { node: loader, app: loaderApp } = createEasyA1111LoaderFixture();
    dispatchPromptInjection(loaderApp, loader, negativeOnly);
    assert.equal(loader.widgets[6].value, 'initial positive prompt');
    assert.equal(loader.widgets[7].value, 'lowres, blurry');
}

console.log('✔ All Cross-Node Prompt Injection Protocol (CNPIP) tests passed!');
