/**
 * The AI workbench's message box (ui_ai_workbench.js): under a task's timeline, where the user
 * writes to the AI on that task. The text goes to `onSend(text)`; the AI gets it the next time it
 * asks (get_answers), which the hint says, and says to ask in the AI app once the task ended.
 * Made once per task, so half-typed text survives the task's redraws.
 */

import { translate as t } from './locales.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function messageBox(onSend) {
    const box = el('div', 'anomalous-ai-message');
    const line = el('div', 'anomalous-ai-message-line');
    const field = el('input', 'anomalous-ai-message-input');
    field.type = 'text';
    field.maxLength = 2000;
    field.placeholder = t('aiMessagePlaceholder');
    const note = el('div', 'anomalous-ai-message-hint');
    const send = el('button', 'anomalous-ai-panel-send', t('aiMessageSend'));
    send.type = 'button';
    send.onclick = async () => {
        const text = field.value.trim();
        if (!text) return;
        send.disabled = true;
        try {
            await onSend(text);
            field.value = '';
        } catch (error) {
            note.textContent = error.message;
        } finally {
            send.disabled = false;
        }
    };
    field.addEventListener('keydown', (event) => {
        event.stopPropagation(); // typing here is not the browser's shortcuts
        if (event.key === 'Enter' && !event.isComposing) send.click();
    });
    line.append(field, send);
    box.append(line, note);
    box.note = note;
    return box;
}

/** The hint for where the task stands; quieter while the AI is not working on it. */
export function updateMessageBox(box, ended, status) {
    box.classList.toggle('is-quiet', status !== 'live' && status !== 'asks');
    box.note.textContent = t(ended ? 'aiMessageEnded' : 'aiMessageHint');
}
