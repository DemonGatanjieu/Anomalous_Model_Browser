/**
 * Settings → Backup (api/backup.py): exporting the user's data as one .zip, and putting a
 * backup back. Export asks what to include and downloads the file. Import uploads the chosen
 * .zip, shows what is in it next to what this computer has (per store, the models found by
 * hash), lets the user pick the parts and whether differing files are replaced, then puts it
 * back and says what happened. Nothing is erased: replaced files go to the Recycle Bin.
 * The models the backup's computer had and this one lacks can be downloaded again
 * (ui_backup_downloads.js).
 */

import { translate as t } from './locales.js';
import { formatSize } from './ui_model_download.js';
import { openRestoreDownloads } from './ui_backup_downloads.js';

const PARTS = ['recipes', 'combos', 'materials', 'parameters', 'comfy_workflows'];

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

function checkbox(label, checked, hint = '') {
    const line = el('label', 'anomalous-backup-choice');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = checked;
    const copy = el('span', 'anomalous-backup-choice-copy');
    copy.append(el('span', '', label));
    if (hint) copy.append(el('small', 'anomalous-backup-note', hint));
    line.append(box, copy);
    return { line, box };
}

/** A dialog over the page; Esc or a click beside it closes it (then `onClose`). Returns { dialog, footer, close }. */
export function openDialog(title, onClose = null) {
    const overlay = el('div', 'anomalous-dialog-overlay anomalous-backup-overlay');
    const dialog = el('div', 'anomalous-backup-dialog');
    dialog.setAttribute('role', 'dialog');
    const body = el('div', 'anomalous-backup-body');
    const footer = el('div', 'anomalous-backup-footer');
    dialog.append(el('h3', 'anomalous-backup-title', title), body, footer);
    overlay.append(dialog);
    const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
    };
    const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        onClose?.();
    };
    overlay.onclick = (event) => { if (event.target === overlay) close(); };
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    return { dialog: body, footer, close };
}

async function postJson(url, body) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status === 'error') throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}

function download(name) {
    const link = el('a');
    link.href = `/anomalous/backup/file?name=${encodeURIComponent(name)}`;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
}

/** Export: what to include, then the .zip is packed and downloaded. */
export function exportBackup() {
    const { dialog, footer, close } = openDialog(t('backupExportTitle'));
    const models = checkbox(t('backupExportModels'), true, t('backupExportModelsHint'));
    const scan = checkbox(t('backupExportScan'), true, t('backupExportScanHint'));
    const covers = checkbox(t('backupExportCivitaiCovers'), false, t('backupExportCivitaiCoversHint'));
    const comfy = checkbox(t('backupPart_comfy_workflows'), true, t('backupExportComfyHint'));
    const library = checkbox(t('backupExportLibrary'), true, t('backupExportLibraryHint'));
    const status = el('p', 'anomalous-backup-note');
    dialog.append(el('p', 'anomalous-backup-text', t('backupExportIntro')), models.line, scan.line, covers.line, library.line, comfy.line,
        el('p', 'anomalous-backup-note', t('backupExportKey')), status);
    const go = button('anomalous-scan-primary', t('backupExportStart'), async () => {
        go.disabled = true;
        status.classList.remove('is-bad');
        status.textContent = t('backupExporting');
        try {
            const data = await postJson('/anomalous/backup/export', {
                models: models.box.checked, scan: scan.box.checked, civitai_covers: covers.box.checked,
                library: library.box.checked, comfy_workflows: comfy.box.checked,
            });
            download(data.name);
            status.textContent = t('backupExported', { name: data.name, size: formatSize(data.size) });
            go.remove();
            cancel.textContent = t('dialogOk');
        } catch (error) {
            status.textContent = t('backupFailed', { error: error.message });
            status.classList.add('is-bad');
            go.disabled = false;
        }
    });
    const cancel = button('anomalous-scan-secondary', t('dialogCancel'), close);
    footer.append(cancel, go);
    go.focus();
}

/** Import: pick the .zip, see what is in it, choose, put it back. */
export function importBackup(owner) {
    const input = el('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.onchange = () => {
        const file = input.files?.[0];
        if (file) void inspect(owner, file);
    };
    input.click();
}

async function inspect(owner, file) {
    const { dialog, footer, close } = openDialog(t('backupImportTitle'));
    const status = el('p', 'anomalous-backup-note', t('backupReading', { name: file.name }));
    dialog.append(status);
    footer.append(button('anomalous-scan-secondary', t('dialogCancel'), close));
    let summary;
    try {
        const form = new FormData();
        form.append('file', file, file.name);
        const response = await fetch('/anomalous/backup/inspect', { method: 'POST', body: form });
        summary = await response.json().catch(() => ({}));
        if (!response.ok || summary.status === 'error') throw new Error(summary.error || `HTTP ${response.status}`);
    } catch (error) {
        status.textContent = t('backupFailed', { error: error.message });
        status.classList.add('is-bad');
        return;
    }
    showChoices(owner, file.name, summary, { dialog, footer, close });
}

/** The models the backup's computer had and this one lacks, with the way to download them again. */
function missingModels(owner, summary) {
    const library = summary.library;
    if (!library) return null;
    const line = el('div', 'anomalous-backup-missing');
    if (!library.missing.length) {
        line.append(el('span', 'anomalous-backup-note', t('backupLibraryAllHere', { total: library.total })));
        return line;
    }
    const size = library.missing.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);
    line.append(el('span', 'anomalous-backup-text', t('backupLibraryMissing', { count: library.missing.length, size: formatSize(size) })),
        button('anomalous-scan-secondary anomalous-scan-small-btn', t('backupLibraryDownload'), () => openRestoreDownloads(owner, library.missing)));
    return line;
}

function showChoices(owner, name, summary, { dialog, footer, close }) {
    const created = summary.created ? new Date(summary.created * 1000).toLocaleString() : '?';
    dialog.replaceChildren(el('p', 'anomalous-backup-text', t('backupFrom', { name, date: created, version: summary.version || '?' })));
    const parts = PARTS.filter(part => summary.parts?.[part]).map((part) => {
        const counts = summary.parts[part];
        const choice = checkbox(t(`backupPart_${part}`), counts.new + counts.differs > 0, t('backupCounts', counts));
        dialog.append(choice.line);
        return { part, box: choice.box };
    });
    let models = null;
    if (summary.models?.total) {
        const { matched, total, missing } = summary.models;
        const hint = missing.length
            ? t('backupModelsMissing', { names: missing.slice(0, 5).map(rel => rel.split('/').pop()).join('、'), count: missing.length })
            : '';
        models = checkbox(t('backupModels', { matched, total }), matched > 0, hint);
        dialog.append(models.line);
    }
    const settings = summary.settings ? checkbox(t('backupSettings'), false, t('backupSettingsHint')) : null;
    if (settings) dialog.append(settings.line);
    const missing = missingModels(owner, summary);
    if (missing) dialog.append(missing);
    if (!parts.length && !models && !settings) dialog.append(el('p', 'anomalous-backup-note', t('backupNothing')));

    const mode = el('div', 'anomalous-backup-mode');
    const radio = (value, label, checked) => {
        const line = el('label', 'anomalous-backup-choice');
        const input = el('input');
        input.type = 'radio';
        input.name = 'anomalous-backup-mode';
        input.value = value;
        input.checked = checked;
        line.append(input, el('span', '', label));
        mode.append(line);
        return input;
    };
    radio('keep', t('backupModeKeep'), true);
    const replace = radio('replace', t('backupModeReplace'), false);
    const status = el('p', 'anomalous-backup-note');
    dialog.append(el('h4', 'anomalous-backup-subtitle', t('backupModeTitle')), mode, status);

    footer.replaceChildren();
    const go = button('anomalous-scan-primary', t('backupImportStart'), async () => {
        go.disabled = true;
        status.classList.remove('is-bad');
        status.textContent = t('backupImporting');
        try {
            const result = await postJson('/anomalous/backup/apply', {
                token: summary.token, name,
                parts: parts.filter(item => item.box.checked).map(item => item.part),
                models: Boolean(models?.box.checked), settings: Boolean(settings?.box.checked), replace: replace.checked,
            });
            showResult(dialog, result);
            const again = missingModels(owner, summary);
            if (again && summary.library.missing.length) dialog.append(again);
            go.remove();
            cancel.textContent = t('dialogOk');
            if (result.model_notes || result.model_covers || result.model_infos || result.model_civitai_covers || result.settings) owner?.loadModels?.();
        } catch (error) {
            status.textContent = t('backupFailed', { error: error.message });
            status.classList.add('is-bad');
            go.disabled = false;
        }
    });
    const cancel = button('anomalous-scan-secondary', t('dialogCancel'), close);
    footer.append(cancel, go);
}

function showResult(dialog, result) {
    const lines = [t('backupDone', result)];
    if (result.model_notes || result.model_covers || result.covers_kept || result.models_missing) lines.push(t('backupDoneModels', result));
    if (result.model_infos || result.model_civitai_covers) lines.push(t('backupDoneScan', result));
    if (result.settings) lines.push(t('backupDoneSettings'));
    dialog.replaceChildren(...lines.map(line => el('p', 'anomalous-backup-text', line)));
    if (result.failed?.length) {
        dialog.append(el('p', 'anomalous-backup-note is-bad', t('backupFailedItems')));
        const list = el('ul', 'anomalous-backup-failed');
        list.append(...result.failed.slice(0, 20).map(item => el('li', '', item)));
        dialog.append(list);
    }
    dialog.append(el('p', 'anomalous-backup-note', t('backupDoneHint')));
}
