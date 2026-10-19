/**
 * The toast after an output image was kept as a new combo (ui_keep_menu.js): the image's
 * thumbnail, what happened, the combo's name in a box to rename it on the spot (Enter or
 * leaving the box saves it, image_keep.js renameCombo) and Open. It stays while the pointer
 * or the focus is on it.
 */

import { translate as t } from './locales.js';
import { renameCombo } from './image_keep.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** The thumbnail URL of an output image ({ filename, subfolder }). */
export const outputThumbnail = image => `/anomalous/output_thumbnail?${new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '' })}`;

/**
 * Shows the toast for the combo `kept` ({ filename, name }) kept from `image`. `onRenamed(name)`
 * runs after a rename; `onOpen()` opens the combo.
 */
export function showKeptComboToast(image, kept, { message, onRenamed, onOpen }) {
    const toast = el('div', 'anomalous-mixer-toast has-action anomalous-kept-toast');
    toast.setAttribute('role', 'status');
    const thumb = el('img', 'anomalous-kept-toast-thumb');
    thumb.alt = '';
    thumb.src = outputThumbnail(image);
    thumb.onerror = () => thumb.remove();
    const body = el('div', 'anomalous-kept-toast-body');
    const line = el('span', 'anomalous-kept-toast-line', message);
    const input = el('input', 'anomalous-kept-toast-name');
    input.type = 'text';
    input.value = kept.name;
    input.maxLength = 100;
    input.title = t('keepRenameHint');
    input.setAttribute('aria-label', t('keepRenameHint'));
    body.append(line, input);
    const open = el('button', 'anomalous-mixer-toast-action', t('keepOpen'));
    open.type = 'button';
    toast.append(thumb, body, open);

    let timer = null;
    let saved = kept.name;
    const close = () => {
        clearTimeout(timer);
        toast.classList.remove('is-show');
        setTimeout(() => toast.remove(), 300);
    };
    const wait = () => {
        clearTimeout(timer);
        if (!toast.matches(':hover') && !toast.contains(document.activeElement)) timer = setTimeout(close, 12000);
    };
    const rename = async () => {
        const wanted = input.value.trim();
        if (!wanted || wanted === saved) {
            input.value = saved;
            return;
        }
        try {
            saved = await renameCombo(kept.filename, wanted);
            input.value = saved;
            line.textContent = t('keepRenamed', { name: saved });
            onRenamed?.(saved);
        } catch (error) {
            console.error('[AMB] Could not rename the kept combo:', error);
            input.value = saved;
            line.textContent = t('keepRenameFailed');
        }
    };
    input.onkeydown = (event) => {
        event.stopPropagation(); // the canvas and the browser keep their keys
        if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            input.value = saved;
            input.blur();
        }
    };
    input.onblur = () => void rename();
    open.onclick = async () => {
        await rename();
        close();
        onOpen?.();
    };
    toast.onpointerenter = () => clearTimeout(timer);
    toast.onpointerleave = wait;
    toast.addEventListener('focusin', () => clearTimeout(timer));
    toast.addEventListener('focusout', () => setTimeout(wait, 0));
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('is-show'), 10);
    wait();
}
