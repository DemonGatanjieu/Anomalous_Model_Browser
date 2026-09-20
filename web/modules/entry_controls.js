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

export const SIDEBAR_FRAME_WIDTH = 68;
export const TOPBAR_MENU_HEIGHT = 70;
export const DEFAULT_SAFE_X = 72;
export const DEFAULT_SAFE_Y = 80;
export const DEFAULT_TRIGGER_POSITION = Object.freeze({ x: DEFAULT_SAFE_X, y: DEFAULT_SAFE_Y });

export function isValidSavedTriggerPosition(x, y) {
    if (x == null || y == null) return false;
    const px = Number.parseFloat(x);
    const py = Number.parseFloat(y);
    return Number.isFinite(px) && Number.isFinite(py);
}

export function sanitizeSavedTriggerPosition(x, y) {
    if (!isValidSavedTriggerPosition(x, y)) return null;
    let px = Number.parseFloat(x);
    let py = Number.parseFloat(y);
    // If dropped inside the left sidebar frame, automatically pull it out onto the canvas outside the frame
    if (px < SIDEBAR_FRAME_WIDTH) {
        px = DEFAULT_SAFE_X;
    }
    // If dropped inside the topbar menu zone, nudge below the menu
    if (py < TOPBAR_MENU_HEIGHT && px < 350) {
        py = DEFAULT_SAFE_Y;
    }
    return { x: px, y: py };
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

    const targetX = Number.isFinite(parsedX) ? parsedX : DEFAULT_SAFE_X;
    const targetY = Number.isFinite(parsedY) ? parsedY : DEFAULT_SAFE_Y;

    return {
        x: Math.min(maxX, Math.max(0, targetX)),
        y: Math.min(maxY, Math.max(0, targetY))
    };
}
