// node tests/ai_toolbox_data.mjs — the materials picker's data: node types from the page's own definitions, the catalogue, search, keeping.
import assert from 'node:assert/strict';
import { catalogItems, keptCatalog, loadCatalog, nameWithoutVersion, nodeItems, nodeSources, packLabel, searchItems } from '../web/modules/ai_toolbox_data.js';

assert.equal(packLabel('comfyui_controlnet_aux'), 'controlnet aux');
assert.equal(packLabel('ComfyUI-Impact-Pack'), 'Impact Pack');
assert.equal(packLabel('rgthree-comfy'), 'rgthree');
assert.equal(packLabel('Comfyroll_CustomNodes'), 'Comfyroll CustomNodes');
assert.equal(packLabel('ComfyUI'), 'ComfyUI');

const def = (module, extra = {}) => ({ nodeData: { python_module: module, ...extra } });
const registered = {
    KSampler: def('nodes', {
        display_name: 'KSampler', category: 'sampling',
        input: { required: { model: ['MODEL'], seed: ['INT', { default: 0 }], sampler_name: [['euler', 'dpmpp_2m']], positive: ['CONDITIONING'] },
            optional: { note: ['STRING', { forceInput: true }] } },
        output: ['LATENT'], output_name: ['LATENT'],
    }),
    FaceDetailer: def('custom_nodes.ComfyUI-Impact-Pack', { display_name: 'FaceDetailer', nodeSource: { displayText: 'Impact Pack' }, input: {}, output: ['IMAGE'] }),
    'Context (rgthree)': def('custom_nodes.rgthree-comfy', { display_name: 'Context (rgthree)', input: {}, output: [] }),
    KlingTextToVideoNode: def('comfy_api_nodes.nodes_kling', { display_name: 'Kling', api_node: true, input: {}, output: ['VIDEO'] }),
    'Fast Groups Muter (rgthree)': { title: 'Fast Groups Muter (rgthree)' },
    Reroute: { title: 'Reroute' },
};
const nodes = nodeItems(registered);
const by = Object.fromEntries(nodes.map(item => [item.id, item]));
assert.deepEqual(by.KSampler.inputs.map(input => input.name), ['model', 'positive', 'note'], 'sockets, a forced input among them');
assert.deepEqual(by.KSampler.settings.map(setting => [setting.name, setting.type, setting.choices]), [['seed', 'INT', 0], ['sampler_name', 'choice', 2]]);
assert.deepEqual(by.KSampler.outputs, [{ slot: 0, name: 'LATENT', type: 'LATENT' }]);
assert.deepEqual([by.FaceDetailer.source.kind, by.FaceDetailer.source.label], ['pack', 'Impact Pack']);
assert.equal(by['Context (rgthree)'].source.label, 'rgthree');
assert.ok(by.KlingTextToVideoNode.paid);
assert.deepEqual([by['Fast Groups Muter (rgthree)'].source.key, by['Fast Groups Muter (rgthree)'].page], ['rgthree-comfy', true], 'a page-only helper goes with its pack');
assert.equal(by.Reroute.source.kind, 'builtin');
assert.deepEqual(nodeSources(nodes).map(source => [source.key, source.count]),
    [['builtin', 2], ['ComfyUI-Impact-Pack', 1], ['rgthree-comfy', 2], ['api', 1]], 'own first, packs by name, paid last');

const items = catalogItems({
    combos: [{ name: '赛博少女', model: 'a.safetensors', loras: ['neon.safetensors'], prompt: '1girl, neon city' }],
    workflows: [{ name: 'SDXL 高清修复', tags: ['SDXL'], prompt: 'castle' }],
    prompts: [{ id: 'combo:赛博少女', name: '赛博少女', source: 'combo', positive: '1girl, neon city', negative: '', tags: [] }],
    models: [{ id: 'loras:0:neon.safetensors', name: 'Neon', file: 'neon.safetensors', type: 'loras', base: 'SDXL', words: ['neonstyle'] }],
});
assert.deepEqual(items.map(item => [item.kind, item.id]), [['combos', '赛博少女'], ['workflows', 'SDXL 高清修复'], ['prompts', 'combo:赛博少女'], ['models', 'loras:0:neon.safetensors']]);
assert.deepEqual(searchItems(items, 'neon').map(item => item.kind), ['models', 'combos', 'prompts'], 'a title that starts with the words first');
assert.deepEqual(searchItems(items, 'sdxl castle').map(item => item.id), ['SDXL 高清修复']);
assert.deepEqual(searchItems(nodes, 'impact').map(item => item.id), ['FaceDetailer'], 'a pack name finds its nodes');
assert.equal(searchItems(items, '').length, items.length);

// A model carries what the Models page groups by: its versions find it by name, its file name is the one groupByPage sorts on.
const [version] = catalogItems({ models: [{ id: 'loras:0:b.safetensors', name: 'B', file: 'b.safetensors', type: 'loras', base: '', metadata: { model_id: 7, version_id: 9, version_name: 'v2.5' } }] });
assert.equal(version.filename, 'b.safetensors');
assert.deepEqual(searchItems([version], 'v2.5').map(item => item.id), ['loras:0:b.safetensors']);
assert.equal(nameWithoutVersion({ name: 'GhostMix_v2.0-BakedVAE', metadata: { version_name: 'v2.0-BakedVAE' } }), 'GhostMix');
assert.equal(nameWithoutVersion({ name: 'My v2.0', metadata: { version_name: 'v2.0' } }), 'My v2.0', 'only a name that ends in _version');
assert.equal(nameWithoutVersion({ name: 'Plain' }), 'Plain');

// Kept a minute; one request however many ask at once; a failure says why and keeps nothing.
let calls = 0;
const fetcher = async () => { calls++; return { ok: true, json: async () => ({ combos: [{ name: 'x', loras: [] }] }) }; };
const [a, b] = await Promise.all([loadCatalog({ fetcher, fresh: true }), loadCatalog({ fetcher })]);
assert.equal(calls, 1);
assert.equal(a, b);
await loadCatalog({ fetcher });
assert.equal(calls, 1, 'kept');
assert.equal(keptCatalog()[0].id, 'x');
await assert.rejects(loadCatalog({ fresh: true, fetcher: async () => ({ ok: false, status: 502, json: async () => ({ error: 'no' }) }) }), /no/);
console.log('ai_toolbox_data: ok');
