// What a combo kept from an output image holds (web/modules/sampler_inputs.js).
import assert from 'node:assert/strict';
import { isSampler, samplerSideNodes } from '../web/modules/sampler_inputs.js';

// A small graph: links [id, from, to, type]; inputs name the link feeding them.
function graph(nodes, links) {
    const byId = new Map(links.map(([id, from, , type]) => [id, { id, origin_id: from, type }]));
    return {
        _nodes: nodes.map(([id, type, inputs = {}]) => ({ id, type, inputs: Object.entries(inputs).map(([name, link]) => ({ name, link })) })),
        getLink: id => byId.get(id) ?? null,
    };
}

const g = graph([
    [1, 'CheckpointLoaderSimple'],
    [2, 'LoraLoader', { model: 1, clip: 2 }],
    [3, 'CLIPSetLastLayer', { clip: 3 }],
    [4, 'CLIPTextEncode', { clip: 4 }],
    [5, 'CLIPTextEncode', { clip: 5 }],
    [6, 'EmptyLatentImage'],
    [7, 'KSampler', { model: 6, positive: 7, negative: 8, latent_image: 9 }],
    [8, 'VAEDecode', { samples: 10, vae: 11 }],
    [9, 'LoadImage'],
    [10, 'ControlNetApply', { conditioning: 12, image: 13 }],
    [11, 'Note'],
], [
    [1, 1, 2, 'MODEL'], [2, 1, 2, 'CLIP'], [3, 2, 3, 'CLIP'], [4, 3, 4, 'CLIP'], [5, 3, 5, 'CLIP'],
    [6, 2, 7, 'MODEL'], [7, 10, 7, 'CONDITIONING'], [8, 5, 7, 'CONDITIONING'], [9, 6, 7, 'LATENT'],
    [10, 7, 8, 'LATENT'], [11, 1, 8, 'VAE'], [12, 4, 10, 'CONDITIONING'], [13, 9, 10, 'IMAGE'],
]);

assert.equal(isSampler(g._nodes[6]), true);
assert.equal(isSampler(g._nodes[1]), false);
// Loaders, the LoRA, CLIP skip, both prompts and what sits between them and the sampler;
// not the sampler, the latent, the decode, the image loader or a note.
assert.deepEqual(samplerSideNodes(g).map(node => node.id), [1, 2, 3, 4, 5, 10]);
// A workflow without a sampler: nothing to keep.
assert.deepEqual(samplerSideNodes(graph([[1, 'CheckpointLoaderSimple']], [])), []);
// A guider (Flux): model and conditioning.
const flux = graph([[1, 'UNETLoader'], [2, 'CLIPTextEncode'], [3, 'BasicGuider', { model: 1, conditioning: 2 }]],
    [[1, 1, 3, 'MODEL'], [2, 2, 3, 'CONDITIONING']]);
assert.deepEqual(samplerSideNodes(flux).map(node => node.id), [1, 2]);
console.log('sampler inputs: ok');
