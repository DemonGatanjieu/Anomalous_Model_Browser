/**
 * A choice shown outside its picker window as a card, its cover, name and one line of what it is: the models of
 * "Start from → Build a new one" (ui_ai_start_from.js, a badge for who draws first), the private card's LoRAs
 * (ui_ai_private_sheet.js, an × to drop one) and the chosen saved workflow (ui_workflow_pick.js workflowChoice).
 * A card that opens its picker says so on the pointer; a dashed card adds one.
 */

import { translate as t } from './locales.js';
import { icon } from './ui_ai_icons.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/**
 * Builds `{ node, fill({ cover, name, meta, badge }) }`: with `onOpen()` the card is a button that opens the
 * picker, else `onDrop()` gives it an × (`dropLabel` says which). `cover` is an element (a picture, a stand-in).
 */
export function pickedCard({ onOpen = null, onDrop = null, dropLabel = '' } = {}) {
    const node = el(onOpen ? 'button' : 'div', `anomalous-picked-card${onOpen ? ' is-open' : ''}`);
    let drop = null;
    if (onOpen) {
        node.type = 'button';
        node.onclick = onOpen;
    } else if (onDrop) {
        drop = el('button', 'anomalous-picked-drop');
        drop.type = 'button';
        drop.title = dropLabel;
        drop.setAttribute('aria-label', dropLabel);
        drop.append(icon('close', 12));
        drop.onclick = onDrop;
    }
    const fill = ({ cover, name, meta = '', badge = '' }) => {
        const top = el('span', 'anomalous-picked-cover');
        top.append(cover);
        if (badge) top.append(el('span', 'anomalous-picked-badge', badge));
        if (onOpen) top.append(el('span', 'anomalous-picked-change', t('aiPickedChange')));
        const words = el('span', 'anomalous-picked-words');
        words.append(el('span', 'anomalous-picked-name', name));
        if (meta) words.append(el('span', 'anomalous-picked-meta', meta));
        node.replaceChildren(top, words, ...(drop ? [drop] : []));
        node.title = [name, meta].filter(Boolean).join(' · ');
    };
    return { node, fill };
}

/** The dashed card that adds one: a plus over `label` (which `say(label)` changes later); `onOpen()` on a press. */
export function addCard(label, onOpen) {
    const node = el('button', 'anomalous-picked-card is-add');
    node.type = 'button';
    const words = el('span', 'anomalous-picked-add-label', label);
    node.append(icon('plus', 20), words);
    node.onclick = onOpen;
    return { node, say: (text) => { words.textContent = text; } };
}
