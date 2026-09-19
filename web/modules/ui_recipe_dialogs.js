/** Save and edit dialogs for Workflow Recipes. */

import { translate } from "./locales.js";
import { anomalousAlert, anomalousConfirm } from "./ui_dialog.js";
import { appendText } from "./ui_recipe_detail_dom.js";
import { outputImageUrl, safeThumbnail } from "./ui_recipe_media.js";

const t = (key, params) => translate(key, params);
const RECIPE_PRESENTATION_DEFAULTS = Object.freeze({ saveModelPreviewSnapshots: true });

export function formatRecipeText(key, values = {}) {
    return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), t(key));
}

export function showRecipeSaveDialog(owner, canvasThumbnail, workflowScope, modelAudit, initial = null) {
    return new Promise((resolve) => {
        const selection = {
            thumbnail: safeThumbnail(initial?.thumbnail) || safeThumbnail(canvasThumbnail),
            sourceImage: initial?.source_image || null,
            // A saved snapshot is what makes the cover portable in an export.
            // Preserve an explicit opt-out, but enable the sharing-oriented
            // behavior for new and legacy recipes without a stored preference.
            saveModelPreviewSnapshots: initial?.presentation?.save_model_preview_snapshots
                ?? RECIPE_PRESENTATION_DEFAULTS.saveModelPreviewSnapshots,
        };
        const overlay = document.createElement('div');
        overlay.className = 'anomalous-recipe-dialog-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        const dialog = document.createElement('div');
        dialog.className = 'anomalous-recipe-dialog';
        appendText(dialog, 'h3', t('recipeSaveTitle'));
        appendText(
            dialog,
            'p',
            t(workflowScope === 'partial' ? 'recipeScopePartialSaveHint' : 'recipeScopeCompleteSaveHint'),
            'anomalous-recipe-detail-muted',
        );

        const nameLabel = appendText(dialog, 'label', t('recipeName'));
        const nameInput = document.createElement('input');
        nameInput.className = 'anomalous-nb-select';
        nameInput.type = 'text';
        nameInput.maxLength = 120;
        nameInput.value = initial?.name || t('recipeDefaultName');
        nameLabel.appendChild(nameInput);

        const tagsLabel = appendText(dialog, 'label', t('recipeTags'));
        const tagsInput = document.createElement('input');
        tagsInput.className = 'anomalous-nb-select';
        tagsInput.type = 'text';
        tagsInput.maxLength = 300;
        tagsInput.placeholder = t('recipeTagsHint');
        tagsInput.value = Array.isArray(initial?.tags) ? initial.tags.join(', ') : '';
        tagsLabel.appendChild(tagsInput);

        const notesLabel = appendText(dialog, 'label', t('recipeNotes'));
        const notesInput = document.createElement('textarea');
        notesInput.className = 'anomalous-nb-textarea';
        notesInput.maxLength = 3000;
        notesInput.placeholder = t('recipeNotesHint');
        notesInput.value = initial?.notes || '';
        notesLabel.appendChild(notesInput);

        const verifiableMissing = modelAudit?.verifiableMissing || [];
        let verifyModelIdentitiesInput = null;
        if (verifiableMissing.length) {
            const verificationSection = document.createElement('section');
            verificationSection.className = 'anomalous-recipe-save-section';
            appendText(
                verificationSection,
                'strong',
                formatRecipeText('recipeVerificationMissing', { count: verifiableMissing.length }),
            );
            appendText(
                verificationSection,
                'small',
                verifiableMissing.map((reference) => reference.saved_value).join('、'),
                'anomalous-recipe-node-hint',
            );
            const verificationChoice = document.createElement('label');
            verificationChoice.className = 'anomalous-recipe-checkbox';
            verifyModelIdentitiesInput = document.createElement('input');
            verifyModelIdentitiesInput.type = 'checkbox';
            verifyModelIdentitiesInput.checked = false;
            verificationChoice.append(
                verifyModelIdentitiesInput,
                document.createTextNode(t('recipeVerifyOnSave')),
            );
            verificationSection.appendChild(verificationChoice);
            appendText(
                verificationSection,
                'small',
                t('recipeVerifyOnSaveHint'),
                'anomalous-recipe-node-hint',
            );
            dialog.appendChild(verificationSection);
        }

        const coverSection = document.createElement('section');
        coverSection.className = 'anomalous-recipe-save-section';
        appendText(coverSection, 'strong', t('recipeBindImage'));
        const coverChoices = document.createElement('div');
        coverChoices.className = 'anomalous-recipe-cover-choices';
        const coverPreview = document.createElement('img');
        coverPreview.className = 'anomalous-recipe-dialog-preview';
        coverPreview.alt = t('recipeThumbnail');
        const initialPreview = selection.thumbnail || outputImageUrl(selection.sourceImage);
        if (initialPreview) coverPreview.src = initialPreview;
        else coverPreview.style.display = 'none';

        const choiceButtons = [];
        const selectCover = (button, sourceImage, previewUrl, thumbnailValue) => {
            for (const choice of choiceButtons) choice.classList.toggle('selected', choice === button);
            selection.sourceImage = sourceImage;
            selection.thumbnail = thumbnailValue;
            if (previewUrl) {
                coverPreview.src = previewUrl;
                coverPreview.style.display = 'block';
            } else {
                coverPreview.removeAttribute('src');
                coverPreview.style.display = 'none';
            }
        };

        const noneChoice = appendText(coverChoices, 'button', t('recipeNoImage'), 'anomalous-recipe-cover-choice');
        noneChoice.type = 'button';
        choiceButtons.push(noneChoice);
        noneChoice.onclick = () => selectCover(noneChoice, null, null, null);
        if (safeThumbnail(initial?.thumbnail) || initial?.source_image) {
            const existingChoice = appendText(coverChoices, 'button', t('recipeKeepImage'), 'anomalous-recipe-cover-choice selected');
            existingChoice.type = 'button';
            choiceButtons.push(existingChoice);
            existingChoice.onclick = () => selectCover(
                existingChoice,
                initial?.source_image || null,
                safeThumbnail(initial?.thumbnail) || outputImageUrl(initial?.source_image),
                safeThumbnail(initial?.thumbnail),
            );
        }
        if (safeThumbnail(canvasThumbnail)) {
            const canvasChoice = document.createElement('button');
            canvasChoice.type = 'button';
            canvasChoice.className = `anomalous-recipe-cover-choice${initial ? '' : ' selected'}`;
            const canvasImage = document.createElement('img');
            canvasImage.src = canvasThumbnail;
            canvasImage.alt = t('recipeCanvasPreview');
            appendText(canvasChoice, 'span', t('recipeCanvasPreview'));
            canvasChoice.prepend(canvasImage);
            choiceButtons.push(canvasChoice);
            canvasChoice.onclick = () => selectCover(canvasChoice, null, canvasThumbnail, safeThumbnail(canvasThumbnail));
        } else if (!initial) {
            noneChoice.classList.add('selected');
        }

        const recentStatus = appendText(coverSection, 'small', t('recipeLoadingRecentImages'), 'anomalous-recipe-node-hint');
        coverSection.append(coverChoices, coverPreview);
        dialog.appendChild(coverSection);

        fetch('/anomalous/gallery_images?page=1&limit=12')
            .then((response) => response.ok ? response.json() : Promise.reject(new Error('image list failed')))
            .then((payload) => {
                recentStatus.textContent = t('recipeRecentImages');
                for (const imageData of payload.images || []) {
                    const url = outputImageUrl(imageData);
                    if (!url) continue;
                    const choice = document.createElement('button');
                    choice.type = 'button';
                    choice.className = 'anomalous-recipe-cover-choice anomalous-recipe-output-choice';
                    const image = document.createElement('img');
                    image.src = url;
                    image.loading = 'lazy';
                    image.alt = imageData.filename;
                    choice.appendChild(image);
                    choice.title = imageData.filename;
                    choiceButtons.push(choice);
                    choice.onclick = () => selectCover(choice, {
                        filename: imageData.filename,
                        subfolder: imageData.subfolder || '',
                        type: 'output',
                    }, url, null);
                    coverChoices.appendChild(choice);
                }
            })
            .catch((error) => {
                console.warn('Could not load recent recipe images:', error);
                recentStatus.textContent = t('recipeRecentImagesUnavailable');
            });

        const error = appendText(dialog, 'div', '', 'anomalous-recipe-dialog-error');
        const actions = document.createElement('div');
        actions.className = 'anomalous-recipe-actions';
        const cancel = appendText(actions, 'button', t('recipeCancel'), 'anomalous-btn-danger');
        const save = appendText(actions, 'button', t('recipeSave'), 'anomalous-btn-primary');
        cancel.type = 'button';
        save.type = 'button';

        const close = (value) => {
            overlay.remove();
            resolve(value);
        };
        cancel.onclick = () => close(null);
        overlay.onclick = (event) => {
            if (event.target === overlay) close(null);
        };
        save.onclick = () => {
            const name = nameInput.value.trim();
            if (!name) {
                error.textContent = t('recipeNameRequired');
                nameInput.focus();
                return;
            }
            const tags = [...new Set(tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
            close({
                name,
                tags,
                notes: notesInput.value.trim(),
                thumbnail: selection.thumbnail,
                sourceImage: selection.sourceImage,
                saveModelPreviewSnapshots: selection.saveModelPreviewSnapshots,
                verifyModelIdentities: Boolean(verifyModelIdentitiesInput?.checked),
            });
        };
        dialog.appendChild(actions);
        overlay.appendChild(dialog);
        (owner.nbPanel || document.body).appendChild(overlay);
        nameInput.focus();
        nameInput.select();
    });
}

export function showRecipeEditDialog(owner, recipeData, filename, history) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'anomalous-recipe-dialog-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        const dialog = document.createElement('div');
        dialog.className = 'anomalous-recipe-dialog anomalous-recipe-edit-dialog';
        appendText(dialog, 'h3', t('recipeEditTitle'));

        const nameLabel = appendText(dialog, 'label', t('recipeName'));
        const nameInput = document.createElement('input');
        nameInput.className = 'anomalous-nb-select';
        nameInput.type = 'text';
        nameInput.maxLength = 120;
        nameInput.value = recipeData.name || '';
        nameLabel.appendChild(nameInput);

        const tagsLabel = appendText(dialog, 'label', t('recipeTags'));
        const tagsInput = document.createElement('input');
        tagsInput.className = 'anomalous-nb-select';
        tagsInput.type = 'text';
        tagsInput.maxLength = 300;
        tagsInput.value = Array.isArray(recipeData.tags) ? recipeData.tags.join(', ') : '';
        tagsInput.placeholder = t('recipeTagsHint');
        tagsLabel.appendChild(tagsInput);

        const notesLabel = appendText(dialog, 'label', t('recipeNotes'));
        const notesInput = document.createElement('textarea');
        notesInput.className = 'anomalous-nb-textarea';
        notesInput.maxLength = 3000;
        notesInput.value = recipeData.notes || '';
        notesInput.placeholder = t('recipeNotesHint');
        notesLabel.appendChild(notesInput);

        const historyDetails = document.createElement('details');
        historyDetails.className = 'anomalous-recipe-node-details';
        const historySummary = document.createElement('summary');
        historySummary.textContent = `${t('recipeHistory')} (${history.length})`;
        historyDetails.appendChild(historySummary);
        const historyList = document.createElement('div');
        historyList.className = 'anomalous-recipe-history-list';
        if (!history.length) {
            appendText(historyList, 'small', t('recipeHistoryEmpty'), 'anomalous-recipe-node-hint');
        } else {
            for (const version of history) {
                const row = document.createElement('div');
                row.className = 'anomalous-recipe-history-row';
                const date = Number.isFinite(Number(version.timestamp))
                    ? new Date(Number(version.timestamp)).toLocaleString()
                    : t('recipeUnknownVersion');
                appendText(row, 'span', `${date} · ${version.name || t('recipeUntitled')}`);
                const restore = appendText(row, 'button', t('recipeRestoreVersion'), 'anomalous-btn-danger');
                restore.type = 'button';
                restore.onclick = async () => {
                    if (!await anomalousConfirm(t('recipeRestoreVersionConfirm'))) return;
                    try {
                        const response = await fetch('/anomalous/restore_recipe_version', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filename, version: version.version }),
                        });
                        if (!response.ok) throw new Error('recipe history restore failed');
                        overlay.remove();
                        await owner.refreshRecipes();
                        resolve({ mode: 'restored' });
                    } catch (error) {
                        console.error('Could not restore Workflow Recipe version:', error);
                        await anomalousAlert(t('recipeUpdateError'));
                    }
                };
                row.appendChild(restore);
                historyList.appendChild(row);
            }
        }
        historyDetails.appendChild(historyList);
        dialog.appendChild(historyDetails);

        const error = appendText(dialog, 'div', '', 'anomalous-recipe-dialog-error');
        const actions = document.createElement('div');
        actions.className = 'anomalous-recipe-actions';
        const cancel = appendText(actions, 'button', t('recipeCancel'), 'anomalous-btn-danger');
        const canvas = appendText(actions, 'button', t('recipeEditCanvas'), 'anomalous-btn-primary');
        const save = appendText(actions, 'button', t('recipeUpdate'), 'anomalous-btn-success');
        for (const button of [cancel, canvas, save]) button.type = 'button';
        const close = (value) => { overlay.remove(); resolve(value); };
        cancel.onclick = () => close(null);
        overlay.onclick = (event) => { if (event.target === overlay) close(null); };
        canvas.onclick = () => close({ mode: 'canvas' });
        save.onclick = () => {
            const name = nameInput.value.trim();
            if (!name) {
                error.textContent = t('recipeNameRequired');
                nameInput.focus();
                return;
            }
            close({
                mode: 'save',
                name,
                tags: [...new Set(tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
                notes: notesInput.value.trim(),
            });
        };
        dialog.appendChild(actions);
        overlay.appendChild(dialog);
        (owner.nbPanel || document.body).appendChild(overlay);
        nameInput.focus();
        nameInput.select();
    });
}

