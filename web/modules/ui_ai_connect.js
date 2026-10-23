/**
 * How to connect an AI app to Anomalous (the AI workbench's "Connect an AI", its empty page and a
 * task waiting for an AI): the address, a sentence to paste to the AI so it sets itself up (and
 * starts on the task, when one waits), and the way for each common app. Only this computer can
 * connect; the address is this page's own. A task waiting for an AI (waitingCard) leads with
 * what the user wants, a way to the page where they put things ready for it (ui_ai_ready.js)
 * and the one sentence to send, in numbered steps under a picture;
 * connecting (connectHint) is a card under it that opens the guide in place.
 */

import { translate as t } from './locales.js';
import { copyText } from './ui_dialog.js';
import { icon, iconButton } from './ui_ai_icons.js';

const ART = {
    waiting: new URL('../assets/ai_waiting.webp', import.meta.url).href,
    connect: new URL('../assets/ai_connect.webp', import.meta.url).href,
};

function art(name, className) {
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

export const mcpAddress = () => `${location.origin}/anomalous/mcp`;

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

function step(number, label, ...body) {
    const item = el('li', 'anomalous-ai-waiting-step');
    item.append(el('span', 'anomalous-ai-waiting-num', String(number)), el('div', 'anomalous-ai-waiting-step-label', label), ...body);
    return item;
}

/** What the timeline will look like: three faint steps. */
function preview() {
    const box = el('div', 'anomalous-ai-waiting-ghost');
    for (const [name, key] of [['search', 'aiTool_describe_canvas'], ['models', 'aiTool_set_model'], ['image', 'aiTool_run_workflow']]) {
        const line = el('div', 'anomalous-ai-waiting-ghost-row');
        line.append(icon(name, 14), el('span', '', t(key)));
        box.append(line);
    }
    return box;
}

/** Step 2 of a waiting task: what is ready so far and the way to the page for it (`prep.open()`). */
function readyStep(prep) {
    const body = el('div', 'anomalous-ai-waiting-ready');
    const done = [prep.ready && t('aiWaitingReadySome', { count: prep.ready }), prep.materials && t('aiWaitingMaterialsCount', { count: prep.materials })].filter(Boolean);
    body.append(el('span', 'anomalous-ai-waiting-ready-text', done.length ? done.join(' · ') : t('aiWaitingReadyBody')),
        iconButton('anomalous-ai-waiting-ready-go', 'arrowRight', t('aiWaitingReadyGo'), prep.open));
    return body;
}

/**
 * A task the user started, waiting for an AI: a picture, then numbered steps (what they want, in
 * a line that renames the task: `rename(title)`; what is ready, `prep` for readyStep; the
 * sentence that has the AI take it; where its steps will show), and the card for an AI not
 * connected yet.
 */
export function waitingCard(task, rename, prep) {
    const card = el('div', 'anomalous-ai-waiting');
    const hero = el('div', 'anomalous-ai-waiting-hero');
    const words = el('div', 'anomalous-ai-waiting-words');
    words.append(el('div', 'anomalous-ai-waiting-title', t('aiWaitingTitle')), el('p', 'anomalous-ai-waiting-body', t('aiWaitingBody')));
    hero.append(art('waiting', 'anomalous-ai-waiting-art'), words);
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
    const field = el('label', 'anomalous-ai-waiting-field');
    field.append(icon('pencil', 16), wish);
    const sentence = task.title ? t('aiHandSentence', { task: task.title }) : t('aiWaitingSentence');
    const steps = el('ol', 'anomalous-ai-waiting-steps');
    steps.append(step(1, t('aiWaitingStepWish'), field), step(2, t('aiWaitingReady'), readyStep(prep)),
        step(3, t('aiWaitingSay'), copyLine(sentence, { code: false, label: t('aiConnectCopySentence') })),
        step(4, t('aiWaitingStep3'), preview()));
    card.append(hero, steps, connectHint(task.title));
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
