import assert from 'node:assert/strict';
import { fixture } from './ui_fixture.mjs';

const f = fixture();
let mockNotebooks = [{ filename: '1.json', name: 'Test Note', data: { baseModel: 'SDXL', loras: [] } }];

f.fetch = async (url) => {
    if (String(url).includes('/anomalous/base_models')) {
        return { ok: true, json: async () => ({ base_models: ['SD 1.5', 'SDXL', 'Flux.1'] }) };
    }
    if (String(url).includes('/anomalous/compatible_models')) {
        return { ok: true, json: async () => ({ models: [] }) };
    }
    if (String(url).includes('/anomalous/notebooks')) {
        return { ok: true, json: async () => ({ notebooks: mockNotebooks }) };
    }
    return { ok: true, json: async () => ({ status: 'success' }) };
};

const notes = await f.module('ui_notebooks.js');

const owner = {
    currentNotebook: null,
    nbListEl: f.document.createElement('div'),
    nbEditor: f.document.createElement('div'),
    saveCurrentNotebook: async () => true,
    deleteCurrentNotebook: async () => {},
    sendNotebookToCanvas: () => {},
    fillNotebookGalleries: () => {},
};
owner.renderNotebookEditor = notes.renderNotebookEditor.bind(owner);
owner.refreshNotebooks = notes.refreshNotebooks.bind(owner);

// 1. Test refreshNotebooks with autoOpenFirst=true
await owner.refreshNotebooks(true);
assert.ok(owner.currentNotebook, 'First notebook should be selected');
assert.equal(owner.currentNotebook.filename, '1.json');
assert.ok(owner.nbEditor.children.length >= 4, 'nbEditor should contain at least 4 main sections');

const fold = owner.nbEditor.querySelector('.anomalous-nb-models-fold');
assert.ok(fold, 'Companion models fold should exist in nbEditor');
assert.equal(fold.open, true, 'Companion models fold should be open by default');

const promptSection = owner.nbEditor.querySelector('.anomalous-nb-prompt-section');
assert.ok(promptSection, 'Prompt section should exist');

// 2. Test refreshNotebooks when list is empty
mockNotebooks = [];
owner.currentNotebook = null;
await owner.refreshNotebooks(false);
assert.ok(owner.nbEditor.textContent.includes('提示词笔记') || owner.nbEditor.textContent.includes('Prompt Notes') || owner.nbEditor.textContent.includes('暂无笔记'), 'Empty state should be displayed when no notebooks exist');

console.log('notebook_render_test: passed successfully');
