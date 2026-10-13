/**
 * What the output gallery lists: everything, pictures or videos (the switch beside its search),
 * minus the formats hidden in Settings. Both are this browser's own (localStorage). A format is
 * stored when hidden, so one added later shows. The server's side is GET
 * /anomalous/gallery_images?media=..&hide=.. (api/gallery_routes.py).
 */

export const GALLERY_IMAGE_FORMATS = ['png', 'jpg', 'webp', 'gif', 'avif']; // jpg covers .jpeg
export const GALLERY_VIDEO_FORMATS = ['mp4', 'webm', 'mov', 'mkv'];
export const GALLERY_MEDIA = ['all', 'image', 'video'];

const HIDDEN_KEY = 'anomalous_gallery_hidden_formats';
const MEDIA_KEY = 'anomalous_gallery_media';

function read(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage blocked (private window): the choice lasts until the page reloads.
    }
}

/** An output entry ({ filename, media_type } from the listing) is a video. */
export function isGalleryVideo(item) {
    if (item?.media_type) return item.media_type === 'video';
    return GALLERY_VIDEO_FORMATS.includes(String(item?.filename || '').split('.').pop().toLowerCase());
}

export function hiddenGalleryFormats() {
    try {
        const list = JSON.parse(read(HIDDEN_KEY) || '[]');
        return new Set(Array.isArray(list) ? list.filter(format => typeof format === 'string') : []);
    } catch {
        return new Set();
    }
}

export function setGalleryFormatHidden(format, hidden) {
    const formats = hiddenGalleryFormats();
    if (hidden) formats.add(format);
    else formats.delete(format);
    write(HIDDEN_KEY, JSON.stringify([...formats]));
}

export function galleryMedia() {
    const media = read(MEDIA_KEY);
    return GALLERY_MEDIA.includes(media) ? media : 'all';
}

export function setGalleryMedia(media) {
    write(MEDIA_KEY, media);
}

/** Adds the gallery's filter to a listing request. */
export function appendGalleryFilter(params) {
    params.set('media', galleryMedia());
    const hidden = [...hiddenGalleryFormats()];
    if (hidden.length) params.set('hide', hidden.join(','));
}
