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
    const maxX = Math.max(0, (Number(viewportWidth) || safeWidth) - safeWidth);
    const maxY = Math.max(0, (Number(viewportHeight) || safeHeight) - safeHeight);
    const fallbackX = Math.max(0, maxX - margin);
    const fallbackY = Math.max(0, maxY - margin);
    const parsedX = Number.parseFloat(x);
    const parsedY = Number.parseFloat(y);

    return {
        x: Math.min(maxX, Math.max(0, Number.isFinite(parsedX) ? parsedX : fallbackX)),
        y: Math.min(maxY, Math.max(0, Number.isFinite(parsedY) ? parsedY : fallbackY))
    };
}
