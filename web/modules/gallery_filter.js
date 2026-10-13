/**
 * gallery_filter.js
 * Source of truth for active/hidden output formats in the Gallery.
 * Persists extension preferences to localStorage ('anomalous_gallery_extensions').
 */

export const GALLERY_IMAGE_EXTENSIONS = ['png', 'webp', 'jpg', 'jpeg', 'gif'];
export const GALLERY_VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv'];
export const ALL_GALLERY_EXTENSIONS = [...GALLERY_IMAGE_EXTENSIONS, ...GALLERY_VIDEO_EXTENSIONS];

const STORAGE_KEY = 'anomalous_gallery_extensions';

function cleanExt(ext) {
    return String(ext || '').trim().toLowerCase().replace(/^\.+/, '');
}

/** Returns the Set of currently active extensions (lowercase without dot). */
export function getActiveGalleryExtensions() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return new Set(parsed.map(cleanExt).filter(e => ALL_GALLERY_EXTENSIONS.includes(e)));
            }
        }
    } catch (_) {}
    return new Set(ALL_GALLERY_EXTENSIONS);
}

/** Saves the active extensions to localStorage. */
export function setActiveGalleryExtensions(extensions) {
    const arr = Array.from(extensions || []).map(cleanExt).filter(e => ALL_GALLERY_EXTENSIONS.includes(e));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    return new Set(arr);
}

/** Toggles a single extension on/off. */
export function toggleGalleryExtension(ext) {
    const cleaned = cleanExt(ext);
    const active = getActiveGalleryExtensions();
    if (active.has(cleaned)) {
        active.delete(cleaned);
    } else {
        active.add(cleaned);
    }
    setActiveGalleryExtensions(active);
    return active;
}

/** Sets all extensions in a group (all, images, videos) to enabled or disabled. */
export function setGalleryGroup(group, enabled) {
    const active = getActiveGalleryExtensions();
    let targets = [];
    if (group === 'all') {
        targets = ALL_GALLERY_EXTENSIONS;
    } else if (group === 'images') {
        targets = GALLERY_IMAGE_EXTENSIONS;
    } else if (group === 'videos') {
        targets = GALLERY_VIDEO_EXTENSIONS;
    }

    for (const ext of targets) {
        if (enabled) active.add(ext);
        else active.delete(ext);
    }
    setActiveGalleryExtensions(active);
    return active;
}

/** True if every supported extension is active. */
export function isAllGalleryExtensionsActive() {
    const active = getActiveGalleryExtensions();
    return ALL_GALLERY_EXTENSIONS.every(ext => active.has(ext));
}

/** Appends active extensions to URLSearchParams. If all are active, omits to query everything. */
export function appendExtensionParams(params) {
    const active = getActiveGalleryExtensions();
    // If not all are active, append each active extension
    if (active.size < ALL_GALLERY_EXTENSIONS.length) {
        if (active.size === 0) {
            params.set('ext', 'none');
        } else {
            active.forEach(ext => params.append('ext', ext));
        }
    }
}

