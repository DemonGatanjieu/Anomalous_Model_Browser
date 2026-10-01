/**
 * Starting scans and following them: every model folder, picked models or listed models from
 * the scan page (all through /anomalous/scan_all), and one model from its card. Progress goes
 * to scan_progress.js; when a scan ends its result (GET /anomalous/last_scan) is shown, and
 * node drop-downs, hashes and the model grid are refreshed. No page DOM here: ui_scan_page.js
 * renders the page.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { updateScanProgress, finishScanProgress, failScanProgress } from './scan_progress.js';
import { oneModelLine, resultLine } from './scan_results.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const POLL_MS = 2000;
const SCAN_RADAR_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="21" stroke-opacity="0.35"/><line x1="3" y1="12" x2="21" y2="12" stroke-opacity="0.35"/><line x1="12" y1="12" x2="18.5" y2="5.5" stroke-width="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`;

let running = false;

export function setScanButtonState(btn, isScanning) {
    if (!btn) return;
    btn.innerHTML = SCAN_RADAR_ICON_SVG;
    btn.classList.toggle('anomalous-radar-spinning', Boolean(isScanning));
    btn.style.opacity = isScanning ? '0.85' : '1';
    btn.style.animation = '';
}

function setActiveScanButtonState(isScanning) {
    setScanButtonState(document.getElementById('anomalous-scan-btn'), isScanning);
}

/** Whether a scan started here is still running (the page disables its buttons). */
export function isScanRunning() {
    return running;
}

/**
 * The scraper's request fields for the page's options:
 * { offline, virtualRename, physicalRename, forceOverwrite, retryUnmatched }.
 */
export function scanRequestBody(options) {
    const offline = Boolean(options.offline);
    const virtualRename = !offline && Boolean(options.virtualRename);
    const physicalRename = !offline && Boolean(options.physicalRename);
    return {
        offline_only: offline,
        skip_rename: !virtualRename && !physicalRename,
        virtual_rename: virtualRename,
        physical_rename: physicalRename,
        force_overwrite: !offline && Boolean(options.forceOverwrite),
        retry_unmatched: !offline && Boolean(options.retryUnmatched),
    };
}

/** Listed models ({type, path_idx, rel}) as the scan's `targets`, one per folder. */
export function targetsForItems(items) {
    const folders = new Map();
    for (const item of items) {
        const cut = item.rel.lastIndexOf('/');
        const subfolder = cut < 0 ? '/' : `/${item.rel.slice(0, cut)}`;
        const key = `${item.type}|${item.path_idx}|${subfolder}`;
        if (!folders.has(key)) folders.set(key, { type: item.type, path_idx: item.path_idx, subfolder, files: [] });
        folders.get(key).files.push(item.filename);
    }
    return [...folders.values()];
}

/** The model picker's selection (Map "type|path_idx|subfolder" -> Set of file names) as `targets`. */
function targetsForSelection(selection) {
    const targets = [];
    for (const [folderKey, files] of selection.entries()) {
        const [type, pathIdx, ...rest] = folderKey.split('|');
        if (type && pathIdx !== undefined && rest.length && files.size) {
            targets.push({ type, path_idx: Number(pathIdx), subfolder: rest.join('|'), files: [...files] });
        }
    }
    return targets;
}

async function postJson(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (data.status !== 'ok') throw new Error(data.message || `HTTP ${res.status}`);
    return data;
}

/** The last scan's result ({} before the first, or when it cannot be read). */
export async function fetchLastScan() {
    try {
        return await (await fetch('/anomalous/last_scan')).json();
    } catch {
        return {};
    }
}

/** Polls a status URL until the scan there stops; resolves with the last status. */
function followScan(statusUrl, extra = {}, everyMs = POLL_MS, title = '') {
    return new Promise((resolve, reject) => {
        const poll = setInterval(async () => {
            try {
                const status = await (await fetch(statusUrl)).json();
                updateScanProgress({ ...status, ...extra }, title);
                if (!status.scanning) {
                    clearInterval(poll);
                    resolve(status);
                }
            } catch (error) {
                clearInterval(poll);
                reject(error);
            }
        }, everyMs);
    });
}

async function afterScan(owner, autoFix) {
    try {
        if (app?.refreshComboInNodes) await app.refreshComboInNodes();
        if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
    } catch (error) {
        console.warn('[AMB] Error reloading hashes or combo nodes:', error);
    }
    if (autoFix && window.anomalous_resolve_all_missing_nodes) window.anomalous_resolve_all_missing_nodes(true);
    owner.loadModels?.();
}

/** The ended scan's line, with a way to its result when the progress box floats. */
export function showScanResult(owner, result) {
    finishScanProgress(resultLine(result), {
        label: t('scanProgressShowResult'),
        onClick: () => {
            owner.show?.();
            owner.openScanPage?.();
        },
    });
}

/**
 * Runs one scan from the scan page: every active model folder, `options.selection` (the model
 * picker) or `options.targets` (listed models). Resolves with the scan's result when it has
 * ended, or null when it could not start (the reason shown).
 */
export async function startScan(owner, options) {
    if (running) return null;
    running = true;
    setActiveScanButtonState(true);
    const body = scanRequestBody(options);
    const targets = options.targets || (options.selection ? targetsForSelection(options.selection) : null);
    if (targets) body.targets = targets;
    try {
        const data = await postJson('/anomalous/scan_all', body);
        updateScanProgress({ scanning: true, phase: 'preparing', recovered: data.recovered });
        const status = await followScan('/anomalous/global_scan_status');
        const result = await fetchLastScan();
        if (status.interrupted) failScanProgress(t('scanProgressInterrupted'));
        else showScanResult(owner, result);
        await afterScan(owner, options.autoFix);
        return result;
    } catch (error) {
        failScanProgress(t('scanPageStartFailed', { error: String(error.message || error) }));
        return null;
    } finally {
        running = false;
        setActiveScanButtonState(false);
    }
}

/** The radar button on a model card: scan just that model, in its own folder. */
export async function triggerDirectModelScan(model, triggerBtn = null, browserInstance = null) {
    const browser = browserInstance || this || {};
    if (!model || !model.filename) return;

    const modelLabel = model.name || model.filename;
    const titleText = t('scanOneTitle', { name: modelLabel });

    if (triggerBtn) {
        triggerBtn.classList.add('anomalous-radar-spinning');
        if (triggerBtn.firstElementChild) {
            triggerBtn.firstElementChild.style.animation = 'anomalous-radar-spin 1.2s linear infinite';
            triggerBtn.firstElementChild.style.stroke = '#10b981';
        }
        triggerBtn.style.pointerEvents = 'none';
        triggerBtn.style.opacity = '0.7';
    }
    setActiveScanButtonState(true);
    updateScanProgress({ scanning: true, phase: 'preparing', total: 1, current: 0, filename: model.filename }, titleText);

    const resetBtn = () => {
        setActiveScanButtonState(false);
        if (triggerBtn) {
            triggerBtn.classList.remove('anomalous-radar-spinning');
            if (triggerBtn.firstElementChild) {
                triggerBtn.firstElementChild.style.animation = '';
                triggerBtn.firstElementChild.style.stroke = '';
            }
            triggerBtn.style.pointerEvents = '';
            triggerBtn.style.opacity = '';
        }
    };

    try {
        const params = new URLSearchParams({
            type: browser.currentType || 'checkpoints',
            path_idx: browser.currentPathIdx || 0,
            subfolder: browser.currentSubfolder || '/',
        });
        // A model that was looked up without an answer is looked up again.
        await postJson(`/anomalous/scan?${params}`, {
            target_files: [model.filename],
            offline_only: false,
            skip_rename: true,
            virtual_rename: false,
            physical_rename: false,
            force_overwrite: false,
            retry_unmatched: model.metadata?.info_source === 'local',
        });
        showWorkbenchToast(titleText);
        const status = await followScan(`/anomalous/scan_status?${params}`, {}, 1200, titleText);
        resetBtn();
        if (status.interrupted) {
            failScanProgress(t('scanProgressInterrupted'));
            showWorkbenchToast(t('scanProgressInterrupted'));
        } else {
            const line = oneModelLine(await fetchLastScan());
            finishScanProgress(line);
            showWorkbenchToast(line);
        }
        browser.loadModels?.();
        try {
            if (app?.refreshComboInNodes) await app.refreshComboInNodes();
            if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
        } catch (e) {
            console.warn('[AMB] Error reloading hashes or combo nodes:', e);
        }
    } catch (e) {
        resetBtn();
        const message = String(e.message || e) || t('scanPageStartFailed', { error: '' });
        failScanProgress(message);
        showWorkbenchToast(message);
    }
}
