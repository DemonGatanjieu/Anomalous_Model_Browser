/**
 * ui_gallery_filter.js
 * UI components for gallery extension filtering: the quick filter bar
 * in the Gallery header, and the configuration section in Settings.
 */

import { translate } from './locales.js';
import {
    ALL_GALLERY_EXTENSIONS,
    GALLERY_IMAGE_EXTENSIONS,
    GALLERY_VIDEO_EXTENSIONS,
    getActiveGalleryExtensions,
    toggleGalleryExtension,
    setGalleryGroup,
    isAllGalleryExtensionsActive,
} from './gallery_filter.js';

const t = (key, params) => translate(key, params);

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/**
 * Creates the filter bar rendered inside the Gallery header.
 * Displays quick group presets (All, Images, Videos) and format chips (PNG, WEBP, MP4, etc.).
 */
export function createGalleryFilterBar(owner, onFilterChange) {
    const bar = el('div', 'anomalous-gallery-filter-bar');

    const updateChips = () => {
        const active = getActiveGalleryExtensions();
        const allActive = isAllGalleryExtensionsActive();

        bar.querySelectorAll('[data-ext]').forEach(chip => {
            const ext = chip.getAttribute('data-ext');
            chip.classList.toggle('is-active', active.has(ext));
            chip.setAttribute('aria-pressed', String(active.has(ext)));
        });

        const allChip = bar.querySelector('[data-group="all"]');
        if (allChip) {
            allChip.classList.toggle('is-active', allActive);
            allChip.setAttribute('aria-pressed', String(allActive));
        }

        const imagesActive = GALLERY_IMAGE_EXTENSIONS.some(e => active.has(e));
        const imagesAll = GALLERY_IMAGE_EXTENSIONS.every(e => active.has(e));
        const imgChip = bar.querySelector('[data-group="images"]');
        if (imgChip) {
            imgChip.classList.toggle('is-active', imagesAll);
            imgChip.classList.toggle('is-partial', imagesActive && !imagesAll);
        }

        const videosActive = GALLERY_VIDEO_EXTENSIONS.some(e => active.has(e));
        const videosAll = GALLERY_VIDEO_EXTENSIONS.every(e => active.has(e));
        const vidChip = bar.querySelector('[data-group="videos"]');
        if (vidChip) {
            vidChip.classList.toggle('is-active', videosAll);
            vidChip.classList.toggle('is-partial', videosActive && !videosAll);
        }
    };

    const addGroupChip = (groupKey, labelKey) => {
        const chip = el('button', 'anomalous-gallery-filter-chip is-group', t(labelKey));
        chip.type = 'button';
        chip.setAttribute('data-group', groupKey);
        chip.onclick = (e) => {
            e.preventDefault();
            const active = getActiveGalleryExtensions();
            let targets = [];
            if (groupKey === 'all') targets = ALL_GALLERY_EXTENSIONS;
            else if (groupKey === 'images') targets = GALLERY_IMAGE_EXTENSIONS;
            else if (groupKey === 'videos') targets = GALLERY_VIDEO_EXTENSIONS;

            const allInGroupActive = targets.every(ext => active.has(ext));
            setGalleryGroup(groupKey, !allInGroupActive);
            updateChips();
            onFilterChange?.();
        };
        bar.appendChild(chip);
    };

    // Preset group buttons
    addGroupChip('all', 'galleryFilterAll');
    addGroupChip('images', 'galleryFilterImages');
    addGroupChip('videos', 'galleryFilterVideos');

    // Separator divider
    bar.appendChild(el('span', 'anomalous-gallery-filter-sep'));

    // Format pills
    ALL_GALLERY_EXTENSIONS.forEach(ext => {
        const isVid = GALLERY_VIDEO_EXTENSIONS.includes(ext);
        const chip = el('button', `anomalous-gallery-filter-chip is-ext ${isVid ? 'is-video' : ''}`, ext.toUpperCase());
        chip.type = 'button';
        chip.setAttribute('data-ext', ext);
        chip.title = `${t('galleryExtensionToggle')}: .${ext}`;
        chip.onclick = (e) => {
            e.preventDefault();
            toggleGalleryExtension(ext);
            updateChips();
            onFilterChange?.();
        };
        bar.appendChild(chip);
    });

    updateChips();
    bar.refresh = updateChips;
    return bar;
}

/**
 * Creates the extension configuration control for the Settings page.
 */
export function createGalleryExtensionSettings(owner, redraw) {
    const box = el('div', 'anomalous-gallery-settings-exts');
    const active = getActiveGalleryExtensions();

    const chipsWrap = el('div', 'anomalous-gallery-settings-chips');
    ALL_GALLERY_EXTENSIONS.forEach(ext => {
        const isVid = GALLERY_VIDEO_EXTENSIONS.includes(ext);
        const btn = el('button', `anomalous-scan-segment-btn ${active.has(ext) ? 'is-active' : ''}`, `.${ext}`);
        btn.type = 'button';
        btn.onclick = () => {
            toggleGalleryExtension(ext);
            redraw();
        };
        chipsWrap.appendChild(btn);
    });

    const actions = el('div', 'anomalous-gallery-settings-actions');
    const selectAllBtn = el('button', 'anomalous-scan-secondary anomalous-scan-small-btn', t('galleryFilterAll'));
    selectAllBtn.type = 'button';
    selectAllBtn.onclick = () => {
        setGalleryGroup('all', true);
        redraw();
    };

    const imagesOnlyBtn = el('button', 'anomalous-scan-secondary anomalous-scan-small-btn', t('galleryFilterImages'));
    imagesOnlyBtn.type = 'button';
    imagesOnlyBtn.onclick = () => {
        setGalleryGroup('images', true);
        setGalleryGroup('videos', false);
        redraw();
    };

    const videosOnlyBtn = el('button', 'anomalous-scan-secondary anomalous-scan-small-btn', t('galleryFilterVideos'));
    videosOnlyBtn.type = 'button';
    videosOnlyBtn.onclick = () => {
        setGalleryGroup('videos', true);
        setGalleryGroup('images', false);
        redraw();
    };

    actions.append(selectAllBtn, imagesOnlyBtn, videosOnlyBtn);
    box.append(chipsWrap, actions);
    return box;
}

