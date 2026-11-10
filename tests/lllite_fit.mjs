import assert from 'node:assert/strict';
import { llliteUses, llliteWords, usesLllite } from '../web/modules/lllite_fit.js';

// A Tile on the second model of a two-pass canvas: its model line goes up through a LoRA to that model's loader.
const output = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'Anima\\base.safetensors', weight_dtype: 'default' } },
    30: { class_type: 'UNETLoader', inputs: { unet_name: 'Anima\\second.safetensors', weight_dtype: 'default' } },
    31: { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'style.safetensors', strength_model: 0.8, model: ['30', 0] } },
    33: { class_type: 'AnimaLLLiteApply_sdscripts', inputs: { lllite_name: 'animaTileRepair_v20.safetensors', strength: 0.7, model: ['31', 0], image: ['7', 0] } },
    34: { class_type: 'KSampler', inputs: { model: ['33', 0], denoise: 0.85 } },
};
assert.deepEqual(llliteUses(output), [{ node: '33', loader: '30', model: 'Anima\\second.safetensors', lllite: 'animaTileRepair_v20.safetensors' }]);

// A checkpoint's loader counts too; a line that ends nowhere, or in a node naming no model file, is left alone.
assert.deepEqual(llliteUses({
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'xl.safetensors' } },
    5: { class_type: 'AnimaLLLiteApply_sdscripts', inputs: { lllite_name: 'pose.safetensors', model: ['4', 0] } },
}), [{ node: '5', loader: '4', model: 'xl.safetensors', lllite: 'pose.safetensors' }]);
assert.deepEqual(llliteUses({ 5: { class_type: 'AnimaLLLiteApply_sdscripts', inputs: { lllite_name: 'pose.safetensors', model: ['9', 0] } } }), []);
assert.deepEqual(llliteUses({
    4: { class_type: 'SomeModelMaker', inputs: {} },
    5: { class_type: 'AnimaLLLiteApply_sdscripts', inputs: { lllite_name: 'pose.safetensors', model: ['4', 0] } },
}), []);
assert.deepEqual(llliteUses({ 5: { class_type: 'AnimaLLLiteApply_sdscripts', inputs: { lllite_name: 'pose.safetensors' } } }), [], 'no model line');
assert.deepEqual(llliteUses({ 1: output[1], 34: { class_type: 'KSampler', inputs: { model: ['1', 0] } } }), []);
assert.deepEqual(llliteUses(null), []);

// The prompt is only read for a canvas that has such a node, in a subgraph too.
assert.equal(usesLllite({ _nodes: [{ type: 'KSampler' }] }), false);
assert.equal(usesLllite({ _nodes: [{ type: 'KSampler' }, { type: 'AnimaLLLiteApply_sdscripts' }] }), true);
assert.equal(usesLllite({ _nodes: [{ type: 'group', subgraph: { _nodes: [{ type: 'AnimaLLLiteApply_sdscripts' }] } }] }), true);
assert.equal(usesLllite(null), false);

// The AI hears which nodes, the two counts, both ways out, and that a model the user named is theirs to change.
const words = llliteWords({ node: '33', loader: '30', model: 'second.safetensors', lllite: 'animaTileRepair_v20.safetensors', blocks: 40, made_for: 28 });
for (const part of ['Nothing was run', 'node #33', 'loader #30', 'second.safetensors', '28 blocks', 'has 40', 'set_model', 'remove_nodes', '0.45', 'ask_user']) {
    assert.ok(words.includes(part), part);
}

console.log('lllite_fit: ok');
