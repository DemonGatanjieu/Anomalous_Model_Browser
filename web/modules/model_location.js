/**
 * Where a model's file is: the details' path line (the full path, or the file name, with Copy)
 * and Show in folder (Explorer / Finder opens with the file selected; only on the computer
 * ComfyUI runs on), which the details' Folder button calls.
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

/** `where`: the model's { type, path_idx, subfolder } in the browser. */
export async function showInFolder(model, where) {
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
