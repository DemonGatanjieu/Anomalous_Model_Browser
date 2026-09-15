import assert from 'node:assert/strict';
import { fixture, all } from './ui_fixture.mjs';

const f = fixture();
const studio = await f.module('ui_prompt_composer.js');
const translator = await f.module('ui_prompt_translator.js');
const owner = { setTriggerVisible(value) { this.triggerVisible = value; } };
const listeners = () => f.window.listenerCount() + f.document.listenerCount();
const clean = () => {
    assert.equal(listeners(), 0, 'all global listeners must be released');
    assert.equal(f.document.querySelector('.anomalous-prompt-studio-overlay'), null);
    assert.equal(f.document.querySelector('.anomalous-translator-overlay'), null);
    assert.equal(owner.sidePromptComposerControl, null);
    assert.equal(owner.triggerVisible, true);
};

for (let i = 0; i < 3; i++) {
    await studio.openPromptStudio(owner);
    await f.flush();
    assert.equal(f.document.querySelectorAll('.anomalous-source-card-compact').length, 6);
    owner.sidePromptComposerControl.addBlock({ content: 'quality', role: 'positive', category: 'base' });
    assert.equal(owner.promptPlanDraft.plan.positive, 'quality');
    f.window.dispatch('keydown', { key: 'Escape' });
    clean();
    owner.promptPlanDraft = null;
}

await studio.openPromptStudio(owner);
await studio.openPromptStudio(owner);
assert.equal(f.document.querySelectorAll('.anomalous-prompt-studio-overlay').length, 1);
const beforeDrag = listeners();
const handle = f.document.querySelector('.anomalous-studio-resize-handle');
f.document.body.style.cursor = 'crosshair';
handle.onmousedown({ button: 0, clientX: 100, preventDefault() {} });
assert.equal(listeners(), beforeDrag + 2);
f.window.dispatch('mousemove', { clientX: 160 });
assert.equal(f.document.querySelector('.anomalous-prompt-studio-drawer').style.width, '640px');
studio.closePromptStudio(owner);
assert.equal(f.document.body.style.cursor, 'crosshair');
clean();

await studio.openPromptStudio(owner);
owner.sidePromptComposerControl.addBlock({ content: 'quality', role: 'positive' });
await f.button(f.document.body, '⛶').click();
assert.ok(f.document.querySelector('.anomalous-prompt-inspector-overlay'));
f.window.dispatch('keydown', { key: 'Escape' });
assert.equal(f.document.querySelector('.anomalous-prompt-inspector-overlay'), null);
assert.ok(f.document.querySelector('.anomalous-prompt-studio-overlay'), 'first Escape closes only inspector');
f.window.dispatch('keydown', { key: 'Escape' });
clean();

// Full-text edits remain authoritative after recomposition, save and reopening.
await studio.openPromptStudio(owner);
owner.sidePromptComposerControl.addBlock({ content: 'scene', role: 'positive' });
await f.button(f.document.body, 'Negative (').click();
owner.sidePromptComposerControl.addBlock({ content: 'bad anatomy', role: 'negative' });
await f.button(f.document.body, 'Positive (').click();
await f.button(f.document.body, '⛶').click();
const inspectorText = f.document.querySelector('.anomalous-inspector-textarea');
inspectorText.value = 'edited whole prompt';
inspectorText.oninput();
f.window.dispatch('keydown', { key: 'Escape' });
await f.button(f.document.body, '📋').click();
assert.equal(f.clipboard.at(-1), 'edited whole prompt');
assert.equal(owner.promptPlanDraft.plan.negative, 'bad anatomy');
const name = f.document.querySelector('.anomalous-prompt-name-input');
name.value = 'round trip'; name.oninput();
f.fetch = async url => ({ ok: true, json: async () => String(url).includes('/materials?')
    ? { status: 'success', materials: [], pages: 1 }
    : { status: 'success', material: { filename: 'saved.json' } } });
await f.button(f.document.body, '💾').click();
const savedRequest = f.requests.findLast(([url]) => url.includes('save_prompt_plan'));
const saved = JSON.parse(savedRequest[1].body);
assert.equal(saved.name, 'round trip');
assert.equal(saved.plan.positive, 'edited whole prompt');
assert.equal(saved.plan.negative, 'bad anatomy');
f.window.dispatch('focus');
await f.flush();
assert.ok(f.requests.at(-1)[0].includes('category=prompts'));
studio.closePromptStudio(owner);
await studio.openPromptStudio(owner);
assert.equal(owner.promptPlanDraft.plan.positive, 'edited whole prompt');
await f.button(f.document.body, '✨').click();
assert.equal(owner.promptPlanDraft.plan.positive, '');
assert.equal(owner.promptPlanDraft.plan.negative, '');
studio.closePromptStudio(owner);
clean();

// Closing while a saved plan is loading must not replace the draft or reopen.
const keptDraft = owner.promptPlanDraft;
let releasePlan;
f.fetch = async () => new Promise(resolve => { releasePlan = () => resolve({ ok: true, json: async () => ({ status: 'success', data: { kind: 'prompt_plan', name: 'late', plan: { positive: 'late text' } } }) }); });
const loadingPlan = studio.showPromptComposer(owner, { filename: 'late.json' });
await f.flush();
studio.closePromptStudio(owner);
releasePlan(); await loadingPlan;
assert.equal(owner.promptPlanDraft, keptDraft);
clean();

for (const path of ['button', 'escape', 'backdrop']) {
    translator.openPromptTranslator(owner);
    translator.openPromptTranslator(owner);
    assert.equal(f.document.querySelectorAll('.anomalous-translator-overlay').length, 1);
    const overlay = f.document.querySelector('.anomalous-translator-overlay');
    if (path === 'button') f.document.querySelector('.anomalous-translator-close').click();
    if (path === 'escape') f.document.dispatch('keydown', { key: 'Escape' });
    if (path === 'backdrop') { overlay.classList.remove('is-sidebar'); overlay.onclick({ target: overlay }); }
    clean();
}

// A delayed translation may not write into a new selection, overwrite an edited
// widget, or write after the translator closes. Kana must use the EN service too.
for (const change of ['selection', 'widget', 'close', 'none']) {
    translator.openPromptTranslator(owner);
    const target = f.document.querySelector('.is-target');
    target.value = 'かわいい';
    let release;
    f.fetch = async (url, options) => {
        assert.equal(JSON.parse(options.body).target_lang, 'en');
        return new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ translated: 'cute' }) }); });
    };
    const pending = f.button(f.document.body, 'Translate to EN & Write').click();
    await f.flush();
    if (change === 'selection') f.app.canvas.selected_nodes = {};
    if (change === 'widget') f.node.widgets[0].value = 'edited';
    if (change === 'close') f.document.querySelector('.anomalous-translator-close').click();
    release?.(); await pending;
    assert.equal(f.node.widgets[0].value, change === 'widget' ? 'edited' : change === 'none' ? 'cute' : 'original');
    f.document.querySelector('.anomalous-translator-close')?.click();
    f.app.canvas.selected_nodes = { 1: f.node };
    f.node.widgets[0].value = 'original';
    (await f.module('translation_service.js')).clearTranslationCache();
    clean();
}
assert.deepEqual(f.errors, []);
console.log('prompt UI: reopen/close, Escape nesting, resize cleanup, real card insertion and delayed node writes passed');
