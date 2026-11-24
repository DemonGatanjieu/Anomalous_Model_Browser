/**
 * What the first-run floating welcome card and scan dock show (ui_first_run.js draws them):
 * a centered welcome dialog ("Scan my models", optional inline Civitai key foldout, and an
 * offline / retry / proxy strip only when Civitai does not answer) that docks to a compact
 * bottom-right progress pill once scanning starts. No DOM.
 *
 * `phase`: 'idle' (waiting for the press), 'checking' (asking Civitai), 'offline_choice' (it did not
 * answer: scan offline, retry or set a proxy), 'running', 'done' or 'failed'. `counts`: { total,
 * waiting } of the scan summary. `netFailure` / `netError`: why Civitai did not answer (net_proxy.py's
 * failure code, else the error), for the fallback strip. `keyRefused`: Civitai answered but refused the
 * key; the scan goes on and a note says so. `hasKey`: whether a Civitai key is already saved.
 * `offline`: the scan that ran (or failed) was an offline one. `result`: finished scan payload.
 */

/** The body line of a card waiting for its press, by what the folders hold. */
function waitingBody(counts) {
    const total = counts?.total || 0;
    const waiting = counts?.waiting || 0;
    if (!total) return { kind: 'empty', bodyKey: 'firstRunScanNone', bodyParams: {} };
    if (waiting > 0) return { kind: 'ready', bodyKey: 'firstRunLeadCount', bodyParams: { count: waiting } };
    return { kind: 'scanned', bodyKey: 'firstRunScanNothingNew', bodyParams: {} };
}

/** Whether a completed online scan without a key left missing covers or unmatched models. */
function needsKeyNudge({ offline, hasKey, result }) {
    if (offline || hasKey) return false;
    const counts = result?.counts;
    return Boolean((counts?.covers_missed || 0) > 0 || (counts?.inferred || 0) > 0);
}

/**
 * { kind, presentation ('dialog' | 'dock'), titleKey, bodyKey, bodyParams,
 * primaryAction ('import' | 'scan' | 'retry' | 'none'), primaryLabelKey, primaryDisabled,
 * showFallback, fallbackKey, fallback ({ failure, error }), showOfflineScan, showTourLink,
 * showKeyFoldout, hasKey, suggestKey, pillKey, dismissKey, keyWarning }.
 */
export function describeFirstRun({ phase = 'idle', counts = null, netFailure = '', netError = '', keyRefused = false, hasKey = false, offline = false, result = null } = {}) {
    const waiting = waitingBody(counts);
    const hasModels = (counts?.total || 0) > 0;
    const view = {
        kind: phase,
        presentation: phase === 'running' || phase === 'done' ? 'dock' : 'dialog',
        titleKey: 'firstRunTitle',
        bodyKey: '',
        bodyParams: {},
        primaryAction: 'none',
        primaryLabelKey: '',
        primaryDisabled: false,
        showFallback: false,
        fallbackKey: '',
        fallback: null,
        showOfflineScan: false,
        showTourLink: false,
        showKeyFoldout: (phase === 'idle' && hasModels) || phase === 'offline_choice',
        hasKey: Boolean(hasKey),
        suggestKey: phase === 'done' && needsKeyNudge({ offline, hasKey, result }),
        pillKey: '',
        dismissKey: 'firstRunLater',
        keyWarning: Boolean(keyRefused && !offline),
    };
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
