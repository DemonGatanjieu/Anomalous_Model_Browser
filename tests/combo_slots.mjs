// The rules of combo structures that need no canvas (web/modules/combo_slots.js).
import assert from 'node:assert/strict';
import { chainOrder, findPort, fedByLink, folderFor, isModelWidget, missingTypes, packOf, structureKey, structureSummary } from '../web/modules/combo_slots.js';

const combo = (value, values) => ({ type: 'combo', value, options: { values } });

// Model drop-downs: by the files they list, not by their name.
assert.equal(isModelWidget(combo('ae.safetensors', ['ae.safetensors', 'other.sft'])), true);
assert.equal(isModelWidget(combo('None', ['None', 'Flux\\a.safetensors'])), true); // a LoRA stack row left empty
assert.equal(isModelWidget(combo('flux', ['sdxl', 'sd3', 'flux'])), false); // CLIP type: not a model
assert.equal(isModelWidget(combo('x.gguf', () => ['x.gguf'])), true); // options given as a function
assert.equal(isModelWidget({ type: 'text', value: 'a.safetensors' }), false);

// A box turned into an input and fed by a link is no slot.
const node = { inputs: [{ name: 'lora_name', widget: { name: 'lora_name' }, link: 7 }, { name: 'model', link: 3 }] };
assert.equal(fedByLink(node, { name: 'lora_name' }), true);
assert.equal(fedByLink(node, { name: 'strength' }), false);

// The models folder: the one whose files hold every option ("None" aside).
const lists = new Map([
    ['loras', new Set(['Flux/a.safetensors', 'b.safetensors'])],
    ['clip', new Set(['t5.safetensors', 'clip_l.safetensors'])],
    ['text_encoders', new Set(['t5.safetensors', 'clip_l.safetensors'])],
    ['checkpoints', new Set(['sdxl.safetensors'])],
    ['my_loras', new Set(['Flux/a.safetensors', 'b.safetensors', 'c.safetensors'])],
]);
assert.equal(folderFor(['None', 'Flux\\a.safetensors', 'b.safetensors'], 'None', lists), 'loras'); // known folder before a custom one
assert.equal(folderFor(['t5.safetensors', 'clip_l.safetensors'], 't5.safetensors', lists), 'text_encoders'); // clip is the same folder
assert.equal(folderFor(['c.safetensors'], 'c.safetensors', lists), 'my_loras');
assert.equal(folderFor(['nowhere.safetensors'], 'nowhere.safetensors', lists), '');
assert.equal(folderFor([], 'sdxl.safetensors', lists), 'checkpoints'); // no options: the value decides
assert.equal(folderFor([], 'None', lists), '');
lists.set('vae', new Set(['ae.safetensors']));
assert.equal(folderFor(['ae.safetensors', 'pixel_space', 'taesd'], 'ae.safetensors', lists), 'vae'); // built-in choices are no files

// Link ends: same name and type, else the old place, else the one port of that type.
const outputs = [{ name: 'MODEL', type: 'MODEL' }, { name: 'CLIP', type: 'CLIP' }, { name: 'VAE', type: 'VAE' }];
assert.equal(findPort(outputs, 'CLIP', 1, 'CLIP'), 1);
assert.equal(findPort([{ name: 'VAE', type: 'VAE' }, { name: 'CLIP', type: 'CLIP' }], 'CLIP', 0, 'CLIP'), 1); // moved
assert.equal(findPort([{ name: 'clip_out', type: 'CLIP' }], 'CLIP', 1, 'CLIP'), 0); // renamed, one of its type
assert.equal(findPort([{ name: 'a', type: 'CLIP' }, { name: 'b', type: 'CLIP' }], 'CLIP', 5, 'CLIP'), -1); // two: no guess
assert.equal(findPort(outputs, 'MODEL', 0, 'LATENT'), -1); // wrong type

// Node packs and missing node types (LiteGraph's registry).
globalThis.LiteGraph = { registered_node_types: {
    UnetLoaderGGUF: { nodeData: { python_module: 'custom_nodes.ComfyUI-GGUF' } },
    CLIPTextEncode: { nodeData: { python_module: 'nodes' } },
} };
assert.equal(packOf('UnetLoaderGGUF'), 'ComfyUI-GGUF');
assert.equal(packOf('CLIPTextEncode'), '');
const structure = { nodes: [{ type: 'UnetLoaderGGUF' }, { type: 'Missing', pack: 'Some-Pack' }, { type: 'Missing', pack: 'Some-Pack' }], links: [], slots: [] };
assert.deepEqual(missingTypes(structure), [{ type: 'Missing', pack: 'Some-Pack' }]);

// Same structure, whatever the values.
const one = { nodes: [{ type: 'A', key: 'n1' }], links: [{ from: 'n1', fromName: 'MODEL', to: 'n2', toName: 'model' }], slots: [{ node: 'n1', widget: 'x' }] };
assert.equal(structureKey(one), structureKey(JSON.parse(JSON.stringify(one))));
assert.notEqual(structureKey(one), structureKey({ ...one, slots: [] }));

// Repeated nodes are counted in the summary.
assert.equal(structureSummary({ nodes: [{ name: 'UNet' }, { name: 'Text' }, { name: 'LoRA' }, { name: 'Text' }, { title: 'Mine', name: 'LoRA' }] }),
    'UNet + Text ×2 + LoRA + Mine');

// Flow order: loaders first, a LoRA chain from the model outwards, ties as given, loops last.
assert.deepEqual(chainOrder(['p1', 'p2', 'l1', 'l2', 'l3', 'l4', 'unet', 'clip'],
    [['l3', 'l1'], ['l1', 'p1'], ['l1', 'p2'], ['unet', 'l2'], ['clip', 'l2'], ['l4', 'l3'], ['l2', 'l4']]),
    ['unet', 'clip', 'l2', 'l4', 'l3', 'l1', 'p1', 'p2']);
assert.deepEqual(chainOrder(['a', 'b', 'c'], [['a', 'b'], ['b', 'a'], ['x', 'c']]), ['c', 'a', 'b']);

console.log('combo_slots: ok');
