import assert from 'node:assert/strict';
import { fixture } from './ui_fixture.mjs';

const f = fixture();
const catalog = await f.module('ui_notebooks.js');
const editor = await f.module('ui_notebook_editor.js');
const canvas = await f.module('notebook_canvas.js');

assert.deepEqual(Object.keys(catalog).sort(), [
    'deleteCurrentNotebook',
    'refreshNotebooks',
    'saveCurrentNotebook',
    'showNotebooks',
]);
assert.deepEqual(Object.keys(editor).sort(), [
    'fillNotebookGalleries',
    'renderNotebookEditor',
]);
assert.deepEqual(Object.keys(canvas).sort(), ['sendNotebookToCanvas']);

console.log('Notebook feature modules: catalog, editor, and canvas boundaries passed.');
