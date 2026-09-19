import assert from 'node:assert/strict';
import { fixture } from './ui_fixture.mjs';

const f = fixture();
const catalog = await f.module('ui_materials.js');
const cards = await f.module('ui_material_cards.js');
const detail = await f.module('ui_material_detail.js');
const application = await f.module('ui_material_application.js');

assert.deepEqual(Object.keys(catalog).sort(), [
    'openMaterialLibrary',
    'openSavedMaterial',
    'refreshMaterials',
    'showImageMaterialDetail',
    'showMaterials',
]);
assert.deepEqual(Object.keys(cards).sort(), ['renderMaterialCard']);
assert.equal(typeof detail.showMaterialDetail, 'function');
assert.equal(typeof detail.leaveMaterialDetail, 'function');
assert.equal(typeof application.applyLibraryMaterial, 'function');
assert.equal(typeof application.watchMaterialSelection, 'function');
assert.equal(typeof application.updateMaterialContext, 'function');

const promptMaterial = { kind: 'prompt_text', name: 'Prompt', filename: 'prompt.json' };
assert.equal(detail.isPromptMaterial(promptMaterial), true);
assert.match(detail.materialAssetUrl('a b.json', 'preview image.png'), /a%20b\.json.*preview%20image\.png/);

const card = cards.renderMaterialCard({ materialApplyMode: false }, promptMaterial);
assert.equal(card.classList.contains('anomalous-material-card'), true);
assert.ok(card.querySelector('.anomalous-material-card-preview'));

console.log('Material feature modules: catalog, cards, detail, and application boundaries passed.');
