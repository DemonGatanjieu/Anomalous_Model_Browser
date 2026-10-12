/**
 * The model details' location card: the file name and full path, Copy path, and Show in
 * folder (Explorer / Finder opens with the file selected; only on the computer ComfyUI runs on).
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';

function actionButton(label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'anomalous-model-location-copy';
    button.textContent = label;
    return button;
}

async function showInFolder(model, where) {
    try {
        const response = await fetch('/anomalous/open_model_folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...where, filename: model.filename }),
        });
        const data = await response.json().catch(() => ({}));
        if (data.status !== 'success') throw new Error(data.message || `HTTP ${response.status}`);
    } catch (error) {
        await anomalousAlert(t('detailOpenFolderFailed', { error: error.message }));
    }
}

/** `where`: the model's { type, path_idx, subfolder } in the browser. */
export function createModelLocationCard(model, where) {
    const card = document.createElement('div');
    card.className = 'anomalous-model-location';

    const appendValue = (labelKey, value) => {
        const row = document.createElement('div');
        row.className = 'anomalous-model-location-row';
        const label = document.createElement('span');
        label.className = 'anomalous-model-location-label';
        label.textContent = t(labelKey);
        const content = document.createElement('code');
        content.textContent = value;
        content.title = value;
        row.append(label, content);
        card.appendChild(row);
    };

    appendValue('detailPhysicalFilename', model.filename);
    if (model.file_path) {
        appendValue('detailFullPath', model.file_path);
        const actions = document.createElement('div');
        actions.className = 'anomalous-model-location-actions';
        const copyButton = actionButton(t('detailCopyPath'));
        copyButton.onclick = async () => {
            try {
                await navigator.clipboard.writeText(model.file_path);
                copyButton.textContent = t('detailPathCopied');
            } catch (error) {
                copyButton.textContent = t('detailPathCopyFailed');
            }
            setTimeout(() => { copyButton.textContent = t('detailCopyPath'); }, 1400);
        };
        const folderButton = actionButton(t('detailOpenFolder'));
        folderButton.onclick = () => showInFolder(model, where);
        actions.append(copyButton, folderButton);
        card.appendChild(actions);
    }
    return card;
}
