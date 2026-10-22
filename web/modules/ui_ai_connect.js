/**
 * How to connect an AI app to Anomalous (the AI workbench's "Connect an AI", its empty page and a
 * task waiting for an AI): the address, a sentence to paste to the AI so it sets itself up (and
 * starts on the task, when one waits), and the way for each common app. Only this computer can
 * connect; the address is this page's own. A task waiting for an AI (waitingCard) leads with
 * what the user wants and the one sentence to send; connecting is folded under it.
 */

import { translate as t } from './locales.js';
import { copyText } from './ui_dialog.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

export const mcpAddress = () => `${location.origin}/anomalous/mcp`;

/** A line to copy: the text and a Copy button that says when it is done. */
export function copyLine(text, { code = true, label = t('aiCopyAddress') } = {}) {
    const line = el('div', `anomalous-ai-copy${code ? ' is-code' : ''}`);
    const body = el(code ? 'code' : 'span', 'anomalous-ai-copy-text', text);
    const copy = button('anomalous-ai-copy-button', label, async () => {
        await copyText(text);
        copy.textContent = t('aiCopied');
        setTimeout(() => { copy.textContent = label; }, 1800);
    });
    line.append(body, copy);
    return line;
}

/** The sentence for the AI: add the server, then (with `title`) start on that task. */
export function sentenceForAi(title = '') {
    const add = t('aiConnectSentence', { url: mcpAddress() });
    return title ? `${add}${t('aiConnectSentenceTask', { task: title })}` : add;
}

/** Everything about connecting, as one block. `title`: the task waiting for an AI, if any. */
export function connectGuide(title = '') {
    const url = mcpAddress();
    const box = el('div', 'anomalous-ai-connect');
    box.append(el('div', 'anomalous-ai-connect-step', t('aiConnectStepAddress')), copyLine(url));
    box.append(el('div', 'anomalous-ai-connect-step', t(title ? 'aiConnectStepSayTask' : 'aiConnectStepSay')),
        copyLine(sentenceForAi(title), { code: false, label: t('aiConnectCopySentence') }));
    const apps = el('details', 'anomalous-ai-connect-apps');
    apps.append(el('summary', '', t('aiConnectByApp')));
    const ways = [
        ['Claude Code', `claude mcp add --transport http anomalous ${url}`],
        ['Gemini CLI', `gemini mcp add --transport http anomalous ${url}`],
        ['Cursor (~/.cursor/mcp.json)', `{ "mcpServers": { "anomalous": { "url": "${url}" } } }`],
        ['VS Code (.vscode/mcp.json)', `{ "servers": { "anomalous": { "type": "http", "url": "${url}" } } }`],
    ];
    for (const [name, text] of ways) apps.append(el('div', 'anomalous-ai-connect-app', name), copyLine(text));
    apps.append(el('div', 'anomalous-ai-connect-app', 'Cherry Studio'), el('div', 'anomalous-ai-connect-note', t('aiConnectCherry', { url })));
    box.append(apps, el('div', 'anomalous-ai-connect-note', t('aiConnectLocal')));
    return box;
}

/**
 * A task the user started, waiting for an AI: what they want (a line that renames the task:
 * `rename(title)`), the sentence that has the AI take it, three small steps, and, folded, how to
 * connect an AI that is not connected yet.
 */
export function waitingCard(task, rename) {
    const card = el('div', 'anomalous-ai-waiting');
    card.append(el('div', 'anomalous-ai-waiting-mark', '✦'), el('div', 'anomalous-ai-waiting-title', t('aiWaitingTitle')),
        el('p', 'anomalous-ai-waiting-body', t('aiWaitingBody')));
    const wish = el('input', 'anomalous-ai-waiting-wish');
    wish.placeholder = t('aiWaitingWish');
    wish.value = task.title || '';
    wish.setAttribute('aria-label', t('aiWaitingWish'));
    wish.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter' && !event.isComposing) wish.blur();
    });
    wish.addEventListener('blur', () => {
        if (wish.value.trim() !== (task.title || '')) void rename(wish.value.trim());
    });
    const sentence = task.title ? t('aiHandSentence', { task: task.title }) : t('aiWaitingSentence');
    const say = el('div', 'anomalous-ai-waiting-say');
    say.append(el('div', 'anomalous-ai-waiting-label', t('aiWaitingSay')), copyLine(sentence, { code: false, label: t('aiConnectCopySentence') }));
    const steps = el('ol', 'anomalous-ai-waiting-steps');
    for (const key of ['aiWaitingStep1', 'aiWaitingStep2', 'aiWaitingStep3']) steps.append(el('li', '', t(key)));
    const setup = el('details', 'anomalous-ai-waiting-setup');
    setup.append(el('summary', '', t('aiWaitingSetup')), connectGuide(task.title));
    card.append(wish, say, steps, setup);
    return card;
}

/** A window over the page with `title` and `body` (Esc, ×, or the backdrop closes it); returns close. */
export function aiWindow(title, body) {
    const overlay = el('div', 'anomalous-ai-connect-overlay');
    const dialog = el('div', 'anomalous-ai-connect-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const close = () => {
        overlay.remove();
        window.removeEventListener('keydown', onKey, true);
    };
    const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
    };
    const head = el('div', 'anomalous-ai-connect-head');
    head.append(el('div', 'anomalous-ai-connect-title', title), button('anomalous-ai-connect-close', '×', close, t('close')));
    dialog.append(head, body);
    overlay.append(dialog);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    return close;
}

/** The guide in a window over the page. */
export function openConnectGuide() {
    aiWindow(t('aiConnect'), connectGuide());
}
