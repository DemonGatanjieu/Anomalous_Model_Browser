import assert from 'node:assert/strict';
import { fixture, all } from './ui_fixture.mjs';

const f = fixture();
f.app.canvas.setDirty = () => {};
const hub = await f.module('ui_model_sources.js');
const node = (id, type, name, value, values) => ({ id, type, widgets: [{ name, value, options: { values } }] });
f.app.graph._nodes = [
    node(1, 'DualCLIPLoader', 'clip_name1', 'encoders/t5.gguf', ['encoders\\t5.gguf']),
    node(2, 'CLIPLoader', 'clip_name', 'clip.pth', () => ['clip.pth']),
    node(3, 'VAELoader', 'vae_name', 'taesd', ['taesd']),
    node(4, 'VAELoader', 'vae_name', 'missing.safetensors', ['available.safetensors']),
    node(5, 'CLIPVisionLoader', 'clip_name', 'vision.safetensors', ['vision.safetensors']),
    node(6, 'DualCLIPLoader', 'device', 'cpu', ['cpu', 'cuda']),
    node(7, 'VAELoader', 'vae_name', 'None', ['None']),
    node(8, 'VAELoader', 'vae_name', 'uninstalled.safetensors', []),
];
f.app.graph.extra = {};
let entries = hub.collectWorkflowModels();
assert.equal(entries.length, 6, 'Include components without requiring a source URL or hash; skip non-model controls');
assert.equal(entries[0].isMissing, false, 'Native slash variants are not missing files');
assert.equal(entries[1].isMissing, false, 'Dynamic choices are not proof of a missing file');
assert.equal(entries[3].isMissing, true);
assert.equal(entries[5].isMissing, true, 'An empty native file list still identifies an unavailable selected model');
assert.deepEqual([...entries[4].folderTypes], ['clip_vision']);

f.fetch = async (url, options) => {
    assert.equal(url, '/anomalous/resolve_paths_to_previews', 'Opening only reads local metadata');
    const body = JSON.parse(options.body);
    const context_models = {};
    for (const request of body.context_requests || []) {
        assert.equal(request.exact_only, true);
        assert.ok(request.folder_types.length);
        if (request.path === 'vision.safetensors') context_models[request.key] = {
            type: 'clip_vision', subfolder: '', path_idx: 1, file_path: 'E:/fixtures/vision.safetensors',
            metadata: { source_url: 'https://huggingface.co/example/vision' },
        };
    }
    return { ok: true, json: async () => ({ context_models, models: {
        // A same-named checkpoint must not be used for a VAE.
        'missing.safetensors': { type: 'checkpoints', metadata: { source_url: 'https://example.com/wrong' } },
    } }) };
};
await hub.resolveWorkflowModelsMetadata(entries);
assert.equal(entries[3].url, '');
assert.equal(entries[4].url, 'https://huggingface.co/example/vision');
assert.equal(entries[4].path_idx, 1);
assert.equal(await hub.autoDetectModelSource(entries[3]), '', 'Unknown component stays unresolved; no cloud search URL is treated as a source');
await assert.rejects(() => hub.saveSingleModelToLocalSidecar(entries[2], 'https://example.com/taesd'));
entries[2].url = 'https://example.com/taesd';
hub.syncWorkflowSources(entries);
assert.equal(f.app.graph.extra.anomalous_model_sources.taesd.url, entries[2].url, 'Unresolved local options can still carry workflow links');

const many = Array.from({ length: 19 }, (_, i) => ({ ...entries[4], key: `component-${i}` }));
const start = f.requests.length;
await hub.resolveWorkflowModelsMetadata(many);
const batches = f.requests.slice(start).map(([, o]) => JSON.parse(o.body)).filter(b => b.context_requests);
assert.deepEqual(batches.map(b => b.context_requests.length), [16, 3]);
await hub.copySourcesSummary([{ ...entries[2], url: '' }]);
assert.ok(f.clipboard.at(-1).includes('Not provided (optional)'));
assert.ok(!f.clipboard.at(-1).includes('⚠️'));

// Exercise the actual UI renderer, including manual entry and both status badges.
f.app.graph.extra = {};
const close = hub.openModelSourcesModal('workflow');
await f.flush();
assert.equal(f.document.body.querySelectorAll('.anomalous-source-row-item').length, 0, 'Collapsed components do not build row DOM');
let disclosure = f.document.body.querySelector('.anomalous-sources-components-toggle');
assert.ok(disclosure.textContent.includes('Foundation components (advanced) · 6'));
assert.ok(disclosure.textContent.includes('Missing local files × 2'));
assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
disclosure.click();
let rows = f.document.body.querySelectorAll('.anomalous-source-row-item');
assert.equal(rows.length, 6);
assert.ok(rows[0].textContent.includes('Text encoder'));
assert.ok(rows[4].textContent.includes('Vision encoder'));
const missing = rows[3];
assert.ok(missing.querySelector('.anomalous-source-badge-danger'));
const pending = all(missing).find(el => el.textContent === 'Not provided (optional)' && el.className === 'anomalous-source-badge-neutral');
assert.equal(pending.hidden, false);
const input = missing.querySelector('input');
assert.equal(input.readOnly, false);
input.value = 'https://example.com/vae';
input.oninput();
assert.equal(pending.hidden, true, 'Typing a source removes the pending-source hint without hiding missing-file warning');
assert.ok(missing.querySelector('.anomalous-source-badge-danger'));
assert.equal(rows[4].querySelector('input').readOnly, true, 'Resolved source is preserved');

// Source filters apply to components as well, so resolved components never appear under source-needed.
f.button(f.document.body, 'Source provided').click();
assert.equal(f.document.body.querySelectorAll('.anomalous-source-row-item').length, 2);
let search = f.document.body.querySelector('.anomalous-sources-search-input');
search.value = 'vision';
search.oninput();
rows = f.document.body.querySelectorAll('.anomalous-source-row-item');
assert.equal(rows.length, 1);
disclosure = f.document.body.querySelector('.anomalous-sources-components-toggle');
assert.ok(disclosure.textContent.includes('Foundation components (advanced) · 1'));
assert.equal(disclosure.textContent.includes('Missing local files'), false, 'Missing warning describes only visible component matches');
await f.button(f.document.body, 'Copy Visible Range').click();
assert.ok(f.clipboard.at(-1).includes('vision.safetensors'));
assert.ok(!f.clipboard.at(-1).includes('t5.gguf'), 'Summary exports only the currently visible range');
f.button(f.document.body, 'Save to Workflow').click();
assert.equal(f.app.graph.extra.anomalous_model_sources['missing.safetensors'].url, 'https://example.com/vae');
assert.equal(f.app.graph.extra.anomalous_model_sources['vision.safetensors'].url, 'https://huggingface.co/example/vision', 'Filtered save retains full workflow semantics');
assert.equal(f.document.body.querySelectorAll('.anomalous-source-row-item').length, 1, 'Save refresh preserves expansion and search');
close();
assert.equal(f.document.body.querySelector('.anomalous-model-sources-overlay'), null);
const closeReopened = hub.openModelSourcesModal('workflow');
assert.equal(f.document.body.querySelectorAll('.anomalous-source-row-item').length, 0, 'A new modal session starts collapsed');
closeReopened();
let saved = null;
f.fetch = async (url, options) => {
    assert.equal(url, '/anomalous/update_metadata');
    saved = JSON.parse(options.body);
    return { ok: true, json: async () => ({ status: 'success' }) };
};
await hub.saveSingleModelToLocalSidecar(entries[4], 'https://example.com/vision');
assert.equal(saved.type, 'clip_vision');
assert.equal(saved.path_idx, 1);
assert.equal(saved.filename, 'vision.safetensors');
assert.equal(saved.custom_source_url, 'https://example.com/vision');
console.log('PASS component collection, category-scoped lookup, manual workflow links, batching and independent UI status.');
