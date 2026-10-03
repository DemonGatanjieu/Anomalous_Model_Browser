/**
 * Prompt Studio's content (the drawer around it is ui_prompt_composer.js): a top bar with the
 * view switch (tags or the whole text), the Chinese meanings switch (Chinese interface only),
 * the dock side and Close; the cards on the drawer's outer side (ui_prompt_source_deck.js) and
 * the prompt boxes beside the canvas (ui_prompt_target.js). A clicked card goes into the box of
 * its role; Save on a box keeps its text as a card under My prompts. The two switches are
 * remembered in this browser.
 */

import { resolveLocale, translate as t } from './locales.js';
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
        return { view: saved.view === 'text' ? 'text' : 'tags', gloss: saved.gloss === true };
    } catch {
        return { view: 'tags', gloss: false };
    }
}

function savePrefs(prefs) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* remembered for this visit only */ }
}

/** Fills `drawer`. `onToggleDockSide()` moves the drawer and returns whether it is now on the left. */
export function createPromptWorkbench(owner, drawer, scope, { onClose, onToggleDockSide }) {
    const prefs = loadPrefs();
    const chineseUi = resolveLocale() === 'zh';
    if (!chineseUi) prefs.gloss = false;

    const view = el('section', 'anomalous-ps');
    const top = el('header', 'anomalous-ps-top');
    top.append(el('h3', 'anomalous-ps-title', t('promptStudioTitle')));
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

    const glossButton = button('anomalous-ps-toggle', t('promptStudioGloss'), t('promptStudioGlossHint'), () => {
        prefs.gloss = !prefs.gloss;
        savePrefs(prefs);
        drawSwitches();
        target.render();
    });
    if (chineseUi) controls.append(glossButton);

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
    controls.append(dock, button('anomalous-ps-icon anomalous-ps-close', '✕', t('close'), onClose));
    top.append(controls);

    function drawSwitches() {
        for (const item of viewButtons) item.classList.toggle('is-active', item.dataset.mode === prefs.view);
        glossButton.classList.toggle('is-active', prefs.gloss);
        glossButton.setAttribute('aria-pressed', String(prefs.gloss));
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