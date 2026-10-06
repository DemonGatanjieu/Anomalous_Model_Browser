// Where a LoRA goes and how it is wired (web/modules/graph_splice.js), on a small stand-in graph.
import assert from 'node:assert/strict';
import { chainEnd, loraInsertionCapabilities, mainModelLoaders, planLoraInsertion, spliceLora } from '../web/modules/graph_splice.js';

const SLOTS = {
    CheckpointLoaderSimple: [[], ['MODEL', 'CLIP', 'VAE']],
    UNETLoader: [[], ['MODEL']],
    CLIPLoader: [[], ['CLIP']],
    CLIPTextEncode: [['CLIP'], ['CONDITIONING']],
    KSampler: [['MODEL', 'CONDITIONING', 'CONDITIONING', 'LATENT'], ['LATENT']],
    LoraLoader: [['MODEL', 'CLIP'], ['MODEL', 'CLIP']],
    LoraLoaderModelOnly: [['MODEL'], ['MODEL']],
};

class Graph {
    constructor() { this._nodes = []; this.links = {}; this.nextLink = 1; this.nextNode = 1; }
    getNodeById(id) { return this._nodes.find(node => node.id === id) || null; }
    getLink(id) { return this.links[id] || null; }
    add(node) { node.id ??= this.nextNode++; node.graph = this; this._nodes.push(node); }
    remove(node) {
        node.inputs.forEach((input, slot) => input.link != null && this.unlink(input.link));
        node.outputs.forEach(output => [...output.links].forEach(id => this.unlink(id)));
        this._nodes = this._nodes.filter(item => item !== node);
    }
    unlink(id) {
        const link = this.links[id];
        if (!link) return;
        const origin = this.getNodeById(link.origin_id);
        origin.outputs[link.origin_slot].links = origin.outputs[link.origin_slot].links.filter(item => item !== id);
        this.getNodeById(link.target_id).inputs[link.target_slot].link = null;
        delete this.links[id];
    }
}

function node(graph, type, failConnect = false) {
    const [inputs, outputs] = SLOTS[type];
    const item = {
        type, mode: 0,
        inputs: inputs.map(t => ({ type: t, link: null })),
        outputs: outputs.map(t => ({ type: t, links: [] })),
        connect(slot, target, targetSlot) {
            if (failConnect) return null;
            const g = this.graph;
            if (target.inputs[targetSlot].link != null) g.unlink(target.inputs[targetSlot].link);
            const id = g.nextLink++;
            g.links[id] = { id, origin_id: this.id, origin_slot: slot, target_id: target.id, target_slot: targetSlot };
            this.outputs[slot].links.push(id);
            target.inputs[targetSlot].link = id;
            return g.links[id];
        },
    };
    if (graph) graph.add(item);
    return item;
}

const source = (graph, target, slot) => {
    const link = graph.getLink(target.inputs[slot].link);
    return link ? `${graph.getNodeById(link.origin_id).type}#${link.origin_id}` : null;
};

// A checkpoint whose CLIP feeds both prompts.
function checkpointWorkflow() {
    const g = new Graph();
    const ckpt = node(g, 'CheckpointLoaderSimple');
    const pos = node(g, 'CLIPTextEncode');
    const neg = node(g, 'CLIPTextEncode');
    const sampler = node(g, 'KSampler');
    ckpt.connect(1, pos, 0); ckpt.connect(1, neg, 0); ckpt.connect(0, sampler, 0);
    pos.connect(0, sampler, 1); neg.connect(0, sampler, 2);
    return { g, ckpt, pos, neg, sampler };
}

{
    const { g, ckpt, pos, neg, sampler } = checkpointWorkflow();
    const plan = planLoraInsertion(g, ckpt, 'after', { textEncoder: true });
    assert.equal(plan.clip, true);
    const lora = spliceLora({ graph: g, plan, anchorNode: ckpt, insertedNode: node(null, 'LoraLoader') });
    assert.equal(source(g, lora, 0), `CheckpointLoaderSimple#${ckpt.id}`);
    assert.equal(source(g, lora, 1), `CheckpointLoaderSimple#${ckpt.id}`);
    for (const prompt of [pos, neg]) assert.equal(source(g, prompt, 0), `LoraLoader#${lora.id}`, 'both prompts move behind the LoRA');
    assert.equal(source(g, sampler, 0), `LoraLoader#${lora.id}`);
    // The next one goes after the LoRA already there; a model-only LoRA leaves CLIP alone.
    assert.equal(chainEnd(g, mainModelLoaders(g)[0], 'MODEL'), lora);
    const plan2 = planLoraInsertion(g, lora, 'after', { textEncoder: false });
    const lora2 = spliceLora({ graph: g, plan: plan2, anchorNode: lora, insertedNode: node(null, 'LoraLoaderModelOnly') });
    assert.equal(source(g, sampler, 0), `LoraLoaderModelOnly#${lora2.id}`);
    assert.equal(source(g, pos, 0), `LoraLoader#${lora.id}`);
}

{
    // A UNet with its own CLIP loader: the CLIP line comes from the CLIP loader.
    const g = new Graph();
    const unet = node(g, 'UNETLoader');
    const clip = node(g, 'CLIPLoader');
    const pos = node(g, 'CLIPTextEncode');
    const neg = node(g, 'CLIPTextEncode');
    const sampler = node(g, 'KSampler');
    clip.connect(0, pos, 0); clip.connect(0, neg, 0); unet.connect(0, sampler, 0);
    pos.connect(0, sampler, 1); neg.connect(0, sampler, 2);
    const plan = planLoraInsertion(g, unet, 'after', { textEncoder: true });
    const lora = spliceLora({ graph: g, plan, anchorNode: unet, insertedNode: node(null, 'LoraLoader') });
    assert.equal(source(g, lora, 0), `UNETLoader#${unet.id}`);
    assert.equal(source(g, lora, 1), `CLIPLoader#${clip.id}`);
    assert.equal(source(g, neg, 0), `LoraLoader#${lora.id}`);
    assert.equal(planLoraInsertion(g, unet, 'after', { textEncoder: false }).clip, false);
}

{
    // Before a sampler: only its own model input moves; CLIP through the prompts wired into it.
    const { g, ckpt, pos, neg, sampler } = checkpointWorkflow();
    const caps = loraInsertionCapabilities(g, sampler);
    assert.equal(caps.before.supported, true);
    assert.equal(caps.after.supported, false); // a sampler has no MODEL output
    const plan = planLoraInsertion(g, sampler, 'before', { textEncoder: true });
    assert.equal(plan.clip, true);
    const lora = spliceLora({ graph: g, plan, anchorNode: sampler, insertedNode: node(null, 'LoraLoader') });
    assert.equal(source(g, sampler, 0), `LoraLoader#${lora.id}`);
    assert.equal(source(g, pos, 0), `LoraLoader#${lora.id}`);
    assert.equal(source(g, neg, 0), `LoraLoader#${lora.id}`);
    assert.equal(source(g, lora, 1), `CheckpointLoaderSimple#${ckpt.id}`);
}

{
    // A connection that fails leaves the graph as it was.
    const { g, ckpt, pos, sampler } = checkpointWorkflow();
    const plan = planLoraInsertion(g, ckpt, 'after', { textEncoder: true });
    const broken = node(null, 'LoraLoader', true);
    assert.throws(() => spliceLora({ graph: g, plan, anchorNode: ckpt, insertedNode: broken }), /Failed to connect/);
    assert.equal(g._nodes.includes(broken), false);
    assert.equal(source(g, pos, 0), `CheckpointLoaderSimple#${ckpt.id}`);
    assert.equal(source(g, sampler, 0), `CheckpointLoaderSimple#${ckpt.id}`);
    assert.equal(planLoraInsertion(g, pos, 'after').supported, false); // a prompt has no MODEL output
}

console.log('graph_splice: ok');
