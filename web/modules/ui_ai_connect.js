/**
 * How to connect an AI app to Anomalous (the AI workbench's "Connect an AI", its empty page and a
 * task waiting for an AI). First the way the AI will work, which is which tools the app is offered
 * (ui_ai_tool_set.js: with the workbench, or in the app's own chat; not with a task waiting, which
 * needs every tool); the address follows the choice. Then one thing to do: a sentence to paste to the
 * AI so it sets itself up (and starts on the task, when one waits), and under it a line that turns
 * green once an app has called (connectionLine, GET /anomalous/ai_callers, asked only while the line
 * shows). The rest is folded: the address and the way for each common app, to add it by hand; and
 * rules for the AI app to keep (use Anomalous's tools, never edit pictures with code, say what it
 * did outside). Only this computer can connect; the
 * address is this page's own. Connecting (connectHint) is a card that opens the guide in place,
 * under a task waiting for an AI (ui_ai_ready.js) and on the empty page.
 */

import { translate as t } from './locales.js';
import { copyText, trackRehearsalDialog } from './ui_dialog.js';
import { iconButton } from './ui_ai_icons.js';
import { toolSetPicker } from './ui_ai_tool_set.js';
import { art } from './ui_ai_art.js';

const LOOK_MS = 2500; // how often the guide asks whether an app has come
const LOOKS_UNSHOWN = 40; // a line never put on the page stops asking

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
export function copyLine(text, { code = true, label = t('aiCopyAddress'), onCopied = null } = {}) {
    const line = el('div', `anomalous-ai-copy${code ? ' is-code' : ''}`);
    const body = el(code ? 'code' : 'span', 'anomalous-ai-copy-text', text);
    const copy = iconButton('anomalous-ai-copy-button', 'copy', label, async () => {
        const copied = await copyText(text);
        copy.classList.add('is-done');
        copy.lastChild.textContent = t('aiCopied');
        // `onCopied`: what comes next once it is on the clipboard, after "Copied" was seen a moment.
        if (copied && onCopied) {
            setTimeout(onCopied, 600);
            return;
        }
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

/**
 * Whether an AI app has come: asks while the line shows, and names the app once one calls after the
 * line was made (an app that called before proves nothing about the sentence just sent).
 */
export function connectionLine() {
    const line = el('div', 'anomalous-ai-connect-live');
    line.setAttribute('role', 'status');
    const words = el('span', '', t('aiConnectWaiting'));
    line.append(el('span', 'anomalous-ai-visit-dot'), words);
    let before = null; // when an app last called, as the first answer had it
    let shown = false;
    let unshown = 0;
    const look = async () => {
        if (line.isConnected) shown = true;
        else if (shown || ++unshown > LOOKS_UNSHOWN) return; // the guide closed, or never came to the page
        if (line.offsetParent) { // not while folded away
            try {
                const last = (await (await fetch('/anomalous/ai_callers')).json()).last;
                if (before === null) before = last?.at || 0;
                else if (last && last.at > before) {
                    line.classList.add('is-known');
                    words.textContent = t('aiConnectCame', { client: last.client });
                    return;
                }
            } catch (_) { /* asked again in a moment */ }
        }
        setTimeout(look, LOOK_MS);
    };
    setTimeout(look, 300);
    return line;
}

/** Everything about connecting, as one block. `title`: the task waiting for an AI, if any. */
export function connectGuide(title = '') {
    const box = el('div', 'anomalous-ai-connect');
    const sentence = el('div', 'anomalous-ai-connect');
    const byHand = el('details', 'anomalous-ai-connect-apps');
    const more = el('details', 'anomalous-ai-connect-apps');
    const fill = (set) => {
        sentence.replaceChildren(copyLine(sentenceForAi(title, set), { code: false, label: t('aiConnectCopySentence') }));
        appWays(byHand, mcpAddress(set));
    };
    fill('all');
    if (!title) box.append(toolSetPicker(fill)); // a task waiting in Anomalous needs every tool
    const rules = copyLine(t('aiConnectRules'), { code: false, label: t('aiConnectCopyRules') });
    rules.classList.add('is-rules');
    more.append(el('summary', '', t('aiConnectMore')), el('div', 'anomalous-ai-connect-app', t('aiConnectRulesWhy')), rules);
    const say = el('div', 'anomalous-ai-connect-step has-art');
    say.append(art('connect', 'anomalous-ai-connect-art'), el('span', '', t(title ? 'aiConnectSayTask' : 'aiConnectSay')));
    box.append(say, sentence, connectionLine(),
        byHand, more, el('div', 'anomalous-ai-connect-note', t('aiConnectLocal')));
    return box;
}

/** The address and the way to add it in each common app, into the folding `apps`. */
function appWays(apps, url) {
    apps.replaceChildren(el('summary', '', t('aiConnectByApp')), el('div', 'anomalous-ai-connect-app', t('aiConnectAddress')), copyLine(url));
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
export function aiWindow(title, body, onClose = null) {
    const overlay = el('div', 'anomalous-ai-connect-overlay');
    const dialog = el('div', 'anomalous-ai-connect-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    let open = true;
    const close = () => {
        if (!open) return;
        open = false;
        untrack();
        overlay.remove();
        window.removeEventListener('keydown', onKey, true);
        onClose?.();
    };
    const untrack = trackRehearsalDialog(close);
    const onKey = (event) => {
        if (event.key !== 'Escape') return;
        if ([...document.querySelectorAll('.anomalous-ai-connect-overlay')].at(-1) !== overlay) return; // a window opened over this one goes first
        if ([...dialog.querySelectorAll('[data-anomalous-escape]')].some(node => node.getClientRects().length)) return;
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
