/**
 * Activity log client: reading, adding canvas entries, clearing; and the words for
 * each entry. The server (`api/activity_log.py`) keeps the list and records file
 * changes itself.
 */

import { translate as t } from './locales.js';

// Server action id → locale key.
const ACTION_KEYS = {
    model_delete: 'activityModelDelete',
    model_edit: 'activityModelEdit',
    model_cover: 'activityModelCover',
    scan: 'activityScan',
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
        return t('activityCanvasChanged', { count: entry.detail?.total || changes.length });
    }
    const words = t(ACTION_KEYS[entry.action] || 'activityUnknown');
    return entry.target ? t('activityWithTarget', { action: words, target: entry.target }) : words;
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
