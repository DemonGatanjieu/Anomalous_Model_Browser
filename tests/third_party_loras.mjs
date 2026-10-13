// LoRAs in popular third-party nodes, wherever AMB reads a workflow's models: a workflow's summary
// (recipe_parser.js → recipe_loras.js), saved model references (recipe_identity.js) and Model
// Check's boxes (lora_nodes.js powerLoraRowBoxes).
import assert from 'node:assert/strict';
import { extractRecipeMetadata } from '../web/modules/recipe_parser.js';
import { deriveRecipeModelReferences, nodeModelValues } from '../web/modules/recipe_identity.js';
import { POWER_LORA, powerLoraRowBoxes } from '../web/modules/lora_nodes.js';

globalThis.LiteGraph = { registered_node_types: {
    LoraLoader: { nodeData: { input: { required: { lora_name: [['Flux\\a.safetensors', 'b.safetensors']] } } } },
} };

const row = (name, value) => ({ name, type: 'custom', value });
const powerLora = {
    id: 7,
    type: POWER_LORA,
    widgets: [
        { name: '', type: 'custom', value: {} }, // divider
        row('PowerLoraLoaderHeaderWidget', { type: 'PowerLoraLoaderHeaderWidget' }),
        row('lora_1', { on: true, lora: 'Flux\\a.safetensors', strength: 0.8, strengthTwo: null }),
        row('lora_2', { on: false, lora: 'off.safetensors', strength: 1, strengthTwo: null }),
        row('lora_3', { on: true, lora: 'b.safetensors', strength: 0.5, strengthTwo: 0.25 }),
        row('lora_4', { on: true, lora: null, strength: 1 }),
        { name: '➕ Add Lora', type: 'custom', value: '' },
    ],
};
const easyStack = {
    id: 8,
    type: 'easy loraStack',
    widgets: [
        { name: 'toggle', value: true }, { name: 'mode', value: 'simple' }, { name: 'num_loras', value: 2 },
        { name: 'lora_1_name', value: 'c.safetensors' }, { name: 'lora_1_strength', value: 0.6 },
        { name: 'lora_2_name', value: 'None' }, { name: 'lora_2_strength', value: 1 },
    ],
};

// The summary: switched-on rows with a LoRA, the clip strength as the model's unless set apart.
const metadata = extractRecipeMetadata({ _nodes: [powerLora, easyStack], links: [] });
assert.deepEqual(metadata.loras, [
    { name: 'Flux\\a.safetensors', strength_model: 0.8, strength_clip: 0.8 },
    { name: 'b.safetensors', strength_model: 0.5, strength_clip: 0.25 },
    { name: 'c.safetensors', strength_model: 0.6, strength_clip: null },
]);
// Saved model references: rows by their place in widgets_values (rows numbered as rgthree numbers them).
const savedPower = { id: 7, type: POWER_LORA, widgets_values: [{}, { type: 'PowerLoraLoaderHeaderWidget' },
    { on: true, lora: 'a.safetensors', strength: 1 }, { on: false, lora: 'off.safetensors', strength: 1 },
    { on: true, lora: 'b.safetensors', strength: 1 }, {}, ''] };
assert.deepEqual(nodeModelValues(savedPower), [[2, 'lora', 'lora_1', 'a.safetensors'], [4, 'lora', 'lora_3', 'b.safetensors']]);
const savedStack = { id: 8, type: 'easy loraStack', widgets_values: [true, 'simple', 2, 'c.safetensors', 1, 1, 1, 'None', 1, 1, 1, 'unused.safetensors'] };
assert.deepEqual(nodeModelValues(savedStack), [[3, 'lora', 'lora_1_name', 'c.safetensors'], [7, 'lora', 'lora_2_name', 'None']]);
const refs = deriveRecipeModelReferences({ workflow: { nodes: [savedPower, savedStack] }, params: {} });
assert.deepEqual(refs.map(ref => [ref.node_id, ref.widget_index, ref.widget_name, ref.saved_value]), [
    [7, 2, 'lora_1', 'a.safetensors'], [7, 4, 'lora_3', 'b.safetensors'], [8, 3, 'lora_1_name', 'c.safetensors'],
]); // "None" is no model
assert.deepEqual(nodeModelValues({ type: 'CheckpointLoaderSimple', widgets_values: ['x.safetensors'] }), [[0, 'checkpoint', 'checkpoint', 'x.safetensors']]);

// Model Check's boxes: switched-on rows naming a LoRA, read and written like a drop-down.
const boxes = powerLoraRowBoxes(powerLora);
assert.deepEqual(boxes.map(box => [box.name, box.type, box.value]), [['lora_1', 'combo', 'Flux\\a.safetensors'], ['lora_3', 'combo', 'b.safetensors']]);
assert.deepEqual(boxes[0].options.values, ['Flux\\a.safetensors', 'b.safetensors']);
boxes[1].value = 'Flux\\a.safetensors';
assert.deepEqual(powerLora.widgets[4].value, { on: true, lora: 'Flux\\a.safetensors', strength: 0.5, strengthTwo: 0.25 }); // strength kept
boxes[1].anomalous_replaced = { from: 'b.safetensors', to: 'Flux\\a.safetensors' };
assert.deepEqual(powerLoraRowBoxes(powerLora)[1].anomalous_replaced, { from: 'b.safetensors', to: 'Flux\\a.safetensors' }); // lasts
assert.deepEqual(powerLoraRowBoxes(easyStack), []);

console.log('third_party_loras: ok');
