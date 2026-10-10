/**
 * Saving the canvas as a workflow, or updating the one being edited: the cover on the left (the
 * canvas, a recent picture, the current cover or none, picked under it), the name, tags and
 * notes on the right, Cancel and Save always in view. Resolves the details, or null.
 */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { appendText } from './ui_recipe_detail_dom.js';
import { outputImageUrl, safeThumbnail } from './ui_recipe_media.js';
import { outputThumbnailUrl } from './ui_recipe_gallery.js';
import { formatRecipeText } from './ui_recipe_dialogs.js';

const t = (key, params) => translate(key, params);
const RECENT_PICTURES = 9;

/** The canvas's workflow name when ComfyUI has saved it under one. */
function canvasWorkflowName() {
    const workflow = app.extensionManager?.workflow?.activeWorkflow;
    if (!workflow || workflow.isTemporary) return '';
    return String(workflow.filename || '').trim();
}

function field(parent, label, control) {
    const box = appendText(parent, 'label', '', 'anomalous-wfs-field');
    appendText(box, 'span', label, 'anomalous-wfs-label');
    box.appendChild(control);
    return box;
}

function textInput(className, value, maxLength, placeholder = '') {
    const input = document.createElement(className === 'anomalous-nb-textarea' ? 'textarea' : 'input');
    if (input.tagName === 'INPUT') input.type = 'text';
    input.className = className;
    input.maxLength = maxLength;
    input.placeholder = placeholder;
    input.value = value;
    return input;
}

/** The models without a saved fingerprint, and whether to work them out while saving. */
function verificationBox(parent, missing) {
    if (!missing.length) return null;
    const box = appendText(parent, 'div', '', 'anomalous-wfs-verify');
    appendText(box, 'strong', formatRecipeText('recipeVerificationMissing', { count: missing.length }));
    appendText(box, 'small', missing.map((reference) => reference.saved_value).join('、'), 'anomalous-wfs-hint');
    const choice = appendText(box, 'label', '', 'anomalous-wfs-check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    choice.append(input, document.createTextNode(t('recipeVerifyOnSave')));
    appendText(box, 'small', t('recipeVerifyOnSaveHint'), 'anomalous-wfs-hint');
    return input;
}

/**
 * The cover side: the chosen cover large, the choices under it. `selection` holds the choice
 * ({ thumbnail, sourceImage }); recent pictures load after the dialog shows.
 */
function coverSide(parent, selection, canvasThumbnail, initial) {
    const side = appendText(parent, 'div', '', 'anomalous-wfs-cover-side');
    const preview = appendText(side, 'div', '', 'anomalous-wfs-cover');
    const image = document.createElement('img');
    image.alt = t('recipeThumbnail');
    const empty = appendText(preview, 'span', t('recipeNoImage'), 'anomalous-wfs-cover-empty');
    preview.prepend(image);
    appendText(side, 'span', t('recipeBindImage'), 'anomalous-wfs-label');
    const choices = appendText(side, 'div', '', 'anomalous-wfs-choices');
    const status = appendText(side, 'small', t('recipeLoadingRecentImages'), 'anomalous-wfs-hint');

    const show = (url) => {
        image.hidden = !url;
        empty.hidden = Boolean(url);
        if (url) image.src = url;
        else image.removeAttribute('src');
    };
    const choice = (title, url, pick, selected = false) => {
        const tile = appendText(choices, 'button', '', `anomalous-wfs-choice${selected ? ' is-selected' : ''}`);
        tile.type = 'button';
        tile.title = title;
        tile.setAttribute('aria-label', title);
        if (url) {
            const thumb = document.createElement('img');
            thumb.loading = 'lazy';
            thumb.alt = '';
            thumb.src = url;
            tile.appendChild(thumb);
        } else {
            appendText(tile, 'span', '∅');
        }
        tile.onclick = () => {
            choices.querySelectorAll('.is-selected').forEach((other) => other.classList.remove('is-selected'));
            tile.classList.add('is-selected');
            pick();
        };
        return tile;
    };

    const keepUrl = safeThumbnail(initial?.thumbnail) || outputImageUrl(initial?.source_image);
    const canvasUrl = safeThumbnail(canvasThumbnail);
    choice(t('recipeNoImage'), '', () => {
        Object.assign(selection, { sourceImage: null, thumbnail: null });
        show('');
    }, !keepUrl && !canvasUrl);
    if (keepUrl) {
        choice(t('recipeKeepImage'), keepUrl, () => {
            Object.assign(selection, { sourceImage: initial?.source_image || null, thumbnail: safeThumbnail(initial?.thumbnail) });
            show(keepUrl);
        }, true);
    }
    if (canvasUrl) {
        choice(t('recipeCanvasPreview'), canvasUrl, () => {
            Object.assign(selection, { sourceImage: null, thumbnail: canvasUrl });
            show(canvasUrl);
        }, !keepUrl);
    }
    show(keepUrl || canvasUrl);

    fetch(`/anomalous/gallery_images?page=1&limit=${RECENT_PICTURES}`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('image list failed')))
        .then((payload) => {
            status.textContent = '';
            for (const picture of payload.images || []) {
                const source = { filename: picture.filename, subfolder: picture.subfolder || '', type: 'output' };
                if (!outputImageUrl(source)) continue;
                const thumb = outputThumbnailUrl(source);
                choice(picture.filename, thumb, () => {
                    Object.assign(selection, { sourceImage: source, thumbnail: null });
                    show(thumb);
                });
            }
        })
        .catch((error) => {
            console.warn('Could not load recent recipe images:', error);
            status.textContent = t('recipeRecentImagesUnavailable');
        });
}

export function showRecipeSaveDialog(owner, { canvasThumbnail, workflowScope, modelAudit, initial = null }) {
    return new Promise((resolve) => {
        const selection = {
            thumbnail: safeThumbnail(initial?.thumbnail) || (initial?.source_image ? null : safeThumbnail(canvasThumbnail)),
            sourceImage: initial?.source_image || null,
            // A saved snapshot is what makes the cover portable in an export. Keep an explicit
            // opt-out; new and older recipes without a stored preference save one.
            saveModelPreviewSnapshots: initial?.presentation?.save_model_preview_snapshots ?? true,
        };

        const overlay = document.createElement('div');
        overlay.className = 'anomalous-recipe-dialog-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        const dialog = appendText(overlay, 'div', '', 'anomalous-recipe-dialog anomalous-wfs-dialog');

        const head = appendText(dialog, 'div', '', 'anomalous-wfs-head');
        const titles = appendText(head, 'div', '', 'anomalous-wfs-titles');
        appendText(titles, 'h3', t(initial ? 'recipeUpdateCurrent' : 'recipeSaveTitle'));
        appendText(titles, 'p', t(workflowScope === 'partial' ? 'recipeScopePartialSaveHint' : 'recipeScopeCompleteSaveHint'), 'anomalous-wfs-hint');
        const shut = appendText(head, 'button', '×', 'anomalous-wfs-close');
        shut.type = 'button';
        shut.setAttribute('aria-label', t('recipeCancel'));

        const body = appendText(dialog, 'div', '', 'anomalous-wfs-body');
        coverSide(body, selection, canvasThumbnail, initial);
        const fields = appendText(body, 'div', '', 'anomalous-wfs-fields');
        const nameInput = textInput('anomalous-nb-select', initial?.name || canvasWorkflowName() || t('recipeDefaultName'), 120);
        field(fields, t('recipeName'), nameInput);
        const tagsInput = textInput('anomalous-nb-select', Array.isArray(initial?.tags) ? initial.tags.join(', ') : '', 300, t('recipeTagsHint'));
        field(fields, t('recipeTags'), tagsInput);
        const notesInput = textInput('anomalous-nb-textarea', initial?.notes || '', 3000, t('recipeNotesHint'));
        field(fields, t('recipeNotes'), notesInput);
        const verifyInput = verificationBox(fields, modelAudit?.verifiableMissing || []);

        const foot = appendText(dialog, 'div', '', 'anomalous-wfs-foot');
        const error = appendText(foot, 'div', '', 'anomalous-recipe-dialog-error');
        const cancel = appendText(foot, 'button', t('recipeCancel'), 'anomalous-wfs-cancel');
        const save = appendText(foot, 'button', t('recipeSave'), 'anomalous-btn-primary');
        cancel.type = 'button';
        save.type = 'button';

        const close = (value) => {
            overlay.remove();
            resolve(value);
        };
        const submit = () => {
            const name = nameInput.value.trim();
            if (!name) {
                error.textContent = t('recipeNameRequired');
                nameInput.focus();
                return;
            }
            close({
                name,
                tags: [...new Set(tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
                notes: notesInput.value.trim(),
                thumbnail: selection.thumbnail,
                sourceImage: selection.sourceImage,
                saveModelPreviewSnapshots: selection.saveModelPreviewSnapshots,
                verifyModelIdentities: Boolean(verifyInput?.checked),
            });
        };
        shut.onclick = () => close(null);
        cancel.onclick = () => close(null);
        save.onclick = submit;
        overlay.onclick = (event) => {
            if (event.target === overlay) close(null);
        };
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close(null);
            } else if (event.key === 'Enter' && event.target === nameInput) {
                submit();
            }
        });
        (owner.nbPanel || document.body).appendChild(overlay);
        nameInput.focus();
        nameInput.select();
    });
}
