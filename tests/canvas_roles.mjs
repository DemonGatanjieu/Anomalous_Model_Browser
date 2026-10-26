// A ready-made block's roles found on the canvas (web/modules/canvas_roles.js): the sampler, its
// decode and save by their sockets, what feeds an input upstream, and nothing guessed.
import assert from 'node:assert/strict';
import { findRoles, placeRoles } from '../web/modules/canvas_roles.js';

class Graph {
    constructor() { this._nodes = []; this.links = {}; this.serial = 0; }
    getNodeById(id) { return this._nodes.find(n => String(n.id) === String(id)); }
    getLink(id) { return this.links[id]; }
    node(type, inputs = [], outputs = []) {
        const n = { id: this._nodes.length + 1, type, inputs: inputs.map(([name, kind]) => ({ name, type: kind, link: null })),
            outputs: outputs.map(([name, kind]) => ({ name, type: kind, links: [] })) };
        this._nodes.push(n);
        return n;
    }
    wire(from, slot, to, input) {
        const id = ++this.serial, target = to.inputs.findIndex(item => item.name === input);
        this.links[id] = { id, origin_id: from.id, origin_slot: slot, target_id: to.id, target_slot: target };
        from.outputs[slot].links.push(id);
        to.inputs[target].link = id;
    }
}

function txt2img() {
    const g = new Graph();
    const ckpt = g.node('CheckpointLoaderSimple', [], [['MODEL', 'MODEL'], ['CLIP', 'CLIP'], ['VAE', 'VAE']]);
    const pos = g.node('CLIPTextEncode', [['clip', 'CLIP']], [['CONDITIONING', 'CONDITIONING']]);
    const neg = g.node('CLIPTextEncode', [['clip', 'CLIP']], [['CONDITIONING', 'CONDITIONING']]);
    const empty = g.node('EmptyLatentImage', [], [['LATENT', 'LATENT']]);
    const sampler = g.node('KSampler', [['model', 'MODEL'], ['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['latent_image', 'LATENT']], [['LATENT', 'LATENT']]);
    const decode = g.node('VAEDecode', [['samples', 'LATENT'], ['vae', 'VAE']], [['IMAGE', 'IMAGE']]);
    const save = g.node('SaveImage', [['images', 'IMAGE']], []);
    g.wire(ckpt, 1, pos, 'clip'); g.wire(ckpt, 1, neg, 'clip');
    g.wire(ckpt, 0, sampler, 'model'); g.wire(pos, 0, sampler, 'positive'); g.wire(neg, 0, sampler, 'negative');
    g.wire(empty, 0, sampler, 'latent_image'); g.wire(sampler, 0, decode, 'samples'); g.wire(ckpt, 2, decode, 'vae');
    g.wire(decode, 0, save, 'images');
    return { g, ckpt, pos, neg, sampler, decode, save };
}

// The roles of a plain text-to-image workflow, and a block's links resolved to canvas nodes.
{
    const { g, ckpt, pos, neg, sampler, decode, save } = txt2img();
    const roles = findRoles(g);
    assert.deepEqual([roles.sampler, roles.decode, roles.save], [sampler, decode, save]);
    const placed = placeRoles(g, {
        a: { class_type: 'X', inputs: { model: ['$sampler.model', '*'], clip: ['$sampler.positive.clip', '*'], vae: ['$decode.vae', '*'],
            image: ['$decode', 0], negative: ['$sampler.negative', '*'], steps: 20 }, wire_to: '$save' },
        b: { class_type: 'Y', inputs: { image: ['a', 0] }, wire_to: ['$sampler'] },
    });
    assert.deepEqual(placed.a.inputs, { model: [`#${ckpt.id}`, 0], clip: [`#${ckpt.id}`, 1], vae: [`#${ckpt.id}`, 2],
        image: [`#${decode.id}`, 0], negative: [`#${neg.id}`, 0], steps: 20 }, 'upstream paths end at the feeding output');
    assert.equal(placed.a.wire_to, save.id);
    assert.deepEqual(placed.b, { class_type: 'Y', inputs: { image: ['a', 0] }, wire_to: [sampler.id] }, 'own links untouched');
    assert.ok(pos, 'unused');
    const plain = { a: { class_type: 'X', inputs: { image: ['#3', 0] } } };
    assert.equal(placeRoles(g, plain), plain, 'a group naming no role is passed on as it is');
}

// Several samplers: near_node_id picks one, else nothing is guessed; muted ones do not count.
{
    const { g, sampler } = txt2img();
    const other = g.node('KSampler', [['model', 'MODEL'], ['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['latent_image', 'LATENT']], [['LATENT', 'LATENT']]);
    assert.throws(() => findRoles(g), /Several samplers on the canvas \(#5 KSampler, #8 KSampler\): near_node_id/);
    assert.equal(findRoles(g, other.id).sampler, other);
    assert.equal(findRoles(g, other.id).decode, null, 'nothing decodes its latent');
    assert.throws(() => placeRoles(g, { a: { class_type: 'X', inputs: { image: ['$decode', 0] } } }, other.id), /no decode on the canvas/);
    other.mode = 4;
    assert.equal(findRoles(g).sampler, sampler);
}

// An input with nothing wired, and an empty canvas, say so.
{
    const { g, sampler } = txt2img();
    const pos = g.getNodeById(g.links[sampler.inputs[1].link].origin_id);
    delete g.links[pos.inputs[0].link];
    pos.inputs[0].link = null;
    assert.throws(() => placeRoles(g, { a: { class_type: 'X', inputs: { clip: ['$sampler.positive.clip', '*'] } } }),
        /\$sampler.positive.clip: nothing is wired into #2 CLIPTextEncode's clip/);
    assert.throws(() => findRoles(new Graph()), /No sampler \(KSampler\) on the canvas/);
}

console.log('canvas_roles ok');
