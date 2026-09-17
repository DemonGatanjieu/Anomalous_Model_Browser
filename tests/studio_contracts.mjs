import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { materialPromptText, loadMaterialPrompts } from '../web/modules/material_prompt_data.js';
import { composePromptPlan, joinPromptText, categorizePromptSnippet, smartSortPromptBlocks, assemblePromptBlocks, planToWorkbenchDraft, workbenchDraftToSavedPlan } from '../web/modules/prompt_composition.js';
import { translate } from '../web/modules/locales.js';

assert.deepEqual(materialPromptText({ data: { kind: 'prompt_text', note: { promptEn: ' exact ', promptZh: 'translation' } } }), { positive: ' exact ', negative: '' });
assert.deepEqual(materialPromptText({ data: { kind: 'prompt_plan', plan: { parts: [{ positive: 'base', negative: 'bad' }, { positive: 'skip', enabled: false }], positive: 'scene' } } }), { positive: 'base\nscene', negative: 'bad' });
assert.deepEqual(materialPromptText({ data: { kind: 'image_node_selection' }, prompt_groups: { positive: ['yes'], negative: ['no'] }, node_blocks: [{ type: 'CheckpointLoaderSimple', widgets_values: ['not-prompt'] }] }), { positive: 'yes', negative: 'no' });
assert.deepEqual(materialPromptText({ data: {}, node_blocks: [{ widgets_values: ['unknown role'] }] }), { positive: '', negative: '' });
let lastUrl;
globalThis.fetch = async url => { lastUrl = url; return { ok: true, json: async () => ({ status: 'success', data: { kind: 'prompt_note_bundle', note: { promptEn: 'real detail' } } }) }; };
assert.equal((await loadMaterialPrompts('note.json')).positive, 'real detail'); assert.ok(lastUrl.includes('include_workflow=0'));

class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.value = ''; this.attrs = {}; this.className = ''; this.classList = { add() {}, remove() {}, toggle() {} }; this.dataset = {}; }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    append(...children) { children.forEach(c => this.appendChild(c)); }
    replaceChildren() { this.children.forEach(c => c.parent = null); this.children = []; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(key, fn) { (this.listeners ||= {})[key] = fn; }
    focus() {}
    get isConnected() { return this.tagName === 'body' || !!this.parent?.isConnected; }
}
const document = { body: new Element('body'), createElement: tag => new Element(tag), addEventListener: (key, fn) => events[key] = fn };
const text = (parent, tag, value, cls = '') => { const el = document.createElement(tag); el.textContent = value; el.className = cls; parent.appendChild(el); return el; };
const all = parent => [parent, ...parent.children.flatMap(all)];
const events = {};
let sent;
const context = vm.createContext({ console, document, app: {}, translate, t: translate, text, appendText: text, composePromptPlan, joinPromptText,
    categorizePromptSnippet, smartSortPromptBlocks, assemblePromptBlocks, planToWorkbenchDraft, workbenchDraftToSavedPlan,
    window: { addEventListener: (key, fn) => events[key] = fn, removeEventListener: (key, fn) => { if (events[key] === fn) delete events[key]; } },
    selectedMaterialNode: () => null, promptWidgetTargets: () => [], bindMaterialDrag() {},
    anomalousConfirm: async () => true, anomalousAlert: async msg => { throw new Error(msg); }, showMaterialSaved() {},
    jsonResponse: response => response.json(), loadMaterialPrompts: async () => ({ positive: 'imported', negative: '' }),
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
        sent = [url, options];
        return { ok: true, json: async () => url.includes('save_prompt_plan') ? { status: 'success' } : { status: 'success', materials: [{ filename: 'p.json', name: 'Real prompt' }], total: 49, page: 1, pages: 2 } };
    },
});
async function moduleFor(file, extra) {
    const source = fs.readFileSync(`web/modules/${file}`, 'utf8').replace(/^import[\s\S]*?;\s*/gm, '');
    const mod = new vm.SourceTextModule(source + `\nexport { ${extra} };`, {
        context,
        identifier: `file:///${process.cwd().replace(/\\/g, '/')}/web/modules/${file}`,
        initializeImportMeta(meta, module) { meta.url = module.identifier; }
    }); await mod.link(() => { throw new Error('unexpected import'); }); await mod.evaluate(); return mod.namespace;
}
const recipeCatalog = await moduleFor('ui_recipe_catalog.js', '');
assert.equal(recipeCatalog.recipeMatchesFilter({ name: 'cat', workflow_scope: 'partial', tags: ['A'] }, 'cat', new Set(['a']), 'complete'), false);
assert.equal(recipeCatalog.recipeMatchesFilter({ name: 'cat', workflow_scope: 'partial', tags: ['A'] }, 'cat', new Set(['a']), 'partial'), true);
assert.equal(recipeCatalog.recipeMatchesFilter({ name: 'old' }, '', new Set(), 'complete'), true);
const recipeOwner = { recipeTagSelect: new Element('select'), recipeSelectedTags: new Set(['B']) };
recipeCatalog.updateRecipeFilterControls(recipeOwner, [{ data: { tags: ['A', 'B'] } }]);
assert.equal(recipeOwner.recipeTagSelect.children.length, 3); assert.equal(recipeOwner.recipeTagSelect.value, 'B');
assert.equal(recipeCatalog.getRecipeReadiness({ params: { model_references: [{ identity: { status: 'verified' }, currentAvailability: 'missing' }] } }).status, 'missing');
assert.equal(recipeCatalog.getRecipeReadiness({ params: { model_references: [{ identity: { status: 'verified' } }] } }).status, 'warning');

const drags = await moduleFor('material_drag.js', '');
const graph = { getNodeOnPos: () => null };
const surface = new Element('canvas'); surface.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100 });
context.app.graph = graph; context.app.canvas = { graph, canvas: surface, convertEventToCanvasOffset: () => [50, 50] };
const source = new Element('article'); let drops = 0;
drags.bindMaterialDrag(source, {}, { payload: () => ({}), dropOnCanvas: () => { drops++; } });
const event = target => ({ target, clientX: 50, clientY: 50, dataTransfer: { setData() {} }, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
source.listeners.dragstart(event(source)); await events.drop(event(new Element('button'))); assert.equal(drops, 0);
source.listeners.dragstart(event(source)); context.app.graph = {}; await events.drop(event(surface)); assert.equal(drops, 0); context.app.graph = graph;
source.listeners.dragstart(event(source)); await events.drop(event(surface)); assert.equal(drops, 1); assert.equal(events.drop, undefined);
console.log('studio contracts: recipe scope/tags/readiness, prompt detail shapes, active material drag cleanup passed');
