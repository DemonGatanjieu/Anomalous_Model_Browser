/**
 * shortcut_layout.js - State and Persistence for Customizable Shortcut Bar
 *
 * Implements schema validation, capacity limits, pinning, unpinning,
 * reordering and reset logic with localStorage persistence.
 */

import { CATALOG_TOOLS } from './tool_registry.js';

export const SHORTCUT_STORAGE_KEY = 'anomalous_shortcut_layout_v1';
export const SHORTCUT_SCHEMA_VERSION = 1;
export const MAX_PINNED_SHORTCUTS = 4;

export const DEFAULT_PINNED_SHORTCUTS = Object.freeze([
    'scan',
    'doctor',
    'assistant',
    'materials',
]);

// In-memory fallback if localStorage fails or is blocked
let sessionMemoryLayout = null;

const VALID_CATALOG_IDS = new Set(CATALOG_TOOLS.map(t => t.id));

export function isValidCatalogToolId(id) {
    return VALID_CATALOG_IDS.has(id);
}

/**
 * Normalizes an array of tool IDs:
 * - Drops invalid IDs, anchor IDs and non-strings
 * - Deduplicates preserving first occurrence
 * - Truncates to MAX_PINNED_SHORTCUTS
 */
export function normalizePinnedIds(ids) {
    if (!Array.isArray(ids)) return [...DEFAULT_PINNED_SHORTCUTS];
    const seen = new Set();
    const result = [];
    for (const id of ids) {
        if (typeof id === 'string' && VALID_CATALOG_IDS.has(id) && !seen.has(id)) {
            seen.add(id);
            result.push(id);
            if (result.length >= MAX_PINNED_SHORTCUTS) break;
        }
    }
    return result;
}

/**
 * Load shortcut layout from storage.
 * Explicit empty array is valid and preserved.
 */
export function loadShortcutLayout(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (sessionMemoryLayout !== null && !storage) {
        return [...sessionMemoryLayout];
    }

    if (!storage) {
        return sessionMemoryLayout !== null ? [...sessionMemoryLayout] : [...DEFAULT_PINNED_SHORTCUTS];
    }

    try {
        const raw = storage.getItem(SHORTCUT_STORAGE_KEY);
        if (raw === null || raw === undefined) {
            return [...DEFAULT_PINNED_SHORTCUTS];
        }
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.schemaVersion !== SHORTCUT_SCHEMA_VERSION || !Array.isArray(parsed.pinned)) {
            return [...DEFAULT_PINNED_SHORTCUTS];
        }
        return normalizePinnedIds(parsed.pinned);
    } catch (err) {
        console.warn('[AMB] Failed to read shortcut layout from storage, resetting to defaults:', err);
        sessionMemoryLayout = [...DEFAULT_PINNED_SHORTCUTS];
        return [...DEFAULT_PINNED_SHORTCUTS];
    }
}

/**
 * Persist shortcut layout to storage and memory.
 */
export function saveShortcutLayout(pinnedIds, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    const normalized = normalizePinnedIds(pinnedIds);
    sessionMemoryLayout = [...normalized];

    if (!storage) {
        return { success: true, layout: normalized, memoryOnly: true };
    }

    try {
        const payload = JSON.stringify({
            schemaVersion: SHORTCUT_SCHEMA_VERSION,
            pinned: normalized,
        });
        storage.setItem(SHORTCUT_STORAGE_KEY, payload);
        return { success: true, layout: normalized, memoryOnly: false };
    } catch (err) {
        console.warn('[AMB] Failed to write shortcut layout to storage, saved to session memory:', err);
        return { success: true, layout: normalized, memoryOnly: true, error: err };
    }
}

/**
 * Pin a tool to the shortcut bar.
 * If already pinned, reorder to targetIndex.
 * If not pinned and at capacity, rejects with 'capacity_full'.
 */
export function pinTool(toolId, targetIndex = -1, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!isValidCatalogToolId(toolId)) {
        return { success: false, reason: 'unknown_tool', layout: loadShortcutLayout(storage) };
    }

    const current = loadShortcutLayout(storage);
    const existingIndex = current.indexOf(toolId);

    if (existingIndex !== -1) {
        // Already pinned: reorder to target position
        current.splice(existingIndex, 1);
        const insertAt = (targetIndex >= 0 && targetIndex <= current.length) ? targetIndex : current.length;
        current.splice(insertAt, 0, toolId);
        saveShortcutLayout(current, storage);
        return { success: true, reordered: true, layout: current };
    }

    if (current.length >= MAX_PINNED_SHORTCUTS) {
        return { success: false, reason: 'capacity_full', layout: current };
    }

    const insertAt = (targetIndex >= 0 && targetIndex <= current.length) ? targetIndex : current.length;
    current.splice(insertAt, 0, toolId);
    saveShortcutLayout(current, storage);
    return { success: true, reordered: false, layout: current };
}

/**
 * Unpin a tool from the shortcut bar (returns it to toolbox only).
 */
export function unpinTool(toolId, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    const current = loadShortcutLayout(storage);
    const index = current.indexOf(toolId);
    if (index === -1) {
        return { success: true, changed: false, layout: current };
    }
    current.splice(index, 1);
    saveShortcutLayout(current, storage);
    return { success: true, changed: true, layout: current };
}

/**
 * Reorder an item in the shortcut bar.
 */
export function reorderShortcut(fromIndex, toIndex, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    const current = loadShortcutLayout(storage);
    if (fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length || fromIndex === toIndex) {
        return { success: false, layout: current };
    }
    const [item] = current.splice(fromIndex, 1);
    current.splice(toIndex, 0, item);
    saveShortcutLayout(current, storage);
    return { success: true, layout: current };
}

/**
 * Reset shortcut layout to defaults.
 */
export function resetShortcutLayout(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    saveShortcutLayout(DEFAULT_PINNED_SHORTCUTS, storage);
    return { success: true, layout: [...DEFAULT_PINNED_SHORTCUTS] };
}

/**
 * Check if a tool is currently pinned.
 */
export function isToolPinned(toolId, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    const current = loadShortcutLayout(storage);
    return current.includes(toolId);
}
