/**
 * A model's versions on Civitai, in its details: a button the user presses (only then is Civitai
 * asked, GET /anomalous/download/versions), then every version of its model page, newest first,
 * each with its base model, date and size: the ones in this folder open with a click, the others
 * download next to this one (model_download.downloadFrom, the file checked by its SHA-256). A
 * version whose file name is already taken here gets the version's name added, as a download
 * never replaces a file.
 */

import { translate as t } from './locales.js';
import { formatSize } from './file_size.js';
import { downloadFrom } from './model_download.js';
import { freeName, pageId, versionId } from './model_versions.js';

const ERRORS = ['unreachable', 'not_found', 'bad_request']; // the route's answers that have words

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function versionRow(owner, model, version, here, onOpen) {
    const row = el('div', `anomalous-civitai-version${here ? ' is-here' : ''}`);
    const about = el('div', 'anomalous-civitai-version-about');
    about.append(el('span', 'anomalous-civitai-version-name', version.name || `#${version.id}`),
        el('span', 'anomalous-civitai-version-facts', [version.base_model, version.published, version.size ? formatSize(version.size) : '']
            .filter(Boolean).join(' · ')));
    row.append(about);
    if (here) {
        const open = el('button', 'anomalous-civitai-version-action', here === model ? t('civitaiVersionShown') : t('civitaiVersionOpen'));
        open.type = 'button';
        open.disabled = here === model;
        open.onclick = () => onOpen(here);
        row.append(open);
        return row;
    }
    if (!version.file_name) {
        row.append(el('span', 'anomalous-civitai-version-note', t('civitaiVersionNoFile')));
        return row;
    }
    const get = el('button', 'anomalous-civitai-version-action', t('civitaiVersionDownload'));
    get.type = 'button';
    get.title = version.sha256 ? t('civitaiVersionChecked') : t('civitaiVersionUnchecked');
    get.onclick = async () => {
        get.disabled = true;
        const taken = new Set((owner.models || []).filter(other => (other.subfolder || '') === (model.subfolder || ''))
            .map(other => String(other.filename).toLowerCase()));
        try {
            const started = await downloadFrom(owner, {
                url: version.page, hash: version.sha256, type: model.type || owner.currentType, root: model.path_idx,
                folder: model.subfolder || owner.currentSubfolder || '', name: freeName(version.file_name, version.name, taken),
            });
            get.textContent = t('civitaiVersionDownloading', { to: started.to });
        } catch (error) {
            get.disabled = false;
            get.textContent = t('civitaiVersionFailed', { error: error.message });
        }
    };
    row.append(get);
    return row;
}

/** The details' "Versions on Civitai" box for `model` (null without a Civitai page); `onOpen(model)` opens one here. */
export function civitaiVersionsBox(owner, model, onOpen) {
    const page = pageId(model);
    if (!page) return null;
    const box = el('div', 'anomalous-civitai-versions');
    const ask = el('button', 'anomalous-civitai-versions-ask', t('civitaiVersionsAsk'));
    ask.type = 'button';
    ask.title = t('civitaiVersionsAskHint');
    const list = el('div', 'anomalous-civitai-versions-list');
    ask.onclick = async () => {
        ask.disabled = true;
        list.replaceChildren(el('div', 'anomalous-civitai-version-note', t('civitaiVersionsReading')));
        try {
            const answer = await fetch(`/anomalous/download/versions?${new URLSearchParams({ model_id: page })}`);
            const data = await answer.json().catch(() => ({}));
            if (!answer.ok) throw new Error(ERRORS.includes(data.error) ? t(`civitaiVersionsError_${data.error}`) : data.error || answer.statusText);
            if (!box.isConnected) return; // the details moved on meanwhile
            const byVersion = new Map((owner.models || []).filter(other => pageId(other) === page).map(other => [versionId(other), other]));
            list.replaceChildren(el('div', 'anomalous-civitai-version-note', t('civitaiVersionsCount', { count: data.versions.length })),
                ...data.versions.map(version => versionRow(owner, model, version, byVersion.get(version.id), onOpen)));
        } catch (error) {
            list.replaceChildren(el('div', 'anomalous-civitai-version-note is-error', t('civitaiVersionsFailed', { error: error.message })));
        } finally {
            ask.disabled = false;
        }
    };
    box.append(ask, list);
    return box;
}
