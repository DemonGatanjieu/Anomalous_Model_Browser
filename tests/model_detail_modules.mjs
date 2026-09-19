import assert from 'node:assert/strict';
import { fixture } from './ui_fixture.mjs';

const f = fixture();
const detail = await f.module('ui_detail.js');
const editor = await f.module('ui_model_editor.js');
const selector = await f.module('ui_model_selector.js');

assert.deepEqual(Object.keys(detail).sort(), ['showDetail']);
assert.deepEqual(Object.keys(editor).sort(), ['showEditModal']);
assert.deepEqual(Object.keys(selector).sort(), [
    '_openAdvancedModelSelector',
    'setWidgetValuePath',
]);

const exactWidget = {
    type: 'combo',
    value: '',
    options: { values: ['folder/model.safetensors'] },
};
selector.setWidgetValuePath({ widgets: [exactWidget] }, 'folder\\model.safetensors');
assert.equal(exactWidget.value, 'folder/model.safetensors');

const fallbackWidget = { type: 'text', value: '' };
selector.setWidgetValuePath({ widgets: [fallbackWidget] }, 'other/model.ckpt');
assert.equal(fallbackWidget.value, 'other/model.ckpt');

console.log('Model detail modules: detail, editor, selector, and widget path behavior passed.');
