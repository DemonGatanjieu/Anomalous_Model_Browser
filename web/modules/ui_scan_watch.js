/**
 * Follows scans started anywhere (the wizard, a single model, another tab): shows their
 * progress, turns the rail's scan button into a spinner, and reloads the models when done.
 */

import { translate as t } from './locales.js';
import { updateScanProgress, finishScanProgress, failScanProgress } from './scan_progress.js';
import { setScanButtonState } from './scan_runner.js';

const POLL_MS = 3000;

/** Starts polling; returns `isScanning()` for the toolbox's scan button. */
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
            const button = document.getElementById('anomalous-scan-btn');
            if (active && !scanning) {
                scanning = true;
                if (button) setScanButtonState(button, true);
            } else if (!active && scanning) {
                scanning = false;
                if (button) setScanButtonState(button, false);
                finishScanProgress();
                owner.loadModels();
                owner.onScanFinished?.();
                if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
            }
        } catch (_) { /* the server may be restarting; the next poll tries again */ }
    }, POLL_MS);
    return () => scanning;
}
