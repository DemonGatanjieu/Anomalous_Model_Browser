/**
 * Words for what a scan found (the result GET /anomalous/last_scan returns, also kept in the
 * activity log): a model's outcome, why an unmatched model has no Civitai record, a scan's
 * counts. Shared by the scan page, the activity page and the progress box. No DOM.
 */

import { translate as t } from './locales.js';

const REASON_KEYS = { not_found: 'scanReasonNotFound', network: 'scanReasonNetwork', offline: 'scanReasonOffline' };
const ERROR_KEYS = { name_conflict: 'scanErrorNameConflict', duplicate_kept: 'scanErrorDuplicateKept' };
const COUNT_KEYS = [
    ['matched', 'scanCountMatched'], ['inferred', 'scanCountInferred'], ['failed', 'scanCountFailed'],
    ['covers', 'scanCountCovers'], ['renamed', 'scanCountRenamed'],
];

/** The mark before a model's line. */
export const STATUS_MARKS = { matched: '✓', inferred: '≈', failed: '✕', unchanged: '·' };

/** Why an unmatched model has no Civitai record. */
export function reasonText(reason) {
    return t(REASON_KEYS[reason] || 'scanReasonUnknown');
}

/** Models whose lookup did not happen (offline, or no connection): the next online scan asks. */
export function isPending(reason) {
    return reason === 'offline' || reason === 'network';
}

/** "3 matched · 1 inferred …", the parts that are not zero. */
export function countsLine(counts = {}) {
    const parts = COUNT_KEYS.filter(([key]) => counts[key]).map(([key, label]) => t(label, { count: counts[key] }));
    return parts.length ? parts.join(' · ') : t('scanCountNothing');
}

/** What happened to one model in a scan. */
export function fileOutcome(item) {
    let text;
    if (item.status === 'matched') text = t('scanFileMatched', { name: item.name || item.filename });
    else if (item.status === 'inferred') {
        text = item.base ? t('scanFileInferredBase', { reason: reasonText(item.reason), base: item.base })
            : t('scanFileInferred', { reason: reasonText(item.reason) });
    } else if (item.status === 'failed') text = t('scanFileFailed', { error: ERROR_KEYS[item.error] ? t(ERROR_KEYS[item.error]) : item.error || '?' });
    else text = t('scanFileUpdated');
    if (item.renamed_from) text += ` · ${t('scanFileRenamed', { from: item.renamed_from })}`;
    if (item.duplicate) text += ` · ${t('scanFileDuplicate')}`;
    if (item.cover === 'kept') text += ` · ${t('scanFileCoverKept')}`;
    return text;
}

/** Which models a scan covered: all, picked, or one (`target`: its file name). */
export function scanScope(scan, target = '') {
    if (scan?.kind === 'one') return t('scanScopeOne', { name: target || '?' });
    if (scan?.kind === 'picked') return t('scanScopePicked');
    return t(scan?.options?.retry_unmatched ? 'scanScopeRetry' : 'scanScopeAll');
}

/** The progress box's line when a scan has ended. */
export function resultLine(result) {
    if (!result?.counts) return '';
    if (result.kind === 'one') return oneModelLine(result);
    return result.civitai_down ? `${countsLine(result.counts)} · ${t('scanCivitaiDownShort')}` : countsLine(result.counts);
}

/** After one model's scan (its card's radar button). */
export function oneModelLine(result) {
    const item = result?.files?.[0];
    return item ? fileOutcome(item) : t('scanOneUnchanged');
}
