/**
 * How the next scan goes (`scanOptions`, kept while the browser is open; the two risky ones go
 * back off after each scan) and the scan page's settings card that changes it: folded, a row
 * of short words for the current choices; unfolded, in place, the switches (offline, the
 * online-only ones, what happens after the scan) and the Civitai key. Which models a scan
 * reads is the scan page's own (its picks), not a setting.
 */

import { translate as t } from './locales.js';

export const scanOptions = {
    picked: [], // the picker's items; none: every model
    offline: false,
    virtualRename: true,
    physicalRename: false,
    forceOverwrite: false,
    autoFix: true,
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** One setting: what it is and does on the left, its switch on the right; `tag` warns beside the title. */
function toggle(key, titleKey, helpKey, onChange, tag = '') {
    const row = el('label', 'anomalous-scan-setting');
    const copy = el('span', 'anomalous-scan-setting-copy');
    const title = el('span', 'anomalous-scan-setting-title', t(titleKey));
    if (tag) title.append(el('span', 'anomalous-scan-tag', t(tag)));
    copy.append(title, el('small', 'anomalous-scan-setting-help', t(helpKey)));
    const input = el('input', 'anomalous-scan-switch');
    input.type = 'checkbox';
    input.checked = Boolean(scanOptions[key]);
    input.onchange = () => {
        scanOptions[key] = input.checked;
        onChange();
    };
    row.append(copy, input);
    return row;
}

/** How the next scan will go, in short words; `true` marks the ones that change files or take long. */
function currentChoices(hasKey) {
    const online = !scanOptions.offline;
    return [
        [t(online ? 'scanChipOnline' : 'scanPageOffline')],
        online && scanOptions.virtualRename && [t('scanChipDisplayName')],
        online && scanOptions.physicalRename && [t('scanChipFileRename'), true],
        online && scanOptions.forceOverwrite && [t('scanChipForce'), true],
        scanOptions.autoFix && [t('scanChipAutoFix')],
        [t(hasKey ? 'scanChipKeyOn' : 'scanChipKeyOff')],
    ].filter(Boolean);
}

/** Asks for the Civitai key and saves it; true when saved (also Model Check's downloads). */
export async function saveApiKey() {
    const value = prompt(t('scanPageApiKeyPrompt'), '');
    if (value === null) return false;
    try {
        const res = await fetch('/anomalous/save_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: value.trim() }),
        });
        const data = await res.json();
        if (data.status !== 'ok') throw new Error(data.message || `HTTP ${res.status}`);
        alert(t(value.trim() ? 'scanPageApiKeySaved' : 'scanPageApiKeyCleared'));
        return true;
    } catch (error) {
        alert(t('scanPageApiKeyFailed', { error: String(error.message || error) }));
        return false;
    }
}

/**
 * The settings card. `open`: unfolded; `onFold(open)` when it is folded or unfolded; `onChange()`
 * after each switch (the page says what the next scan does); `onKey()` after the key was saved.
 */
export function renderScanSettings(hasKey, { open, onFold, onChange, onKey }) {
    const card = el('details', 'anomalous-scan-card anomalous-scan-settings');
    card.open = open;
    card.ontoggle = () => onFold(card.open);
    const head = el('summary', 'anomalous-scan-settings-head');
    const chips = el('span', 'anomalous-scan-chips');
    for (const [text, warn] of currentChoices(hasKey)) chips.append(el('span', `anomalous-scan-chip${warn ? ' is-warn' : ''}`, text));
    head.append(el('span', 'anomalous-scan-card-title', t('scanSettingsTitle')), chips,
        el('span', 'anomalous-scan-settings-change', t('scanSettingsChange')), el('span', 'anomalous-scan-settings-fold', t('scanSettingsFold')));

    // What only an online scan does: under its own heading, faded while scanning offline.
    const online = el('div', `anomalous-scan-online${scanOptions.offline ? ' is-disabled' : ''}`);
    online.append(
        el('div', 'anomalous-scan-subtitle', t(scanOptions.offline ? 'scanPageOnlineOff' : 'scanPageOnline')),
        toggle('virtualRename', 'scanPageDisplayName', 'scanPageDisplayNameHelp', onChange),
        toggle('physicalRename', 'scanPageFileRename', 'scanPageFileRenameHelp', onChange, 'scanPageTagFiles'),
        toggle('forceOverwrite', 'scanPageForce', 'scanPageForceHelp', onChange, 'scanPageTagSlow'),
    );

    const key = el('div', 'anomalous-scan-setting');
    const keyCopy = el('span', 'anomalous-scan-setting-copy');
    const keyTitle = el('span', 'anomalous-scan-setting-title', t('scanPageApiKey'));
    keyTitle.append(el('span', `anomalous-scan-tag ${hasKey ? 'is-on' : 'is-off'}`, t(hasKey ? 'scanPageApiKeyOn' : 'scanPageApiKeyOff')));
    keyCopy.append(keyTitle, el('small', 'anomalous-scan-setting-help', t('scanPageApiKeyHelp')));
    const set = el('button', 'anomalous-scan-secondary anomalous-scan-small-btn', t('scanPageApiKeySet'));
    set.type = 'button';
    set.onclick = async () => {
        if (await saveApiKey()) onKey();
    };
    key.append(keyCopy, set);

    const part = (titleKey, ...rows) => {
        const box = el('div', 'anomalous-scan-settings-part');
        box.append(el('h3', 'anomalous-scan-group-title', t(titleKey)), ...rows);
        return box;
    };
    card.append(head, el('p', 'anomalous-scan-setting-help', t('scanSettingsLead')),
        part('scanPageHow', toggle('offline', 'scanPageOffline', 'scanPageOfflineHelp', onChange), online),
        part('scanPageAfter', toggle('autoFix', 'scanPageAutoFix', 'scanPageAutoFixHelp', onChange)),
        part('scanPageAccount', key));
    return card;
}
