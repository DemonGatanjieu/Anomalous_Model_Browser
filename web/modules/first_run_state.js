/**
 * What the first-run card on Home shows (ui_first_run.js draws it): one button that scans the user's
 * models, the network checked on the way, and a way on only when Civitai does not answer. No DOM.
 *
 * `phase`: 'idle' (waiting for the press), 'checking' (asking Civitai), 'offline_choice' (it did not
 * answer: scan offline, retry or set a proxy), 'running', 'done' or 'failed'. `counts`: { total,
 * waiting } of the scan summary. `netFailure` / `netError`: why Civitai did not answer (net_proxy.py's
 * failure code, else the error), for the fallback strip. `keyRefused`: Civitai answered but refused the
 * key; the scan goes on and a note says so. `offline`: the scan that ran (or failed) was an offline one.
 */

/** The body line of a card waiting for its press, by what the folders hold. */
function waitingBody(counts) {
    const total = counts?.total || 0;
    const waiting = counts?.waiting || 0;
    if (!total) return { kind: 'empty', bodyKey: 'firstRunScanNone', bodyParams: {} };
    if (waiting > 0) return { kind: 'ready', bodyKey: 'firstRunLeadCount', bodyParams: { count: waiting } };
    return { kind: 'scanned', bodyKey: 'firstRunScanNothingNew', bodyParams: {} };
}

/**
 * { kind, titleKey, bodyKey, bodyParams, primaryAction ('import' | 'scan' | 'retry' | 'none'),
 * primaryLabelKey, primaryDisabled, showFallback, fallbackKey, fallback ({ failure, error }),
 * showOfflineScan, showTourLink, pillKey, dismissKey, keyWarning }.
 */
export function describeFirstRun({ phase = 'idle', counts = null, netFailure = '', netError = '', keyRefused = false, offline = false } = {}) {
    const view = {
        kind: phase, titleKey: 'firstRunTitle', bodyKey: '', bodyParams: {},
        primaryAction: 'none', primaryLabelKey: '', primaryDisabled: false,
        showFallback: false, fallbackKey: '', fallback: null, showOfflineScan: false, showTourLink: false, pillKey: '',
        dismissKey: 'firstRunLater', keyWarning: Boolean(keyRefused && !offline),
    };
    const waiting = waitingBody(counts);
    if (phase === 'idle') {
        const primary = {
            empty: ['import', 'homeImportModels'], ready: ['scan', 'firstRunScanMyModels'], scanned: ['scan', 'firstRunScanAgain'],
        }[waiting.kind];
        return { ...view, ...waiting, primaryAction: primary[0], primaryLabelKey: primary[1], showTourLink: true };
    }
    if (phase === 'checking') {
        return { ...view, bodyKey: waiting.bodyKey, bodyParams: waiting.bodyParams,
            primaryAction: 'scan', primaryLabelKey: 'firstRunNetChecking', primaryDisabled: true };
    }
    if (phase === 'offline_choice') {
        return { ...view, bodyKey: waiting.bodyKey, bodyParams: waiting.bodyParams, showFallback: true,
            fallbackKey: 'firstRunOfflineFallback', fallback: { failure: String(netFailure || ''), error: String(netError || '') } };
    }
    if (phase === 'running') return { ...view, bodyKey: 'firstRunScanRunning' };
    if (phase === 'done') {
        return { ...view, bodyKey: 'firstRunScanDoneBody', pillKey: 'firstRunScanDone', showTourLink: true, dismissKey: 'firstRunDone' };
    }
    if (phase === 'failed') {
        return { ...view, bodyKey: 'firstRunScanFailed', primaryAction: 'retry', primaryLabelKey: 'firstRunRetry', showOfflineScan: !offline };
    }
    throw new Error(`first-run card: unknown phase ${phase}`);
}
