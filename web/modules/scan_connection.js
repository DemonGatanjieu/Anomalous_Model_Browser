/**
 * Before an online scan: can Civitai be reached (GET /anomalous/civitai_check, both its
 * addresses)? When not, the user is asked instead of the scan waiting on every model: scan
 * from the files only (an offline scan; a later online scan fills in the rest), set a proxy
 * first (Settings → Models, Network), or not now. A check that reached Civitai is trusted for
 * a few minutes, so scans in a row do not wait on it.
 */

import { translate as t } from './locales.js';
import { failureWords } from './net_failure.js';
import { anomalousConfirm } from './ui_dialog.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { openSettingsPage } from './ui_settings_page.js';

const TRUSTED_MS = 5 * 60 * 1000;
let reachedAt = 0;

/** 'online' (Civitai answers, or this cannot be told), 'offline' (scan from the files), or null (not now). */
export async function onlineOrAsk(owner) {
    if (Date.now() - reachedAt < TRUSTED_MS) return 'online';
    showWorkbenchToast(t('scanCheckingNet'));
    let answer = null;
    try {
        const res = await fetch('/anomalous/civitai_check');
        answer = res.ok ? await res.json() : null;
    } catch {
        answer = null;
    }
    if (!answer || answer.reachable) {
        if (answer) reachedAt = Date.now();
        return 'online';
    }
    const choice = await anomalousConfirm(t('scanNetDownText', { why: failureWords(answer.failure) }), t('scanNetDownTitle'), {
        okLabel: t('scanNetFromFiles'), okClass: 'anomalous-btn-primary', noLabel: t('scanNetSetProxy'),
    });
    if (choice === true) return 'offline';
    if (choice === false) {
        owner.show?.();
        openSettingsPage(owner, { tab: 'models' });
    }
    return null;
}
