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

export const DEFAULT_TRIGGER_TOP = 80;
export const DEFAULT_TRIGGER_RIGHT_MARGIN = 24;

export function getDefaultTriggerPosition(viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1024), triggerWidth = 60) {
    const vw = Math.max(triggerWidth + DEFAULT_TRIGGER_RIGHT_MARGIN, Number(viewportWidth) || 1024);
    return {
        x: Math.max(0, vw - triggerWidth - DEFAULT_TRIGGER_RIGHT_MARGIN),
        y: DEFAULT_TRIGGER_TOP,
    };
}

export const DEFAULT_TRIGGER_POSITION = Object.freeze({ x: 940, y: DEFAULT_TRIGGER_TOP });

export function isValidSavedTriggerPosition(x, y) {
    if (x == null || y == null) return false;
    const px = Number.parseFloat(x);
    const py = Number.parseFloat(y);
    return Number.isFinite(px) && Number.isFinite(py);
}

export function normalizeSavedTriggerPosition(x, y) {
    if (!isValidSavedTriggerPosition(x, y)) return null;
    return {
        x: Number.parseFloat(x),
        y: Number.parseFloat(y),
    };
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

    const defaultPos = getDefaultTriggerPosition(safeVw, safeWidth);
    const parsedX = Number.parseFloat(x);
    const parsedY = Number.parseFloat(y);

    const targetX = Number.isFinite(parsedX) ? parsedX : defaultPos.x;
    const targetY = Number.isFinite(parsedY) ? parsedY : defaultPos.y;

    return {
        x: Math.min(maxX, Math.max(0, targetX)),
        y: Math.min(maxY, Math.max(0, targetY))
    };
}
