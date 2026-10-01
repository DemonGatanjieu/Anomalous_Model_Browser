/**
 * Starting scans and following them: a scan of every model folder (or of picked models)
 * from the scan page, and the precision scan of one model from its card. Progress goes
 * to scan_progress.js; when a scan ends, node drop-downs, hashes and the model grid are
 * refreshed. No page DOM here: ui_scan_page.js renders the page.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { updateScanProgress, finishScanProgress, failScanProgress } from './scan_progress.js';
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

async function postJson(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (data.status !== 'ok') throw new Error(data.message || `HTTP ${res.status}`);
    return data;
}

/** Polls a status URL until the scan there stops; resolves with the last status. */
function followScan(statusUrl, extra = {}) {
    return new Promise((resolve, reject) => {
        const poll = setInterval(async () => {
            try {
                const status = await (await fetch(statusUrl)).json();
                updateScanProgress({ ...status, ...extra });
                if (!status.scanning) {
                    clearInterval(poll);
                    resolve(status);
                }
            } catch (error) {
                clearInterval(poll);
                reject(error);
            }
        }, POLL_MS);
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

/** Picked models: one folder after the other (`selection`: Map "type|path_idx|subfolder" -> Set of file names). */
async function scanSelection(selection, body) {
    const folders = [...selection.entries()].filter(([, files]) => files.size > 0);
    let current = 0;
    updateScanProgress({ scanning: true, phase: 'preparing', folder_total: folders.length, folder_current: 0 });
    let last = {};
    for (const [folderKey, files] of folders) {
        current += 1;
        const [type, pathIdx, ...rest] = folderKey.split('|');
        const subfolder = rest.join('|');
        if (!type || pathIdx === undefined || !rest.length) continue;
        const params = new URLSearchParams({ type, path_idx: pathIdx, subfolder });
        try {
            await postJson(`/anomalous/scan?${params}`, { ...body, target_files: [...files] });
            last = await followScan(`/anomalous/scan_status?${params}`, { folder_total: folders.length, folder_current: current, folder: subfolder });
        } catch (error) {
            console.error('[AMB] Scan failed for folder:', folderKey, error);
            last = { error: String(error.message || error) };
        }
    }
    return last;
}

/**
 * Runs one scan from the scan page: every active model folder, or `options.selection`.
 * Resolves when it has ended (true) or could not start (false, with the reason shown).
 */
export async function startScan(owner, options) {
    if (running) return false;
    running = true;
    setActiveScanButtonState(true);
    const body = scanRequestBody(options);
    try {
        let status;
        if (options.selection) {
            status = await scanSelection(options.selection, body);
        } else {
            const data = await postJson('/anomalous/scan_all', body);
            updateScanProgress({ scanning: true, phase: 'preparing', recovered: data.recovered });
            status = await followScan('/anomalous/global_scan_status');
        }
        if (status.interrupted) failScanProgress(t('scanProgressInterrupted'));
        else finishScanProgress();
        await afterScan(owner, options.autoFix);
        return true;
    } catch (error) {
        failScanProgress(t('scanPageStartFailed', { error: String(error.message || error) }));
        return false;
    } finally {
        running = false;
        setActiveScanButtonState(false);
    }
}

export async function formatScanCompletionToast(model) {
    const isZh = window.anomalous_browser_lang === 'zh';
    const fallbackName = model.name || model.filename;
    try {
        const findRes = await fetch('/anomalous/find_model?search=' + encodeURIComponent(model.filename));
        if (findRes.ok) {
            const updated = await findRes.json();
            const target = updated?.model || updated || model;
            if (target && target.metadata) {
                const meta = target.metadata;
                const isCivitai = Boolean(
                    (meta.id && meta.id !== -1) ||
                    (meta.modelId && meta.modelId !== -1) ||
                    (meta.model_id && meta.model_id !== -1) ||
                    (meta.version_id && meta.version_id !== -1) ||
                    meta.civitai_url
                );
                const hasPreview = Boolean(target.preview_url);
                const baseModel = meta.baseModel;

                if (isCivitai && hasPreview) {
                    return isZh ? `✓ 已从 Civitai 获取封面与模型信息！` : `✓ Civitai cover & metadata fetched!`;
                }
                if (isCivitai && !hasPreview) {
                    return isZh ? `✓ 已匹配到 Civitai 信息（线上未提供封面）` : `✓ Civitai metadata matched (no cover online)`;
                }
                if (!isCivitai) {
                    if (baseModel) {
                        return isZh
                            ? `ℹ️ 非 Civitai 模型：已识别底模为 [${baseModel}]`
                            : `ℹ️ Non-Civitai model: inferred base model [${baseModel}]`;
                    }
                    return isZh
                        ? `ℹ️ 未在 Civitai 匹配到此模型`
                        : `ℹ️ No Civitai match found for this model`;
                }
            }
        }
    } catch {
        // fallback to standard text
    }
    return isZh ? `✓ 模型 [${fallbackName}] 扫描完成！` : `✓ Model [${fallbackName}] scanned!`;
}

function pollDirectScanStatus(params, titleText, model, onComplete) {
    const statusUrl = '/anomalous/scan_status?' + params.toString();
    const poll = setInterval(async () => {
        try {
            const statusRes = await fetch(statusUrl);
            const statusData = await statusRes.json();
            updateScanProgress(statusData, titleText);

            if (!statusData.scanning) {
                clearInterval(poll);
                if (statusData.interrupted) {
                    failScanProgress(t('scanProgressInterrupted'));
                    showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? '扫描被中断' : 'Scan interrupted');
                } else {
                    const toastMsg = await formatScanCompletionToast(model);
                    finishScanProgress(toastMsg);
                    showWorkbenchToast(toastMsg);
                }
                onComplete(true);
            }
        } catch (err) {
            clearInterval(poll);
            failScanProgress(String(err));
            onComplete(false);
        }
    }, 1200);
    return poll;
}

/** The radar button on a model card: scan just that model, in its own folder. */
export async function triggerDirectModelScan(model, triggerBtn = null, browserInstance = null) {
    const browser = browserInstance || this || {};
    if (!model || !model.filename) return;

    const modelLabel = model.name || model.filename;
    const isZh = window.anomalous_browser_lang === 'zh';
    const titleText = isZh ? `精准扫描: ${modelLabel}` : `Scanning: ${modelLabel}`;

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
        const reqBody = {
            target_files: [model.filename],
            offline_only: false,
            skip_rename: true,
            virtual_rename: false,
            physical_rename: false,
            force_overwrite: false
        };

        const res = await fetch('/anomalous/scan?' + params.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody)
        });

        const data = await res.json();
        if (data.status === 'ok') {
            showWorkbenchToast(isZh ? `开始精准扫描: ${modelLabel}` : `Scanning model: ${modelLabel}`);
            pollDirectScanStatus(params, titleText, model, async () => {
                resetBtn();
                if (typeof browser.loadModels === 'function') {
                    browser.loadModels();
                }
                try {
                    if (app?.refreshComboInNodes) await app.refreshComboInNodes();
                    if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
                } catch (e) {
                    console.warn('[AMB] Error reloading hashes or combo nodes:', e);
                }
            });
        } else {
            resetBtn();
            const errMsg = data.message || (isZh ? '扫描启动失败' : 'Failed to start scan');
            failScanProgress(errMsg);
            showWorkbenchToast(errMsg);
        }
    } catch (e) {
        resetBtn();
        failScanProgress(String(e));
        showWorkbenchToast(String(e));
    }
}
