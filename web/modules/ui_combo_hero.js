/**
 * The head of a combo's editor (ui_notebook_editor.js, and the node-structure combos of
 * ui_combo_structure.js): its picture (the output image it was kept from, with See the
 * picture; else its main model's cover), its name with a Rename button (a click on the name
 * renames too; saved at once), what it holds as small chips (base model, main model, LoRAs;
 * a structure's models), Put on canvas and More (delete, asked twice). Every change in the
 * editor saves itself, so there is no Save button.
 */

import { translate as t } from './locales.js';
import { anomalousPrompt } from './ui_dialog.js';
import { outputThumbnail } from './ui_kept_toast.js';
import { STRUCTURED } from './combo_slots.js';
import { structuredComboMeta } from './ui_combo_structure.js';
import { UNLABELED_BASE_MODEL } from './notebook_canvas.js';

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

/** A model's name as its card shows it. */
export const comboModelName = model => String(model?.metadata?.custom_name || '').trim()
    || String(model?.filename || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');

/** A model's cover at card size ('' without one; a video's still frame). */
export function comboModelCover(model) {
    const url = model?.preview_url;
    if (!url) return '';
    return `${url}${url.includes('?') ? '&' : '?'}${/\.(mp4|webm)(?:&|$)/i.test(url) ? 'variant=poster' : 'variant=card'}`;
}

/** The chips: what the combo holds. */
function chipsOf(data) {
    if (data.kind === STRUCTURED) {
        const meta = structuredComboMeta(data);
        return [[meta.meta, ''], [meta.hint, 'is-warn']].filter(([text]) => text);
    }
    const base = data.baseModel === UNLABELED_BASE_MODEL ? t('notebookUnlabeledBase') : data.baseModel;
    const loras = (data.loras || []).length;
    return [
        [base, 'is-base'],
        [data.mainModel ? comboModelName(data.mainModel) : t('comboNoMainModel'), data.mainModel ? '' : 'is-warn'],
        [loras ? t('comboLoraCount', { count: loras }) : t('comboNoLora'), ''],
    ].filter(([text]) => text);
}

/** More: delete, which asks once more on the button itself. */
function moreMenu(ctx, hero) {
    const wrapper = el('div', 'anomalous-nb-dropdown-wrapper');
    const more = button('anomalous-nb-more-btn anomalous-combo-hero-more', `${t('notebookMore')} ▾`, (event) => {
        event.stopPropagation();
        const open = menu.classList.toggle('show');
        more.classList.toggle('active', open);
        if (!open) reset();
    });
    const menu = el('div', 'anomalous-nb-dropdown-menu');
    const remove = button('anomalous-nb-dropdown-item anomalous-nb-dropdown-item-danger', `🗑️ ${t('deleteNotebook')}`, (event) => {
        event.stopPropagation();
        if (!remove.classList.contains('confirming')) {
            remove.classList.add('confirming');
            remove.textContent = `⚠️ ${t('delSure').replace(/^⚠️\s*/, '')}`;
            timer = setTimeout(reset, 4000);
            return;
        }
        reset();
        close();
        ctx.deleteCurrentNotebook();
    });
    let timer = 0;
    const reset = () => {
        clearTimeout(timer);
        remove.classList.remove('confirming');
        remove.textContent = `🗑️ ${t('deleteNotebook')}`;
    };
    const close = () => {
        menu.classList.remove('show');
        more.classList.remove('active');
    };
    const onClick = (event) => {
        if (!hero.isConnected) {
            document.removeEventListener('click', onClick);
            return;
        }
        if (!wrapper.contains(event.target)) {
            close();
            reset();
        }
    };
    document.addEventListener('click', onClick);
    menu.append(remove);
    wrapper.append(more, menu);
    return wrapper;
}

/** The head for `notebook` ({ filename, name, data }); `ctx` is the browser. */
export function createComboHero(ctx, notebook) {
    const data = notebook.data || {};
    const hero = el('header', 'anomalous-combo-hero');
    const image = data.source_image?.filename ? data.source_image : null;

    const pictureBox = el('div', 'anomalous-combo-hero-picture');
    const frame = image ? button('anomalous-combo-hero-frame is-image', undefined, () => openImage()) : el('div', 'anomalous-combo-hero-frame');
    if (image) frame.title = t('comboFromImageOpen');
    const openImage = () => {
        const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '' });
        ctx.showGalleryViewer?.(`/view?${query}&type=output`);
    };
    const drawPicture = () => {
        const src = image ? outputThumbnail(image)
            : data.kind === STRUCTURED ? structuredComboMeta(data).cover : comboModelCover(data.mainModel);
        frame.replaceChildren();
        if (!src) {
            frame.append(el('span', 'anomalous-combo-hero-empty', '🧩'));
            return;
        }
        const img = el('img');
        img.alt = '';
        img.src = src;
        img.onerror = () => frame.replaceChildren(el('span', 'anomalous-combo-hero-empty', '🧩'));
        frame.append(img);
    };
    pictureBox.append(frame);
    if (image) pictureBox.append(button('anomalous-combo-hero-view', `🖼 ${t('comboSeePicture')}`, openImage));

    const info = el('div', 'anomalous-combo-hero-info');
    const eyebrow = el('span', 'anomalous-combo-hero-eyebrow', image ? t('comboEyebrowKept') : t('comboEyebrow'));
    const nameRow = el('div', 'anomalous-combo-hero-name-row');
    const name = el('h2', 'anomalous-combo-hero-name', notebook.name);
    name.title = t('comboRenameHint');
    const renameButton = button('anomalous-combo-hero-rename', `✎ ${t('comboRename')}`, () => void rename());
    const rename = async () => {
        const wanted = String(await anomalousPrompt(t('comboRenameAsk'), notebook.name, t('comboRename')) || '').trim().slice(0, 100);
        if (!wanted || wanted === notebook.name) return;
        const before = notebook.name;
        // In place: the editor below holds this same data object.
        const named = (value) => {
            notebook.name = value;
            data.name = value;
            name.textContent = value;
        };
        named(wanted);
        if (!await ctx.saveCurrentNotebook()) named(before);
    };
    name.onclick = () => void rename();
    nameRow.append(name, renameButton);

    const chips = el('div', 'anomalous-combo-hero-chips');
    const drawChips = () => chips.replaceChildren(...chipsOf(data).map(([text, kind]) => el('span', `anomalous-combo-hero-chip ${kind}`.trim(), text)));

    const actions = el('div', 'anomalous-combo-hero-actions');
    const use = button('anomalous-btn-success anomalous-combo-hero-use', t('comboUse'), () => ctx.sendNotebookToCanvas());
    use.title = t('comboUseHint');
    actions.append(use, moreMenu(ctx, hero));

    info.append(eyebrow, nameRow, chips, actions);
    hero.append(pictureBox, info);
    // The models part below calls this after each change.
    ctx.updateNotebookModelsSummary = () => {
        drawChips();
        if (!image) drawPicture();
    };
    drawPicture();
    drawChips();
    return hero;
}
