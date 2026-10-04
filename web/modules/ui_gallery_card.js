/**
 * One output image's card in the gallery: the picture (opens the viewer, or becomes a
 * model's cover while one is being chosen; drags onto the canvas), Parameters (the image
 * workbench), the star (ui_keep_menu.js: keep it as a workflow, a combo or its prompts;
 * filled once kept as anything) and Delete (to the Recycle Bin, after a confirmation).
 */

import { translate as t } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { showImageWorkbench } from './ui_gallery_detail.js';
import { openKeepMenu } from './ui_keep_menu.js';
import { keptKey } from './image_keep.js';

const DETAILS_ICON = `<svg class="anomalous-gallery-details-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><line x1="2" y1="5" x2="8" y2="5"></line><line x1="12" y1="5" x2="14" y2="5"></line><circle cx="10" cy="5" r="2"></circle><line x1="2" y1="11" x2="4" y2="11"></line><line x1="8" y1="11" x2="14" y2="11"></line><circle cx="6" cy="11" r="2"></circle></svg>`;
const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';

function button(className, title, onClick) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.title = title;
    node.onclick = (event) => {
        event.stopPropagation();
        onClick(event);
    };
    return node;
}

const sameItem = (item, image) => item.filename === image.filename && item.subfolder === image.subfolder;

/** Uses the image as the cover of the model being given one (the gallery's cover mode). */
async function useAsCover(owner, image) {
    const model = owner.gallerySelectModel;
    try {
        const response = await fetch('/anomalous/set_custom_cover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: owner.currentType,
                path_idx: owner.currentPathIdx,
                subfolder: owner.currentSubfolder,
                filename: model.filename,
                source_image: image.subfolder ? `${image.subfolder}/${image.filename}` : image.filename,
            }),
        });
        const data = await response.json();
        if (data.status !== 'success') throw new Error(data.message || 'cover not set');
    } catch (error) {
        await anomalousAlert(t('galleryErrorPrefix') + error.message);
        return;
    }
    owner.gallerySelectModel = null;
    const banner = document.getElementById('anomalous-gallery-select-banner');
    if (banner) banner.style.display = 'none';
    owner.galleryPanel.classList.remove('is-cover-selecting');
    owner.galleryPanel.style.display = 'none';
    await owner.loadModels();
    const updated = owner.models.find(m => m.filename === model.filename);
    if (owner.currentDetailModel && owner.currentDetailModel.filename === model.filename) {
        owner.detailPanel.style.display = 'flex';
        if (updated) owner.showDetail(updated);
    } else {
        owner.grid.style.display = 'grid';
    }
}

function openWorkbench(owner, image, url) {
    const list = owner.galleryImagesList || [];
    const index = list.findIndex(item => sameItem(item, image));
    void showImageWorkbench(owner, image, url, {
        items: list,
        currentIndex: Math.max(0, index),
        loadMore: async () => {
            if (owner.galleryHasMore && !owner.galleryLoading) await owner.loadGalleryImages(owner.galleryCurrentPage + 1);
            return owner.galleryImagesList || [];
        },
    });
}

async function deleteImage(owner, image, card) {
    if (!await anomalousConfirm(t('galleryDeleteConfirmHint'), t('galleryDeleteConfirm'), { okLabel: t('galleryDelete') })) return;
    try {
        const response = await fetch('/anomalous/delete_gallery_image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: image.filename, subfolder: image.subfolder }),
        });
        const data = await response.json();
        if (data.status !== 'success') throw new Error(data.message);
        card.remove();
        owner.galleryImagesList = (owner.galleryImagesList || []).filter(item => !sameItem(item, image));
    } catch (error) {
        await anomalousAlert(t('galleryDeleteFailed') + (error?.message || ''));
    }
}

/** The star: ☆, or ★ once the image is kept as anything. */
function keepButton(owner, image) {
    const star = button('anomalous-gallery-keep', t('galleryKeep'), () => openKeepMenu(owner, star, image, {
        onKept: (kept) => {
            mark(kept);
            // Cards drawn later (another page) read the same list.
            owner.galleryKept?.then(map => map.set(keptKey(image), { ...kept })).catch(() => {});
        },
    }));
    const mark = (kept) => {
        const done = Boolean(kept?.recipe || kept?.combo || kept?.prompt);
        star.textContent = done ? '★' : '☆';
        star.classList.toggle('is-kept', done);
        star.title = t(done ? 'galleryKept' : 'galleryKeep');
    };
    mark(null);
    owner.galleryKept?.then(map => mark(map.get(keptKey(image)))).catch(() => {});
    return star;
}

/** The card of `imgData` ({ filename, subfolder } from GET /anomalous/gallery_images). */
export function createGalleryCard(owner, imgData, { showViewer }) {
    const image = { type: 'output', filename: imgData.filename, subfolder: imgData.subfolder || '' };
    const query = `filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}`;
    const url = `/view?${query}&type=output`;
    const card = document.createElement('div');
    card.className = 'anomalous-gallery-card';

    const img = document.createElement('img');
    img.src = `/anomalous/output_thumbnail?${query}`; // drags and the viewer use the original
    img.loading = 'lazy';
    img.draggable = true;
    img.title = t('materialViewOriginal');
    img.addEventListener('dragstart', (event) => {
        const fullUrl = new URL(url, window.location.href).href;
        event.dataTransfer.setData('text/uri-list', fullUrl);
        event.dataTransfer.setData('text/plain', fullUrl);
        // Chromium may not start dragging very large (hires) images without a small drag image.
        if (window.anomalousDragGhostImg) event.dataTransfer.setDragImage(window.anomalousDragGhostImg, 40, 40);
    });
    img.onclick = () => (owner.gallerySelectModel ? useAsCover(owner, image) : showViewer(url));

    const details = button('anomalous-gallery-details', t('materialViewDetails'), () => {
        if (!owner.gallerySelectModel) openWorkbench(owner, image, url);
    });
    details.innerHTML = DETAILS_ICON; // static markup only
    details.append(Object.assign(document.createElement('span'), { textContent: t('materialViewParameters') }));
    const remove = button('anomalous-gallery-delete', t('galleryDelete'), () => deleteImage(owner, image, card));
    remove.innerHTML = DELETE_ICON; // static markup only

    card.append(img, details, remove);
    // Only PNG outputs carry the workflow that can be kept.
    if (/\.png$/i.test(image.filename)) card.append(keepButton(owner, image));
    return card;
}
