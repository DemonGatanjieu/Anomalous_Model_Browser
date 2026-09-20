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
export const DEFAULT_SAFE_MARGIN_RIGHT = 24;
export const DEFAULT_TRIGGER_POSITION = Object.freeze({ top: DEFAULT_SAFE_TOP, right: DEFAULT_SAFE_MARGIN_RIGHT });

export function isValidSavedTriggerPosition(x, y) {
    if (x == null || y == null) return false;
    const px = Number.parseFloat(x);
    const py = Number.parseFloat(y);
    return Number.isFinite(px) && Number.isFinite(py);
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
    margin = 0
}) {
    const safeWidth = Math.max(1, Number(width) || 60);
    const safeHeight = Math.max(1, Number(height) || 60);
    const safeVw = Math.max(safeWidth + margin, Number(viewportWidth) || (typeof window !== 'undefined' ? window.innerWidth : 1024) || 1024);
    const safeVh = Math.max(safeHeight + margin, Number(viewportHeight) || (typeof window !== 'undefined' ? window.innerHeight : 768) || 768);
    const maxX = Math.max(0, safeVw - safeWidth);
    const maxY = Math.max(0, safeVh - safeHeight);

    const parsedX = Number.parseFloat(x);
    const parsedY = Number.parseFloat(y);

    const fallbackX = Math.max(0, maxX - DEFAULT_SAFE_MARGIN_RIGHT);
    const fallbackY = Math.min(maxY, DEFAULT_SAFE_TOP);

    const targetX = Number.isFinite(parsedX) ? parsedX : fallbackX;
    const targetY = Number.isFinite(parsedY) ? parsedY : fallbackY;

    return {
        x: Math.min(maxX, Math.max(0, targetX)),
        y: Math.min(maxY, Math.max(0, targetY))
    };
}
