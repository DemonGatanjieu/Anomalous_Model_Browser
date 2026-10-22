/**
 * The materials picker's pictures (ui_ai_toolbox.js), all vector and in the theme's colours:
 * line icons for the kinds and actions, a badge for each node source (a custom node pack gets
 * its initials on a colour of its own, the same every time), and the picture of an empty
 * selection. Static SVG text only; nothing from a user or a file goes into it.
 */

const PATHS = {
    nodes: '<rect x="2.5" y="4" width="8" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="8" height="6.5" rx="1.6"/><path d="M10.5 7.2h2.2a2.3 2.3 0 0 1 2.3 2.3v4"/><circle cx="10.5" cy="7.2" r=".9" fill="currentColor"/><circle cx="15" cy="13.5" r=".9" fill="currentColor"/>',
    combos: '<path d="M12 3.2 21 8l-9 4.8L3 8z"/><path d="m3 12 9 4.8 9-4.8"/><path d="m3 16 9 4.8 9-4.8"/>',
    workflows: '<circle cx="5.5" cy="6" r="2.5"/><circle cx="18.5" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 6h8M7 8.2l3.6 7.5M17 8.2l-3.6 7.5"/>',
    prompts: '<path d="M4 5.5h16M4 10h11M4 14.5h14M4 19h8"/><path d="M19.5 14.5 21 19"/>',
    models: '<path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.8 7.6 12 12.2l8.2-4.6M12 12.2v8.8"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20.5 20.5-4.8-4.8"/>',
    star: '<path d="m12 3.3 2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.8l-5.3 2.8 1.1-5.9-4.4-4.1 6-.8z"/>',
    starOn: '<path d="m12 3.3 2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.8l-5.3 2.8 1.1-5.9-4.4-4.1 6-.8z" fill="currentColor"/>',
    check: '<path d="m5 12.5 4.3 4.3L19 7.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    sparkle: '<path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z"/><path d="M19 15.5c.25 1.7.8 2.25 2.5 2.5-1.7.25-2.25.8-2.5 2.5-.25-1.7-.8-2.25-2.5-2.5 1.7-.25 2.25-.8 2.5-2.5z"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor"/>',
    page: '<rect x="3" y="4" width="18" height="16" rx="2.2"/><path d="M3 8.5h18"/><circle cx="6" cy="6.3" r=".7" fill="currentColor"/><circle cx="8.3" cy="6.3" r=".7" fill="currentColor"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.6-.9-1.6-1.3-2.8-1.3-1.6 0-2.8.8-2.8 2.1 0 2.9 5.8 1.4 5.8 4.2 0 1.3-1.3 2.1-3 2.1-1.3 0-2.4-.5-3-1.4M12 6.3v1.6M12 16.3v1.4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7"/>',
    list: '<path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17.5 5-4.5 3.5 3 3-2.5 4.5 4"/>',
};

/** A line icon by name, `size` px, in the text colour. */
export function icon(name, size = 18, className = '') {
    const holder = document.createElement('span');
    holder.className = `anomalous-tb-icon${className ? ` ${className}` : ''}`;
    holder.setAttribute('aria-hidden', 'true');
    holder.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
    return holder;
}

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

/** The picture of an empty selection: a toolbox with node cards rising out of it. */
export function emptyPicture() {
    const holder = document.createElement('div');
    holder.className = 'anomalous-tb-empty-art';
    holder.setAttribute('aria-hidden', 'true');
    holder.innerHTML = `<svg viewBox="0 0 220 150" width="220" height="150" fill="none" stroke-linecap="round" stroke-linejoin="round">
<g class="tb-art-soft"><circle cx="40" cy="38" r="3"/><circle cx="186" cy="30" r="2.5"/><circle cx="196" cy="98" r="3"/><circle cx="24" cy="102" r="2"/></g>
<g class="tb-art-card tb-art-a" transform="rotate(-10 72 52)"><rect x="46" y="30" width="54" height="40" rx="7"/><path d="M54 42h22M54 50h32M54 58h16"/><circle cx="100" cy="50" r="3"/></g>
<g class="tb-art-card tb-art-b" transform="rotate(8 150 46)"><rect x="124" y="24" width="54" height="40" rx="7"/><path d="M132 36h26M132 44h18M132 52h30"/><circle cx="124" cy="44" r="3"/></g>
<path class="tb-art-link" d="M103 50c10 0 12-6 18-6"/>
<g class="tb-art-box"><path d="M38 84h144l-10 50H48z"/><path d="M38 84l14-14h116l14 14"/><rect x="92" y="96" width="36" height="12" rx="4"/></g>
<path class="tb-art-spark" d="M110 10c.8 6 3.2 8.4 9.2 9.2-6 .8-8.4 3.2-9.2 9.2-.8-6-3.2-8.4-9.2-9.2 6-.8 8.4-3.2 9.2-9.2z"/>
</svg>`;
    return holder;
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
