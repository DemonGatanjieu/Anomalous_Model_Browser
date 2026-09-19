/**
 * DOM and copy helpers shared by Workflow Recipe detail subviews.
 */

import { translate } from './locales.js';

const t = (key, params) => translate(key, params);

export function appendText(parent, tagName, text, className = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text == null ? '' : String(text);
    parent.appendChild(element);
    return element;
}

export function button(parent, label, className = '') {
    const element = appendText(parent, 'button', label, className);
    element.type = 'button';
    return element;
}

export function displayValue(value) {
    if (value === undefined) return '';
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value) ?? String(value); } catch (error) { return String(value); }
}

export function dateText(value) {
    if (!value) return t('recipeDetailUnknownTime');
    try { return new Date(Number(value)).toLocaleString(); } catch (error) { return t('recipeDetailUnknownTime'); }
}

export async function copyText(value) {
    if (value === null || value === undefined || value === '') return false;
    try {
        await navigator.clipboard.writeText(String(value));
        return true;
    } catch (error) {
        console.warn('Could not copy recipe detail value:', error);
        return false;
    }
}

export async function copyTextWithFeedback(buttonElement, value) {
    const original = buttonElement.textContent;
    const isIcon = original.length <= 2;
    const copied = await copyText(value);

    if (isIcon) {
        buttonElement.textContent = copied ? '✓' : '!';
    } else {
        buttonElement.textContent = copied
            ? `✓ ${t('recipeCopied')}`
            : `! ${t('recipeCopyFailed')}`;
    }

    buttonElement.style.color = copied ? '#6ee7b7' : '#fca5a5';
    buttonElement.style.borderColor = copied ? 'rgba(110, 231, 183, 0.7)' : 'rgba(252, 165, 165, 0.7)';
    buttonElement.style.transition = 'all 0.2s ease';

    window.setTimeout(() => {
        buttonElement.textContent = original;
        buttonElement.style.color = '';
        buttonElement.style.borderColor = '';
    }, 1200);
    return copied;
}
export function appendCopyButton(parent, value, label = t('recipeCopyParameter')) {
    const copy = button(parent, '', 'anomalous-recipe-copy-param anomalous-recipe-detail-copy');
    copy.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    copy.title = label;
    copy.setAttribute('aria-label', label);
    copy.onclick = () => { void copyTextWithFeedback(copy, value); };
    return copy;
}

export function needsExpansion(value) {
    const text = String(value || '');
    return text.length > 260 || text.split(/\r?\n/).length > 3;
}

export function appendValueViewer(parent, value, className = '', options = {}) {
    const text = displayValue(value);
    const viewer = document.createElement('div');
    viewer.className = `anomalous-recipe-detail-value-viewer${className ? ` ${className}` : ''}`;
    const code = appendText(viewer, 'code', text, 'anomalous-recipe-detail-full-value');
    if (options.collapse !== false && needsExpansion(text)) {
        code.classList.add('is-collapsed');
        const toggle = button(viewer, t('recipeDetailExpandValue'), 'anomalous-recipe-detail-value-toggle');
        toggle.onclick = () => {
            const expanded = code.classList.toggle('is-collapsed') === false;
            toggle.textContent = expanded ? t('recipeDetailCollapseValue') : t('recipeDetailExpandValue');
        };
    }
    if (options.copy !== false) appendCopyButton(viewer, text);
    parent.appendChild(viewer);
    return viewer;
}

export const PROMPT_ROLES = new Set(['positive', 'negative', 'both', 'ignored', 'unknown']);
const PROMPT_WIDGET_NAME = /^(?:text|prompt|text_[gl]|positive|negative)$/i;
