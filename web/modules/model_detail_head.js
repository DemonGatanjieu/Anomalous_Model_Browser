/**
 * The top of a model's details, beside its cover, laid out like a profile: back (a crumb, "Models / LoRA", or back to
 * Model Check, the assistant or the model before; Esc presses it), the name big (a Civitai name "Model - v2" split:
 * the model's name, then its version in small grey), one small accent line (its type, size, base, source and the
 * source links), and one row of actions: Add node (the one filled button, the rest plain words),
 * Edit, Folder (its tooltip shows the path), Outputs, Change type (ui_model_retype.js: filed under
 * the wrong type, it moves to another) and Hand to AI (ui_ai_handoff.js). The path, Copy and Delete are at the
 * foot of the details (model_location.js). Where the page is too narrow for the cover column,
 * a small cover sits beside the name instead. Under the name, the other versions of the model
 * downloaded here (ui_model_versions.js), `onOpen(model)` showing one.
 */

import { translate as t } from './locales.js';
import { renderDetailLinks, renderSourceLine } from './model_source.js';
import { showInFolder } from './model_location.js';
import { cardPosterUrl, cardPreviewUrl } from './ui_grid.js';
import { typeLabel } from './ui_model_types.js';
import { handModelToAi } from './ui_ai_handoff.js';
import { openRetype } from './ui_model_retype.js';
import { detailVersionRow } from './ui_model_versions.js';

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

function smallCover(owner, model) {
    if (!model.preview_url) return null;
    const cover = el('img', 'anomalous-detail-head-cover');
    cover.alt = '';
    cover.src = /\.(mp4|webm)(?:&|$)/i.test(model.preview_url)
        ? cardPosterUrl(model.preview_url) : cardPreviewUrl(model.preview_url, owner.cardThumbnailMode);
    return cover;
}

/** The type the models page lists `owner`'s models under ("LoRA", without its count), or its folder type. */
function typeName(owner) {
    const group = (owner.foldersData || []).find(item => item.type === owner.currentType && item.path_idx === owner.currentPathIdx);
    return group ? typeLabel(group).replace(/\s*\(\d+\)$/, '') : owner.currentType || '';
}

/**
 * [the name to show big, the version under it]: a name that ends in its Civitai version ("Model - v2", or the scan's
 * "Model_v2") in two, the model and the version; else the name as it is, the version under it when it is not in it.
 */
export function titleOf(model, meta = model.metadata || {}) {
    const version = String(meta.version_name || '').trim();
    const name = String(meta.custom_name || meta.name || model.filename.replace(/\.[^.]+$/, '')).trim();
    if (version && name.length > version.length && name.endsWith(version)) {
        const head = name.slice(0, -version.length).replace(/[\s_\-–·]+$/, '');
        if (head) return [head, version];
    }
    return [name, version && !name.includes(version) ? version : ''];
}

/** `onBack()` leads back and `onOpen(model)` shows another version (ui_detail.js owns both). */
export function createDetailHead(owner, model, onBack, onOpen) {
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
    const [big, version] = titleOf(model, meta);
    const name = el('h2', 'anomalous-detail-name', big);
    name.title = model.filename;
    title.append(name);
    if (version) title.append(el('div', 'anomalous-detail-sub', version));
    const facts = el('div', 'anomalous-detail-facts');
    const line = el('span', 'anomalous-detail-source');
    renderSourceLine(line, model, meta);
    const type = typeName(owner);
    if (type) line.prepend(el('span', '', type), el('span', 'anomalous-source-sep', ' · '));
    facts.append(line, renderDetailLinks(meta));
    title.append(facts);
    const versions = detailVersionRow(owner, model, onOpen);
    if (versions) title.append(versions);
    named.append(title);

    const actions = el('div', 'anomalous-detail-actions');
    actions.append(
        button('anomalous-detail-action is-primary', t('applyToCanvas'), () => owner.applyModelToCanvas(owner.currentType, owner.currentSubfolder, model)),
        button('anomalous-detail-action', t('detailEdit'), () => owner.showEditModal(model)),
        button('anomalous-detail-action', t('detailFolder'), () => showInFolder(model, where),
            `${t('detailOpenFolder')}\n${model.file_path || model.filename}`),
        button('anomalous-detail-action', t('detailOutputs'), () => owner.showGeneratedGallery(model), t('detailGeneratedGallery')),
        button('anomalous-detail-action', t('retypeAction'), () => openRetype(owner, {
            type: where.type, root: where.path_idx, name: name.textContent,
            rel: [String(where.subfolder || '').replace(/^\/+|\/+$/g, ''), model.filename].filter(Boolean).join('/'),
        }, onBack), t('retypeHint')),
        button('anomalous-detail-action', `✦ ${t('aiHand')}`, () => handModelToAi(owner, model, where), t('aiHandHint')),
    );

    head.append(crumb, named, actions);
    return head;
}
