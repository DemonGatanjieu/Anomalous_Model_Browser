/**
 * The preview beside a Prompt Studio library card (ui_prompt_source_deck.js): the card's
 * category, role and full text, with Copy, Pin (keeps it open), Add to the board, and for
 * a saved prompt Rename and Delete. It opens on hover and stays while the pointer is on the
 * card, the preview or the corridor between them; the deck's view scope releases it.
 */

import { translate as t } from './locales.js';
import { CATEGORY_META } from './prompt_studio_data.js';

const OPEN_DELAY = 100;
const HIDE_DELAY = 200;
const HIDE_FAST = 90;
const WIDTH = 320; // keep in step with .anomalous-card-preview-popover

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, title, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.title = title;
    node.onclick = (event) => {
        event.stopPropagation();
        onClick();
    };
    return node;
}

const within = (rect, x, y, pad) => x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;

/**
 * `drawer`: the studio drawer (its dock side places the preview); `scope`: the deck's view
 * scope; `onAdd(card)`, `onRename(card)`, `onDelete(card)`: the preview's actions.
 * Returns { hover(card, anchor), leave(), hide(force), isPinned() }.
 */
export function createCardPopover({ drawer, scope, onAdd, onRename, onDelete }) {
    let popover = null;
    let anchor = null;
    let pinned = false;
    let openTimer = null;
    let hideTimer = null;
    let pointer = { x: 0, y: 0 };

    const dockLeft = () => drawer?.classList.contains('is-dock-left') ?? true;

    /** On the card, on the preview, or crossing the gap between them. */
    function inSafeZone(x, y) {
        if (!popover?.isConnected || !anchor?.isConnected) return false;
        const pop = popover.getBoundingClientRect();
        const card = anchor.getBoundingClientRect();
        if (within(card, x, y, 4) || within(pop, x, y, 6)) return true;
        const [left, right] = dockLeft() ? [card.right - 6, pop.left + 6] : [pop.right - 6, card.left + 6];
        const top = Math.min(card.top, pop.top) - 10;
        const bottom = Math.max(card.bottom, pop.bottom) + 10;
        return x >= left && x <= right && y >= top && y <= bottom;
    }

    function hide(force = false) {
        if (pinned && !force) return;
        clearTimeout(hideTimer);
        clearTimeout(openTimer);
        anchor?.classList.remove('is-preview-active');
        anchor = null;
        popover?.remove();
        popover = null;
        pinned = false;
    }

    function scheduleHide(fast = false) {
        if (pinned) return;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (!inSafeZone(pointer.x, pointer.y)) hide();
        }, fast ? HIDE_FAST : HIDE_DELAY);
    }

    function header(card) {
        const head = el('div', 'anomalous-popover-header');
        const top = el('div', 'anomalous-popover-top');
        const tags = el('div', 'anomalous-popover-tags');
        const meta = CATEGORY_META[card.category] || CATEGORY_META.subject;
        const category = el('span', 'anomalous-popover-cat', window.anomalous_browser_lang === 'zh' ? meta.zh : meta.en);
        Object.assign(category.style, { color: meta.color, background: meta.bg, borderColor: meta.border }); // the category's own colours
        tags.append(category, el('span', `anomalous-popover-role is-${card.role}`, t(card.role === 'negative' ? 'promptCardNegative' : 'promptCardPositive')));

        const actions = el('div', 'anomalous-popover-top-actions');
        const copy = button('anomalous-popover-copy-btn', `📋 ${t('promptCardCopy')}`, t('promptCardCopyHint'), () => {
            navigator.clipboard.writeText(card.content).then(() => {
                copy.textContent = `✅ ${t('promptCardCopied')}`;
                setTimeout(() => { if (copy.isConnected) copy.textContent = `📋 ${t('promptCardCopy')}`; }, 1200);
            });
        });
        const close = button('anomalous-popover-close-btn', '✕', t('promptCardClose'), () => hide(true));
        close.hidden = true;
        const pin = button('anomalous-popover-pin-btn', `📌 ${t('promptCardPin')}`, t('promptCardPinHint'), () => {
            pinned = !pinned;
            popover.classList.toggle('is-pinned', pinned);
            pin.classList.toggle('is-active', pinned);
            pin.textContent = `📌 ${t(pinned ? 'promptCardPinned' : 'promptCardPin')}`;
            close.hidden = !pinned;
        });
        actions.append(copy, pin, close);
        top.append(tags, actions);
        head.append(top, el('div', 'anomalous-popover-title', card.title));
        if (card.sourceKind === 'material') head.append(el('div', 'anomalous-source-origin', t('promptLibrarySource')));
        return head;
    }

    function footer(card) {
        const foot = el('div', 'anomalous-popover-footer');
        foot.append(el('span', 'anomalous-popover-hint', t('promptCardAddHint')));
        const actions = el('div', 'anomalous-popover-footer-actions');
        if (card.sourceKind === 'material') {
            actions.append(
                button('anomalous-popover-text-btn', t('promptCardRename'), t('promptCardRenameHint'), () => { hide(true); onRename(card); }),
                button('anomalous-popover-text-btn is-danger', t('promptCardDelete'), t('promptCardDeleteHint'), () => { hide(true); onDelete(card); }),
            );
        }
        actions.append(button('anomalous-popover-add-btn', `＋ ${t('promptCardAdd')}`, t('promptCardAddTitle'), () => { onAdd(card); hide(true); }));
        foot.append(actions);
        return foot;
    }

    function show(card, anchorEl) {
        clearTimeout(hideTimer);
        clearTimeout(openTimer);
        if (!anchorEl?.isConnected || pinned) return;
        if (anchor && anchor !== anchorEl) anchor.classList.remove('is-preview-active');
        anchor = anchorEl;
        anchor.classList.add('is-preview-active');
        popover?.remove();
        popover = el('div', 'anomalous-card-preview-popover');
        popover.card = card;
        popover.onmouseenter = (event) => {
            pointer = { x: event.clientX, y: event.clientY };
            clearTimeout(hideTimer);
            clearTimeout(openTimer);
        };
        popover.onmouseleave = (event) => {
            pointer = { x: event.clientX, y: event.clientY };
            scheduleHide();
        };
        const body = el('div', 'anomalous-popover-body');
        body.append(el('pre', 'anomalous-popover-snippet', card.content));
        popover.append(header(card), body, footer(card));
        document.body.append(popover);

        const rect = anchorEl.getBoundingClientRect();
        const height = popover.offsetHeight || 160;
        popover.style.top = `${Math.max(12, Math.min(window.innerHeight - height - 12, rect.top - 6))}px`;
        popover.classList.add(dockLeft() ? 'is-dock-left' : 'is-dock-right');
        popover.style.left = dockLeft() ? `${rect.right + 6}px` : `${Math.max(12, rect.left - WIDTH - 6)}px`;
    }

    scope.listen(window, 'pointermove', (event) => {
        pointer = { x: event.clientX, y: event.clientY };
        if (!popover || pinned) return;
        if (inSafeZone(event.clientX, event.clientY)) clearTimeout(hideTimer);
        else scheduleHide(true);
    }, { passive: true });
    scope.listen(document, 'pointerdown', (event) => {
        if (popover && !popover.contains(event.target) && !anchor?.contains(event.target)) hide(true);
    });
    scope.onDispose(() => hide(true));

    return {
        /** The pointer entered `anchorEl`, the card of `card`. */
        hover(card, anchorEl, event) {
            pointer = { x: event.clientX, y: event.clientY };
            clearTimeout(hideTimer);
            clearTimeout(openTimer);
            if (pinned || popover?.card === card) return;
            openTimer = setTimeout(() => show(card, anchorEl), OPEN_DELAY);
        },
        /** The pointer left a card or blank space of the list. */
        leave(event, fast = false) {
            if (event) pointer = { x: event.clientX, y: event.clientY };
            clearTimeout(openTimer);
            if (popover) scheduleHide(fast);
        },
        hide,
        isPinned: () => pinned,
    };
}
