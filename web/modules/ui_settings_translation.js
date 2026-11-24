/**
 * Settings → Workflows & Tools → Translation: prompts are translated by DeepL with the user's own key,
 * else by the free services (translation_routes.py). Asks for the key, saves it and tries it on one
 * sentence. `group` and `row` are the settings page's own helpers (ui_settings_page.js).
 */

import { translate as t } from './locales.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Why DeepL did not translate (translation_routes.py `deepl_error`), in the user's words. */
function deeplReason(error) {
    const known = { bad_key: 'settingsDeeplBadKey', quota: 'settingsDeeplQuota', busy: 'settingsDeeplBusy' };
    return known[error] ? t(known[error]) : String(error || '?');
}

/**
 * Asks for the DeepL key and saves it, then translates one sentence to show whether it works.
 * Resolves to the saved key ("" when removed), or null when nothing was saved.
 */
async function saveDeeplKey() {
    const value = prompt(t('settingsDeeplKeyPrompt'), '');
    if (value === null) return null;
    const key = value.trim();
    try {
        const res = await fetch('/anomalous/save_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deepl_key: key }),
        });
        const data = await res.json();
        if (data.status !== 'ok') throw new Error(data.message || `HTTP ${res.status}`);
    } catch (error) {
        alert(t('settingsDeeplKeySaveFailed', { error: String(error.message || error) }));
        return null;
    }
    if (!key) {
        alert(t('settingsDeeplKeyCleared'));
        return key;
    }
    try {
        const res = await fetch('/anomalous/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'A girl reading under a cherry tree.', target_lang: 'zh-CN' }),
        });
        const data = await res.json();
        alert(data.engine === 'deepl'
            ? t('settingsDeeplKeyWorks', { text: data.translated })
            : t('settingsDeeplKeyFailed', { why: deeplReason(data.deepl_error || data.error) }));
    } catch (error) {
        alert(t('settingsDeeplKeyFailed', { why: String(error.message || error) }));
    }
    return key;
}

/** The Translation card: whether a DeepL key is set, and a button to set it; filled once the config is read. */
export function translationGroup({ group, row }) {
    const box = group('settingsTranslation');
    fetch('/anomalous/config').then(res => res.json()).then(config => {
        const tag = el('span');
        const show = (hasKey) => {
            tag.className = `anomalous-scan-tag ${hasKey ? 'is-on' : 'is-off'}`;
            tag.textContent = t(hasKey ? 'settingsDeeplKeyOn' : 'settingsDeeplKeyOff');
        };
        show(Boolean(config.has_deepl_key));
        // Only the tag changes: redrawing the page would lose its scroll place.
        const set = el('button', 'anomalous-scan-secondary anomalous-scan-small-btn', t('settingsDownloadKeySet'));
        set.type = 'button';
        set.onclick = async () => {
            const key = await saveDeeplKey();
            if (key !== null) show(Boolean(key));
        };
        const line = row('settingsDeeplKey', 'settingsDeeplKeyHelp', set);
        line.querySelector('.anomalous-scan-setting-title').append(tag);
        box.append(line);
    }).catch(error => console.warn('[AMB] Settings: translation settings unavailable.', error));
    return box;
}
