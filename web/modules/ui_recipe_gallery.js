/**
 * Workflow Recipe gallery rendering and Image Detail Workbench handoff.
 */

import { translate } from './locales.js';
import { showImageWorkbench } from './ui_gallery_detail.js';
import { appendText, button } from './ui_recipe_detail_dom.js';

const t = (key, params) => translate(key, params);

export function outputImageUrl(image) {
    if (!image || image.type !== 'output' || typeof image.filename !== 'string') return '';
    const query = new URLSearchParams({ filename: image.filename, type: 'output' });
    if (image.subfolder) query.set('subfolder', image.subfolder);
    return `/view?${query.toString()}`;
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
export function renderRecipeGallery(content, owner, recipe, gallery, refresh) {
    const section = document.createElement('section');
    section.className = 'anomalous-recipe-detail-section anomalous-recipe-gallery';
    const heading = document.createElement('div');
    heading.className = 'anomalous-recipe-detail-section-heading';
    appendText(heading, 'h4', t('recipeGallery'));
    const refreshButton = button(heading, t('recipeGalleryRefresh'), 'anomalous-btn-ghost anomalous-recipe-gallery-refresh');
    refreshButton.onclick = () => { void refresh(true); };
    section.appendChild(heading);

    if (gallery.status === 'loading') {
        appendText(section, 'p', t('recipeGalleryLoading'), 'anomalous-recipe-detail-muted');
        content.appendChild(section);
        return;
    }
    if (gallery.status === 'error') {
        appendText(section, 'p', t('recipeGalleryLoadError'), 'anomalous-recipe-detail-muted');
        content.appendChild(section);
        return;
    }

    if (gallery.status === 'ready') {
        appendText(section, 'small', t('recipeGalleryScanHint').replace('{count}', String(gallery.scanned || 0)), 'anomalous-recipe-detail-muted');
    }
    if (!gallery.images.length) {
        appendText(section, 'p', t('recipeGalleryEmpty'), 'anomalous-recipe-detail-muted');
        content.appendChild(section);
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'anomalous-recipe-gallery-grid';
    for (const sourceImage of gallery.images) {
        const card = document.createElement('article');
        card.className = 'anomalous-recipe-gallery-card';
        const url = outputImageUrl(sourceImage);
        const image = document.createElement('img');
        image.src = url;
        image.alt = t('recipeGalleryOpenImage');
        image.loading = 'lazy';
        image.onclick = () => owner.showGalleryViewer?.(url);
        card.appendChild(image);
        const actions = document.createElement('div');
        actions.className = 'anomalous-recipe-gallery-card-actions';
        const details = button(actions, `🔎 ${t('materialViewDetails')}`, 'anomalous-btn-primary');
        details.onclick = event => {
            event.stopPropagation();
            openGalleryImageDetail(owner, gallery.images, sourceImage, url);
        };
        card.appendChild(actions);
        grid.appendChild(card);
    }
    section.appendChild(grid);
    content.appendChild(section);
}
