/**
 * Model Check's downloads, on its page (ui_doctor.js): each missing model with a source gets
 * "Download" (and the page "Download all"); a dialog shows, per file, where it will be saved —
 * the folder of its type (a choice when there are several) and the subfolder the download
 * settings give, both changeable — its size, source and anything to know (a format that can
 * carry code, nothing to check it against), and the free space. While a file downloads its
 * row shows how far, with Cancel; a failed one says why, with Retry (it continues where it
 * stopped). model_download.js does the work.
 */

import { translate as t } from './locales.js';
import { destinationFor, unsafeFormat } from './download_places.js';
import {
    cancelDownload, defaultRoot, doneCount, downloadFor, lookupDownloads, rememberRoot, startDownload, syncDownloads,
    watchDownloads,
} from './model_download.js';
import { saveApiKey } from './ui_scan_page.js';
import { openSettingsPage } from './ui_settings_page.js';

const ACTIVE = ['queued', 'running', 'verifying'];
const SOURCES = { civitai: 'Civitai', huggingface: 'Hugging Face', link: 'GitHub' };
const NOT_FOUND = { network: 'downloadNoNetwork', different_file: 'downloadDifferentFile', gated: 'downloadGated' };

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

export function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(value / 1024))} KB`;
}

const fileName = (value) => String(value).split(/[\\/]/).pop();


export const joinPath = (root, rel) => `${String(root).replace(/[\\/]+$/, '')}${String(root).includes('\\') ? '\\' : '/'}${
    String(root).includes('\\') ? rel.replace(/\//g, '\\') : rel}`;

/** One file's part of the dialog; `read()` gives { root, rel } as chosen. */
function dialogItem(entry, info, settings) {
    // ComfyUI also lists folders that do not exist (output/loras…): offered only when none does.
    const existing = (info.roots || []).filter(root => root.exists);
    const roots = existing.length ? existing : (info.roots || []).slice(0, 1);
    const box = el('div', 'anomalous-download-item');
    const head = el('div', 'anomalous-download-head');
    head.append(el('strong', 'anomalous-download-name', fileName(entry.value)));
    const source = info.mirror ? t('downloadSourceMirror') : SOURCES[info.source] || info.source;
    const facts = [source, info.size ? formatSize(info.size) : '', info.base_model].filter(Boolean);
    head.append(el('span', 'anomalous-download-facts', facts.join(' · ')));
    box.append(head);
    if (info.model_name) box.append(el('div', 'anomalous-download-model', [info.model_name, info.version_name].filter(Boolean).join(' — ')));

    let root = defaultRoot(info.type, roots) || { index: 0, path: '', subfolders: [] };
    const line = el('label', 'anomalous-download-where');
    line.append(el('span', 'anomalous-download-label', t('downloadSaveTo')));
    if (roots.length > 1) {
        const select = el('select', 'anomalous-download-root');
        for (const item of roots) {
            const option = el('option', '', item.path + (item.exists ? '' : ` ${t('downloadRootNew')}`));
            option.value = String(item.index);
            option.selected = item.index === root.index;
            select.append(option);
        }
        select.onchange = () => {
            root = roots.find(item => String(item.index) === select.value) || root;
            // Its own folders decide {base}, unless the path was typed by hand.
            if (!input.dataset.edited) input.value = destinationFor(entry, info, settings, root.subfolders);
            fillList();
            showPath();
        };
        line.append(select);
    }
    const input = el('input', 'anomalous-download-rel');
    input.type = 'text';
    input.spellcheck = false;
    input.value = destinationFor(entry, info, settings, root.subfolders);
    const list = el('datalist');
    list.id = `anomalous-download-list-${Math.random().toString(36).slice(2)}`;
    input.setAttribute('list', list.id);
    const fillList = () => list.replaceChildren(...(root.subfolders || []).map(folder => {
        const option = el('option');
        option.value = `${folder}/${fileName(entry.value)}`;
        return option;
    }));
    fillList();
    line.append(input, list);
    const full = el('div', 'anomalous-download-path');
    const showPath = () => { full.textContent = root.path ? joinPath(root.path, input.value.trim()) : input.value.trim(); };
    input.oninput = () => {
        input.dataset.edited = '1';
        showPath();
    };
    showPath();
    box.append(line, full);

    if (unsafeFormat(entry.value) || unsafeFormat(info.file_name)) box.append(el('div', 'anomalous-download-note is-warn', t('downloadUnsafeFormat')));
    if (info.by_name) {
        box.append(el('div', 'anomalous-download-note is-warn', t('downloadByName', { name: info.list_name || '' })));
    } else if (info.via === 'manager_list') {
        box.append(el('div', 'anomalous-download-note', t('downloadViaManager', { name: info.list_name || '' })));
    }
    if (!info.by_name && !info.sha256 && !(entry.record?.hash?.length >= 10)) {
        box.append(el('div', 'anomalous-download-note', t('downloadNoCheck')));
    }
    const error = el('div', 'anomalous-download-note is-bad');
    error.hidden = true;
    box.append(error);
    return {
        box,
        read: () => ({ root: root.index, rel: input.value.trim().replace(/\\/g, '/'), rootInfo: root }),
        fail: (text) => { error.textContent = text; error.hidden = !text; },
    };
}

export function errorText(code) {
    const key = `downloadError_${code}`;
    const text = t(key);
    return text === key ? t('downloadError_unknown') : text;
}

/** The dialog for `items` ([{ entry, info }]); resolves once downloads started or it was closed. */
export function openDownloadDialog(owner, items, settings) {
    return new Promise((resolve) => {
        const overlay = el('div', 'anomalous-dialog-overlay anomalous-download-overlay');
        const dialog = el('div', 'anomalous-download-dialog');
        dialog.setAttribute('role', 'dialog');
        dialog.append(el('h3', 'anomalous-download-title', t(items.length > 1 ? 'downloadTitleMany' : 'downloadTitle', { count: items.length })));
        const parts = items.map(({ entry, info }) => ({ entry, info, ...dialogItem(entry, info, settings) }));
        const listBox = el('div', 'anomalous-download-items');
        listBox.append(...parts.map(part => part.box));
        dialog.append(listBox);

        const total = items.reduce((sum, { info }) => sum + (Number(info.size) || 0), 0);
        const space = el('div', 'anomalous-download-space');
        const showSpace = () => {
            const roots = new Map(parts.map(part => [part.read().rootInfo.path, part.read().rootInfo]));
            const free = Math.min(...[...roots.values()].map(root => Number(root.free) || 0));
            space.textContent = t('downloadSpace', { need: total ? formatSize(total) : '?', free: free ? formatSize(free) : '?' });
            space.classList.toggle('is-bad', Boolean(total && free && free < total));
        };
        showSpace();
        dialog.addEventListener('change', showSpace);
        const rules = button('anomalous-download-rules', t('downloadRules'), () => {
            close();
            openSettingsPage(owner, { tab: 'models' });
        });
        dialog.append(space, rules);

        const footer = el('div', 'anomalous-download-footer');
        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); resolve(false); };
        const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
        document.addEventListener('keydown', onKey, true);
        const go = button('anomalous-scan-primary', t('downloadStart'), async () => {
            go.disabled = true;
            let left = 0;
            for (const part of parts) {
                const choice = part.read();
                part.fail('');
                try {
                    await startDownload(owner, part.entry, part.info, choice);
                    rememberRoot(part.info.type, choice.root);
                    part.box.remove();
                } catch (error) {
                    left += 1;
                    part.fail(errorText(error.code));
                }
            }
            go.disabled = false;
            if (!left) {
                overlay.remove();
                document.removeEventListener('keydown', onKey, true);
                resolve(true);
            }
        });
        footer.append(button('anomalous-scan-secondary', t('dialogCancel'), close), go);
        dialog.append(footer);
        overlay.append(dialog);
        overlay.onclick = (event) => { if (event.target === overlay) close(); };
        document.body.append(overlay);
        go.focus();
    });
}

/** What a row shows for its model's download: progress, a failure, or nothing yet. */
export function jobView(owner, job, retry) {
    const box = el('span', 'anomalous-download-status');
    if (ACTIVE.includes(job.state)) {
        const percent = job.total ? Math.floor((job.received / job.total) * 100) : 0;
        const text = job.state === 'queued' ? t('downloadQueued')
            : job.state === 'verifying' ? t('downloadVerifying')
                : t('downloadProgress', { percent, done: formatSize(job.received), total: job.total ? formatSize(job.total) : '?' });
        const bar = el('span', 'anomalous-download-bar');
        bar.style.setProperty('--amb-download-done', `${percent}%`);
        box.append(el('span', 'anomalous-download-text', text), bar,
            button('anomalous-scan-row-btn', t('dialogCancel'), () => cancelDownload(job.id)));
    } else if (job.state === 'failed') {
        box.append(el('span', 'anomalous-download-text is-bad', errorText(job.error)));
        if (job.host === 'huggingface.co' && ['network', 'unknown'].includes(job.error)) {
            box.append(el('span', 'anomalous-download-text', t('downloadTryMirror')));
        }
        if (job.error === 'needs_key') {
            box.append(button('anomalous-scan-row-btn is-main', t('downloadSetKey'), async () => {
                if (await saveApiKey()) retry();
            }));
        } else if (!['hash_mismatch', 'gone', 'exists'].includes(job.error)) {
            box.append(button('anomalous-scan-row-btn', t('downloadRetry'), retry));
        }
    }
    return box;
}

/**
 * Fills the download parts of a rendered Model Check page: `slots` (Map entry -> the span in
 * its row) and `pageActions` (the page's buttons) for "Download all". `rerender` redraws the
 * page (after a download ends, the model is there).
 */
export async function fillDownloads(owner, panel, slots, pageActions, rerender) {
    panel._downloadUnwatch?.();
    if (!slots.size) return;
    for (const slot of slots.values()) slot.replaceChildren(el('span', 'anomalous-download-text', t('downloadLooking')));
    let looked;
    try {
        await syncDownloads(owner);
        looked = await lookupDownloads([...slots.keys()]);
    } catch (error) {
        console.warn('[AMB] Download: looking for sources failed.', error);
        for (const slot of slots.values()) slot.replaceChildren();
        return;
    }
    if (!panel.isConnected || [...slots.values()].some(slot => !slot.isConnected)) return; // redrawn meanwhile
    const { found, settings } = looked;
    const ready = [];
    const draw = () => {
        for (const [entry, slot] of slots) {
            const info = found.get(entry);
            const job = downloadFor(entry.value);
            const start = () => openDownloadDialog(owner, [{ entry, info }], settings);
            if (job && job.state !== 'cancelled' && job.state !== 'done') {
                slot.replaceChildren(jobView(owner, job, start));
            } else if (info?.found && info.by_name) {
                // Only a file of the same name: its own wording, never the main button.
                slot.replaceChildren(button('anomalous-scan-row-btn', info.size
                    ? t('downloadOneByName', { size: formatSize(info.size) }) : t('downloadOneByNameNoSize'), start));
            } else if (info?.found) {
                slot.replaceChildren(button('anomalous-scan-row-btn is-main', info.size
                    ? t('downloadOne', { size: formatSize(info.size) }) : t('downloadOneNoSize'), start));
            } else if (info && NOT_FOUND[info.reason]) {
                slot.replaceChildren(el('span', 'anomalous-download-text', t(NOT_FOUND[info.reason])));
                if (info.reason === 'gated' && /^https:\/\//.test(info.page || '')) {
                    slot.append(button('anomalous-scan-row-btn', t('downloadOpenPage'), () => window.open(info.page, '_blank', 'noopener')));
                }
            } else {
                slot.replaceChildren();
            }
        }
    };
    // Not downloading now (an earlier, ended download of the same name does not count).
    const idle = (entry) => !ACTIVE.includes(downloadFor(entry.value)?.state);
    for (const [entry] of slots) {
        // "Download all" takes only the files known to be the right ones.
        if (found.get(entry)?.found && !found.get(entry).by_name && idle(entry)) ready.push({ entry, info: found.get(entry) });
    }
    if (ready.length > 1) {
        const size = ready.reduce((sum, item) => sum + (Number(item.info.size) || 0), 0);
        pageActions.prepend(button('anomalous-scan-primary', t('downloadAll', { count: ready.length, size: formatSize(size) }), () => {
            const waiting = ready.filter(({ entry }) => idle(entry));
            if (waiting.length) openDownloadDialog(owner, waiting, settings);
        }));
    }
    draw();
    let finished = doneCount();
    const unwatch = watchDownloads((jobs) => {
        if (!panel.isConnected || panel.style.display === 'none') return;
        const done = [...jobs.values()].filter(job => job.state === 'done').length;
        if (done !== finished) {
            finished = done;
            rerender();
        } else {
            draw();
        }
    });
    panel._downloadUnwatch = unwatch;
}
