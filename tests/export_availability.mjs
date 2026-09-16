import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { deflateRawSync } from 'node:zlib';
import { fixture, Element, all } from './ui_fixture.mjs';

const f = fixture();
const studio = await f.module('ui_prompt_composer.js');
const owner = {};
await studio.openPromptStudio(owner);
await f.flush();
const workbench = f.document.querySelector('.anomalous-prompt-workbench');
assert.equal(all(workbench).some(el => el.tagName === 'button' && /export|导出/i.test(el.textContent)), false);
owner.sidePromptComposerControl.addBlock({ content: 'cinematic light', role: 'positive' });
await f.button(workbench, '📋').click();
assert.equal(f.clipboard.at(-1), 'cinematic light');
const name = workbench.querySelector('.anomalous-prompt-name-input');
name.value = 'Local combination'; name.oninput();
f.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', material: { filename: 'local.json' } }) });
await f.button(workbench, '💾').click();
const save = f.requests.findLast(([url]) => url.includes('/save_prompt_plan'));
assert.equal(JSON.parse(save[1].body).plan.positive, 'cinematic light');
studio.closePromptStudio(owner);

const recipes = await f.module('ui_recipes.js');
const recipeOwner = { recipeListContainer: new Element('div') };
recipes.renderRecipeList.call(recipeOwner, [{ filename: 'example.json', data: { name: 'Example', params: {} } }]);
const exportButton = all(recipeOwner.recipeListContainer).find(el => el.attrs?.['aria-label'] === 'Recipe package export is temporarily unavailable');
assert.ok(exportButton);
assert.equal(exportButton.disabled, true);
await exportButton.click();
assert.equal(f.requests.some(([url]) => url.includes('/export_recipe_package')), false);
const recipeWorkspace = { nbPanel: new Element('div'), refreshRecipes: async () => {} };
await recipes.showRecipes.call(recipeWorkspace);
const importPackage = all(recipeWorkspace.recipeContainer).find(el => el.attrs?.['aria-label'] === 'Recipe package import is temporarily unavailable');
assert.ok(importPackage);
assert.equal(importPackage.disabled, true);
await importPackage.click();
assert.equal(f.requests.some(([url]) => url.includes('/import_recipe_package')), false);
assert.deepEqual(f.errors, []);
console.log('Transfer availability: prompt export absent; copy/local save work; recipe import/export cannot issue a request.');

// Evaluate the existing share object independently of unrelated host bootstrap.
const main = fs.readFileSync(new URL('../web/main.js', import.meta.url), 'utf8');
const shareStart = main.indexOf('const AMB_WorkflowShare');
assert.ok(shareStart >= 0);
const locales = await f.module('locales.js');
f.window.atob = atob;
f.window.btoa = btoa;
f.document.getElementById = id => all(f.document.body).find(el => el.id === id);
let importedWorkflow;
f.app.loadGraphData = workflow => { importedWorkflow = workflow; };
f.app.graphToPrompt = () => { throw new Error('Disabled export must not read the canvas'); };
vm.runInNewContext(main.slice(shareStart), {
    window: f.window, document: f.document, app: f.app,
    t: locales.createTranslator('en'), setTimeout: () => 0,
    Blob, Response, CompressionStream, DecompressionStream, TextEncoder, TextDecoder,
});
const share = f.window.AMB_WorkflowShare;
const sidebar = fs.readFileSync(new URL('../web/modules/ui_sidebar.js', import.meta.url), 'utf8');
const toolsStart = sidebar.indexOf('const defaultTools = [');
const toolsEnd = sidebar.indexOf('const allTools =', toolsStart);
assert.ok(toolsStart >= 0 && toolsEnd > toolsStart);
const toolboxModal = new Element('div');
const toolboxTools = vm.runInNewContext(`(function() { ${sidebar.slice(toolsStart, toolsEnd)} return defaultTools; }).call({})`, {
    window: f.window, t: locales.createTranslator('en'), toolboxModal,
});
toolboxTools.find(tool => tool.id === 'workflow-transfer').action();
assert.equal(toolboxModal.style.display, 'none');
const exportShare = f.button(f.document.body, 'Export Workflow to Share Code');
assert.ok(exportShare);
assert.equal(exportShare.disabled, false);
await exportShare.click();
assert.ok(f.document.getElementById('amb-export-modal'));
await f.button(f.document.getElementById('amb-export-modal'), 'Close').click();
share.showUnifiedModal();
await f.button(f.document.body, 'Import Workflow from Share Code').click();
const importModal = f.document.getElementById('amb-import-modal');
assert.ok(importModal);
const workflow = { nodes: [], extra: { model_hashes: { example: 'keep-this-hash' } } };
importModal.querySelector('textarea').value = 'AMB0-' + deflateRawSync(JSON.stringify(workflow)).toString('base64');
await f.button(importModal, 'Import & Load').click();
assert.equal(JSON.stringify(importedWorkflow), JSON.stringify(workflow));
for (const skeleton of [false, true]) {
    const code = await share.encodeShareCode(workflow, skeleton);
    const decoded = await share.decodeShareCode(code);
    assert.equal(JSON.stringify(decoded.extra), JSON.stringify(workflow.extra));
}
console.log('Verified share-code tools: export UI enabled; both formats round-trip and import preserves metadata.');
