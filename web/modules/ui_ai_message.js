/**
 * The AI workbench's message box (ui_ai_workbench.js): under a task's timeline, where the user
 * writes to the AI on that task, with "@" to point at things and "/" for commands
 * (ui_ai_mention.js), and a picture button for pictures from the gallery (ui_ai_gallery_pick.js).
 * The text and what its "@" point at go to `onSend(text, refs)`; the AI gets
 * them the next time it asks (get_answers), which the hint says, and says to ask in the AI app
 * once the task ended. Made once per task, so half-typed text survives the task's redraws.
 */

import { translate as t } from './locales.js';
import { mentions } from './ui_ai_mention.js';
import { galleryPicker } from './ui_ai_gallery_pick.js';
import { iconButton } from './ui_ai_icons.js';

const MAX_REFS = 12; // api/ai_message_refs.py
const MAX_PICTURES = 8; // a message's pictures, as ai_pictures.py hands them

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** The box; `source`: {task(), commands()} for "@" and "/". */
export function messageBox(onSend, source) {
    const box = el('div', 'anomalous-ai-message');
    const line = el('div', 'anomalous-ai-message-line');
    const field = el('input', 'anomalous-ai-message-input');
    field.type = 'text';
    field.maxLength = 2000;
    field.placeholder = t('aiMessagePlaceholder');
    const note = el('div', 'anomalous-ai-message-hint');
    const send = el('button', 'anomalous-ai-panel-send', t('aiMessageSend'));
    send.type = 'button';
    let at = null; // "@" and "/" (made once the box is in place)
    send.onclick = async () => {
        const text = field.value.trim();
        if (!text) return;
        send.disabled = true;
        try {
            await onSend(text, at?.refs(text) || []);
            field.value = '';
            at?.clear();
        } catch (error) {
            note.textContent = error.message;
        } finally {
            send.disabled = false;
        }
    };
    field.addEventListener('keydown', (event) => {
        event.stopPropagation(); // typing here is not the browser's shortcuts
        if (at?.keydown(event)) return;
        if (event.key === 'Enter' && !event.isComposing) send.click();
    });
    line.append(field, send);
    box.append(line, note);
    if (source) {
        at = mentions(field, box, source);
        const room = () => Math.min(MAX_PICTURES - at.pictures(), MAX_REFS - at.count());
        const picker = galleryPicker(box, room, (items) => {
            for (const item of items) at.add(item);
            field.focus();
        });
        line.prepend(iconButton('anomalous-ai-message-pics', 'image', t('aiPicsButton'), () => picker.toggle(), { iconOnly: true, size: 17 }));
    }
    box.note = note;
    return box;
}

/** The hint for where the task stands; quieter while the AI is not working on it. While a task
 * waits for an AI (`status` "waiting"), what is sent waits with it. */
export function updateMessageBox(box, ended, status) {
    box.classList.toggle('is-quiet', !['live', 'asks', 'waiting'].includes(status));
    box.note.textContent = t(ended ? 'aiMessageEnded' : status === 'waiting' ? 'aiMessageWaiting' : 'aiMessageHint');
}
