/**
 * Prompt Studio's cards: three common ones and the prompts you saved (prompt_material_source.js),
 * with search and a small form for a new card. A card is clicked (or added from its preview,
 * ui_prompt_card_popover.js) to go into the prompt box of its role, dragged onto a box, or
 * dragged out onto the canvas (prompt_card_drag.js); a saved one is renamed or deleted from its
 * preview. The saved list is checked again every 30 seconds and when the window comes back.
 */

import { translate as t } from './locales.js';
import { bindPromptCardDrag } from './prompt_card_drag.js';
import { promptTitle } from './prompt_composition.js';
import { loadPromptSourceCards, savePromptCard } from './prompt_material_source.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { jsonResponse } from './ui_dom.js';
import { createCardPopover } from './ui_prompt_card_popover.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const PRESET_CARDS = [
    { id: 'preset_quality', titleKey: 'promptPresetQuality', role: 'positive', content: 'masterpiece, best quality, highly detailed' },
    { id: 'preset_negative', titleKey: 'promptPresetNegative', role: 'negative', content: 'worst quality, low quality, lowres, blurry, jpeg artifacts, watermark, text' },
    { id: 'preset_anatomy', titleKey: 'promptPresetAnatomy', role: 'negative', content: 'bad anatomy, bad hands, extra fingers, missing fingers, deformed' },
];
const SYNC_MS = 30000;

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

/** Fills `parent`; `onPick(card)` takes a clicked card. Returns { sync() }. */
export function createPromptSourceDeck(parent, drawer, scope, onPick) {
    const presets = PRESET_CARDS.map(card => ({ ...card, title: t(card.titleKey) }));
    let saved = [];
    let keyword = '';
    const popover = createCardPopover({
        drawer,
        scope,
        onAdd: card => onPick(card),
        onRename: card => void rename(card),
        onDelete: card => void remove(card),
    });

    const panel = el('section', 'anomalous-ps-deck');
    const top = el('div', 'anomalous-ps-deck-top');
    const search = el('input', 'anomalous-ps-search');
    search.type = 'search';
    search.placeholder = t('promptDeckSearch');
    search.oninput = () => {
        keyword = search.value.trim().toLowerCase();
        renderList();
    };
    top.append(search, button('anomalous-ps-icon', '＋', t('promptDeckNew'), () => toggleForm()));
    const form = el('form', 'anomalous-ps-new');
    form.hidden = true;
    const list = el('div', 'anomalous-ps-cards');
    const status = el('div', 'anomalous-ps-sync');
    status.setAttribute('role', 'status');
    panel.append(top, form, list, status);
    parent.append(panel);

    // Blank space of the list lets the preview go.
    list.addEventListener('pointermove', (event) => {
        if (event.target === list) popover.leave(event, true);
    }, { passive: true });
    list.addEventListener('pointerdown', (event) => {
        if (event.target === list) popover.hide(true);
    });
    list.onscroll = () => popover.hide();

    function toggleForm(open = form.hidden) {
        form.hidden = !open;
        form.replaceChildren();
        if (!open) return;
        const name = el('input', 'anomalous-ps-input');
        name.placeholder = t('promptDeckNewName');
        name.maxLength = 120;
        const content = el('textarea', 'anomalous-ps-input');
        content.placeholder = t('promptDeckNewText');
        content.rows = 3;
        const roles = el('div', 'anomalous-ps-new-roles');
        for (const role of ['positive', 'negative']) {
            const option = el('label', `anomalous-ps-new-role is-${role}`);
            const radio = el('input');
            radio.type = 'radio';
            radio.name = 'anomalous-ps-new-role';
            radio.value = role;
            radio.checked = role === 'positive';
            option.append(radio, el('span', '', t(role === 'negative' ? 'recipePromptRoleNegative' : 'recipePromptRolePositive')));
            roles.append(option);
        }
        const submit = el('button', 'anomalous-ps-mini is-accent', t('promptStudioSave'));
        submit.type = 'submit';
        const row = el('div', 'anomalous-ps-new-row');
        row.append(roles, submit, button('anomalous-ps-mini', t('dialogCancel'), '', () => toggleForm(false)));
        form.append(name, content, row);
        form.onsubmit = async (event) => {
            event.preventDefault();
            const text = content.value.trim();
            if (!text) { content.focus(); return; }
            const role = form.querySelector('input[type="radio"]:checked')?.value || 'positive';
            const title = name.value.trim() || promptTitle(text) || text.slice(0, 40);
            submit.disabled = true;
            try {
                const result = await savePromptCard({ name: title, content: text, role });
                showWorkbenchToast(result.status === 'duplicate' ? t('promptStudioSavedBefore', { name: result.name }) : t('promptStudioSaved', { name: title }));
                if (scope.signal.aborted) return;
                toggleForm(false);
                void sync();
            } catch {
                showWorkbenchToast(t('promptStudioSaveFailed'));
                submit.disabled = false;
            }
        };
        name.focus();
    }

    async function rename(card) {
        const name = String(await anomalousPrompt(t('promptCardRenameAsk'), card.title, t('promptCardRename')) || '').trim();
        if (!name || name === card.title) return;
        try {
            const detail = await jsonResponse(await fetch(`/anomalous/material_full?include_workflow=0&filename=${encodeURIComponent(card.filename)}`), 'read prompt');
            const response = await fetch('/anomalous/update_material', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: card.filename, name, tags: detail.data?.tags || [] }),
            });
            await jsonResponse(response, 'rename prompt');
            await sync();
        } catch {
            await anomalousAlert(t('promptCardRenameFailed'));
        }
    }

    async function remove(card) {
        if (!await anomalousConfirm(t('promptCardDeleteConfirm', { name: card.title }), t('promptCardDelete'), { okLabel: t('promptCardDelete') })) return;
        try {
            const response = await fetch('/anomalous/delete_material', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: card.filename }),
            });
            await jsonResponse(response, 'delete prompt');
            await sync();
        } catch {
            await anomalousAlert(t('promptCardDeleteFailed'));
        }
    }

    function cardElement(card) {
        const item = el('div', `anomalous-ps-card is-${card.role}`);
        item.append(el('span', 'anomalous-ps-card-title', card.title), el('span', 'anomalous-ps-card-text', card.content));
        item.onmouseenter = event => popover.hover(card, item, event);
        item.onmouseleave = event => popover.leave(event);
        // Onto a prompt box in the studio (the card itself), or out onto the canvas (prompt_card_drag.js).
        item.ondragstart = (event) => {
            popover.hide(true);
            event.dataTransfer.setData('application/json', JSON.stringify({ title: card.title, content: card.content, role: card.role }));
            event.dataTransfer.setData('text/plain', card.content);
        };
        bindPromptCardDrag(item, card, drawer);
        item.onclick = () => {
            popover.hide(true);
            onPick(card);
        };
        return item;
    }

    function group(title, cards, empty) {
        if (!cards.length && !empty) return;
        list.append(el('div', 'anomalous-ps-cards-head', title));
        if (cards.length) list.append(...cards.map(cardElement));
        else list.append(el('div', 'anomalous-ps-cards-empty', empty));
    }

    function renderList() {
        popover.hide(true);
        list.replaceChildren();
        const matches = card => !keyword || card.title.toLowerCase().includes(keyword) || card.content.toLowerCase().includes(keyword);
        group(t('promptDeckPresets'), presets.filter(matches));
        group(t('promptDeckSaved'), saved.filter(matches), t(keyword ? 'promptDeckNoMatch' : 'promptDeckSavedEmpty'));
    }

    let controller = null;
    let timer = null;
    scope.onDispose(() => {
        clearTimeout(timer);
        controller?.abort();
    });
    function schedule() {
        clearTimeout(timer);
        if (scope.signal.aborted) return;
        timer = setTimeout(() => (document.hidden ? schedule() : void sync()), SYNC_MS);
    }
    async function sync() {
        if (scope.signal.aborted) return;
        clearTimeout(timer);
        controller?.abort();
        const mine = new AbortController();
        controller = mine;
        try {
            const cards = await loadPromptSourceCards(mine.signal);
            if (scope.signal.aborted || mine.signal.aborted) return;
            const changed = JSON.stringify(cards) !== JSON.stringify(saved);
            saved = cards;
            status.textContent = '';
            if (changed) renderList();
        } catch {
            if (!scope.signal.aborted && !mine.signal.aborted) status.textContent = t('promptLibrarySyncFailed');
        } finally {
            if (controller === mine) {
                controller = null;
                schedule();
            }
        }
    }
    scope.listen(window, 'focus', () => { void sync(); });
    scope.listen(document, 'visibilitychange', () => {
        if (!document.hidden) void sync();
    });

    renderList();
    void sync();
    return { sync };
}