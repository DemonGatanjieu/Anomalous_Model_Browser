/**
 * How to connect an AI app to Anomalous (the AI workbench's "Connect an AI", its empty page and a
 * task waiting for an AI): the address, a sentence to paste to the AI so it sets itself up (and
 * starts on the task, when one waits), the way for each common app, and rules for the AI app to
 * keep (use Anomalous's tools, never edit pictures with code, say what it did outside). Only this computer can
 * connect; the address is this page's own. Connecting (connectHint) is a card that opens the guide
 * in place, under a task waiting for an AI (ui_ai_ready.js) and on the empty page. Without a waiting
 * task the guide also picks which tools the app is offered (ui_ai_tool_set.js), and the address follows.
 */

import { translate as t } from './locales.js';
import { copyText } from './ui_dialog.js';
import { iconButton } from './ui_ai_icons.js';
import { toolSetPicker } from './ui_ai_tool_set.js';

const ART = {
    waiting: new URL('../assets/ai_waiting.webp', import.meta.url).href,
    connect: new URL('../assets/ai_connect.webp', import.meta.url).href,
};

export function art(name, className) {
    const img = el('img', className);
    img.src = ART[name];
    img.alt = '';
    img.decoding = 'async';
    img.setAttribute('aria-hidden', 'true');
    return img;
}

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

/** The address; `set` 'core' or 'mine' offers a shorter tool list (api/mcp_tool_sets.py). */
export const mcpAddress = (set = 'all') => `${location.origin}/anomalous/mcp${set === 'all' ? '' : `?tools=${set}`}`;

/** A line to copy: the text and a Copy button that says when it is done. */
export function copyLine(text, { code = true, label = t('aiCopyAddress') } = {}) {
    const line = el('div', `anomalous-ai-copy${code ? ' is-code' : ''}`);
    const body = el(code ? 'code' : 'span', 'anomalous-ai-copy-text', text);
    const copy = iconButton('anomalous-ai-copy-button', 'copy', label, async () => {
        await copyText(text);
        copy.classList.add('is-done');
        copy.lastChild.textContent = t('aiCopied');
        setTimeout(() => {
            copy.classList.remove('is-done');
            copy.lastChild.textContent = label;
        }, 1800);
    });
    line.append(body, copy);
    return line;
}

/** The sentence for the AI: add the server, then (with `title`) start on that task. */
export function sentenceForAi(title = '', set = 'all') {
    const add = t('aiConnectSentence', { url: mcpAddress(set) });
    return title ? `${add}${t('aiConnectSentenceTask', { task: title })}` : add;
}

/** Everything about connecting, as one block. `title`: the task waiting for an AI, if any. */
export function connectGuide(title = '') {
    const box = el('div', 'anomalous-ai-connect');
    const linked = el('div', 'anomalous-ai-connect');
    const apps = el('details', 'anomalous-ai-connect-apps');
    const fill = (set) => {
        linked.replaceChildren(copyLine(mcpAddress(set)), el('div', 'anomalous-ai-connect-step', t(title ? 'aiConnectStepSayTask' : 'aiConnectStepSay')),
            copyLine(sentenceForAi(title, set), { code: false, label: t('aiConnectCopySentence') }));
        appWays(apps, mcpAddress(set));
    };
    box.append(el('div', 'anomalous-ai-connect-step', t('aiConnectStepAddress')));
    if (!title) box.append(toolSetPicker(fill));  // a task waiting in Anomalous needs every tool
    fill('all');
    const rules = copyLine(t('aiConnectRules'), { code: false, label: t('aiConnectCopyRules') });
    rules.classList.add('is-rules');
    box.append(linked, apps, el('div', 'anomalous-ai-connect-step', t('aiConnectStepRules')), rules,
        el('div', 'anomalous-ai-connect-note', t('aiConnectLocal')));
    return box;
}

/** The way to add `url` in each common app, into the folding `apps`. */
function appWays(apps, url) {
    apps.replaceChildren(el('summary', '', t('aiConnectByApp')));
    const ways = [
        ['Claude Code', `claude mcp add --transport http anomalous ${url}`],
        ['Gemini CLI', `gemini mcp add --transport http anomalous ${url}`],
        ['Cursor (~/.cursor/mcp.json)', `{ "mcpServers": { "anomalous": { "url": "${url}" } } }`],
        ['VS Code (.vscode/mcp.json)', `{ "servers": { "anomalous": { "type": "http", "url": "${url}" } } }`],
    ];
    for (const [name, text] of ways) apps.append(el('div', 'anomalous-ai-connect-app', name), copyLine(text));
    apps.append(el('div', 'anomalous-ai-connect-app', 'Cherry Studio'), el('div', 'anomalous-ai-connect-note', t('aiConnectCherry', { url })));
}

/** The card for an AI not connected yet: connecting is done once; its button opens the guide in place. */
export function connectHint(title = '') {
    const card = el('div', 'anomalous-ai-hint');
    const words = el('div', 'anomalous-ai-hint-words');
    words.append(el('div', 'anomalous-ai-hint-title', t('aiHintTitle')), el('p', 'anomalous-ai-hint-body', t('aiHintBody')));
    const guide = el('div', 'anomalous-ai-hint-guide');
    guide.hidden = true;
    const open = iconButton('anomalous-ai-hint-open', 'plug', t('aiHintOpen'), () => {
        if (!guide.children.length) guide.append(connectGuide(title));
        guide.hidden = !guide.hidden;
        open.setAttribute('aria-expanded', String(!guide.hidden));
        open.lastChild.textContent = t(guide.hidden ? 'aiHintOpen' : 'aiHintClose');
    });
    open.setAttribute('aria-expanded', 'false');
    words.append(open);
    const row = el('div', 'anomalous-ai-hint-row');
    row.append(art('connect', 'anomalous-ai-hint-art'), words);
    card.append(row, guide);
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
