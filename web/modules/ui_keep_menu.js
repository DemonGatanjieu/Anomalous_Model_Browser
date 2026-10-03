/**
 * The keep menu of an output image (the star on gallery cards, Keep in the image
 * workbench): its whole workflow (Workflows page), its combo (Combos page) or its prompts
 * (saved prompts), each row saying where it goes; one kept already shows ✓ and opens it.
 * Keeping runs recipe_save.js / image_keep.js and says what happened in a toast with Open.
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { keepImageAsRecipe } from './recipe_save.js';
import { keepImageAsCombo, keepImagePrompts, keptKey, loadKeptImages } from './image_keep.js';

const NO_WORKFLOW = 'Image has no reusable UI workflow'; // the inspect route's message

const KINDS = Object.freeze([
    { kind: 'recipe', icon: '🪡', keep: keepImageAsRecipe, open: (owner, item) => owner.openRecipeByFilename(item.filename) },
    { kind: 'combo', icon: '🧩', keep: keepImageAsCombo, open: (owner, item) => owner.openComboByFilename(item.filename) },
    { kind: 'prompt', icon: '✍️', keep: keepImagePrompts, open: (owner, item) => owner.openSavedMaterial({ filename: item.filename, name: item.name }) },
]);

let closeOpenMenu = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Under the anchor, or above it when there is no room below; inside the window. */
function place(menu, anchor) {
    const box = anchor.getBoundingClientRect();
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
    const below = box.bottom + 6;
    menu.style.left = `${left}px`;
    menu.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, box.top - height - 6) : below}px`;
}

function keptMessage(spec, result) {
    if (result.existed) return t('keepExisted', { name: result.name });
    const message = t(`keptAs_${spec.kind}`, { name: result.name });
    return result.missing?.length ? `${message} ${t('keepComboMissing', { count: result.missing.length })}` : message;
}

async function keep(owner, spec, sourceImage, kept, { name, onKept, beforeOpen }) {
    try {
        const result = await spec.keep(sourceImage, { name });
        if (result.empty) {
            await anomalousAlert(t('keepNoPrompt'));
            return;
        }
        kept[spec.kind] = { filename: result.filename, name: result.name };
        onKept?.(kept);
        showWorkbenchToast(keptMessage(spec, result), {
            label: t('keepOpen'),
            run: () => {
                beforeOpen?.();
                spec.open(owner, kept[spec.kind]);
            },
        });
    } catch (error) {
        console.error(`[AMB] Could not keep the image as ${spec.kind}:`, error);
        await anomalousAlert(t(error?.message === NO_WORKFLOW ? 'keepNoWorkflow' : 'keepFailed'));
    }
}

/** Closes the menu that is open, if any. */
export function closeKeepMenu() {
    closeOpenMenu?.();
}

/**
 * Opens the menu at `anchor` for `sourceImage`. `name`: what to call what is kept (else the
 * image's suggested name); `onKept(kept)` gets the image's { recipe, combo, prompt } after a
 * keep; `beforeOpen()` runs before something kept is opened (the workbench closes itself).
 */
export async function openKeepMenu(owner, anchor, sourceImage, options = {}) {
    closeKeepMenu();
    const menu = el('div', 'anomalous-keep-menu');
    menu.setAttribute('role', 'menu');
    menu.append(el('p', 'anomalous-keep-menu-title', t('keepMenuTitle')), el('p', 'anomalous-keep-menu-wait', t('loading')));
    document.body.append(menu);
    place(menu, anchor);

    const onPointer = (event) => {
        if (!menu.contains(event.target) && !anchor.contains(event.target)) close();
    };
    const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
    };
    const close = () => {
        menu.remove();
        window.removeEventListener('pointerdown', onPointer, true);
        window.removeEventListener('keydown', onKey, true);
        if (closeOpenMenu === close) closeOpenMenu = null;
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    closeOpenMenu = close;

    let kept = {};
    try {
        kept = (await loadKeptImages()).get(keptKey(sourceImage)) || {};
    } catch (error) {
        console.warn('[AMB] Could not read what this image was kept as:', error);
    }
    if (closeOpenMenu !== close) return;
    kept = { recipe: kept.recipe || null, combo: kept.combo || null, prompt: kept.prompt || null };
    menu.querySelector('.anomalous-keep-menu-wait')?.remove();
    for (const spec of KINDS) {
        const item = kept[spec.kind];
        const row = el('button', `anomalous-keep-row${item ? ' is-kept' : ''}`);
        row.type = 'button';
        row.setAttribute('role', 'menuitem');
        const copy = el('span', 'anomalous-keep-row-copy');
        copy.append(el('strong', '', t(`keepAs_${spec.kind}`)),
            el('span', '', item ? t('keepKeptAs', { name: item.name }) : t(`keepAs_${spec.kind}Hint`)));
        row.append(el('span', 'anomalous-keep-row-icon', spec.icon), copy, el('span', 'anomalous-keep-row-mark', item ? '✓' : ''));
        row.onclick = () => {
            close();
            if (!item) {
                void keep(owner, spec, sourceImage, kept, options);
                return;
            }
            options.beforeOpen?.();
            spec.open(owner, item);
        };
        menu.append(row);
    }
    place(menu, anchor);
}
