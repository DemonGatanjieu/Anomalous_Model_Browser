/**
 * Switching between the versions of one model (model_versions.js groups them by their Civitai page):
 * on a card the version label becomes a switch whose menu lists the versions downloaded here,
 * and the details show them as a row to go from one to another. The version last picked on a card
 * is kept in this browser (localStorage, a convenience only: without it the newest is shown).
 * The versions not downloaded yet are listed on demand by ui_civitai_versions.js.
 */

import { translate as t } from './locales.js';
import { openActionMenu } from './action_menu.js';
import { formatSize } from './file_size.js';
import { pageId, versionId, versionsOf } from './model_versions.js';

const KEY = 'anomalous.modelVersions'; // { pageId: versionId } picked on the cards

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function picked() {
    try {
        const value = JSON.parse(localStorage.getItem(KEY) || '{}');
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
}

/** The version id last picked for model page `page` on a card, or 0. */
export const chosenVersion = page => Number(picked()[page]) || 0;

function rememberVersion(model) {
    const page = pageId(model);
    if (!page) return;
    try {
        localStorage.setItem(KEY, JSON.stringify({ ...picked(), [page]: versionId(model) }));
    } catch { /* storage off: the newest is shown next time */ }
}

/** How a version is called: its Civitai name, else its file's. */
export const versionLabel = model => model.metadata?.version_name || model.filename;

function versionFacts(model) {
    return [model.metadata?.baseModel, model.size_bytes ? formatSize(model.size_bytes) : ''].filter(Boolean).join(' · ');
}

/** A card's version label as a switch over `versions` (more than one); `onPick(model)` shows that one on the card. */
export function versionSwitch(model, versions, onPick) {
    const node = el('button', 'anomalous-card-version is-switch');
    node.type = 'button';
    node.setAttribute('aria-haspopup', 'menu');
    node.setAttribute('aria-expanded', 'false');
    node.append(el('span', 'anomalous-card-version-name', versionLabel(model)),
        el('span', 'anomalous-card-version-count', t('modelVersionsCount', { count: versions.length })));
    node.title = t('modelVersionsSwitch');
    let close = null; // the menu while it is open
    node.onclick = event => {
        event.stopPropagation();
        if (close) {
            close();
            return;
        }
        node.setAttribute('aria-expanded', 'true');
        close = openActionMenu(node, versions.map(version => ({
            icon: version === model ? '✓' : '',
            label: [versionLabel(version), versionFacts(version)].filter(Boolean).join(' · '),
            run: () => {
                if (version === model) return;
                rememberVersion(version);
                onPick(version);
            },
        })), { onClose: () => { close = null; node.setAttribute('aria-expanded', 'false'); } });
    };
    return node;
}

/** The details' row of the versions downloaded here (`owner.models`), `onOpen(model)` going to one; null without others. */
export function detailVersionRow(owner, model, onOpen) {
    const versions = versionsOf(owner.models, model);
    if (versions.length < 2) return null;
    const row = el('div', 'anomalous-detail-versions');
    row.append(el('span', 'anomalous-detail-versions-label', t('modelVersionsHere', { count: versions.length })));
    for (const version of versions) {
        const chip = el('button', `anomalous-detail-version${version === model ? ' is-current' : ''}`, versionLabel(version));
        chip.type = 'button';
        chip.title = [versionFacts(version), version.filename].filter(Boolean).join('\n');
        if (version === model) chip.setAttribute('aria-current', 'true');
        else chip.onclick = () => onOpen(version);
        row.append(chip);
    }
    return row;
}
