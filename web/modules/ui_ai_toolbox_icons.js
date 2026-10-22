/**
 * The materials picker's pictures (ui_ai_toolbox.js): a badge for each node source (a custom node pack gets its
 * initials on a colour of its own, the same every time), and the illustrations in web/assets
 * (made with ChatGPT for this window): the empty selection, and the stand-in cover of a combo,
 * workflow or model that has none. Static SVG text only; nothing from a user or a file goes in.
 */

import { icon } from './ui_ai_icons.js';

function hue(text) {
    let hash = 0;
    for (const char of String(text)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return hash % 360;
}

/** Up to two letters for a pack: its words without "ComfyUI" and "comfy" ("ComfyUI-Easy-Use" → "EU"). */
export function initials(label) {
    const words = String(label || '').replace(/comfy[_-]?ui|comfy/gi, ' ').split(/[\s_\-.]+/).filter(Boolean);
    const letters = (words.length > 1 ? words.slice(0, 2).map(word => word[0]) : [...(words[0] || '?').slice(0, 2)]).join('');
    return letters.toUpperCase();
}

/** The badge of a node source: ComfyUI's own, the paid API nodes, or a pack's initials on its colour. */
export function sourceBadge(source, size = 26) {
    const badge = document.createElement('span');
    badge.className = `anomalous-tb-badge is-${source.kind}`;
    badge.style.setProperty('--tb-size', `${size}px`);
    if (source.kind === 'builtin') {
        badge.innerHTML = `<svg viewBox="0 0 24 24" width="${Math.round(size * 0.62)}" height="${Math.round(size * 0.62)}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M16.5 7.5A6 6 0 1 0 16.5 16.5"/><circle cx="17" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>`;
    } else if (source.kind === 'api') {
        badge.append(icon('coin', Math.round(size * 0.62)));
    } else {
        badge.style.setProperty('--tb-hue', String(hue(source.key)));
        badge.textContent = initials(source.label || source.key);
    }
    badge.setAttribute('aria-hidden', 'true');
    return badge;
}

const ART = {
    empty: new URL('../assets/toolbox_empty.webp', import.meta.url).href,
    combos: new URL('../assets/toolbox_combo.webp', import.meta.url).href,
    workflows: new URL('../assets/toolbox_workflow.webp', import.meta.url).href,
    models: new URL('../assets/toolbox_model.webp', import.meta.url).href,
};

function art(src, className) {
    const img = document.createElement('img');
    img.className = className;
    img.src = src;
    img.alt = '';
    img.decoding = 'async';
    img.setAttribute('aria-hidden', 'true');
    return img;
}

/** The picture of an empty selection: a toolbox with cards rising out of it. */
export const emptyPicture = () => art(ART.empty, 'anomalous-tb-empty-art');

/** The stand-in cover of a combo, workflow or model without one. */
export const standInCover = kind => art(ART[kind], 'anomalous-tb-stand-in');

/** The colour ComfyUI draws a socket type with: the open canvas's own when it says, else ComfyUI's defaults. */
const SOCKET_COLORS = {
    MODEL: '#B39DDB', CLIP: '#FFD500', VAE: '#FF6E6E', CONDITIONING: '#FFA931', LATENT: '#FF9CF9', IMAGE: '#64B5F6',
    MASK: '#81C784', CONTROL_NET: '#00D78D', CLIP_VISION: '#A8DADC', CLIP_VISION_OUTPUT: '#ad7452', STYLE_MODEL: '#C2FFAE',
    UPSCALE_MODEL: '#87CEFA', NOISE: '#B0B0B0', SAMPLER: '#ECB4B4', SIGMAS: '#CDFFCD', GUIDER: '#66FFFF', AUDIO: '#7FD3D4', VIDEO: '#C8A2C8',
};
export function socketColor(type, canvas = globalThis.app?.canvas) {
    const own = canvas?.default_connection_color_byType?.[type];
    return own || SOCKET_COLORS[type] || '#9AA4B2';
}
