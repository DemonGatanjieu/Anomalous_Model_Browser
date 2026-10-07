/**
 * Prompt Studio's content (the Prompts page or the drawer beside the canvas, ui_prompt_composer.js):
 * a top bar with the view switch (tags or the whole text), the language tags' meanings are shown
 * in (or none), and on the page "Beside the canvas", in the drawer its dock side, "Back to the
 * window" and Close; the cards on the drawer's outer side (ui_prompt_source_deck.js) and
 * the prompt boxes beside the canvas (ui_prompt_target.js). A clicked card goes into the box of
 * its role; Save on a box keeps its text as a card under My prompts. The view and the meaning
 * language are remembered in this browser.
 */

import { translate as t } from './locales.js';
import { GLOSS_LANGUAGES } from './prompt_gloss.js';
import { promptTitle } from './prompt_composition.js';
import { savePromptCard } from './prompt_material_source.js';
import { anomalousPrompt } from './ui_dialog.js';
import { createPromptSourceDeck } from './ui_prompt_source_deck.js';
import { createPromptTarget } from './ui_prompt_target.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const PREFS_KEY = 'anomalous_prompt_studio_prefs';
const ARROW_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
const ARROW_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';

function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
}

function button(className, label, title, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    if (title) node.title = title;
    node.onclick = onClick;
    return node;
}

function loadPrefs() {
    try {
        const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        // An older switch kept only "Chinese on".
        const lang = saved.glossLang ?? (saved.gloss === true ? 'zh-CN' : '');
        return { view: saved.view === 'text' ? 'text' : 'tags', glossLang: GLOSS_LANGUAGES.some(([code]) => code === lang) ? lang : '' };
    } catch {
        return { view: 'tags', glossLang: '' };
    }
}

function savePrefs(prefs) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* remembered for this visit only */ }
}

/**
 * Fills `drawer` (the page's host or the drawer). `mode`: 'page' (`onDock()` moves it beside the
 * canvas) or 'docked' (`onToggleDockSide()` moves the drawer and returns whether it is now on the
 * left, `onUndock()` brings it back to the page, `onClose()` closes it).
 */
export function createPromptWorkbench(owner, drawer, scope, { mode = 'docked', onClose, onToggleDockSide, onDock, onUndock }) {
    const prefs = loadPrefs();

    const view = el('section', 'anomalous-ps');
    const top = el('header', 'anomalous-ps-top');
    // On the page the browser's header already names it.
    if (mode === 'docked') top.append(el('h3', 'anomalous-ps-title', t('promptStudioTitle')));
    const controls = el('div', 'anomalous-ps-top-controls');

    const viewSwitch = el('div', 'anomalous-ps-switch');
    viewSwitch.setAttribute('role', 'group');
    viewSwitch.title = t('promptStudioViewHint');
    const viewButtons = ['tags', 'text'].map(mode => {
        const item = button('anomalous-ps-switch-btn', t(mode === 'tags' ? 'promptStudioViewTags' : 'promptStudioViewText'), '', () => {
            prefs.view = mode;
            savePrefs(prefs);
            drawSwitches();
            target.render();
        });
        item.dataset.mode = mode;
        return item;
    });
    viewSwitch.append(...viewButtons);
    controls.append(viewSwitch);

    const glossPicker = el('select', 'anomalous-ps-gloss');
    glossPicker.title = t('promptStudioGlossHint');
    glossPicker.setAttribute('aria-label', t('promptStudioGlossHint'));
    glossPicker.append(new Option(t('promptStudioGlossOff'), ''),
        ...GLOSS_LANGUAGES.map(([code, name]) => new Option(t('promptStudioGlossIn', { language: name }), code)));
    glossPicker.onchange = () => {
        prefs.glossLang = glossPicker.value;
        savePrefs(prefs);
        drawSwitches();
        target.render();
    };
    controls.append(glossPicker);

    if (mode === 'page') {
        controls.append(button('anomalous-ps-mini', t('promptStudioDock'), t('promptStudioDockHint'), onDock));
    } else {
        const dock = button('anomalous-ps-icon', '', '', () => {
            onToggleDockSide();
            drawDock();
        });
        const drawDock = () => {
            const left = drawer.classList.contains('is-dock-left');
            dock.innerHTML = left ? ARROW_RIGHT : ARROW_LEFT;
            dock.title = t(left ? 'promptStudioDockRight' : 'promptStudioDockLeft');
        };
        drawDock();
        controls.append(dock, button('anomalous-ps-mini', t('promptStudioUndock'), t('promptStudioUndockHint'), onUndock),
            button('anomalous-ps-icon anomalous-ps-close', '✕', t('close'), onClose));
    }
    top.append(controls);

    function drawSwitches() {
        for (const item of viewButtons) item.classList.toggle('is-active', item.dataset.mode === prefs.view);
        glossPicker.value = prefs.glossLang;
        glossPicker.classList.toggle('is-active', Boolean(prefs.glossLang));
    }
    drawSwitches();

    const grid = el('div', 'anomalous-ps-grid');
    view.append(top, grid);
    drawer.append(view);

    async function save(content, role) {
        const name = String(await anomalousPrompt(t('promptStudioSaveName'), promptTitle(content), t('promptStudioSave')) || '').trim();
        if (!name || scope.signal.aborted) return;
        try {
            const result = await savePromptCard({ name, content, role });
            showWorkbenchToast(result.status === 'duplicate' ? t('promptStudioSavedBefore', { name: result.name }) : t('promptStudioSaved', { name }));
            if (!scope.signal.aborted) void deck.sync();
        } catch {
            showWorkbenchToast(t('promptStudioSaveFailed'));
        }
    }

    const deck = createPromptSourceDeck(grid, drawer, scope, card => target.addCard(card));
    const target = createPromptTarget(grid, { owner, drawer, scope, prefs, onSave: save });
}