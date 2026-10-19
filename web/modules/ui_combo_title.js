/**
 * The title of the combo editor's toolbar (ui_notebook_editor.js): the combo's name, which a
 * click renames (saved at once), and for a combo kept from an output image that image's
 * thumbnail, which opens the image in the viewer.
 */

import { translate as t } from './locales.js';
import { anomalousPrompt } from './ui_dialog.js';
import { outputThumbnail } from './ui_kept_toast.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** The title box for `notebook` ({ filename, name, data }); `ctx` is the browser. */
export function createComboTitle(ctx, notebook) {
    const box = el('div', 'anomalous-combo-title');
    const image = notebook.data?.source_image;
    if (image?.filename) {
        const thumb = el('button', 'anomalous-combo-title-image');
        thumb.type = 'button';
        thumb.title = t('comboFromImageOpen');
        thumb.setAttribute('aria-label', t('comboFromImageOpen'));
        const img = el('img');
        img.alt = '';
        img.src = outputThumbnail(image);
        thumb.append(img);
        const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '' });
        thumb.onclick = () => ctx.showGalleryViewer?.(`/view?${query}&type=output`);
        box.append(thumb);
    } else {
        box.append(el('span', 'anomalous-combo-title-icon', '📝'));
    }
    const name = el('h3', 'anomalous-combo-title-name', notebook.name);
    name.tabIndex = 0;
    name.title = t('comboRenameHint');
    const rename = async () => {
        const wanted = String(await anomalousPrompt(t('comboRenameAsk'), notebook.name, t('comboRename')) || '').trim().slice(0, 100);
        if (!wanted || wanted === notebook.name) return;
        const before = notebook.name;
        // In place: the editor below holds this same data object.
        const named = (value) => {
            notebook.name = value;
            notebook.data.name = value;
            name.textContent = value;
        };
        named(wanted);
        if (!await ctx.saveCurrentNotebook()) named(before);
    };
    name.onclick = () => void rename();
    name.onkeydown = (event) => {
        if (!['Enter', 'F2'].includes(event.key)) return;
        event.preventDefault();
        void rename();
    };
    box.append(name);
    return box;
}
