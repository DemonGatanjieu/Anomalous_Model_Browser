/**
 * The top of a model's details, beside its cover: back (a crumb, "Models / LoRA", or back to
 * Model Check, the assistant or the model before; Esc presses it), the name, the size / base /
 * source line with the source links, and one row of actions: Add node (the one blue button),
 * Edit, Folder, Outputs and ⋯ (Copy path, Copy file name, Delete). Where the page is too narrow
 * for the cover column, a small cover sits beside the name instead.
 */

import { translate as t } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { renderDetailLinks, renderSourceLine } from './model_source.js';
import { copyToClipboard, showInFolder } from './model_location.js';
import { cardPosterUrl, cardPreviewUrl } from './ui_grid.js';
import { typeLabel } from './ui_model_types.js';
import { openActionMenu } from './action_menu.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title = '') {
    const node = el('button', className, label);
    node.type = 'button';
    if (title) node.title = title;
    node.onclick = onClick;
    return node;
}

/** Where back leads, as the crumb says it; true second when it leads off the models page. */
function backLabel(owner) {
    const last = owner.historyStack.at(-1);
    if (last?.type === 'doctor') return [t('detailBackDoctor'), true];
    if (last?.type === 'assistant') return [t('detailBackAssistant'), true];
    if (owner.historyStack.length) return [t('detailBackPrevModel'), false];
    if (typeof owner.recipeModelReturn === 'function') return [t('detailBack'), true];
    const group = (owner.foldersData || []).find(item => item.type === owner.currentType && item.path_idx === owner.currentPathIdx);
    return [t('detailBackModels', { type: group ? typeLabel(group) : owner.currentType }), false];
}

async function deleteModel(owner, model, where) {
    if (!await anomalousConfirm(`${t('delConfirm')} ${model.filename} ${t('delConfirm2')}`, t('delModel'), { okLabel: t('delModel') })) return;
    try {
        const response = await fetch('/anomalous/delete_model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...where, filename: model.filename }),
        });
        const data = await response.json();
        if (data.status !== 'success') throw new Error(data.message);
        owner.currentDetailObserver?.disconnect();
        owner.currentDetailObserver = null;
        owner.detailPanel.style.display = 'none';
        owner.stopMediaInContainer(owner.detailPanel);
        owner.detailPanel.replaceChildren();
        owner.grid.style.display = 'grid';
        owner.loadModels();
        await anomalousAlert(t('delSuccess') + data.deleted.join('\n') + t('delNote'));
    } catch (error) {
        await anomalousAlert(t('delFail') + error.message);
    }
}

function smallCover(owner, model) {
    if (!model.preview_url) return null;
    const cover = el('img', 'anomalous-detail-head-cover');
    cover.alt = '';
    cover.src = /\.(mp4|webm)(?:&|$)/i.test(model.preview_url)
        ? cardPosterUrl(model.preview_url) : cardPreviewUrl(model.preview_url, owner.cardThumbnailMode);
    return cover;
}

/** `onBack()` leads back (ui_detail.js owns where to). */
export function createDetailHead(owner, model, onBack) {
    const meta = model.metadata || {};
    const where = { type: owner.currentType, path_idx: owner.currentPathIdx, subfolder: owner.currentSubfolder };
    const head = el('div', 'anomalous-detail-head');

    const [crumbText, leavesPage] = backLabel(owner);
    const crumb = button('anomalous-detail-back', crumbText, onBack, t('detailBackHint'));
    crumb.classList.toggle('is-leaving', leavesPage);

    const named = el('div', 'anomalous-detail-named');
    const cover = smallCover(owner, model);
    if (cover) named.append(cover);
    const title = el('div', 'anomalous-detail-title');
    const name = el('h2', 'anomalous-detail-name', meta.custom_name || meta.name || model.filename);
    name.title = model.filename;
    const facts = el('div', 'anomalous-detail-facts');
    const line = el('span', 'anomalous-detail-source');
    renderSourceLine(line, model, meta);
    facts.append(line, renderDetailLinks(meta));
    title.append(name, facts);
    named.append(title);

    let closeMenu = null;
    const more = button('anomalous-detail-action', '⋯', () => {
        if (closeMenu) return closeMenu();
        closeMenu = openActionMenu(more, [
            ...(model.file_path ? [{ icon: '📋', label: t('detailCopyPath'), run: () => copyToClipboard(model.file_path, 'detailPathCopied') }] : []),
            { icon: '🏷️', label: t('detailCopyFilename'), run: () => copyToClipboard(model.filename, 'detailFilenameCopied') },
            { icon: '🗑️', label: t('delModel'), run: () => deleteModel(owner, model, where), danger: true },
        ], { onClose: () => { closeMenu = null; } });
    }, t('detailMore'));
    more.setAttribute('aria-label', t('detailMore'));
    const actions = el('div', 'anomalous-detail-actions');
    actions.append(
        button('anomalous-detail-action is-primary', t('applyToCanvas'), () => owner.applyModelToCanvas(owner.currentType, owner.currentSubfolder, model)),
        button('anomalous-detail-action', t('detailEdit'), () => owner.showEditModal(model)),
        button('anomalous-detail-action', t('detailFolder'), () => showInFolder(model, where), t('detailOpenFolder')),
        button('anomalous-detail-action', t('detailOutputs'), () => owner.showGeneratedGallery(model), t('detailGeneratedGallery')),
        more,
    );

    head.append(crumb, named, actions);
    return head;
}
