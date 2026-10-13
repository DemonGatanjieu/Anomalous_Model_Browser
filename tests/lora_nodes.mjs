// The LoRA nodes a combo puts its LoRAs in (web/modules/lora_nodes.js), on fake nodes.
import assert from 'node:assert/strict';
import {
    POWER_LORA, addPowerLoraRows, chainLoras, installedLoraNodes, loraNodeKind, nativeLora, powerLoraRows,
} from '../web/modules/lora_nodes.js';

globalThis.LiteGraph = {
    registered_node_types: {
        LoraLoader: { nodeData: { input: { required: { lora_name: [['Flux\\a.safetensors', 'b.safetensors']] } } } },
        [POWER_LORA]: {},
    },
};

// Offered only where installed: rgthree is here, Easy-Use is not.
assert.deepEqual(installedLoraNodes().map(kind => kind.id), ['core', 'rgthree']);
assert.equal(loraNodeKind(undefined).id, 'core');
assert.equal(loraNodeKind('nonsense').id, 'core');
assert.equal(nativeLora('Flux/a.safetensors'), 'Flux\\a.safetensors'); // ComfyUI's own spelling
assert.equal(nativeLora('elsewhere/c.safetensors'), 'elsewhere/c.safetensors');

const INPUTS = {
    LoraLoader: ['model', 'clip'], LoraLoaderModelOnly: ['model'], [POWER_LORA]: ['model', 'clip'],
    'easy loraStack': ['optional_lora_stack'], 'easy loraStackApply': ['lora_stack', 'model', 'optional_clip'],
};
function fakeGraph() {
    const links = [];
    const made = [];
    const node = (type) => {
        const item = {
            type, size: [300, 100], widgets: [], inputs: (INPUTS[type] || []).map(name => ({ name })),
            connect(out, target, input) { links.push([this.type, out, target.type, target.inputs[input]?.name]); return true; },
        };
        if (type === POWER_LORA) {
            item.addNewLoraWidget = (lora) => {
                const widget = { name: `lora_${item.widgets.length + 1}`, value: { on: true, lora: lora ?? null, strength: 1, strengthTwo: null } };
                item.widgets.push(widget);
                return widget;
            };
        }
        if (type === 'easy loraStack') {
            item.widgets = ['toggle', 'mode', 'num_loras', ...Array.from({ length: 10 }, (_, i) => `lora_${i + 1}_name`)].map(name => ({ name, value: null }));
        }
        return item;
    };
    const add = (type, relX, relY) => {
        const item = node(type);
        made.push({ type, relX, relY, node: item });
        return item;
    };
    return { links, made, add, source: node('CheckpointLoaderSimple') };
}
const options = (graph, loras, clipSlot = 1) => ({ add: graph.add, source: graph.source, clipSlot, loras, relX: 350, step: 350,
    setPath: (node, path) => node.widgets.push({ name: 'lora_name', value: path }) });

// ComfyUI's own: a chain, each LoRA's MODEL and CLIP into the next.
let graph = fakeGraph();
let result = chainLoras(loraNodeKind('core'), options(graph, ['a.safetensors', 'b.safetensors']));
assert.deepEqual(graph.made.map(item => [item.type, item.relX]), [['LoraLoader', 350], ['LoraLoader', 700]]);
assert.equal(result.relX, 700);
assert.equal(result.clipSlot, 1);
assert.equal(graph.links.length, 4);
// A UNet: model-only loaders, no CLIP line.
graph = fakeGraph();
result = chainLoras(loraNodeKind('core'), options(graph, ['a.safetensors'], null));
assert.deepEqual(graph.made.map(item => item.type), ['LoraLoaderModelOnly']);
assert.equal(result.clipSlot, null);
// No LoRAs: the loader itself feeds the prompts.
graph = fakeGraph();
result = chainLoras(loraNodeKind('rgthree'), options(graph, []));
assert.equal(result.last, graph.source);
assert.equal(graph.made.length, 0);

// Power Lora Loader: one node, a row per LoRA in ComfyUI's spelling, model and CLIP by name.
graph = fakeGraph();
result = chainLoras(loraNodeKind('rgthree'), options(graph, ['Flux/a.safetensors', 'b.safetensors']));
assert.equal(graph.made.length, 1);
assert.deepEqual(result.last.widgets.map(widget => widget.value.lora), ['Flux\\a.safetensors', 'b.safetensors']);
assert.deepEqual(graph.links, [['CheckpointLoaderSimple', 0, POWER_LORA, 'model'], ['CheckpointLoaderSimple', 1, POWER_LORA, 'clip']]);
assert.equal(result.clipSlot, 1);

// Easy-Use: twelve LoRAs make two stacks (ten and two), the second feeding the first, applied on the model.
graph = fakeGraph();
const twelve = Array.from({ length: 12 }, (_, i) => `l${i + 1}.safetensors`);
result = chainLoras(loraNodeKind('easy'), options(graph, twelve));
assert.deepEqual(graph.made.map(item => item.type), ['easy loraStack', 'easy loraStack', 'easy loraStackApply']);
const [first, second] = graph.made.map(item => item.node);
assert.equal(first.widgets.find(w => w.name === 'num_loras').value, 10);
assert.equal(second.widgets.find(w => w.name === 'num_loras').value, 2);
assert.equal(second.widgets.find(w => w.name === 'lora_2_name').value, 'l12.safetensors');
assert.ok(graph.made[1].relY > graph.made[0].relY); // stacked, not on top of each other
assert.deepEqual(graph.links, [
    ['easy loraStack', 0, 'easy loraStack', 'optional_lora_stack'],
    ['easy loraStack', 0, 'easy loraStackApply', 'lora_stack'],
    ['CheckpointLoaderSimple', 0, 'easy loraStackApply', 'model'],
    ['CheckpointLoaderSimple', 1, 'easy loraStackApply', 'optional_clip'],
]);
assert.equal(result.last.type, 'easy loraStackApply');

// A Power Lora Loader's rows read in order (a row with no LoRA kept as null) and made again.
const saved = { type: POWER_LORA, widgets: [
    { name: 'lora_1', value: { on: true, lora: 'a.safetensors', strength: 0.7, strengthTwo: null } },
    { name: 'header', value: { toggled: true } },
    { name: 'lora_3', value: { on: false, lora: 'b.safetensors', strength: 1, strengthTwo: 0.5 } },
    { name: 'lora_4', value: { on: true, lora: null, strength: 1 } },
    { name: '➕ Add Lora', value: undefined },
] };
const rows = powerLoraRows(saved);
assert.deepEqual(rows, [
    { on: true, lora: 'a.safetensors', strength: 0.7, strengthTwo: null },
    { on: false, lora: 'b.safetensors', strength: 1, strengthTwo: 0.5 },
    { on: true, lora: null, strength: 1, strengthTwo: null },
]);
assert.deepEqual(powerLoraRows({ type: 'LoraLoader', widgets: saved.widgets }), []);
graph = fakeGraph();
const fresh = graph.add(POWER_LORA, 0, 0);
addPowerLoraRows(fresh, rows);
assert.deepEqual(fresh.widgets.map(widget => widget.name), ['lora_1', 'lora_2', 'lora_3']); // renumbered as rgthree does
assert.deepEqual(fresh.widgets.map(widget => widget.value), rows);

console.log('lora_nodes: ok');
