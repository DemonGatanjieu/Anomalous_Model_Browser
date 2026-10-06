/**
 * Downloading again the models a backup's computer had and this one lacks (the backup's model
 * list, api/backup.py). Looks each up like Model Check does (by hash on Civitai, the saved
 * link, Hugging Face), lists them with size and source, and downloads the ticked ones into the
 * same folder and path they had, one after another (model_download.js; each is checked against
 * its SHA-256 and scanned after). A file found by name only starts unticked.
 */

import { translate as t } from './locales.js';
import { defaultRoot, downloadFor, fetchDownloadSettings, hfMirrorOn, startDownload, watchDownloads } from './model_download.js';
import { errorText, formatSize, jobView } from './ui_model_download.js';
import { openDialog } from './ui_backup.js';

const LOOKUP_BATCH = 100; // the lookup route takes this many at once
const NOT_FOUND = { network: 'downloadNoNetwork', different_file: 'downloadDifferentFile', gated: 'downloadGated' };
const SOURCES = { civitai: 'Civitai', huggingface: 'Hugging Face', github: 'GitHub' };

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

const fileName = (rel) => String(rel || '').split('/').pop();
const jobKey = (entry) => `backup:${entry.type}/${entry.rel}`; // a download's `value`: one per missing model

async function lookUp(missing) {
    const settings = await fetchDownloadSettings().catch(() => ({ hf_mirror: null }));
    const found = [];
    const roots = {};
    for (let start = 0; start < missing.length; start += LOOKUP_BATCH) {
        const batch = missing.slice(start, start + LOOKUP_BATCH);
        const response = await fetch('/anomalous/download/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hf_mirror: hfMirrorOn(settings),
                items: batch.map((entry, index) => ({
                    key: String(start + index), hash: entry.sha256 || '', url: entry.url || '', value: fileName(entry.rel), types: [entry.type],
                })),
            }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        Object.assign(roots, data.roots || {});
        for (const result of data.results || []) found[Number(result.key)] = result;
    }
    return missing.map((entry, index) => {
        const info = found[index] || { found: false, reason: 'not_found' };
        return { entry, info: { ...info, roots: roots[info.type] || [] } };
    });
}

function sourceText(info) {
    if (info.mirror) return t('downloadSourceMirror');
    return SOURCES[info.source] || info.source || '';
}

/** The dialog for the backup's missing models (`missing`: [{ type, rel, size, sha256, url }]). */
export async function openRestoreDownloads(owner, missing) {
    let stop = () => {};
    const { dialog, footer, close } = openDialog(t('backupDownloadTitle', { count: missing.length }), () => stop());
    const status = el('p', 'anomalous-backup-note', t('backupDownloadLooking', { count: missing.length }));
    dialog.append(status);
    const closeButton = button('anomalous-scan-secondary', t('dialogCancel'), close);
    footer.append(closeButton);
    let items;
    try {
        items = await lookUp(missing);
    } catch (error) {
        status.textContent = t('backupFailed', { error: error.message });
        status.classList.add('is-bad');
        return;
    }

    const list = el('div', 'anomalous-backup-downloads');
    const rows = items.map(({ entry, info }) => {
        const row = el('label', 'anomalous-backup-download');
        const box = el('input');
        box.type = 'checkbox';
        const usable = Boolean(info.found && info.download_url);
        box.checked = usable && !info.by_name;
        box.disabled = !usable;
        const copy = el('span', 'anomalous-backup-choice-copy');
        const size = Number(info.size) || Number(entry.size) || 0;
        copy.append(el('strong', '', fileName(entry.rel)),
            el('small', 'anomalous-backup-note', [`${entry.type}/${entry.rel}`, size ? formatSize(size) : '', usable ? sourceText(info) : ''].filter(Boolean).join(' · ')));
        if (!usable) copy.append(el('small', 'anomalous-backup-note', t(NOT_FOUND[info.reason] || 'backupDownloadNoSource')));
        if (info.by_name) copy.append(el('small', 'anomalous-backup-note is-warn', t('backupDownloadByName')));
        if (info.reason === 'gated' && /^https:\/\//.test(info.page || '')) {
            copy.append(button('anomalous-scan-row-btn', t('downloadOpenPage'), () => window.open(info.page, '_blank', 'noopener')));
        }
        const state = el('span', 'anomalous-backup-download-state');
        row.append(box, copy, state);
        list.append(row);
        return { entry, info, box, size, state };
    });
    const total = el('p', 'anomalous-backup-note');
    const showTotal = () => {
        const chosen = rows.filter(item => item.box.checked);
        const need = chosen.reduce((sum, item) => sum + item.size, 0);
        const frees = [...new Set(chosen.map(item => defaultRoot(item.info.type, item.info.roots)))].filter(Boolean).map(root => Number(root.free) || 0);
        const free = frees.length ? Math.min(...frees) : 0;
        total.textContent = t('backupDownloadTotal', { count: chosen.length, need: formatSize(need), free: free ? formatSize(free) : '?' });
        total.classList.toggle('is-bad', Boolean(free && need > free));
        go.disabled = !chosen.length;
    };
    const found = rows.filter(item => !item.box.disabled).length;
    status.textContent = t('backupDownloadFound', { found, count: rows.length });
    dialog.append(list, total, el('p', 'anomalous-backup-note', t('backupDownloadWhere')));
    list.addEventListener('change', showTotal);

    const showJobs = () => {
        for (const item of rows) {
            const job = downloadFor(jobKey(item.entry));
            if (!job) continue;
            item.state.replaceChildren(job.state === 'done'
                ? el('span', 'anomalous-download-text', t('backupDownloadDone'))
                : jobView(owner, job, () => start(item)));
        }
    };
    const start = async (item) => {
        const root = defaultRoot(item.info.type, item.info.roots);
        try {
            await startDownload(owner, { value: jobKey(item.entry), record: { hash: item.entry.sha256 || '' } }, item.info,
                { root: root?.index ?? 0, rel: item.entry.rel });
        } catch (error) {
            item.state.replaceChildren(el('span', 'anomalous-download-text is-bad', errorText(error.code)));
        }
    };
    const go = button('anomalous-scan-primary', t('backupDownloadStart'), async () => {
        go.disabled = true;
        for (const item of rows.filter(row => row.box.checked)) {
            item.box.checked = false;
            item.box.disabled = true;
            await start(item);
        }
        go.remove();
        closeButton.textContent = t('backupDownloadHide');
        showJobs();
    });
    stop = watchDownloads(showJobs);
    footer.append(go);
    showTotal();
    showJobs();
}
