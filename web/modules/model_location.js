/**
 * A model's file: the foot of its details (the full path, or the file name, with Copy and
 * Delete), and the file manager (only on the computer ComfyUI runs on): showInFolder for the
 * details' Folder button (Explorer / Finder with the file selected), openModelFolder for the
 * folder column's 📂 (a type's folder or a subfolder).
 */

import { translate as t } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

/** `where`: { type, path_idx, subfolder } as the browser lists it; no `filename`: the folder itself. */
export async function openModelFolder(where, filename = '') {
    try {
        const response = await fetch('/anomalous/open_model_folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...where, filename }),
        });
        const data = await response.json().catch(() => ({}));
        if (data.status !== 'success') throw new Error(data.message || `HTTP ${response.status}`);
    } catch (error) {
        await anomalousAlert(t('detailOpenFolderFailed', { error: error.message }));
    }
}

export function showInFolder(model, where) {
    return openModelFolder(where, model.filename);
}

export async function copyToClipboard(text, doneKey) {
    try {
        await navigator.clipboard.writeText(text);
        showWorkbenchToast(t(doneKey));
    } catch {
        showWorkbenchToast(t('detailPathCopyFailed'));
    }
}

/** Asks, then deletes the model's file and its side files (to the Recycle Bin) and leaves the details. */
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

function footButton(className, label, onClick) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = label;
    node.onclick = onClick;
    return node;
}

/**
 * The foot of the details, under everything else: the path (the only place the file name shows;
 * the heading shows the model's name), Copy, and Delete. `where`: { type, path_idx, subfolder }.
 */
export function createModelFileFoot(owner, model, where) {
    const foot = document.createElement('div');
    foot.className = 'anomalous-model-file';
    const label = document.createElement('span');
    label.className = 'anomalous-model-file-label';
    label.textContent = t('detailFile');
    const path = document.createElement('code');
    path.textContent = model.file_path || model.filename;
    path.title = path.textContent;
    foot.append(label, path,
        footButton('anomalous-model-file-btn', t('detailCopy'), () => copyToClipboard(path.textContent, 'detailPathCopied')),
        footButton('anomalous-model-file-btn is-danger', t('detailDeleteModel'), () => deleteModel(owner, model, where)));
    return foot;
}
