/**
 * A quick look at a prompt's translation: a small read-only panel beside a button (the combo
 * editor's "译"). Chinese goes to English, English to Chinese on a Chinese page. Prompt Studio
 * is where prompts are changed; this only shows.
 */

import { translate as t } from './locales.js';
import { needsEnglish, translatePromptText } from './translation_service.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

/** The language a prompt is shown in: not English → English; English → Chinese on a Chinese page; else none. */
export function translationTarget(text) {
    if (needsEnglish(text)) return 'en';
    return window.anomalous_browser_lang === 'zh' ? 'zh-CN' : '';
}

let closeTranslation = null;

/** The nearest box around `node` that scrolls. */
function scrollerOf(node) {
    for (let at = node.parentElement; at; at = at.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(at).overflowY) && at.scrollHeight > at.clientHeight) return at;
    }
    return null;
}

/** A small read-only panel beside `anchor` with the translation of `text`; another press, Esc or a click elsewhere closes it. */
export async function showTranslation(anchor, text) {
    const wasOpen = closeTranslation?.anchor === anchor;
    closeTranslation?.();
    if (wasOpen) return;
    const target = translationTarget(text);
    const panel = el('div', 'anomalous-structure-translation');
    const head = el('div', 'anomalous-structure-translation-head');
    const body = el('div', 'anomalous-structure-translation-text', t('comboTranslating'));
    const copy = button('anomalous-scan-row-btn', t('comboTranslationCopy'), () => {
        void navigator.clipboard?.writeText(body.textContent).then(() => { copy.textContent = t('comboTranslationCopied'); }, () => {});
    });
    copy.disabled = true;
    head.append(el('strong', '', t(target === 'en' ? 'comboTranslationToEnglish' : 'comboTranslationToChinese')), copy,
        button('anomalous-structure-translation-close', '×', () => close()));
    panel.append(head, body);
    document.body.append(panel);
    // To the right of the button when there is room, else under it, kept on screen.
    const at = anchor.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 16);
    const left = at.right + 8 + width <= window.innerWidth - 8 ? at.right + 8 : Math.max(8, at.right - width);
    panel.style.width = `${width}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(8, Math.min(left > at.right ? at.top : at.bottom + 6, window.innerHeight - 220))}px`;

    const controller = new AbortController();
    const onDown = (event) => { if (!panel.contains(event.target) && event.target !== anchor) close(); };
    // Only the page under the button moving closes it (it would stay put); other panels may scroll on their own.
    const scroller = scrollerOf(anchor);
    const onScroll = () => close();
    const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
    };
    const close = () => {
        controller.abort();
        panel.remove();
        document.removeEventListener('pointerdown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
        scroller?.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        anchor.classList.remove('is-active');
        if (closeTranslation === close) closeTranslation = null;
    };
    close.anchor = anchor;
    closeTranslation = close;
    anchor.classList.add('is-active');
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    const result = await translatePromptText(text, { targetLang: target, signal: controller.signal });
    if (result.cancelled || !panel.isConnected) return;
    body.textContent = result.ok ? result.translated : t('comboTranslationFailed');
    body.classList.toggle('is-bad', !result.ok);
    copy.disabled = !result.ok;
}
