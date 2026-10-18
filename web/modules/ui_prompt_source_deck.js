/**
 * Prompt Studio's cards: three common ones and the prompts you saved (prompt_material_source.js),
 * with search and a small form for a new card. A card is clicked to open it as a reference
 * (ui_prompt_reference.js, tags taken one by one), added whole from its preview
 * (ui_prompt_card_popover.js) into the prompt box of its role, dragged onto a box, or
 * dragged out onto the canvas (prompt_card_drag.js); a saved one is renamed or deleted from its
 * preview. The saved list is checked again every 30 seconds and when the window comes back.
 * A card is drawn as a notebook page: its role on the bound spine, its title, its first tags;
 * the one open as the reference wears a ribbon (`setOpen`).
 */

import { translate as t } from './locales.js';
import { bindPromptCardDrag } from './prompt_card_drag.js';
import { PROMPT_PRESETS, promptTitle } from './prompt_composition.js';
import { promptTagsOf, tagWeight } from './prompt_tags.js';
import { loadPromptSourceCards, savePromptCard } from './prompt_material_source.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { jsonResponse } from './ui_dom.js';
import { createCardPopover } from './ui_prompt_card_popover.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

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

const SHOWN_TAGS = 8; // first tags on a card; two ruled lines show what fits, the head counts them all

/** Fills `parent`; `onPick(card)` takes a clicked card, `onAdd(card)` one added whole from its preview.
 * Returns { sync(), setOpen(id) } (the card open as the reference, or null). */
export function createPromptSourceDeck(parent, drawer, scope, { onPick, onAdd }) {
    const presets = PROMPT_PRESETS.map(card => ({ ...card, title: t(card.titleKey) }));
    let saved = [];
    let keyword = '';
    let openId = null;
    const popover = createCardPopover({
        drawer,
        scope,
        onAdd,
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
        const role = card.role === 'negative' ? 'negative' : 'positive';
        const item = el('div', `anomalous-ps-card is-${role}`);
        item.classList.toggle('is-open', card.id === openId);
        item.dataset.cardId = card.id;
        const tags = promptTagsOf(card.content).map(tag => tagWeight(tag).core.trim()).filter(Boolean);
        const head = el('div', 'anomalous-ps-card-head');
        head.append(el('span', 'anomalous-ps-card-title', card.title),
            el('span', 'anomalous-ps-card-count', t('promptDeckTagCount', { count: tags.length })),
            el('span', 'anomalous-ps-card-role', t(role === 'negative' ? 'promptDeckRoleNegative' : 'promptDeckRolePositive')));
        const words = el('div', 'anomalous-ps-card-words');
        words.append(...tags.slice(0, SHOWN_TAGS).map(tag => el('span', 'anomalous-ps-card-word', tag)));
        item.append(head, words);
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
        const head = el('div', 'anomalous-ps-cards-head');
        head.append(el('span', 'anomalous-ps-cards-tab', title), el('span', 'anomalous-ps-cards-count', String(cards.length)));
        list.append(head);
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

    function setOpen(id) {
        openId = id;
        for (const item of list.querySelectorAll('.anomalous-ps-card')) item.classList.toggle('is-open', item.dataset.cardId === id);
    }

    renderList();
    void sync();
    return { sync, setOpen };
}