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

export function isValidSavedTriggerPosition(x, y) {
    if (x == null || y == null) return false;
    const px = Number.parseFloat(x);
    const py = Number.parseFloat(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
    // Guard against collapsed / uninitialized top-left coordinates that occlude ComfyUI menu/topbar
    if (px < 10 && py < 10) return false;
    return true;
}

export function clampFloatingTriggerPosition({
    x,
    y,
    width,
    height,
    viewportWidth,
    viewportHeight,
    margin = 30
}) {
    const safeWidth = Math.max(1, Number(width) || 60);
    const safeHeight = Math.max(1, Number(height) || 60);
    const safeVw = Math.max(safeWidth + margin, Number(viewportWidth) || (typeof window !== 'undefined' ? window.innerWidth : 1024) || 1024);
    const safeVh = Math.max(safeHeight + margin, Number(viewportHeight) || (typeof window !== 'undefined' ? window.innerHeight : 768) || 768);
    const maxX = Math.max(0, safeVw - safeWidth);
    const maxY = Math.max(0, safeVh - safeHeight);
    const fallbackX = Math.max(0, maxX - margin);
    const fallbackY = Math.max(0, maxY - margin);
    const parsedX = Number.parseFloat(x);
    const parsedY = Number.parseFloat(y);

    const targetX = Number.isFinite(parsedX) ? parsedX : fallbackX;
    const targetY = Number.isFinite(parsedY) ? parsedY : fallbackY;

    return {
        x: Math.min(maxX, Math.max(0, targetX)),
        y: Math.min(maxY, Math.max(0, targetY))
    };
}
