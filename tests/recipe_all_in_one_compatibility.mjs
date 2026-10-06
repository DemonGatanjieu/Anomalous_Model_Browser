import assert from 'node:assert/strict';
import {
    extractRecipeMetadata,
    applyRecipeWidgetChanges,
    extractRecipeParameterChoices,
    extractRecipeParameterChoicesFromMetadata,
} from '../web/modules/recipe_parser.js';
import {
    deriveNodeModelSpecs,
    deriveRecipeModelReferences,
    recipeReferenceKey,
} from '../web/modules/recipe_identity.js';

// Live nodes carry ComfyUI's definitions; prompt boxes are found by them.
globalThis.LiteGraph = { registered_node_types: {
    'easy a1111Loader': { nodeData: { input: { required: { positive: ['STRING', { multiline: true }], negative: ['STRING', { multiline: true }] } } } },
} };

// --- Test 1: easy a1111Loader Full Parameter Parsing & None Filtering ---
{
    const easyLoaderNode = {
        id: 1,
        type: 'easy a1111Loader',
        title: 'Easy A1111 Loader',
        widgets: [
            { name: 'ckpt_name', value: 'v1-5-pruned-emaonly.safetensors', type: 'combo' },
            { name: 'vae_name', value: 'vae-ft-mse-840000-ema_pruned.safetensors', type: 'combo' },
            { name: 'clip_skip', value: -1, type: 'number' },
            { name: 'lora_name', value: 'None', type: 'combo' },
            { name: 'lora_model_strength', value: 1.0, type: 'number' },
            { name: 'lora_clip_strength', value: 1.0, type: 'number' },
            { name: 'positive', value: 'a beautiful cyberpunk cat, neon rain', type: 'customtext', options: { multiline: true } },
            { name: 'negative', value: 'ugly, deformed, blurry, low quality', type: 'customtext', options: { multiline: true } },
            { name: 'empty_latent_width', value: 512, type: 'number' },
            { name: 'empty_latent_height', value: 768, type: 'number' },
            { name: 'batch_size', value: 1, type: 'number' },
            { name: 'seed', value: 123456789, type: 'number' },
            { name: 'control_after_generate', value: 'fixed', type: 'combo' },
            { name: 'steps', value: 25, type: 'number' },
            { name: 'cfg', value: 7.5, type: 'number' },
            { name: 'sampler_name', value: 'euler_ancestral', type: 'combo' },
            { name: 'scheduler', value: 'karras', type: 'combo' },
            { name: 'denoise', value: 1.0, type: 'number' },
        ],
        inputs: [],
    };

    const graph = {
        _nodes: [easyLoaderNode],
        links: new Map(),
    };

    const metadata = extractRecipeMetadata(graph);

    // Verify Base Model
    assert.equal(metadata.baseModel, 'v1-5-pruned-emaonly.safetensors');
    assert.deepEqual(metadata.baseModels, ['v1-5-pruned-emaonly.safetensors']);

    // Verify LoRA 'None' was filtered out
    assert.deepEqual(metadata.loras, [], 'LoRA value "None" must be filtered out');

    // Verify Embedded Prompts (pure text without synthetic prefixes)
    assert.deepEqual(metadata.promptPositive, ['a beautiful cyberpunk cat, neon rain']);
    assert.deepEqual(metadata.promptNegative, ['ugly, deformed, blurry, low quality']);

    // Verify Sampler Parameters
    assert.equal(metadata.steps, 25);
    assert.equal(metadata.cfg, 7.5);
    assert.equal(metadata.sampler_name, 'euler_ancestral');
    assert.equal(metadata.scheduler, 'karras');
    assert.equal(metadata.denoise, 1.0);
    assert.equal(metadata.seed, 123456789);

    // Verify Latent Resolution
    assert.deepEqual(metadata.resolution, { width: 512, height: 768 });

    // Verify node summary preserved role and all widgets (>16 widgets)
    const summary = metadata.nodes.find((n) => n.id === 1);
    assert.ok(summary);
    assert.equal(summary.role, 'both');
    assert.equal(summary.roleSource, 'embedded');
    assert.ok(summary.widgets.length >= 18, 'all 18 widgets should be preserved in summary');

    console.log('✔ easy a1111Loader full parameter parsing OK');
}

// --- Test 2: Multi-LoRA Slot Parsing (easy loraStack) & None Filtering ---
{
    const loraStackNode = {
        id: 2,
        type: 'easy loraStack',
        title: 'Easy LoRA Stack',
        widgets: [
            { name: 'toggle', value: true },
            { name: 'mode', value: 'simple' },
            { name: 'num_loras', value: 3 },
            { name: 'lora_1_name', value: 'detail_tweaker_v1.safetensors' },
            { name: 'lora_1_strength', value: 0.8 },
            { name: 'lora_1_model_strength', value: 0.8 },
            { name: 'lora_1_clip_strength', value: 0.8 },
            { name: 'lora_2_name', value: 'None' },
            { name: 'lora_2_strength', value: 1.0 },
            { name: 'lora_3_name', value: 'anime_screencap_v2.safetensors' },
            { name: 'lora_3_strength', value: 1.2 },
            { name: 'lora_3_model_strength', value: 1.2 },
            { name: 'lora_3_clip_strength', value: 1.0 },
        ],
        inputs: [],
    };

    const graph = {
        _nodes: [loraStackNode],
        links: new Map(),
    };

    const metadata = extractRecipeMetadata(graph);

    assert.equal(metadata.loras.length, 2, 'Should capture 2 LoRAs, skipping "None"');
    assert.equal(metadata.loras[0].name, 'detail_tweaker_v1.safetensors');
    assert.equal(metadata.loras[0].strength_model, 0.8);
    assert.equal(metadata.loras[1].name, 'anime_screencap_v2.safetensors');
    assert.equal(metadata.loras[1].strength_model, 1.2);
    assert.equal(metadata.loras[1].strength_clip, 1.0);

    console.log('✔ multi-lora slot parsing & None filtering OK');
}

// --- Test 3: Precedence Invariant: External CLIPTextEncode > Embedded Prompts ---
{
    const loaderNode = {
        id: 1,
        type: 'easy a1111Loader',
        title: 'Loader',
        widgets: [
            { name: 'ckpt_name', value: 'model.safetensors' },
            { name: 'positive', value: 'embedded loader positive text' },
            { name: 'negative', value: 'embedded loader negative text' },
        ],
        inputs: [],
    };

    const externalPosNode = {
        id: 10,
        type: 'CLIPTextEncode',
        title: 'External Positive',
        widgets: [{ name: 'text', value: 'external linked positive prompt' }],
        inputs: [],
    };

    const samplerNode = {
        id: 20,
        type: 'KSampler',
        title: 'Sampler',
        widgets: [
            { name: 'seed', value: 1 },
            { name: 'control_after_generate', value: 'fixed' },
            { name: 'steps', value: 20 },
            { name: 'cfg', value: 7 },
            { name: 'sampler_name', value: 'euler' },
            { name: 'scheduler', value: 'normal' },
            { name: 'denoise', value: 1 },
        ],
        inputs: [
            { name: 'positive', link: 101 },
            { name: 'negative', link: null }, // no negative linked
        ],
    };

    const links = new Map([
        [101, [101, 10, 0, 20, 0, 'CONDITIONING']],
    ]);

    const graph = {
        _nodes: [loaderNode, externalPosNode, samplerNode],
        links,
    };

    const metadata = extractRecipeMetadata(graph);

    // Positive should come from the external node (precedence)
    assert.deepEqual(metadata.promptPositive, ['external linked positive prompt']);

    // Negative should fall back to the loader's embedded negative
    assert.deepEqual(metadata.promptNegative, ['embedded loader negative text']);

    console.log('✔ external link > embedded fallback precedence OK');
}

// --- Test 4: Model Specs & Model Reference Derivation for All-in-One Nodes ---
{
    // Live node specs discovery
    const liveNode = {
        id: 1,
        type: 'easy a1111Loader',
        widgets: [
            { name: 'ckpt_name', value: 'epicrealism.safetensors' },
            { name: 'vae_name', value: 'vae-ft-mse.safetensors' },
            { name: 'clip_skip', value: -1 },
            { name: 'lora_name', value: 'add_detail.safetensors' },
        ],
    };

    const liveSpecs = deriveNodeModelSpecs(liveNode);
    assert.deepEqual(liveSpecs, [
        [0, 'checkpoint', 'ckpt_name'],
        [1, 'vae', 'vae_name'],
        [3, 'lora', 'lora_name'],
    ]);

    // Serialized node specs discovery (no widgets array)
    const serializedNode = {
        id: 1,
        type: 'easy a1111Loader',
        widgets_values: [
            'epicrealism.safetensors',
            'vae-ft-mse.safetensors',
            -1,
            'None', // Unselected LoRA slot
        ],
    };

    const serializedSpecs = deriveNodeModelSpecs(serializedNode);
    assert.deepEqual(serializedSpecs, [
        [0, 'checkpoint', 'ckpt_name'],
        [1, 'vae', 'vae_name'],
        [3, 'lora', 'lora_name'],
    ]);

    // Derive references from recipe workflow
    const recipe = {
        params: { baseModel: 'epicrealism.safetensors' },
        workflow: {
            nodes: [serializedNode],
            extra: {
                anomalous_hashes: {
                    '1_epicrealism.safetensors': { hash: 'a'.repeat(64), size: 2000000000 },
                    '1_vae-ft-mse.safetensors': { hash: 'b'.repeat(64), size: 300000000 },
                },
            },
        },
    };

    const refs = deriveRecipeModelReferences(recipe);
    assert.equal(refs.length, 2, 'Should derive Checkpoint and VAE, skipping None LoRA');

    // Reference 1: Checkpoint
    assert.equal(refs[0].node_id, 1);
    assert.equal(refs[0].widget_index, 0);
    assert.equal(refs[0].category, 'checkpoint');
    assert.equal(refs[0].saved_value, 'epicrealism.safetensors');
    assert.equal(refs[0].identity.status, 'verified');
    assert.equal(refs[0].identity.sha256, 'a'.repeat(64));

    // Reference 2: VAE
    assert.equal(refs[1].node_id, 1);
    assert.equal(refs[1].widget_index, 1);
    assert.equal(refs[1].category, 'vae');
    assert.equal(refs[1].saved_value, 'vae-ft-mse.safetensors');
    assert.equal(refs[1].identity.status, 'verified');
    assert.equal(refs[1].identity.sha256, 'b'.repeat(64));

    // Verify Composite Keys isolate the two models on the same node
    const key1 = recipeReferenceKey(refs[0]);
    const key2 = recipeReferenceKey(refs[1]);
    assert.notEqual(key1, key2, 'Composite keys must be distinct for different widgets on same node');

    console.log('✔ model specs & composite key OK');
}

// --- Test 5: syncCommonRecipeMetadata & applyRecipeWidgetChanges on All-in-One Node ---
{
    const params = {
        baseModel: 'v1-5-pruned-emaonly.safetensors',
        baseModels: ['v1-5-pruned-emaonly.safetensors'],
        steps: 20,
        cfg: 7,
        promptPositive: ['initial positive prompt'],
        promptNegative: ['initial negative prompt'],
        nodes: [
            {
                id: 1,
                type: 'easy a1111Loader',
                widgets: [
                    { name: 'ckpt_name', value: 'v1-5-pruned-emaonly.safetensors', index: 0 },
                    { name: 'positive', value: 'initial positive prompt', index: 6 },
                    { name: 'steps', value: 20, index: 13 },
                ],
            },
        ],
    };

    const workflow = {
        nodes: [
            {
                id: 1,
                type: 'easy a1111Loader',
                widgets_values: [
                    'v1-5-pruned-emaonly.safetensors', 'vae.safetensors', -1, 'None',
                    1, 1, 'initial positive prompt', 'initial negative prompt',
                    512, 512, 1, 1, 'fixed', 20, 7, 'euler', 'normal', 1,
                ],
            },
        ],
    };

    // 1. Edit ckpt_name on easy a1111Loader
    applyRecipeWidgetChanges(params, workflow, [
        {
            nodeId: 1,
            nodeType: 'easy a1111Loader',
            widgetIndex: 0,
            widgetName: 'ckpt_name',
            previousValue: 'v1-5-pruned-emaonly.safetensors',
            value: 'v2-1-768.safetensors',
        },
    ]);
    assert.equal(params.baseModel, 'v2-1-768.safetensors');
    assert.equal(workflow.nodes[0].widgets_values[0], 'v2-1-768.safetensors');

    // 2. Edit steps on easy a1111Loader
    applyRecipeWidgetChanges(params, workflow, [
        {
            nodeId: 1,
            nodeType: 'easy a1111Loader',
            widgetIndex: 13,
            widgetName: 'steps',
            previousValue: 20,
            value: 30,
        },
    ]);
    assert.equal(params.steps, 30);
    assert.equal(workflow.nodes[0].widgets_values[13], 30);

    // 3. Edit positive prompt on easy a1111Loader
    applyRecipeWidgetChanges(params, workflow, [
        {
            nodeId: 1,
            nodeType: 'easy a1111Loader',
            widgetIndex: 6,
            widgetName: 'positive',
            previousValue: 'initial positive prompt',
            value: 'updated cyberpunk city positive prompt',
        },
    ]);
    assert.deepEqual(params.promptPositive, ['updated cyberpunk city positive prompt']);
    assert.equal(workflow.nodes[0].widgets_values[6], 'updated cyberpunk city positive prompt');

    console.log('✔ syncCommonRecipeMetadata & applyRecipeWidgetChanges on all-in-one nodes OK');
}

// --- Test 6: Parameter Choices Extraction from All-in-One Nodes ---
{
    const node = {
        id: 1,
        type: 'easy a1111Loader',
        title: 'AllInOne',
        widgets: [
            { name: 'ckpt_name', value: 'model.safetensors' },
            { name: 'positive', value: 'prompt' },
            { name: 'steps', value: 25 },
        ],
    };

    const graph = {
        _nodes: [node],
    };

    const choices = extractRecipeParameterChoices(graph);
    assert.equal(choices.length, 3);
    assert.equal(choices[0].widgetName, 'ckpt_name');
    assert.equal(choices[1].widgetName, 'positive');
    assert.equal(choices[2].widgetName, 'steps');

    const metadataChoices = extractRecipeParameterChoicesFromMetadata({
        nodes: [
            {
                id: 1,
                type: 'easy a1111Loader',
                widgets: [
                    { name: 'ckpt_name', value: 'model.safetensors', index: 0 },
                    { name: 'positive', value: 'prompt', index: 1 },
                ],
            },
        ],
    });
    assert.equal(metadataChoices.length, 2);
    assert.equal(metadataChoices[0].widgetName, 'ckpt_name');
    assert.equal(metadataChoices[1].widgetName, 'positive');

    console.log('✔ parameter choices extraction OK');
}

// --- Test 7: Regressions - unrelated widgets must not rewrite the recipe summary ---
{
    // Extraction: an upscaler's model_name is not a base model; duplicate LoRAs keep one entry per loader.
    const graph = {
        _nodes: [
            { id: 1, type: 'CheckpointLoaderSimple', widgets: [{ name: 'ckpt_name', value: 'base.safetensors' }], inputs: [] },
            { id: 2, type: 'UpscaleModelLoader', widgets: [{ name: 'model_name', value: 'RealESRGAN_x4.safetensors' }], inputs: [] },
            { id: 3, type: 'LoraLoader', widgets: [{ name: 'lora_name', value: 'style.safetensors' }, { name: 'strength_model', value: 0.5 }, { name: 'strength_clip', value: 0.5 }], inputs: [] },
            { id: 4, type: 'LoraLoader', widgets: [{ name: 'lora_name', value: 'style.safetensors' }, { name: 'strength_model', value: 0.9 }, { name: 'strength_clip', value: 0.9 }], inputs: [] },
            { id: 5, type: 'Seed (rgthree)', widgets: [{ name: 'seed', value: 42 }], inputs: [] },
        ],
        links: new Map(),
    };
    const metadata = extractRecipeMetadata(graph);
    assert.deepEqual(metadata.baseModels, ['base.safetensors']);
    assert.equal(metadata.loras.length, 2, 'each LoraLoader keeps its own entry');
    assert.equal(metadata.seed, null, 'a standalone seed node is not a sampler');

    // Sync: the same rules apply to edits.
    const params = {
        baseModel: 'base.safetensors',
        baseModels: ['base.safetensors'],
        seed: 1,
        loras: [{ name: 'a.safetensors', strength_model: 1, strength_clip: 1 }, { name: 'b.safetensors', strength_model: 1, strength_clip: 1 }],
        nodes: [
            { id: 2, type: 'UpscaleModelLoader', widgets: [{ name: 'model_name', value: 'x4.safetensors', index: 0 }] },
            { id: 5, type: 'Seed (rgthree)', widgets: [{ name: 'seed', value: 1, index: 0 }] },
            { id: 7, type: 'LoraLoader', widgets: [{ name: 'lora_name', value: 'b.safetensors', index: 0 }, { name: 'strength_model', value: 1, index: 1 }] },
            { id: 8, type: 'SomeCustomNode', widgets: [{ name: 'lora_strength', value: 1, index: 0 }] },
        ],
    };
    const workflow = { nodes: [
        { id: 2, type: 'UpscaleModelLoader', widgets_values: ['x4.safetensors'] },
        { id: 5, type: 'Seed (rgthree)', widgets_values: [1] },
        { id: 7, type: 'LoraLoader', widgets_values: ['b.safetensors', 1, 1] },
        { id: 8, type: 'SomeCustomNode', widgets_values: [1] },
    ] };
    applyRecipeWidgetChanges(params, workflow, [
        { nodeId: 2, nodeType: 'UpscaleModelLoader', widgetIndex: 0, widgetName: 'model_name', previousValue: 'x4.safetensors', value: 'x8.safetensors' },
        { nodeId: 5, nodeType: 'Seed (rgthree)', widgetIndex: 0, widgetName: 'seed', previousValue: 1, value: 999 },
        { nodeId: 7, nodeType: 'LoraLoader', widgetIndex: 1, widgetName: 'strength_model', previousValue: 1, value: 0.3 },
        { nodeId: 8, nodeType: 'SomeCustomNode', widgetIndex: 0, widgetName: 'lora_strength', previousValue: 1, value: 0 },
    ]);
    assert.equal(params.baseModel, 'base.safetensors', 'upscaler model_name must not replace the base model');
    assert.equal(params.seed, 1, 'a seed widget outside samplers must not replace the recipe seed');
    assert.equal(params.loras[0].strength_model, 1, 'unrelated LoRA entry untouched');
    assert.equal(params.loras[1].strength_model, 0.3, 'strength applies to the edited loader\'s LoRA');
    assert.equal(workflow.nodes[1].widgets_values[0], 999, 'the workflow itself is still edited');

    // Model references: only verified layouts; no file-name guessing, no placeholder values.
    assert.deepEqual(deriveNodeModelSpecs({ type: 'SomeCustomLoader', widgets_values: ['sdxl_0.9vae.safetensors'] }), []);
    assert.deepEqual(deriveNodeModelSpecs('CheckpointLoaderSimple'), [[0, 'checkpoint', 'checkpoint']]);
    const refs = deriveRecipeModelReferences({ workflow: { nodes: [
        { id: 9, type: 'easy fullLoader', widgets_values: ['sdxl_0.9vae.safetensors', 'Default', 'Baked VAE', -2, 'None'] },
    ] } });
    assert.deepEqual(refs.map(r => [r.category, r.saved_value]), [['checkpoint', 'sdxl_0.9vae.safetensors']]);

    console.log('✔ regressions: unrelated widgets, duplicate LoRAs, placeholder values OK');
}

console.log('\nAll 7 All-in-One Loader semantic compatibility test suites PASSED!\n');
