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
const sourceData = await f.module('model_source_data.js');

const offlinePlaceholder = sourceData.shapeLibrarySourceModels([{
    type: 'diffusion_models', path_idx: 0, filename: 'offline.safetensors',
    metadata: { civitai_url: 'https://civitai.com/models/-1?modelVersionId=-1' },
}], hub.detectPlatform);
assert.equal(offlinePlaceholder[0].url, '');
assert.equal(sourceData.partitionSourceModels(offlinePlaceholder, 'unresolved').mainModels.length, 1);
assert.equal(sourceData.partitionSourceModels(offlinePlaceholder, 'resolved').mainModels.length, 0);
assert.equal(
    sourceData.usableSourceUrl('https://civitai.com/models/123?modelVersionId=456'),
    'https://civitai.com/models/123?modelVersionId=456',
);
const filteredComponents = [
    { type: 'vae', filename: 'resolved-vae.safetensors', url: 'https://huggingface.co/example/vae' },
    { type: 'clip', filename: 'pending-clip.safetensors', url: '' },
];
assert.deepEqual(sourceData.partitionSourceModels(filteredComponents, 'resolved').componentModels.map(item => item.filename), ['resolved-vae.safetensors']);
assert.deepEqual(sourceData.partitionSourceModels(filteredComponents, 'unresolved').componentModels.map(item => item.filename), ['pending-clip.safetensors']);

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

// 7. resolveWorkflowModelsMetadata test
f.fetch = async (url, options) => {
    if (url === '/anomalous/resolve_paths_to_previews') {
        return {
            ok: true,
            status: 200,
            json: async () => ({
                models: {
                    'detail_tweaker.safetensors': {
                        type: 'loras',
                        subfolder: '/styles',
                        path_idx: 0,
                        file_path: 'E:/ComfyUI/models/loras/styles/detail_tweaker.safetensors',
                        metadata: {
                            hash: 'deadbeef999',
                            civitai_url: 'https://civitai.com/models/77777',
                        }
                    }
                }
            })
        };
    }
    if (url === '/anomalous/update_metadata') {
        const body = JSON.parse(options.body);
        return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'success', saved: body })
        };
    }
    return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
};

const unresolvedModel = { filename: 'detail_tweaker.safetensors', basename: 'detail_tweaker.safetensors', url: '' };
const hasChanges = await hub.resolveWorkflowModelsMetadata([unresolvedModel]);
assert.equal(hasChanges, true);
assert.equal(unresolvedModel.url, 'https://civitai.com/models/77777');
assert.equal(unresolvedModel.platform?.name, 'Civitai');
assert.equal(unresolvedModel.type, 'loras');
assert.equal(unresolvedModel.subfolder, '/styles');
assert.equal(unresolvedModel.hash, 'deadbeef999');

// 8. saveSingleModelToLocalSidecar test
let postedBody = null;
f.fetch = async (url, options) => {
    if (url === '/anomalous/update_metadata') {
        postedBody = JSON.parse(options.body);
        return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
};
const modelToSave = {
    filename: 'SDXL/styles/nested_lora.safetensors',
    basename: 'nested_lora.safetensors',
    type: 'loras',
    subfolder: '/SDXL/styles',
    path_idx: 0,
};
await hub.saveSingleModelToLocalSidecar(modelToSave, 'https://civitai.com/models/88888');
assert.ok(postedBody);
assert.equal(postedBody.filename, 'nested_lora.safetensors');
assert.equal(postedBody.custom_source_url, 'https://civitai.com/models/88888');
assert.equal(postedBody.type, 'loras');
assert.equal(postedBody.subfolder, '/SDXL/styles');

// 9. autoDetectModelSource test (local metadata priority)
f.fetch = async (url, options) => {
    if (url === '/anomalous/resolve_paths_to_previews') {
        return {
            ok: true,
            status: 200,
            json: async () => ({
                models: {
                    'local_known.safetensors': {
                        type: 'checkpoints',
                        subfolder: '/',
                        path_idx: 0,
                        metadata: {
                            source_url: 'https://huggingface.co/runwayml/stable-diffusion-v1-5'
                        }
                    }
                }
            })
        };
    }
    return { ok: true, status: 200, json: async () => ({}) };
};
const detectTarget = { filename: 'local_known.safetensors', basename: 'local_known.safetensors', url: '' };
const detectedUrl = await hub.autoDetectModelSource(detectTarget);
assert.equal(detectedUrl, 'https://huggingface.co/runwayml/stable-diffusion-v1-5');

f.fetch = async () => ({ ok: true, status: 200, json: async () => ({ models: {} }) });
assert.equal(await hub.autoDetectModelSource({ filename: 'unknown.safetensors', basename: 'unknown.safetensors', url: '', hash: '' }), '');

// 10. Opening directly into the local library starts its load and distinguishes a successful empty result.
const libraryFixture = fixture();
libraryFixture.app.graph._nodes = [];
libraryFixture.app.graph.extra = {};
let finishLibrary;
libraryFixture.fetch = (url) => {
    assert.equal(url, '/anomalous/all_scan_models?limit=0');
    return new Promise(resolve => { finishLibrary = resolve; });
};
const libraryHub = await libraryFixture.module('ui_model_sources.js');
const closeLibrary = libraryHub.openModelSourcesModal('library');
assert.ok(libraryFixture.document.body.textContent.includes('Loading the current Folder Manager scope'));
finishLibrary({ ok: true, status: 200, json: async () => ({ models: [] }) });
await libraryFixture.flush();
assert.ok(libraryFixture.document.body.textContent.includes('Local library scope follows Settings → Folder Manager'));
assert.ok(libraryFixture.document.body.textContent.includes('No models detected'));
closeLibrary();

// Exact detection moves to the resolved filter and keeps the recognized row visible.
const detectFixture = fixture();
detectFixture.app.graph._nodes = [];
detectFixture.app.graph.extra = {};
detectFixture.fetch = async (url) => {
    if (url === '/anomalous/all_scan_models?limit=0') {
        return { ok: true, status: 200, json: async () => ({ models: [{
            type: 'checkpoints', path_idx: 0, filename: 'recognized.safetensors', metadata: {},
        }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ models: {
        'recognized.safetensors': {
            type: 'checkpoints', path_idx: 0, subfolder: '',
            metadata: { source_url: 'https://huggingface.co/example/recognized' },
        },
    } }) };
};
const detectHub = await detectFixture.module('ui_model_sources.js');
const closeDetected = detectHub.openModelSourcesModal('library');
await detectFixture.flush();
detectFixture.button(detectFixture.document.body, 'Source needed').click();
await detectFixture.button(detectFixture.document.body, 'Detect').click();
await detectFixture.flush();
assert.equal(detectFixture.document.body.querySelectorAll('.anomalous-source-row-item').length, 1);
assert.ok(detectFixture.document.body.querySelectorAll('.anomalous-sources-pill')
    .find(pill => pill.classList.contains('is-active'))?.textContent.includes('Source provided'));
assert.equal(detectFixture.document.body.querySelector('.anomalous-source-url-input')?.value, 'https://huggingface.co/example/recognized');
closeDetected();

// Closing aborts ownership of a late library response and must not recreate the modal.
let finishLate;
libraryFixture.fetch = () => new Promise(resolve => { finishLate = resolve; });
const closeLate = libraryHub.openModelSourcesModal('library');
closeLate();
finishLate({ ok: true, status: 200, json: async () => ({ models: [{ type: 'clip', path_idx: 0, filename: 'late.GGUF' }] }) });
await libraryFixture.flush();
assert.equal(libraryFixture.document.body.querySelector('.anomalous-model-sources-overlay'), null);

const errorFixture = fixture();
errorFixture.app.graph._nodes = [];
errorFixture.app.graph.extra = {};
errorFixture.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
const errorHub = await errorFixture.module('ui_model_sources.js');
const originalConsoleError = console.error;
console.error = () => {};
const closeError = errorHub.openModelSourcesModal('library');
await errorFixture.flush();
console.error = originalConsoleError;
assert.ok(errorFixture.document.body.textContent.includes('Failed to load the local model library'));
assert.ok(errorFixture.button(errorFixture.document.body, 'Retry'));
closeError();

// 12. Switching from workflow -> library -> workflow -> library preserves state and correctly re-renders library models.
const toggleFixture = fixture();
toggleFixture.app.graph._nodes = [
    { type: 'CheckpointLoaderSimple', widgets: [{ name: 'ckpt_name', value: 'wf_model.safetensors' }] },
];
toggleFixture.app.graph.extra = {};
toggleFixture.fetch = async (url) => {
    if (url === '/anomalous/all_scan_models?limit=0') {
        return {
            ok: true,
            status: 200,
            json: async () => ({
                models: [
                    { type: 'checkpoints', path_idx: 0, filename: 'lib_model.safetensors', metadata: {} },
                ],
            }),
        };
    }
    return { ok: true, status: 200, json: async () => ({}) };
};
const toggleHub = await toggleFixture.module('ui_model_sources.js');
const closeToggle = toggleHub.openModelSourcesModal('workflow');
assert.ok(toggleFixture.document.body.textContent.includes('wf_model.safetensors'), 'workflow model is visible initially');

// Switch to library
let tabs = toggleFixture.document.body.querySelectorAll('.anomalous-sources-scope-tab');
assert.equal(tabs.length, 2, 'two scope tabs exist');
tabs[1].click();
await toggleFixture.flush();
assert.ok(toggleFixture.document.body.textContent.includes('lib_model.safetensors'), 'library model visible after first switch');

// Switch back to workflow
tabs = toggleFixture.document.body.querySelectorAll('.anomalous-sources-scope-tab');
tabs[0].click();
await toggleFixture.flush();
assert.ok(toggleFixture.document.body.textContent.includes('wf_model.safetensors'), 'workflow model visible after switching back');

// Switch to library again! (Previously failed due to missing refreshUi)
tabs = toggleFixture.document.body.querySelectorAll('.anomalous-sources-scope-tab');
tabs[1].click();
await toggleFixture.flush();
assert.ok(toggleFixture.document.body.textContent.includes('lib_model.safetensors'), 'library model visible on repeated switch to library');
closeToggle();

console.log('model sources hub tests: all passed!');
