/**
 * A workflow's pictures: the grid of output images (thumbnails; the picture opens the viewer,
 * 参数 the image workbench, ⇄ the parameter comparison) used for all its pictures and for one
 * parameter set's, and the "all pictures" view of a workflow's details.
 */

import { translate } from './locales.js';
import { showImageWorkbench } from './ui_gallery_detail.js';
import { appendText, button } from './ui_recipe_detail_dom.js';
import { isComparePicked, pressCompare } from './ui_param_compare.js';

const t = (key, params) => translate(key, params);

export function outputImageUrl(image) {
    if (!image || image.type !== 'output' || typeof image.filename !== 'string') return '';
    const query = new URLSearchParams({ filename: image.filename, type: 'output' });
    if (image.subfolder) query.set('subfolder', image.subfolder);
    return `/view?${query.toString()}`;
}

function thumbnailUrl(image) {
    const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '' });
    return `/anomalous/output_thumbnail?${query.toString()}`;
}

export function galleryWorkbenchItems(images) {
    return (images || []).map(sourceImage => ({
        filename: sourceImage.filename,
        subfolder: sourceImage.subfolder || '',
        url: outputImageUrl(sourceImage),
        sourceImage,
    })).filter(item => item.url);
}

export function openGalleryImageDetail(owner, images, sourceImage, url) {
    const items = galleryWorkbenchItems(images);
    const currentIndex = items.findIndex(item =>
        item.filename === sourceImage?.filename && (item.subfolder || '') === (sourceImage?.subfolder || '')
    );
    void showImageWorkbench(owner, sourceImage, url, {
        items,
        currentIndex: currentIndex >= 0 ? currentIndex : 0,
    });
}

/**
 * The pictures as a grid in `parent`. `compareOthers`: more sides the ⇄ bar offers
 * ([{ label, side }], the workflow's own values for one); the bar goes under the grid.
 */
export function renderImageGrid(parent, owner, images, { compareOthers = [] } = {}) {
    const grid = document.createElement('div');
    grid.className = 'anomalous-wfd-images';
    for (const sourceImage of images) {
        const url = outputImageUrl(sourceImage);
        if (!url) continue;
        const card = document.createElement('article');
        card.className = 'anomalous-wfd-image';
        if (isComparePicked(owner, sourceImage)) card.classList.add('is-compare-picked');
        const image = document.createElement('img');
        image.src = thumbnailUrl(sourceImage);
        image.alt = t('recipeGalleryOpenImage');
        image.loading = 'lazy';
        image.onclick = () => owner.showGalleryViewer?.(url);
        const details = button(card, t('materialViewParameters'), 'anomalous-wfd-image-btn');
        details.onclick = (event) => {
            event.stopPropagation();
            openGalleryImageDetail(owner, images, sourceImage, url);
        };
        const compare = button(card, '⇄', 'anomalous-wfd-image-btn is-compare');
        compare.title = t('compareCardTitle');
        compare.onclick = (event) => {
            event.stopPropagation();
            pressCompare(owner, sourceImage, card, { host: parent, others: compareOthers });
        };
        card.prepend(image);
        grid.appendChild(card);
    }
    parent.appendChild(grid);
}

/** Every picture made with this workflow's nodes, whatever the values (the details' 全部出图). */
export function renderRecipeGallery(content, owner, recipe, gallery, refresh) {
    const section = document.createElement('section');
    section.className = 'anomalous-wfd-section';
    const heading = document.createElement('div');
    heading.className = 'anomalous-wfd-section-head';
    appendText(heading, 'h3', t('recipeGallery'));
    const refreshButton = button(heading, '↻', 'anomalous-wf-icon-btn');
    refreshButton.title = t('recipeGalleryRefresh');
    refreshButton.onclick = () => { void refresh(true); };
    section.appendChild(heading);
    const note = status => appendText(section, 'p', t(status), 'anomalous-wfd-muted');
    if (gallery.status === 'loading') note('recipeGalleryLoading');
    else if (gallery.status === 'error') note('recipeGalleryLoadError');
    else if (!gallery.images.length) note('recipeGalleryEmpty');
    else {
        appendText(section, 'p', t('recipeGalleryScanHint', { count: gallery.scanned || 0 }), 'anomalous-wfd-muted');
        renderImageGrid(section, owner, gallery.images, {
            compareOthers: [{ label: t('compareWithDefault'), side: { workflow: recipe.workflow, label: t('workflowOwnValues') } }],
        });
    }
    content.appendChild(section);
}