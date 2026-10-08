/**
 * Activity log client: reading, adding canvas entries, clearing; and the words for
 * each entry. The server (`api/activity_log.py`) keeps the list and records file
 * changes itself.
 */

import { translate as t } from './locales.js';
import { countsLine, fileOutcome, scanScope, STATUS_MARKS } from './scan_results.js';

// Server action id → locale key.
const ACTION_KEYS = {
    model_delete: 'activityModelDelete',
    model_edit: 'activityModelEdit',
    model_cover: 'activityModelCover',
    scan: 'activityScan', // entries from before scans were recorded with their result
    recipe_save: 'activityRecipeSave',
    recipe_edit: 'activityRecipeEdit',
    recipe_delete: 'activityRecipeDelete',
    recipe_restore: 'activityRecipeRestore',
    recipe_cover: 'activityRecipeCover',
    recipe_import: 'activityRecipeImport',
    material_save: 'activityMaterialSave',
    material_edit: 'activityMaterialEdit',
    material_delete: 'activityMaterialDelete',
    note_save: 'activityNoteSave',
    note_delete: 'activityNoteDelete',
    preset_save: 'activityPresetSave',
    preset_rename: 'activityPresetRename',
    preset_delete: 'activityPresetDelete',
    image_delete: 'activityImageDelete',
    audio_delete: 'activityAudioDelete',
    audio_save: 'activityAudioSave',
    cache_clear: 'activityCacheClear',
    voice_import: 'activityVoiceImport',
    voice_settings: 'activityVoiceSettings',
    voice_storage: 'activityVoiceStorage',
    model_download: 'activityModelDownload',
    model_import: 'activityModelImport',
    backup_export: 'activityBackupExport',
    backup_import: 'activityBackupImport',
};

async function request(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}

/** Newest first. `source`: 'canvas' | 'file' | undefined (both). */
export async function fetchActivity({ limit = 100, source = '', signal } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (source) params.set('source', source);
    const data = await request(`/anomalous/activity?${params}`, { signal });
    return Array.isArray(data.entries) ? data.entries : [];
}

export function postCanvasActivity(payload) {
    return request('/anomalous/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

export function clearActivity() {
    return request('/anomalous/activity/clear', { method: 'POST' });
}

/** One line saying what an entry did. */
export function entrySummary(entry) {
    if (entry.source === 'canvas') {
        const changes = entry.detail?.changes || [];
        const opened = changes.find(change => change.kind === 'opened');
        if (opened) return t('activityCanvasOpened', { name: opened.node || '—', count: opened.after || '?' });
        const changed = t('activityCanvasChanged', { count: entry.detail?.total || changes.length });
        return entry.detail?.via === 'mcp' ? t('activityByAi', { summary: changed }) : changed;
    }
    if (entry.action === 'scan_done') {
        const scan = entry.detail?.scan || {};
        return t('activityScanDone', { scope: scanScope(scan, entry.target), counts: countsLine(scan.counts) });
    }
    const words = t(ACTION_KEYS[entry.action] || 'activityUnknown');
    return entry.target ? t('activityWithTarget', { action: words, target: entry.target }) : words;
}

function formatSize(bytes) {
    const value = Number(bytes) || 0;
    return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : `${Math.max(0.1, value / 1024 ** 2).toFixed(1)} MB`;
}

const FIELD_KEYS = {
    custom_name: 'modelSourceFieldName', custom_notes: 'modelSourceFieldNotes',
    source_url: 'modelSourceFieldLink', filename: 'activityFieldFilename',
};

/**
 * The lines a file entry opens to: [{text, model?}], `model` being a scanned model the line
 * can open ({type, path_idx, rel, filename}). Empty for entries without details.
 */
export function fileDetailLines(entry) {
    const detail = entry.detail || {};
    const empty = t('activityEmptyValue');
    const lines = [];
    if (detail.scan?.civitai_down) lines.push({ text: t('scanResultCivitaiDown') });
    for (const error of detail.scan?.errors || []) lines.push({ text: error });
    const download = detail.download;
    if (download) {
        lines.push({
            text: t('activityDownloadLine', { file: download.rel || download.file, size: formatSize(download.size), source: download.source || '?' }),
            model: { type: download.type, path_idx: download.path_idx, rel: download.rel, filename: download.file },
        });
        lines.push({ text: t(download.verified ? 'activityDownloadChecked' : 'activityDownloadUnchecked') });
        if (download.value && download.value !== download.rel) lines.push({ text: t('activityDownloadFor', { value: download.value }) });
    }
    for (const item of detail.files || []) {
        if (typeof item === 'string') lines.push({ text: t('activityFileMoved', { name: item }) });
        else lines.push({ text: `${STATUS_MARKS[item.status] || '·'} ${item.filename}: ${fileOutcome(item)}`, model: item.rel ? item : null });
    }
    for (const field of detail.fields || []) {
        lines.push({ text: t('activityFieldChange', {
            field: t(FIELD_KEYS[field.field] || field.field), before: field.before || empty, after: field.after || empty,
        }) });
    }
    return lines;
}

/** One line per canvas change (not for `opened`). */
export function changeLine(change) {
    const empty = t('activityEmptyValue');
    if (change.kind === 'added') return t('activityAdded', { node: change.node });
    if (change.kind === 'removed') return t('activityRemoved', { node: change.node });
    return t('activityChangedValue', {
        node: change.node, widget: change.widget, before: change.before || empty, after: change.after || empty,
    });
}

/** Day heading for grouping: today, yesterday, or the date. */
export function dayLabel(seconds, now = new Date()) {
    const day = new Date(seconds * 1000);
    const start = date => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diff = Math.round((start(now) - start(day)) / 86400000);
    if (diff === 0) return t('activityToday');
    if (diff === 1) return t('activityYesterday');
    return day.toLocaleDateString();
}

export function timeLabel(seconds) {
    return new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
