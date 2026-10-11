/**
 * How the next scan goes (`scanOptions`, kept while the browser is open; the two that change
 * files go back off after each scan) and the scan page's settings: one tile each, with its icon
 * and switch, for the Civitai display name, fixing the workflow after the scan and the Civitai
 * key; the two that change files (renaming them, fetching everything again) folded under
 * "more", marked. Online or offline is the scan card's own switch (ui_scan_page.js), and which
 * models a scan reads is its picks: neither is here.
 */

import { translate as t } from './locales.js';
import { scanIcon } from './scan_icons.js';

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

function switchFor(key, onChange) {
    const input = el('input', 'anomalous-scan-switch');
    input.type = 'checkbox';
    input.checked = Boolean(scanOptions[key]);
    input.onchange = () => {
        scanOptions[key] = input.checked;
        onChange();
    };
    return input;
}

/** A tile: icon, title and `control` on top, what it does under them; `dim` when it does nothing now. */
function tile(icon, titleKey, help, control, dim = false) {
    const box = el(control.tagName === 'INPUT' ? 'label' : 'div', `anomalous-scan-tile${dim ? ' is-dim' : ''}`);
    const top = el('span', 'anomalous-scan-tile-top');
    top.append(scanIcon(icon), el('span', 'anomalous-scan-tile-title', t(titleKey)), control);
    box.append(top, el('small', 'anomalous-scan-setting-help', help));
    return box;
}

/** One setting in "more": what it is and does on the left, its switch on the right, a warning tag. */
function row(key, titleKey, helpKey, tag, onChange) {
    const line = el('label', 'anomalous-scan-setting');
    const copy = el('span', 'anomalous-scan-setting-copy');
    const title = el('span', 'anomalous-scan-setting-title', t(titleKey));
    title.append(el('span', 'anomalous-scan-tag', t(tag)));
    copy.append(title, el('small', 'anomalous-scan-setting-help', t(helpKey)));
    line.append(copy, switchFor(key, onChange));
    return line;
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
 * The settings. `moreOpen`: "more" is unfolded, `onMore(open)` when it is folded or unfolded;
 * `onChange()` after each switch (the page says what the next scan does); `onKey()` after the
 * key was saved.
 */
export function renderScanSettings(hasKey, { moreOpen, onMore, onChange, onKey }) {
    const box = el('section', 'anomalous-scan-settings');
    box.append(el('h2', 'anomalous-scan-section-title', t('scanSettingsTitle')));

    const key = el('button', 'anomalous-scan-secondary anomalous-scan-small-btn', t(hasKey ? 'scanPageApiKeyChange' : 'scanPageApiKeySet'));
    key.type = 'button';
    key.onclick = async () => {
        if (await saveApiKey()) onKey();
    };
    const tiles = el('div', 'anomalous-scan-tiles');
    tiles.append(
        tile('name', 'scanTileDisplayName', t(scanOptions.offline ? 'scanTileOnlineOnly' : 'scanTileDisplayNameHelp'),
            switchFor('virtualRename', onChange), scanOptions.offline),
        tile('fix', 'scanTileAutoFix', t('scanTileAutoFixHelp'), switchFor('autoFix', onChange)),
        tile('key', 'scanTileKey', t(hasKey ? 'scanTileKeyOn' : 'scanTileKeyOff'), key),
    );

    // Renaming files and fetching everything again: rarer, and they change files or take long.
    const more = el('details', 'anomalous-scan-more-settings');
    more.open = moreOpen;
    more.ontoggle = () => onMore(more.open);
    const summary = el('summary', 'anomalous-scan-more-head', t('scanSettingsMore'));
    summary.append(el('span', 'anomalous-scan-tag', t('scanPageTagFiles')));
    more.append(summary,
        row('physicalRename', 'scanPageFileRename', 'scanPageFileRenameHelp', 'scanPageTagFiles', onChange),
        row('forceOverwrite', 'scanPageForce', 'scanPageForceHelp', 'scanPageTagSlow', onChange),
        el('small', 'anomalous-scan-setting-help', t('scanSettingsLead')));
    if (scanOptions.offline) more.append(el('small', 'anomalous-scan-setting-help', t('scanTileOnlineOnly')));
    box.append(tiles, more);
    return box;
}
