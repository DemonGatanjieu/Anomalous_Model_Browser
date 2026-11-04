// Several LoRAs into a workflow at once (web/modules/lora_insert.js), on a small stand-in graph.
import assert from 'node:assert/strict';
import { insertLoras } from '../web/modules/lora_insert.js';
import { loraNodeKind, POWER_LORA } from '../web/modules/lora_nodes.js';

const SLOTS = {
    CheckpointLoaderSimple: [[], [['MODEL'], ['CLIP'], ['VAE']]],
    UNETLoader: [[], [['MODEL']]],
    CLIPTextEncode: [[['CLIP', 'clip']], [['CONDITIONING']]],
    KSampler: [[['MODEL', 'model'], ['CONDITIONING', 'positive'], ['CONDITIONING', 'negative']], [['LATENT']]],
    LoraLoader: [[['MODEL', 'model'], ['CLIP', 'clip']], [['MODEL'], ['CLIP']]],
    LoraLoaderModelOnly: [[['MODEL', 'model']], [['MODEL']]],
    [POWER_LORA]: [[['MODEL', 'model'], ['CLIP', 'clip']], [['MODEL'], ['CLIP']]],
    'easy loraStack': [[['LORA_STACK', 'optional_lora_stack']], [['LORA_STACK']]],
    'easy loraStackApply': [[['LORA_STACK', 'lora_stack'], ['MODEL', 'model'], ['CLIP', 'optional_clip']], [['MODEL'], ['CLIP']]],
};

class Graph {
    constructor() { this._nodes = []; this.links = {}; this.nextLink = 1; this.nextNode = 1; }
    getNodeById(id) { return this._nodes.find(node => node.id === id) || null; }
    getLink(id) { return this.links[id] || null; }
    add(node) { node.id ??= this.nextNode++; node.graph = this; this._nodes.push(node); }
    remove(node) {
        node.inputs.forEach(input => input.link != null && this.unlink(input.link));
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

function node(type) {
    const [inputs, outputs] = SLOTS[type];
    const item = {
        type, mode: 0, pos: [0, 0], size: [300, 120], widgets: [],
        inputs: inputs.map(([slotType, name]) => ({ type: slotType, name, link: null })),
        outputs: outputs.map(([slotType]) => ({ type: slotType, links: [] })),
        connect(slot, target, targetSlot) {
            const g = this.graph;
            if (target.inputs[targetSlot].link != null) g.unlink(target.inputs[targetSlot].link);
            const id = g.nextLink++;
            g.links[id] = { id, origin_id: this.id, origin_slot: slot, target_id: target.id, target_slot: targetSlot };
            this.outputs[slot].links.push(id);
            target.inputs[targetSlot].link = id;
            return g.links[id];
        },
    };
    if (type === POWER_LORA) item.addNewLoraWidget = lora => item.widgets.push({ name: `lora_${item.widgets.length + 1}`, value: { on: true, lora } });
    if (type === 'easy loraStack') item.widgets = ['toggle', 'mode', 'num_loras', ...Array.from({ length: 10 }, (_, row) => `lora_${row + 1}_name`)].map(name => ({ name, value: null }));
    return item;
}

let failOn = null;
globalThis.LiteGraph = {
    registered_node_types: {},
    createNode: type => (type === failOn ? null : node(type)),
};

function workflow(loader = 'CheckpointLoaderSimple') {
    const graph = new Graph();
    const place = (type, x) => { const item = node(type); item.pos = [x, 0]; graph.add(item); return item; };
    const model = place(loader, 0);
    const positive = place('CLIPTextEncode', 900);
    const negative = place('CLIPTextEncode', 900);
    negative.pos = [900, 300];
    const sampler = place('KSampler', 1400);
    model.connect(0, sampler, 0);
    if (loader === 'CheckpointLoaderSimple') {
        model.connect(1, positive, 0);
        model.connect(1, negative, 0);
    }
    positive.connect(0, sampler, 1);
    negative.connect(0, sampler, 2);
    return { graph, model, positive, negative, sampler };
}

const from = (graph, target, slot) => {
    const link = graph.getLink(target.inputs[slot].link);
    return link ? graph.getNodeById(link.origin_id) : null;
};
const setPath = (item, path) => { item.lora = path; };
const insert = (flow, options) => insertLoras({ graph: flow.graph, anchorNode: flow.model, direction: 'after', kind: loraNodeKind('core'), textEncoder: true, setPath, ...options });

// ComfyUI's own, after the loader: a chain in the order picked; the sampler and both prompts now hang off its end.
let flow = workflow();
let made = insert(flow, { loras: ['a', 'b', 'c'] });
assert.deepEqual(made.map(item => [item.type, item.lora]), [['LoraLoader', 'a'], ['LoraLoader', 'b'], ['LoraLoader', 'c']]);
assert.equal(from(flow.graph, made[0], 0), flow.model);
assert.equal(from(flow.graph, made[0], 1), flow.model);
assert.equal(from(flow.graph, made[1], 0), made[0]);
assert.equal(from(flow.graph, made[2], 1), made[1]);
assert.equal(from(flow.graph, flow.sampler, 0), made[2]);
assert.equal(from(flow.graph, flow.positive, 0), made[2]);
assert.equal(from(flow.graph, flow.negative, 0), made[2]);

// They stand in one column, in order, clear of each other and of what was there.
assert.equal(new Set(made.map(item => item.pos[0])).size, 1);
assert.ok(made[0].pos[1] + made[0].size[1] < made[1].pos[1]);
assert.ok(made[1].pos[1] + made[1].size[1] < made[2].pos[1]);

// No file trains the text encoder: model-only loaders, the prompts stay on the checkpoint.
flow = workflow();
made = insert(flow, { loras: ['a', 'b'], textEncoder: false });
assert.deepEqual(made.map(item => item.type), ['LoraLoaderModelOnly', 'LoraLoaderModelOnly']);
assert.equal(from(flow.graph, flow.sampler, 0), made[1]);
assert.equal(from(flow.graph, flow.positive, 0), flow.model);

// Before the sampler: still in the order picked, with the sampler at the end.
flow = workflow();
made = insertLoras({ graph: flow.graph, anchorNode: flow.sampler, direction: 'before', kind: loraNodeKind('core'), textEncoder: true, setPath, loras: ['a', 'b'] });
assert.equal(from(flow.graph, made[0], 0), flow.model);
assert.equal(from(flow.graph, made[1], 0), made[0]);
assert.equal(from(flow.graph, flow.sampler, 0), made[1]);
assert.equal(from(flow.graph, made[1], 1), made[0]);
assert.equal(from(flow.graph, flow.positive, 0), made[1]);
assert.equal(from(flow.graph, flow.negative, 0), made[1]);

// Power Lora Loader: one node, a row each.
flow = workflow();
made = insert(flow, { kind: loraNodeKind('rgthree'), loras: ['a', 'b', 'c'] });
assert.deepEqual(made.map(item => item.type), [POWER_LORA]);
assert.deepEqual(made[0].widgets.map(widget => widget.value.lora), ['a', 'b', 'c']);
assert.equal(from(flow.graph, flow.sampler, 0), made[0]);
assert.equal(from(flow.graph, flow.positive, 0), made[0]);

// A UNet with no CLIP on the canvas: the model goes through, the CLIP input stays empty.
flow = workflow('UNETLoader');
made = insert(flow, { kind: loraNodeKind('rgthree'), loras: ['a'] });
assert.equal(from(flow.graph, flow.sampler, 0), made[0]);
assert.equal(made[0].inputs[1].link, null);

// Easy-Use: twelve LoRAs fill two stacks; the stacks stand above Apply LoraStack, which the model goes through.
flow = workflow();
const twelve = Array.from({ length: 12 }, (_, index) => `lora${index + 1}`);
made = insert(flow, { kind: loraNodeKind('easy'), loras: twelve });
assert.deepEqual(made.map(item => item.type), ['easy loraStack', 'easy loraStack', 'easy loraStackApply']);
const row = (item, name) => item.widgets.find(widget => widget.name === name).value;
assert.equal(row(made[0], 'num_loras'), 10);
assert.equal(row(made[0], 'lora_10_name'), 'lora10');
assert.equal(row(made[1], 'num_loras'), 2);
assert.equal(row(made[1], 'lora_2_name'), 'lora12');
assert.equal(from(flow.graph, made[2], 0), made[0]);
assert.equal(from(flow.graph, made[0], 0), made[1]);
assert.equal(from(flow.graph, made[2], 1), flow.model);
assert.equal(from(flow.graph, made[2], 2), flow.model);
assert.equal(from(flow.graph, flow.sampler, 0), made[2]);
assert.ok(made[1].pos[1] < made[2].pos[1]);

// All or nothing: a failure part way leaves the workflow as it was.
const shape = graph => JSON.stringify([graph._nodes.map(item => item.id), Object.values(graph.links).map(link => [link.origin_id, link.origin_slot, link.target_id, link.target_slot]).sort()]);
flow = workflow();
const before = shape(flow.graph);
let calls = 0;
assert.throws(() => insert(flow, { loras: ['a', 'b', 'c'], setPath: () => { if (++calls === 3) throw new Error('no such file'); } }), /no such file/);
assert.equal(shape(flow.graph), before);
assert.equal(from(flow.graph, flow.sampler, 0), flow.model);

flow = workflow();
const untouched = shape(flow.graph);
failOn = 'easy loraStack';
assert.throws(() => insert(flow, { kind: loraNodeKind('easy'), loras: ['a'] }), /cannot make easy loraStack/);
failOn = null;
assert.equal(shape(flow.graph), untouched);

console.log('LoRA insert: chains, one-node stacks, placing and undoing a failed insert.');
