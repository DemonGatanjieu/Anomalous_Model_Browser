/**
 * The materials picker's pictures (ui_ai_toolbox.js): a badge for each node source (a custom node pack gets its
 * initials on a colour of its own, the same every time), and the illustrations in web/assets
 * (made with ChatGPT for this window): the empty selection, and the stand-in cover of a combo,
 * workflow or model that has none; a model of a known type gets its type's line drawing and name
 * on a colour of that type instead. Static SVG text only; nothing from a user or a file goes in.
 */

import { icon } from './ui_ai_icons.js';
import { typeLabel } from './ui_model_types.js';

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

// A model type's drawing (48 × 48, the text colour); the types that draw alike share one.
const TYPE_GROUP = {
    checkpoints: 'checkpoint', unet: 'diffusion', diffusion_models: 'diffusion', loras: 'lora', lycoris: 'lora',
    controlnet: 'control', t2i_adapter: 'control', upscale_models: 'upscale', vae: 'vae', vae_approx: 'vae',
    clip: 'encoder', text_encoders: 'encoder', clip_vision: 'encoder', embeddings: 'embedding',
};
const TYPE_ART = {
    checkpoint: '<path d="M24 6 40 15v18L24 42 8 33V15z"/><path d="m8 15 16 9 16-9M24 24v18"/>',
    diffusion: '<rect x="8" y="8" width="32" height="32" rx="7"/><path d="M24 14c.8 6 3 8.2 9 9-6 .8-8.2 3-9 9-.8-6-3-8.2-9-9 6-.8 8.2-3 9-9z"/>',
    lora: '<path d="M10 14h8.5a5 5 0 1 1 9 0H36v8.5a5 5 0 1 1 0 9V38H27.5a5 5 0 1 0-9 0H10v-6.5a5 5 0 1 0 0-9z"/>',
    control: '<circle cx="24" cy="10" r="4"/><path d="M24 14v14M24 18l-11 7M24 18l11 7M24 28l-8 13M24 28l8 13"/>',
    upscale: '<rect x="8" y="22" width="18" height="18" rx="3"/><path d="M29 8h11v11M40 8 28 20"/>',
    vae: '<rect x="8" y="10" width="32" height="28" rx="5"/><circle cx="18" cy="20" r="3"/><path d="m8 32 10-9 8 7 6-5 8 7"/>',
    encoder: '<path d="M12 12h24M24 12v26M18 38h12"/>',
    embedding: '<path d="M8 25 25 8h15v15L23 40z"/><circle cx="32" cy="16" r="2.6"/>',
};

/** The stand-in cover of a combo, workflow or model without one; a model of a known type: its type's drawing. */
export function standInCover(kind, type = '') {
    const group = kind === 'models' ? TYPE_GROUP[type] : null;
    if (!group) return art(ART[kind], 'anomalous-tb-stand-in');
    const box = document.createElement('span');
    box.className = `anomalous-tb-type-art is-${group}`;
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${TYPE_ART[group]}</svg>`; // static markup only
    box.append(Object.assign(document.createElement('span'), { className: 'anomalous-tb-type-art-name', textContent: typeLabel({ type }) }));
    return box;
}

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
