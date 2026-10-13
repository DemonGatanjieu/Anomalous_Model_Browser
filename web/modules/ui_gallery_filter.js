/**
 * The output gallery's filters (state in gallery_filter.js): All / Pictures / Videos beside its
 * search, shown once the output folder has a video (or while Pictures or Videos is chosen), and
 * Settings → Gallery's formats, each clicked to hide it or show it again.
 */

import { translate as t } from './locales.js';
import {
    GALLERY_IMAGE_FORMATS,
    GALLERY_VIDEO_FORMATS,
    galleryMedia,
    hiddenGalleryFormats,
    setGalleryFormatHidden,
    setGalleryMedia,
} from './gallery_filter.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** The switch; `onChange()` after a click, `switch.refresh(hasVideos)` after each listing. */
export function createGalleryMediaSwitch(onChange) {
    const box = el('div', 'anomalous-gallery-media');
    box.setAttribute('role', 'radiogroup');
    box.hidden = galleryMedia() === 'all';
    const choices = [['all', 'galleryFilterAll'], ['image', 'galleryFilterImages'], ['video', 'galleryFilterVideos']]
        .map(([media, labelKey]) => {
            const choice = el('button', 'anomalous-gallery-media-btn', t(labelKey));
            choice.type = 'button';
            choice.setAttribute('role', 'radio');
            choice.dataset.media = media;
            choice.onclick = () => {
                if (galleryMedia() === media) return;
                setGalleryMedia(media);
                mark();
                onChange();
            };
            return choice;
        });
    const mark = () => {
        const current = galleryMedia();
        for (const choice of choices) choice.setAttribute('aria-checked', String(choice.dataset.media === current));
    };
    box.append(...choices);
    mark();
    box.refresh = (hasVideos) => {
        box.hidden = !hasVideos && galleryMedia() === 'all';
        mark();
    };
    return box;
}

/** Settings → Gallery: one line of pictures, one of videos; `onChange()` after a click. */
export function createGalleryFormatSettings(onChange) {
    const box = el('div', 'anomalous-gallery-formats');
    const hidden = hiddenGalleryFormats();
    for (const [labelKey, formats] of [['galleryFilterImages', GALLERY_IMAGE_FORMATS], ['galleryFilterVideos', GALLERY_VIDEO_FORMATS]]) {
        const line = el('div', 'anomalous-gallery-formats-line');
        line.append(el('span', 'anomalous-gallery-formats-label', t(labelKey)));
        for (const format of formats) {
            const toggle = el('button', 'anomalous-gallery-format', format.toUpperCase());
            toggle.type = 'button';
            const mark = (shown) => {
                toggle.setAttribute('aria-pressed', String(shown));
                toggle.title = t(shown ? 'galleryFormatShown' : 'galleryFormatHidden');
            };
            mark(!hidden.has(format));
            toggle.onclick = () => {
                const shown = toggle.getAttribute('aria-pressed') !== 'true';
                setGalleryFormatHidden(format, !shown);
                mark(shown);
                onChange();
            };
            line.append(toggle);
        }
        box.append(line);
    }
    return box;
}
