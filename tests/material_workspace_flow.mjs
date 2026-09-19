import assert from 'node:assert/strict';
import { fixture, Element, all } from './ui_fixture.mjs';

const f = fixture();
const record = { filename: 'parameters.json', kind: 'image_node_selection', name: 'Parameters', node_types: ['CLIPTextEncode'], selection: { scope: 'nodes' } };
f.fetch = async url => ({ ok: true, json: async () => String(url).includes('material_full')
    ? {
        status: 'success', data: record,
        node_blocks: [2, 3].map(id => ({ node_id: id, type: 'CLIPTextEncode', widgets_values: [`text ${id}`] })),
        prompt_roles: { 2: { role: 'positive', source: 'topology' }, 3: { role: 'negative', source: 'topology' } },
    }
    : { status: 'success', materials: [record], page: 1, pages: 1, total: 1, tags: [] } });
const materials = await f.module('ui_materials.js');
const owner = { nbPanel: new Element('div') };
owner.nbPanel.style.display = 'flex';
f.document.body.appendChild(owner.nbPanel);
for (const key of ['showMaterials', 'refreshMaterials', 'openSavedMaterial', 'openMaterialLibrary']) owner[key] = materials[key].bind(owner);
await owner.openMaterialLibrary();
assert.equal(all(owner.materialContainer).some(el => el.tagName === 'input' && el.type === 'file'), false);
assert.equal(all(owner.materialContainer).some(el => el.tagName === 'button' && /import|export/i.test(el.textContent)), false);
assert.equal(owner.notebookContainer, undefined);
assert.equal(owner.materialApplyMode, true);
assert.equal(new URL(f.requests.at(-1)[0], 'http://test').searchParams.get('node_type'), 'CLIPTextEncode');
assert.deepEqual(f.errors, []);

f.app.canvas.selected_nodes = {};
await owner.openMaterialLibrary();
assert.equal(owner.materialApplyMode, false, 'opening without a selection uses browse mode');
assert.equal(owner.materialTarget, null, 'opening without a selection clears the application target');
assert.equal(new URL(f.requests.at(-1)[0], 'http://test').searchParams.has('node_type'), false);
assert.ok(owner.materialContext.textContent.includes((await f.module('locales.js')).translate('materialSelectOneNode')), 'browse mode explains that selection is optional');
const browseCard = owner.materialList.querySelector('article');
await browseCard.click();
assert.ok(owner.materialDetailView, 'material details open without a selected node');
assert.deepEqual(f.errors, []);

f.app.canvas.selected_nodes = { 1: f.node };
await owner.openMaterialLibrary();

const card = owner.materialList.querySelector('article');
assert.ok(card, 'current material card renders');
await card.click();
assert.equal(f.node.widgets[0].value, 'original', 'opening details must not write to canvas');
assert.ok(owner.materialDetailView);
await card.querySelector('.anomalous-material-card-apply-btn').click();
assert.deepEqual(f.errors, []);
assert.ok(owner.materialBlockDialog);
let choices = owner.materialBlockDialog.querySelectorAll('.anomalous-material-choice-card');
assert.ok(choices[0].textContent.includes('Positive'));
assert.ok(choices[1].textContent.includes('Negative'));
await choices[1].querySelector('button').click();
assert.equal(f.node.widgets[0].value, 'text 3');
await f.button(owner.materialContext, 'Undo').click();
assert.equal(f.node.widgets[0].value, 'original');

f.runTimers();
await card.querySelector('.anomalous-material-card-apply-btn').click();
const dialog = owner.materialBlockDialog;
f.app.canvas.selected_nodes = {};
await dialog.querySelector('.anomalous-material-choice-card').querySelector('button').click();
assert.equal(f.node.widgets[0].value, 'original');
assert.ok(dialog.textContent.includes((await f.module('locales.js')).translate('materialTargetChanged')));
dialog.close();
f.app.canvas.selected_nodes = { 1: f.node };

const notes = await f.module('ui_notebooks.js');
owner.showNotebooks = notes.showNotebooks.bind(owner);
owner.refreshNotebooks = () => {};
await owner.showNotebooks();
assert.equal(owner.materialContainer.style.display, 'none');
assert.ok(owner.notebookContainer);
assert.equal(owner.notebookMaterialsTab, undefined);
await owner.showMaterials();
assert.equal(owner.notebookContainer.style.display, 'none');
assert.equal(owner.materialContainer.style.display, 'flex');
assert.equal(all(owner.materialContainer).some(el => el.className === 'anomalous-nb-section-tabs'), false);
assert.deepEqual(f.errors, []);
console.log('material workspace: current cards, explicit apply, undo, stale selection and notes isolation passed');
