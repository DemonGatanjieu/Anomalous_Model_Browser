import assert from 'node:assert/strict';
import { fixture } from './ui_fixture.mjs';

const f = fixture();

// Setup LiteGraph global for note node creation
const addedNodes = [];
const mockLiteGraph = {
    createNode(type) {
        return {
            type,
            title: 'Note',
            widgets: [{ name: 'text', type: 'customtext', value: '' }],
            pos: [0, 0],
            size: [200, 100],
            color: '#332222',
            bgcolor: '#553333',
        };
    }
};
globalThis.LiteGraph = mockLiteGraph;
f.window.LiteGraph = mockLiteGraph;

// Setup mock app.graph and app.canvas
f.app.graph._nodes = [
    {
        id: 10,
        type: 'CheckpointLoaderSimple',
        title: 'Load Checkpoint',
        widgets: [
            { name: 'ckpt_name', value: 'epicRealism_v5.safetensors' }
        ],
        pos: [100, 200],
        size: [300, 150]
    },
    {
        id: 11,
        type: 'LoraLoader',
        title: 'Load LoRA',
        widgets: [
            { name: 'lora_name', value: 'detail_tweaker.safetensors' },
            { name: 'strength_model', value: 0.8 }
        ],
        pos: [450, 200],
        size: [250, 120]
    }
];
f.app.graph.add = function(node) {
    addedNodes.push(node);
    f.app.graph._nodes.push(node);
};
f.app.graph.extra = {
    anomalous_hashes: {
        'epicRealism_v5.safetensors': 'abc12345',
    }
};
f.app.canvas = {
    setDirty: () => {}
};

// Load ui_model_sources module
const hub = await f.module('ui_model_sources.js');

// 1. detectPlatform test
assert.equal(hub.detectPlatform('https://civitai.com/models/12345')?.name, 'Civitai');
assert.equal(hub.detectPlatform('https://huggingface.co/runwayml/stable-diffusion-v1-5')?.name, 'HuggingFace');
assert.equal(hub.detectPlatform('https://www.liblib.art/model/67890')?.name, 'LiblibAI');
assert.equal(hub.detectPlatform('https://modelscope.cn/models/test')?.name, 'ModelScope');
assert.equal(hub.detectPlatform('https://github.com/comfyanonymous/ComfyUI')?.name, 'GitHub');
assert.equal(hub.detectPlatform('https://pan.baidu.com/s/abcdef')?.name, 'CloudNet');
assert.equal(hub.detectPlatform('https://example.com/some_model')?.name, 'Web Link');
assert.equal(hub.detectPlatform(''), null);
assert.equal(hub.detectPlatform(null), null);

// 2. isModelFilename test
assert.equal(hub.isModelFilename('v1-5-pruned.safetensors'), true);
assert.equal(hub.isModelFilename('my_lora.ckpt'), true);
assert.equal(hub.isModelFilename('model.pt'), true);
assert.equal(hub.isModelFilename('image.png'), false);
assert.equal(hub.isModelFilename('workflow.json'), false);
assert.equal(hub.isModelFilename(123), false);

// 3. normalizeUrl test
assert.equal(hub.normalizeUrl('civitai.com/models/123'), 'https://civitai.com/models/123');
assert.equal(hub.normalizeUrl('  https://civitai.com/models/123  '), 'https://civitai.com/models/123');
assert.equal(hub.normalizeUrl(''), '');
assert.equal(hub.normalizeUrl(null), '');

// 4. collectWorkflowModels test
const workflowModels = hub.collectWorkflowModels();
assert.equal(workflowModels.length, 2);
assert.equal(workflowModels[0].filename, 'epicRealism_v5.safetensors');
assert.equal(workflowModels[0].hash, 'abc12345');
assert.equal(workflowModels[0].nodeType, 'CheckpointLoaderSimple');
assert.equal(workflowModels[1].filename, 'detail_tweaker.safetensors');

// 5. syncWorkflowSources test (initial save vs update)
workflowModels[0].url = 'https://civitai.com/models/12345';
const saveResult = hub.syncWorkflowSources(workflowModels);
assert.equal(saveResult.count, 1);
assert.equal(saveResult.isUpdate, false);
assert.ok(f.app.graph.extra.anomalous_model_sources['epicRealism_v5.safetensors']);
assert.equal(f.app.graph.extra.anomalous_model_sources['epicRealism_v5.safetensors'].url, 'https://civitai.com/models/12345');

// Second sync should detect that it's an update
workflowModels[0].url = 'https://civitai.com/models/99999';
const updateResult = hub.syncWorkflowSources(workflowModels);
assert.equal(updateResult.isUpdate, true);
assert.equal(f.app.graph.extra.anomalous_model_sources['epicRealism_v5.safetensors'].url, 'https://civitai.com/models/99999');

// 6. createCanvasNoteNode test
const note = hub.createCanvasNoteNode(workflowModels);
assert.ok(note);
assert.equal(note.type, 'Note');
assert.equal(addedNodes.length, 1);
assert.ok(note.widgets[0].value.includes('epicRealism_v5.safetensors'));
assert.ok(note.widgets[0].value.includes('https://civitai.com/models/99999'));

console.log('model sources hub tests: all passed!');
