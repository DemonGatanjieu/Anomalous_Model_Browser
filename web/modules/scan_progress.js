import { translate } from './locales.js';


const PANEL_ID = 'anomalous-scan-progress';
let closeTimer = null;


function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'anomalous-scan-progress';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');

    const title = document.createElement('strong');
    title.className = 'anomalous-scan-progress-title';
    panel.appendChild(title);

    const track = document.createElement('div');
    track.className = 'anomalous-scan-progress-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    const fill = document.createElement('div');
    fill.className = 'anomalous-scan-progress-fill';
    track.appendChild(fill);
    panel.appendChild(track);

    const detail = document.createElement('div');
    detail.className = 'anomalous-scan-progress-detail';
    detail.style.whiteSpace = 'normal';
    detail.style.lineHeight = '1.4';
    detail.style.wordBreak = 'break-word';
    panel.appendChild(detail);

    const item = document.createElement('div');
    item.className = 'anomalous-scan-progress-item';
    panel.appendChild(item);

    document.body.appendChild(panel);
    return panel;
}


function progressRatio(status) {
    const total = Number(status.total) || 0;
    const current = Math.min(Number(status.current) || 0, total);
    const folderTotal = Number(status.folder_total) || 0;
    const folderCurrent = Math.min(Number(status.folder_current) || 0, folderTotal);
    const fileRatio = total > 0 ? current / total : 0;
    if (total === 0 && (status.phase === 'preparing' || status.phase === 'enumerating')) return null;
    if (folderTotal > 0 && folderCurrent > 0) {
        return Math.min(1, ((folderCurrent - 1) + fileRatio) / folderTotal);
    }
    return total > 0 ? fileRatio : null;
}


export function updateScanProgress(status, titleText = '') {
    if (!status || (!status.scanning && !status.interrupted)) return;
    if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
    }

    const panel = ensurePanel();
    panel.classList.remove('is-complete', 'is-error');
    const title = panel.querySelector('.anomalous-scan-progress-title');
    const fill = panel.querySelector('.anomalous-scan-progress-fill');
    const track = panel.querySelector('.anomalous-scan-progress-track');
    const detail = panel.querySelector('.anomalous-scan-progress-detail');
    const item = panel.querySelector('.anomalous-scan-progress-item');

    title.textContent = titleText || translate('scanProgressTitle');
    if (status.interrupted && !status.scanning) {
        failScanProgress(translate('scanProgressInterrupted'));
        return;
    }

    const ratio = progressRatio(status);
    panel.setAttribute('aria-busy', 'true');
    fill.classList.toggle('is-indeterminate', ratio === null);
    fill.style.width = ratio === null ? '35%' : `${Math.max(2, Math.round(ratio * 100))}%`;
    if (ratio === null) track.removeAttribute('aria-valuenow');
    else track.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));

    const folderTotal = Number(status.folder_total) || 0;
    const folderCurrent = Number(status.folder_current) || 0;
    if (folderTotal > 0) {
        detail.textContent = translate('scanProgressFolder', {
            current: folderCurrent,
            total: folderTotal,
            folder: status.folder || '',
        });
    } else if (status.phase === 'enumerating' || status.phase === 'preparing') {
        detail.textContent = translate('scanProgressPreparing');
    } else {
        detail.textContent = translate('sidebarScanning');
    }

    const total = Number(status.total) || 0;
    item.textContent = total > 0
        ? translate('scanProgressModel', {
            current: Number(status.current) || 0,
            total,
            filename: status.filename || '',
        })
        : translate('scanProgressCounting');
    if (status.recovered && total === 0) item.textContent = translate('scanProgressInterrupted');
    if (status.error) item.textContent = translate('scanProgressLastError', { error: status.error });
}


function closeLater(panel) {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
        if (typeof panel.remove === 'function') panel.remove();
        else if (panel.parentNode) panel.parentNode.removeChild(panel);
        closeTimer = null;
    }, 4000);
}


export function finishScanProgress(detailText = '') {
    const panel = ensurePanel();
    panel.classList.remove('is-error');
    panel.classList.add('is-complete');
    panel.setAttribute('aria-busy', 'false');
    panel.querySelector('.anomalous-scan-progress-title').textContent = translate('sidebarScanDone');
    const fill = panel.querySelector('.anomalous-scan-progress-fill');
    fill.classList.remove('is-indeterminate');
    fill.style.width = '100%';
    panel.querySelector('.anomalous-scan-progress-track').setAttribute('aria-valuenow', '100');
    if (detailText) {
        panel.querySelector('.anomalous-scan-progress-detail').textContent = detailText;
    } else {
        const currentDetail = panel.querySelector('.anomalous-scan-progress-detail').textContent;
        if (!currentDetail || currentDetail === translate('sidebarScanning') || currentDetail === translate('scanProgressPreparing')) {
            panel.querySelector('.anomalous-scan-progress-detail').textContent = translate('scanProgressFinished');
        }
    }
    panel.querySelector('.anomalous-scan-progress-item').textContent = '';
    closeLater(panel);
}


export function failScanProgress(message) {
    const panel = ensurePanel();
    panel.classList.remove('is-complete');
    panel.classList.add('is-error');
    panel.setAttribute('aria-busy', 'false');
    panel.querySelector('.anomalous-scan-progress-title').textContent = translate('scanProgressProblem');
    const fill = panel.querySelector('.anomalous-scan-progress-fill');
    fill.classList.remove('is-indeterminate');
    fill.style.width = '100%';
    panel.querySelector('.anomalous-scan-progress-track').removeAttribute('aria-valuenow');
    panel.querySelector('.anomalous-scan-progress-detail').textContent = message || translate('scanProgressInterrupted');
    panel.querySelector('.anomalous-scan-progress-item').textContent = translate('scanProgressRetryReady');
    closeLater(panel);
}
