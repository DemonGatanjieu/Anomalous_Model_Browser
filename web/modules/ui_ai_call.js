/**
 * "Call me when it is done" (api/ai_gates.py run_wait): when a run the AI did not wait for has
 * ended, its step offers a few lines for the user to paste into the AI's chat. A click copies one;
 * the AI's next call brings it the result and the pictures (api/ai_task_runs.py), and the server
 * takes `call_ai` off the step once the AI knows, so the lines go away by themselves.
 */

import { translate as t } from './locales.js';
import { copyText } from './ui_dialog.js';
import { icon } from './ui_ai_icons.js';

const LINES = { done: ['aiCallDone', 'aiCallAgain', 'aiCallGoOn'], error: ['aiCallFailed', 'aiCallGoOn'] };

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** The lines to paste for run step `step`, or null when the AI needs none. */
export function callAiLines(step) {
    const keys = step.call_ai && LINES[step.state];
    if (!keys) return null;
    const box = el('div', 'anomalous-ai-call');
    box.append(el('span', 'anomalous-ai-call-lead', t(step.state === 'done' ? 'aiCallDoneLead' : 'aiCallFailedLead')));
    const hint = el('span', 'anomalous-ai-call-hint', t('aiCallHint'));
    keys.forEach((key, at) => {
        const line = el('button', `anomalous-ai-call-line${at ? '' : ' is-main'}`);
        line.type = 'button';
        if (!at) line.append(icon('copy', 14));
        line.append(el('span', '', t(key)));
        line.addEventListener('click', async () => {
            const copied = await copyText(t(key));
            box.querySelectorAll('.anomalous-ai-call-line').forEach(item => item.classList.toggle('is-done', item === line && copied));
            hint.textContent = t(copied ? 'aiCallCopied' : 'aiCallNotCopied');
        });
        box.append(line);
    });
    box.append(hint);
    return box;
}
