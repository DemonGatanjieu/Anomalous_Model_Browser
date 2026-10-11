/**
 * The scan page's line icons (24-unit grid, drawn in the current text colour), static markup
 * put in with innerHTML; `scanIcon(name)` gives an element holding one.
 */

const ICONS = {
    radar: '<circle cx="12" cy="12" r="9"/><path d="M12 12l6-6" /><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M12 3v3M3 12h3" opacity="0.5"/>',
    pick: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M3.5 6l1.5 1.5 2.5-3M3.5 12l1.5 1.5 2.5-3"/><circle cx="5" cy="18" r="1.2"/>',
    online: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.5 3.8 5.5 3.8 9s-1.2 6.5-3.8 9c-2.6-2.5-3.8-5.5-3.8-9S9.4 5.5 12 3z"/>',
    offline: '<path d="M3 3l18 18"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 4.5-2.6M14.5 10.3a10 10 0 0 1 4.5 2.6"/><circle cx="12" cy="20" r="1" fill="currentColor"/>',
    parts: '<path d="M12 3l8.5 4.7v8.6L12 21l-8.5-4.7V7.7z"/><path d="M3.5 7.7L12 12.4l8.5-4.7M12 12.4V21"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4.5"/><circle cx="12" cy="8" r="0.6" fill="currentColor"/>',
    damaged: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/>',
    voice: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    excluded: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 8.5 6 8.5 6a15 15 0 0 1-2.7 3.3M6.7 6.8C4.6 8.4 3.5 12 3.5 12s3.5 6 8.5 6a8.4 8.4 0 0 0 4.3-1.2"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    name: '<path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8" cy="8" r="1.4"/>',
    fix: '<path d="M4 20L14.5 9.5"/><path d="M13 4v3M11.5 5.5h3M19 8.5v2.5M17.75 9.75h2.5M18 15v2M17 16h2"/>',
    key: '<circle cx="8" cy="15.5" r="4"/><path d="M10.9 12.6L20 3.5M16.5 7l2.5 2.5M14.5 9l2 2"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5v4h4"/><path d="M12 8v4.5l3 2"/>',
    next: '<path d="M9 6l6 6-6 6"/>',
};

/** `<span class="anomalous-scan-icon">` holding the named icon. */
export function scanIcon(name, className = '') {
    const span = document.createElement('span');
    span.className = `anomalous-scan-icon${className ? ` ${className}` : ''}`;
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`; // static markup only
    return span;
}
