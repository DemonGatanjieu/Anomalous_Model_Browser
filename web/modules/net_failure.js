/**
 * Why a request of the plugin failed, in words: the codes of net_proxy.py `failure()` ('timeout',
 * 'refused', 'http:503' …) as the settings' connection test and the scan results show them.
 */

import { translate as t } from './locales.js';

const WORDS = {
    timeout: 'netFailureTimeout', refused: 'netFailureRefused', dns: 'netFailureDns',
    ssl: 'netFailureSsl', reset: 'netFailureReset', proxy: 'netFailureProxy',
};

export function failureWords(code) {
    const text = String(code || '');
    if (text.startsWith('http:')) return t('netFailureHttp', { code: text.slice(5) });
    return t(WORDS[text] || 'netFailureOther');
}

/** The line under "Civitai stopped answering": why, and what to try. '' when the reason is unknown. */
export function civitaiDownWhy(code) {
    return code ? t('scanCivitaiWhy', { why: failureWords(code) }) : '';
}
