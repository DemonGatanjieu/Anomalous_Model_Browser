/**
 * The row of lines to paste into the AI's chat (ai_call_lines.js picks them), kept over the
 * message box by ui_ai_now.js while the AI is not busy with a call, a run or a question: when it
 * has stopped, a click copies the word that sets it going again. After a run it did not wait for
 * (api/ai_gates.py run_wait "call") the lines are about the run; the server takes `call_ai` off
 * the step once the AI knows, and the row goes back to "go on" by itself.
 */

import { translate as t } from './locales.js';
import { copyText } from './ui_dialog.js';
import { icon } from './ui_ai_icons.js';
import { callLines, NEW_CHAT } from './ai_call_lines.js';

const SAID_MS = 4000; // how long "copied" stays in place of the lead

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** The row, made once per task view; `update(task)` draws it again when what it offers changes (null: hidden). */
export function callRow() {
    const row = el('div', 'anomalous-ai-call');
    row.title = t('aiCallHint');
    let said = 0;
    row.update = (task) => {
        const offer = callLines(task);
        const title = task?.title || t('aiUntitled');
        const key = offer ? JSON.stringify([offer, title]) : '';
        row.hidden = !offer;
        if (key === row.dataset.key) return;
        row.dataset.key = key;
        clearTimeout(said);
        row.replaceChildren();
        if (!offer) return;
        const lead = el('span', 'anomalous-ai-call-lead', t(offer.lead));
        row.append(lead);
        offer.lines.forEach((name, at) => {
            const text = t(name, { task: title });
            const line = el('button', `anomalous-ai-call-line${at ? '' : ' is-main'}${name === NEW_CHAT ? ' is-new' : ''}`);
            line.type = 'button';
            if (!at) line.append(icon('copy', 14));
            line.append(el('span', 'anomalous-ai-call-text', text));
            if (name === NEW_CHAT) line.title = t('aiCallNewChatTip');
            line.addEventListener('click', async () => {
                const copied = await copyText(text);
                row.querySelectorAll('.anomalous-ai-call-line').forEach(item => item.classList.toggle('is-done', item === line && copied));
                lead.textContent = t(copied ? 'aiCallCopied' : 'aiCallNotCopied');
                lead.classList.toggle('is-done', copied);
                clearTimeout(said);
                said = setTimeout(() => {
                    lead.textContent = t(offer.lead);
                    lead.classList.remove('is-done');
                    line.classList.remove('is-done');
                }, SAID_MS);
            });
            row.append(line);
        });
    };
    return row;
}
