/**
 * Words the user hides from the AI inside a text it otherwise reads (the gist of the prompt box,
 * a message of a private task). The button marks what is selected \u27e6like this\u27e7; Anomalous seals
 * the marked words when the text is handed in (api/ai_sealed.py seal_marked), so the AI gets a
 * token in their place. withHidden() shows such a text to the user again, each token as the
 * words it stands for.
 */

import { translate as t } from './locales.js';

const OPEN = '\u27e6';
const CLOSE = '\u27e7';

/** The button for text field `field`; `say(text)` tells the user why nothing was marked. */
export function hideButton(field, say) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'anomalous-ai-hide-mark';
    node.textContent = t('aiHideMark');
    node.title = t('aiHideMarkHint');
    node.addEventListener('mousedown', event => event.preventDefault()); // the field keeps its selection
    node.onclick = () => {
        const picked = field.value.slice(field.selectionStart, field.selectionEnd);
        if (!picked.trim() || picked.includes(OPEN) || picked.includes(CLOSE)) {
            say?.(t('aiHideMarkNone'));
            return;
        }
        field.setRangeText(`${OPEN}${picked}${CLOSE}`, field.selectionStart, field.selectionEnd, 'end');
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.focus();
    };
    return node;
}

/** `text` as the user wrote it: the tokens of `sealed` (the task's) as their words, marked. */
export function withHidden(text, sealed) {
    return String(text ?? '').replace(/\[P\d+\]/g, token => (typeof sealed?.[token] === 'string' ? `${OPEN}${sealed[token]}${CLOSE}` : token));
}
