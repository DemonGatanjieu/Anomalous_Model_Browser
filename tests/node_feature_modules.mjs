import assert from 'node:assert/strict';
import { fixture, Element } from './ui_fixture.mjs';

const f = fixture();
const assistant = await f.module('ui_node_assistant.js');
const picker = await f.module('ui_node_model_picker.js');
const presets = await f.module('ui_node_presets.js');

const assistantOwner = {
    assistantPanel: new Element('div'),
    diagnoseNode() {},
};
assistant.initAssistantPanel.call(assistantOwner);
assert.equal(assistantOwner.assistantPanelInitialized, true);
assert.equal(assistantOwner.assistantPanel.children.length, 2);
assert.equal(typeof assistant.renderAssistantModelCard, 'function');
assert.equal(typeof assistant._loadAssistantHistory, 'function');

const combo = { type: 'combo', value: 'old.safetensors', options: { values: ['old.safetensors', 'new.safetensors', 'new.safetensors', 7] } };
const node = { widgets: [combo], widgets_values: ['old.safetensors'] };
assert.deepEqual([...picker.getNativeWidgetValues(node, combo)], ['old.safetensors', 'new.safetensors']);
assert.equal(picker.findModelComboWidget(node), combo);
picker.setWidgetValue(node, combo, 'new.safetensors');
assert.equal(combo.value, 'new.safetensors');
assert.equal(node.widgets_values[0], 'new.safetensors');

assert.equal(typeof presets.applyLocalNodeParameters, 'function');
assert.equal(typeof presets.renderParameterPresets, 'function');

console.log('Node feature modules: assistant lifecycle, model combo helpers, and preset exports passed.');
