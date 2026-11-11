/**
 * What a private task's AI was sent (api/ai_sent.py): each call with what the AI wrote (its
 * arguments) and the text Anomalous answered, as it left. Opened from the task's menu and read
 * then; the box above the list looks for a word in all of it, so the user sees for themselves
 * whether a name or a prompt went out. A call's texts are drawn when it is opened.
 */

import { translate as t } from './locales.js';
import { timeLabel } from './activity_log.js';
import { aiWindow } from './ui_ai_connect.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function callRow(call, open) {
    const row = el('details', `anomalous-ai-sent-call${call.error ? ' is-error' : ''}`);
    const head = el('summary', 'anomalous-ai-sent-head');
    head.append(el('span', 'anomalous-ai-sent-time', timeLabel(call.at)), el('code', '', call.tool),
        el('span', 'anomalous-ai-sent-size', t('aiSentSize', { n: (call.text || '').length })));
    row.append(head);
    const fill = () => {
        if (row.childElementCount > 1) return;
        row.append(el('div', 'anomalous-ai-sent-label', t('aiSentIn')), el('pre', 'anomalous-ai-sent-text', call.arguments),
            el('div', 'anomalous-ai-sent-label', t('aiSentOut')), el('pre', 'anomalous-ai-sent-text', call.text));
    };
    row.addEventListener('toggle', fill);
    if (open) {
        fill();
        row.open = true;
    }
    return row;
}

/** The window for `task`. */
export async function openSent(task) {
    const body = el('div', 'anomalous-ai-sent');
    body.append(el('p', 'anomalous-ai-gates-intro', t('aiSentIntro')));
    aiWindow(t('aiSent'), body);
    let calls = [];
    try {
        calls = (await (await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}/sent`)).json()).calls || [];
    } catch (_) { /* drawn as nothing kept */ }
    if (!calls.length) {
        body.append(el('p', 'anomalous-ai-sent-none', t('aiSentEmpty')));
        return;
    }
    calls.reverse(); // the newest first
    const find = el('input', 'anomalous-ai-sent-find');
    find.type = 'search';
    find.placeholder = t('aiSentFind');
    find.addEventListener('keydown', event => event.stopPropagation());
    const count = el('div', 'anomalous-ai-sent-count');
    const list = el('div', 'anomalous-ai-sent-list');
    const draw = () => {
        const word = find.value.trim().toLowerCase();
        const found = word ? calls.filter(call => `${call.tool}\n${call.arguments}\n${call.text}`.toLowerCase().includes(word)) : calls;
        count.textContent = !word ? t('aiSentCount', { n: calls.length }) : found.length ? t('aiSentFound', { n: found.length, all: calls.length })
            : t('aiSentNotFound', { all: calls.length });
        count.classList.toggle('is-clear', Boolean(word) && !found.length);
        list.replaceChildren(...found.map(call => callRow(call, Boolean(word) && found.length <= 5)));
    };
    find.addEventListener('input', draw);
    body.append(find, count, list);
    draw();
}
