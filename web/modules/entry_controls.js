// Unconditionally purge legacy contaminated storage keys on module load
try {
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('anomalous_btn_x');
        localStorage.removeItem('anomalous_btn_y');
    }
} catch (_) {}

export const FLOATING_TRIGGER_SIZES = new Set(['small', 'medium', 'large']);
export const FLOATING_TRIGGER_STYLES = new Set(['icon', 'pill']);
export const ENTRY_MODES = new Set(['floating', 'topbar', 'menu']);

export function normalizeFloatingTriggerSize(value) {
    return FLOATING_TRIGGER_SIZES.has(value) ? value : 'medium';
}

export function normalizeFloatingTriggerStyle(value) {
    return FLOATING_TRIGGER_STYLES.has(value) ? value : 'icon';
}

export function normalizeEntryMode(value) {
    return ENTRY_MODES.has(value) ? value : 'floating';
}

export const DEFAULT_SAFE_TOP = 80;
export const DEFAULT_SAFE_LEFT = 80; // Safe position outside ComfyUI left sidebar dock
export const DEFAULT_SAFE_MARGIN_RIGHT = 24;
export const DEFAULT_MIN_SAFE_X = 70; // Avoid ComfyUI left sidebar dock
export const DEFAULT_TRIGGER_POSITION = Object.freeze({ top: DEFAULT_SAFE_TOP, left: DEFAULT_SAFE_LEFT });
export const TRIGGER_POSITION_STORAGE_KEY = 'anomalous_trigger_pos_v3';
export const LEGACY_TRIGGER_X_KEY = 'anomalous_btn_x';
export const LEGACY_TRIGGER_Y_KEY = 'anomalous_btn_y';

export function isValidSavedTriggerPosition(x, y) {
    if (x == null || y == null) return false;
    const px = Number.parseFloat(x);
    const py = Number.parseFloat(y);
    // Must be a finite number, py >= 0, and px >= DEFAULT_MIN_SAFE_X (70px) to prevent docking inside sidebar
    return Number.isFinite(px) && Number.isFinite(py) && px >= DEFAULT_MIN_SAFE_X && py >= 0;
}

export function loadSavedTriggerPosition(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!storage) return null;
    try {
        const raw = storage.getItem(TRIGGER_POSITION_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (isValidSavedTriggerPosition(parsed?.x, parsed?.y)) {
                return { x: Math.round(Number(parsed.x)), y: Math.round(Number(parsed.y)) };
            } else {
                storage.removeItem(TRIGGER_POSITION_STORAGE_KEY);
            }
        }
    } catch (_) {}
    return null;
}

export function saveTriggerPosition(pos, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!storage || !pos) return;
    const x = Number.parseFloat(pos.x);
    const y = Number.parseFloat(pos.y);
    if (!isValidSavedTriggerPosition(x, y)) return;
    try {
        storage.setItem(TRIGGER_POSITION_STORAGE_KEY, JSON.stringify({
            x: Math.round(x),
            y: Math.round(y)
        }));
        storage.removeItem(LEGACY_TRIGGER_X_KEY);
        storage.removeItem(LEGACY_TRIGGER_Y_KEY);
        storage.removeItem('anomalous_trigger_pos_v2');
    } catch (_) {}
}

export function clearSavedTriggerPosition(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!storage) return;
    try {
        storage.removeItem(TRIGGER_POSITION_STORAGE_KEY);
        storage.removeItem(LEGACY_TRIGGER_X_KEY);
        storage.removeItem(LEGACY_TRIGGER_Y_KEY);
        storage.removeItem('anomalous_trigger_pos_v2');
    } catch (_) {}
}

export function sanitizeSavedTriggerPosition(x, y) {
    if (!isValidSavedTriggerPosition(x, y)) return null;
    return { x: Number.parseFloat(x), y: Number.parseFloat(y) };
}

export function normalizeSavedTriggerPosition(x, y) {
    return sanitizeSavedTriggerPosition(x, y);
}

export function clampFloatingTriggerPosition({
    x,
    y,
    width,
    height,
    viewportWidth,
    viewportHeight,
    minX = DEFAULT_MIN_SAFE_X,
    margin = 0
}) {
    const safeWidth = Math.max(1, Number(width) || 60);
    const safeHeight = Math.max(1, Number(height) || 60);
    const rawVw = Number(viewportWidth) || (typeof window !== 'undefined' ? window.innerWidth : 1024) || 1024;
    const rawVh = Number(viewportHeight) || (typeof window !== 'undefined' ? window.innerHeight : 768) || 768;
    const safeVw = rawVw >= 300 ? rawVw : 1024;
    const safeVh = rawVh >= 200 ? rawVh : 768;
    const maxX = Math.max(minX, safeVw - safeWidth);
    const maxY = Math.max(0, safeVh - safeHeight);

    const parsedX = Number.parseFloat(x);
    const parsedY = Number.parseFloat(y);

    const fallbackX = Math.max(minX, Math.min(maxX, DEFAULT_SAFE_LEFT));
    const fallbackY = Math.min(maxY, DEFAULT_SAFE_TOP);

    const targetX = Number.isFinite(parsedX) ? parsedX : fallbackX;
    const targetY = Number.isFinite(parsedY) ? parsedY : fallbackY;

    return {
        x: Math.min(maxX, Math.max(minX, Math.round(targetX))),
        y: Math.min(maxY, Math.max(0, Math.round(targetY)))
    };
}
