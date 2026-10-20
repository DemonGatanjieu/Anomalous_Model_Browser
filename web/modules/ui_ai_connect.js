/**
 * How to connect an AI app to Anomalous (the AI workbench's "Connect an AI", its empty page and a
 * task waiting for an AI): the address, a sentence to paste to the AI so it sets itself up (and
 * starts on the task, when one waits), and the way for each common app. Only this computer can
 * connect; the address is this page's own.
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
function copyLine(text, { code = true, label = t('aiCopyAddress') } = {}) {
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

/** The guide in a window over the page (Esc or the backdrop closes it). */
export function openConnectGuide() {
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
    head.append(el('div', 'anomalous-ai-connect-title', t('aiConnect')), button('anomalous-ai-connect-close', '×', close, t('close')));
    dialog.append(head, connectGuide());
    overlay.append(dialog);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
}
