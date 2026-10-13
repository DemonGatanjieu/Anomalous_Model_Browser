/**
 * Where a model's file is: the details' path line (the full path, or the file name, with Copy),
 * and the file manager (only on the computer ComfyUI runs on): showInFolder for the details'
 * Folder button (Explorer / Finder with the file selected), openModelFolder for the folder
 * column's 📂 (a type's folder or a subfolder).
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
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

/** The path line: the only place the file name shows (the heading shows the model's name). */
export function createModelLocationCard(model) {
    const card = document.createElement('div');
    card.className = 'anomalous-model-location';
    const path = document.createElement('code');
    path.textContent = model.file_path || model.filename;
    path.title = path.textContent;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'anomalous-model-location-copy';
    copy.textContent = t('detailCopy');
    copy.title = t('detailCopyPath');
    copy.onclick = () => copyToClipboard(path.textContent, 'detailPathCopied');
    card.append(path, copy);
    return card;
}
