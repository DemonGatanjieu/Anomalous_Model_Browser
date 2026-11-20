/**
 * The hidden parts of a task's conversation (the timeline, ui_ai_step_body.js), veiled: the words the user hid in a
 * message or a gist (ai_hide_mark.js renderHiddenText with `veil`), the prompts handed in through the prompt box
 * (ui_ai_prompt_box.js) and, in the AI's notes, each token it wrote ([M1] a model, [P1] a prompt, [img1] a picture:
 * the task's `sealed`) shown as what it stands for (tokensAsWords), in the same dashed mark with the token beside.
 * Blurred until the pointer is on it or it has the focus; a press keeps it shown, another veils it again,
 * everywhere the same token shows, while the page stays. Only the page shows the words: the AI still has the token.
 */

import { translate as t } from './locales.js';
import { keptCatalog, loadCatalog } from './ai_toolbox_data.js';
import { modelStem } from './ai_start_from.js';
import { icon } from './ui_ai_icons.js';

const TOKEN = /(\[(?:P|M|img)\d+\])/;
const PROMPT_CHARS = 48; // a prompt in the AI's words shows its start; the tooltip has it all
const SYNC = 'anomalous-veil-sync';
const shown = new Set(); // `${token}|${words}` pressed to stay shown, while the page stays

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/**
 * Veils `node` (a sealed mark, or a prompt's text): blurred until hovered or focused, a press (Enter, Space) keeps
 * it shown or veils it again. `token` is what the AI has instead ('' for words marked before they had one), `words`
 * what it stands for, `full` a longer text for the tooltip. Returns `node`.
 */
export function veil(node, token, words, full = '') {
    const key = `${token}|${words}`;
    node.classList.add('is-veiled');
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    const sync = () => {
        const on = shown.has(key);
        node.classList.toggle('is-shown', on);
        node.setAttribute('aria-pressed', String(on));
        const tip = `${t(token ? 'aiSealedTokenTip' : 'aiSealedWordsTip', { token })} ${t(on ? 'aiSealedVeilHide' : 'aiSealedVeilShow')}`;
        node.title = full ? `${full}\n\n${tip}` : tip;
    };
    const flip = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (shown.has(key)) shown.delete(key);
        else shown.add(key);
        for (const twin of document.querySelectorAll('.is-veiled')) twin.dispatchEvent(new Event(SYNC));
    };
    node.addEventListener(SYNC, sync);
    node.addEventListener('click', flip);
    node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') flip(event); });
    sync();
    return node;
}

/** What `token` stands for, in words: a model's name (the catalogue's, else its file), a picture's file, a prompt's start. */
function wordsOf(token, value) {
    if (token.startsWith('[M')) {
        const model = (keptCatalog() || []).find(item => item.kind === 'models' && item.id === value);
        return model?.title || modelStem(value) || String(value);
    }
    if (token.startsWith('[img')) return String(value).split(/[\\/]/).pop();
    const text = String(value).replace(/\s+/g, ' ').trim();
    return text.length > PROMPT_CHARS ? `${text.slice(0, PROMPT_CHARS)}…` : text;
}

/** `token` (standing for `value`) as a veiled mark: the lock and the token, then its words. */
function tokenMark(token, value) {
    const wrap = el('span', 'anomalous-ai-sealed-span is-token');
    const tag = el('span', 'anomalous-ai-sealed-tag');
    tag.append(icon('lock', 10), document.createTextNode(token));
    const words = el('span', 'anomalous-ai-sealed-words', wordsOf(token, value));
    wrap.append(tag, words);
    if (token.startsWith('[M') && !keptCatalog()) {
        loadCatalog().then(() => { words.textContent = wordsOf(token, value); }).catch(() => {});
    }
    const full = token.startsWith('[P') && words.textContent.endsWith('…') ? String(value) : '';
    return veil(wrap, token, String(value), full);
}

/** In `node` (the AI's note, laid out), each token of `sealed` as what it stands for, veiled. Returns `node`. */
export function tokensAsWords(node, sealed) {
    if (!sealed || !Object.keys(sealed).length) return node;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let text = walker.nextNode(); text; text = walker.nextNode()) if (TOKEN.test(text.data)) texts.push(text);
    for (const text of texts) {
        const parts = text.data.split(TOKEN).filter(Boolean)
            .map(part => (typeof sealed[part] === 'string' && TOKEN.test(part) ? tokenMark(part, sealed[part]) : document.createTextNode(part)));
        text.replaceWith(...parts);
    }
    return node;
}
