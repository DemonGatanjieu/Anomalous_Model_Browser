/**
 * Follows scans started anywhere (the scan page, a single model, another tab): shows their
 * progress and result, has the rail show the scan (its scan button turns into a spinner, or More
 * marks it while scan is under More: ui_rail_tools.js), and reloads the models when done.
 */

import { translate as t } from './locales.js';
import { updateScanProgress, failScanProgress } from './scan_progress.js';
import { fetchLastScan, isScanRunning, showScanResult } from './scan_runner.js';

const POLL_MS = 3000;

/** Starts polling; returns `isScanning()` for the rail: a scan seen running, or one this page is starting. */
export function watchScans(owner) {
    let scanning = false;
    setInterval(async () => {
        try {
            let active = null;
            if (owner.currentType) {
                const params = new URLSearchParams({ type: owner.currentType, path_idx: owner.currentPathIdx || 0, subfolder: owner.currentSubfolder || '/' });
                const local = await (await fetch(`/anomalous/scan_status?${params}`)).json();
                if (local.scanning) active = local;
                else if (local.interrupted) failScanProgress(t('scanProgressInterrupted'));
            }
            const global = await (await fetch('/anomalous/global_scan_status')).json();
            if (global.scanning) active = global;
            else if (global.interrupted) failScanProgress(t('scanProgressInterrupted'));

            if (active) updateScanProgress(active);
            if (active && !scanning) {
                scanning = true;
                owner.renderRailTools?.();
            } else if (!active && scanning) {
                scanning = false;
                owner.renderRailTools?.();
                showScanResult(owner, await fetchLastScan());
                owner.loadModels();
                owner.onScanFinished?.();
                if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
            }
        } catch (_) { /* the server may be restarting; the next poll tries again */ }
    }, POLL_MS);
    return () => scanning || isScanRunning();
}
