/**
 * What a message to the AI carries, over its input (ui_ai_message.js; the refs are
 * ui_ai_mention.js's): the pictures as small pictures, each with ✎ to mark it up for the AI
 * (ui_ai_marker.js, sent on its own) and × to leave it out, then what "@" names (models, combos,
 * nodes…) as chips with ×. Nothing shows while nothing is attached.
 */

import { MAX_REF_NOTE, refNote } from './ai_chat_plus.js';
import { translate as t } from './locales.js';
import { icon } from './ui_ai_icons.js';
import { thumbUrl } from './ui_ai_gallery_pick.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function tool(className, name, label, run) {
    const node = el('button', className);
    node.type = 'button';
    node.title = label;
    node.setAttribute('aria-label', label);
    node.append(icon(name, 12));
    node.onclick = (event) => {
        event.stopPropagation();
        run();
    };
    return node;
}

function picture(ref, ctx) {
    const tile = el('div', 'anomalous-ai-tray-picture');
    tile.title = ref.id;
    const img = el('img');
    img.src = thumbUrl(ref.item.image || {});
    img.alt = '';
    img.onerror = () => tile.classList.add('is-gone');
    tile.append(img, tool('anomalous-ai-tray-x', 'close', t('aiTrayRemove'), () => ctx.remove(ref)));
    if (ctx.mark) {
        const mark = el('button', 'anomalous-ai-tray-mark');
        mark.type = 'button';
        mark.title = t('aiTrayMarkHint');
        mark.append(icon('pencil', 11), el('span', '', t('aiTrayMark')));
        mark.onclick = () => ctx.mark(ref);
        tile.append(mark);
    }
    return tile;
}

function chip(ref, ctx) {
    const node = el('span', 'anomalous-ai-mention-chip');
    const note = el('input', 'anomalous-ai-mention-chip-note');
    const hint = t(ctx.privateTask?.() ? 'aiRefNotePrivate' : 'aiRefNote');
    note.type = 'text';
    note.maxLength = MAX_REF_NOTE;
    note.value = refNote(ref.note);
    note.placeholder = hint;
    note.dataset.refKey = `${ref.kind}\0${ref.id}`;
    note.dataset.refLabel = ref.label;
    note.setAttribute('aria-label', `${ref.label}: ${hint}`);
    note.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            ctx.focusField?.();
        }
    });
    note.addEventListener('input', () => { ref.note = refNote(note.value); });
    node.append(ctx.lead(ref.item), el('span', 'anomalous-ai-mention-chip-name', ref.label), note,
        tool('anomalous-ai-mention-chip-x', 'close', t('aiMentionRemove'), () => ctx.remove(ref)));
    return node;
}

/** Updates existing chip note placeholders in place when privacy mode toggles. */
export function syncTrayPrivacy(tray, isPrivate) {
    const hint = t(isPrivate ? 'aiRefNotePrivate' : 'aiRefNote');
    for (const note of tray.querySelectorAll('.anomalous-ai-mention-chip-note')) {
        note.placeholder = hint;
        note.setAttribute('aria-label', `${note.dataset.refLabel || ''}: ${hint}`);
    }
}

/** `refs` into `tray`. `ctx`: {remove(ref), mark(ref) (or none), lead(item), privateTask(), focusField()}. */
export function drawTray(tray, refs, ctx) {
    const pictures = refs.filter(ref => ref.kind === 'pictures');
    const others = refs.filter(ref => ref.kind !== 'pictures');
    tray.hidden = !refs.length;
    tray.replaceChildren(...pictures.map(ref => picture(ref, ctx)), ...others.map(ref => chip(ref, ctx)));
}
