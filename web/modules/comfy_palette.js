/**
 * Whether ComfyUI's palette is dark, from what it puts on <html>. Older frontends add the class
 * `dark-theme` for a dark palette; from frontend 1.59 there is no such class and the page says
 * `color-scheme: dark` (or `light`) in <html>'s own style instead. Either one counts. Read by
 * the 'auto' theme (interface_settings.js), which follows ComfyUI. No imports, so it is tested
 * on its own (tests/comfy_palette.mjs).
 */
export function comfyIsDark(root = document.documentElement) {
    if (root?.classList?.contains('dark-theme')) return true;
    const scheme = String(root?.style?.colorScheme || '').trim().toLowerCase();
    return scheme.split(/\s+/)[0] === 'dark';
}
