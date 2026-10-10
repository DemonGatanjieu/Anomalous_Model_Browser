/**
 * ui_gallery.js
 * The output gallery's listing and search (cards: ui_gallery_card.js), a model's generated
 * images, choosing a cover, and the full-size viewer.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';
import { showImageWorkbench } from './ui_gallery_detail.js';
import { createGalleryCard } from './ui_gallery_card.js';
import { loadKeptImages } from './image_keep.js';
import { createSearchChips } from './ui_search_chips.js';

const t = (key, params) => translate(key, params);

export async function refreshGalleryImages() {
    if (this.galleryLoading || this.galleryRefreshLoading) return;
    this.galleryRefreshLoading = true;
    try {
        const scrollTop = this.galleryGrid?.scrollTop || 0;
        await this.loadGalleryImages(1, true);
        if (this.galleryGrid) this.galleryGrid.scrollTop = scrollTop;
    } catch (error) {
        console.warn('Could not refresh output gallery:', error);
    } finally {
        this.galleryRefreshLoading = false;
    }
}



/** Search blocks above the output gallery; the terms live on the browser as `gallerySearchTerms`. */
export function createGallerySearchBar(owner) {
    const search = createSearchChips({
        placeholder: t('gallerySearchPlaceholder'),
        help: t('gallerySearchHelp'),
        onChange: (terms) => {
            owner.gallerySearchTerms = terms;
            owner.loadGalleryImages(1, true, { refresh: false });
        },
    });
    search.element.classList.add('anomalous-gallery-search');
    owner.gallerySearchCount = search.countElement;
    return search.element;
}

export async function loadGalleryImages(page = 1, reset = false, { refresh = reset } = {}) {
        if (this.galleryLoading) {
            // A newer query arrived while loading: run it once the current request settles.
            if (reset) this.galleryReloadPending = true;
            return;
        }
        this.galleryLoading = true;
        const terms = [...(this.gallerySearchTerms || [])];
        const termsKey = JSON.stringify(terms);
        const query = terms.length > 0;
        this.gallerySentinel.textContent = query && page === 1 ? t('gallerySearching') : t('galleryLoading');

        try {
            const params = new URLSearchParams({ page: String(page), limit: '50' });
            if (refresh) params.set('refresh', '1');
            terms.forEach(term => params.append('term', term));
            const res = await fetch(`/anomalous/gallery_images?${params}`);
            const data = await res.json();
            if (termsKey !== JSON.stringify(this.gallerySearchTerms || [])) {
                this.galleryReloadPending = true;
                return;
            }
            if (this.gallerySearchCount) {
                this.gallerySearchCount.textContent = query && Number.isFinite(data.total) ? t('gallerySearchCount', { count: data.total }) : '';
            }

            if (reset) {
                // Clear existing cards
                const cards = this.galleryGrid.querySelectorAll('.anomalous-gallery-card');
                cards.forEach(c => c.remove());
                this.galleryLoaded = true;
                this.galleryImagesList = [];
                // The stars of this listing: what each image was kept as.
                this.galleryKept = loadKeptImages().catch(() => new Map());
            }

            if (data.images && data.images.length > 0) {
                const incomingItems = data.images.map(imgData => {
                    const q_sub = encodeURIComponent(imgData.subfolder);
                    const q_file = encodeURIComponent(imgData.filename);
                    return {
                        filename: imgData.filename,
                        subfolder: imgData.subfolder || '',
                        url: `/view?filename=${q_file}&subfolder=${q_sub}&type=output`,
                        sourceImage: {
                            type: 'output',
                            filename: imgData.filename,
                            subfolder: imgData.subfolder || '',
                        }
                    };
                });
                if (reset) {
                    this.galleryImagesList = incomingItems;
                } else {
                    this.galleryImagesList = [...(this.galleryImagesList || []), ...incomingItems];
                }

                for (const imgData of data.images) {
                    this.galleryGrid.insertBefore(createGalleryCard(this, imgData, { showViewer: showGalleryViewer }), this.gallerySentinel);
                }

                this.galleryCurrentPage = page;
                this.galleryHasMore = page < data.pages;

                if (!this.galleryHasMore) {
                    this.gallerySentinel.textContent = t('galleryNoMore');
                } else {
                    this.gallerySentinel.textContent = t('galleryScrollMore');
                }
            } else {
                this.galleryHasMore = false;
                this.gallerySentinel.textContent = reset ? t(query ? 'gallerySearchEmpty' : 'galleryEmpty') : t('galleryNoMore');
            }
        } catch (e) {
            console.error('Failed to load gallery images', e);
            this.gallerySentinel.textContent = t('galleryLoadFailed');
        } finally {
            this.galleryLoading = false;
            if (this.galleryReloadPending) {
                this.galleryReloadPending = false;
                void this.loadGalleryImages(1, true, { refresh: false });
            }
        }
    }




export async function showGeneratedGallery(model) {
        let overlay = document.getElementById('anomalous-generated-gallery-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'anomalous-generated-gallery-overlay';
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
            overlay.style.zIndex = '999999';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';

            const modalBox = document.createElement('div');
            modalBox.id = 'anomalous-generated-gallery-modal';
            modalBox.style.width = '95%';
            modalBox.style.maxHeight = '95%';
            modalBox.style.backgroundColor = 'var(--comfy-menu-bg, var(--amb-bg-card))';
            modalBox.style.borderRadius = '12px';
            modalBox.style.display = 'flex';
            modalBox.style.flexDirection = 'column';
            modalBox.style.overflow = 'hidden';
            modalBox.style.boxShadow = '0 10px 40px rgba(0, 0, 0, 0.8)';

            const header = document.createElement('div');
            header.style.padding = '15px 25px';
            header.style.background = 'var(--amb-bg-card-hover)';
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';
            header.style.borderBottom = '1px solid var(--amb-border-strong)';

            const title = document.createElement('h2');
            title.id = 'anomalous-generated-gallery-title';
            title.style.margin = '0';
            title.style.color = '#fff';

            const closeBtn = document.createElement('button');
            closeBtn.textContent = `✖ ${t('galleryClose')}`;
            closeBtn.style.padding = '8px 15px';
            closeBtn.style.background = '#dc3545';
            closeBtn.style.color = '#fff';
            closeBtn.style.border = 'none';
            closeBtn.style.borderRadius = '5px';
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.fontWeight = 'bold';
            closeBtn.onmouseover = () => closeBtn.style.background = '#c82333';
            closeBtn.onmouseout = () => closeBtn.style.background = '#dc3545';
            closeBtn.onclick = () => {
                overlay.style.display = 'none';
            };

            header.appendChild(title);
            header.appendChild(closeBtn);
            modalBox.appendChild(header);

            const contentCont = document.createElement('div');
            contentCont.id = 'anomalous-generated-gallery-content';
            contentCont.style.flex = '1';
            contentCont.style.overflowY = 'auto';
            contentCont.style.padding = '20px';
            contentCont.style.display = 'grid';
            contentCont.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
            contentCont.style.gap = '25px';
            contentCont.style.rowGap = '40px';
            contentCont.style.alignContent = 'start';
            modalBox.appendChild(contentCont);

            overlay.appendChild(modalBox);
            document.getElementById('anomalous-container').appendChild(overlay);
        }

        const title = document.getElementById('anomalous-generated-gallery-title');
        title.textContent = t('galleryHistoryTitle', { name: model.name || model.filename });

        const contentCont = document.getElementById('anomalous-generated-gallery-content');
        contentCont.innerHTML = '';

        const loading = document.createElement('div');
        loading.textContent = t('galleryScanning');
        loading.style.textAlign = 'center';
        loading.style.gridColumn = '1 / -1';
        loading.style.padding = '50px';
        loading.style.color = '#aaa';
        contentCont.appendChild(loading);

        overlay.style.display = 'flex';

        try {
            const res = await fetch('/anomalous/model_images?model_name=' + encodeURIComponent(model.filename) + '&t=' + Date.now());
            const data = await res.json();
            contentCont.innerHTML = '';

            if (!data.images || data.images.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.textContent = t('galleryNoModelImages');
                emptyMsg.style.textAlign = 'center';
                emptyMsg.style.gridColumn = '1 / -1';
                emptyMsg.style.padding = '50px';
                emptyMsg.style.color = '#888';
                contentCont.appendChild(emptyMsg);
                return;
            }

            data.images.forEach(img => {
                const imgCont = document.createElement('div');
                imgCont.className = 'anomalous-card';
                imgCont.style.cursor = 'pointer';

                const el = document.createElement('img');
                el.src = img.url || img; // Support both just in case
                el.loading = 'lazy';
                el.draggable = true;

                el.addEventListener('dragstart', (e) => {
                    const fullUrl = new URL(el.src, window.location.href).href;
                    e.dataTransfer.setData('text/uri-list', fullUrl);
                    e.dataTransfer.setData('text/plain', fullUrl);
                    if (window.anomalousDragGhostImg) {
                        e.dataTransfer.setDragImage(window.anomalousDragGhostImg, 40, 40);
                    }
                });

                let source_image = "";
                let filenameText = "";
                if (img.url) {
                    try {
                        const urlParams = new URLSearchParams(img.url.split('?')[1]);
                        filenameText = urlParams.get('filename') || '';
                        const sub = urlParams.get('subfolder') || '';
                        source_image = sub ? sub + '/' + filenameText : filenameText;
                    } catch (e) { }
                } else {
                    filenameText = img.split('/').pop().split('?')[0];
                    source_image = filenameText;
                }

                const titleDiv = document.createElement('div');
                titleDiv.className = 'anomalous-card-title';
                titleDiv.innerText = filenameText;

                const setCoverBtn = document.createElement('button');
                setCoverBtn.textContent = t('gallerySetCover');
                setCoverBtn.style.position = 'absolute';
                setCoverBtn.style.bottom = '40px';
                setCoverBtn.style.right = '5px';
                setCoverBtn.style.background = 'rgba(40, 167, 69, 0.85)';
                setCoverBtn.style.color = '#fff';
                setCoverBtn.style.border = '1px solid var(--amb-border-strong)';
                setCoverBtn.style.borderRadius = '4px';
                setCoverBtn.style.padding = '4px 8px';
                setCoverBtn.style.cursor = 'pointer';
                setCoverBtn.style.zIndex = '10';
                setCoverBtn.style.fontSize = '12px';

                setCoverBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (!confirm(t('gallerySetCoverConfirm'))) return;

                    fetch('/anomalous/set_custom_cover', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: this.currentType,
                            path_idx: this.currentPathIdx,
                            subfolder: this.currentSubfolder,
                            filename: model.filename,
                            source_image: source_image
                        })
                    }).then(res => res.json()).then(async result => {
                        if (result.status === 'success') {
                            alert(t('galleryCoverSuccess'));
                            await this.loadModels();
                            const updatedModel = this.models.find(m => m.filename === model.filename);
                            if (updatedModel && this.currentDetailModel && this.currentDetailModel.filename === model.filename) {
                                this.showDetail(updatedModel);
                            }
                        } else {
                            alert(t('galleryErrorPrefix') + result.message);
                        }
                    }).catch(err => {
                        alert(t('galleryErrorPrefix') + err.message);
                    });
                };

                imgCont.onclick = () => {
                    const allGenCards = Array.from(contentCont.querySelectorAll('.anomalous-card'));
                    const curIndex = allGenCards.indexOf(imgCont);
                    const genItems = (data.images || []).map(im => {
                        const u = im.url || im;
                        let fn = '';
                        let sub = '';
                        if (im.url) {
                            try {
                                const up = new URLSearchParams(im.url.split('?')[1]);
                                fn = up.get('filename') || '';
                                sub = up.get('subfolder') || '';
                            } catch (_) {}
                        } else {
                            fn = String(im).split('/').pop().split('?')[0];
                        }
                        return {
                            filename: fn,
                            subfolder: sub,
                            url: u,
                            sourceImage: { type: 'output', filename: fn, subfolder: sub }
                        };
                    });
                    void showImageWorkbench(this, {
                        type: 'output',
                        filename: filenameText,
                        subfolder: source_image.includes('/') ? source_image.split('/')[0] : '',
                    }, img.url || img, {
                        items: genItems,
                        currentIndex: curIndex >= 0 ? curIndex : 0,
                    });
                };

                imgCont.appendChild(el);
                imgCont.appendChild(setCoverBtn);
                imgCont.appendChild(titleDiv);
                contentCont.appendChild(imgCont);
            });
        } catch (e) {
            const error = document.createElement('div');
            error.textContent = t('galleryLoadImagesError');
            error.style.color = 'red';
            error.style.textAlign = 'center';
            error.style.gridColumn = '1 / -1';
            error.style.padding = '50px';
            contentCont.replaceChildren(error);
        }
    }



export function showGallerySelectMode(model) {
        this.gallerySelectModel = model;
        this.grid.style.display = 'none';
        this.detailPanel.style.display = 'none';
        this.galleryPanel.style.display = 'flex';
        this.galleryPanel.classList.add('is-cover-selecting');
        let banner = document.getElementById('anomalous-gallery-select-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'anomalous-gallery-select-banner';
            banner.style.background = '#28a745';
            banner.style.color = '#fff';
            banner.style.padding = '10px';
            banner.style.textAlign = 'center';
            banner.style.fontWeight = 'bold';
            banner.style.position = 'sticky';
            banner.style.top = '0';
            banner.style.zIndex = '1000';
            this.galleryPanel.insertBefore(banner, this.galleryPanel.firstChild);
        }
        banner.style.display = 'block';
        banner.replaceChildren();
        const bannerPrefix = document.createTextNode(t('gallerySelectingCoverPrefix'));
        const bannerModel = document.createElement('span');
        bannerModel.textContent = model.filename;
        bannerModel.style.color = '#ff0';
        const bannerSuffix = document.createTextNode(t('gallerySelectingCoverSuffix'));
        const cancelSelect = document.createElement('button');
        cancelSelect.id = 'anomalous-cancel-select';
        cancelSelect.textContent = t('galleryCancel');
        cancelSelect.style.marginLeft = '15px';
        cancelSelect.style.color = '#000';
        cancelSelect.style.background = '#fff';
        cancelSelect.style.border = 'none';
        cancelSelect.style.padding = '2px 8px';
        cancelSelect.style.borderRadius = '4px';
        cancelSelect.style.cursor = 'pointer';
        banner.append(bannerPrefix, bannerModel, bannerSuffix, cancelSelect);

        cancelSelect.onclick = () => {
            const tempModel = this.gallerySelectModel;
            this.gallerySelectModel = null;
            this.galleryPanel.classList.remove('is-cover-selecting');
            banner.style.display = 'none';
            this.galleryPanel.style.display = 'none';
            if (this.currentDetailModel) {
                this.detailPanel.style.display = 'flex';
            } else {
                this.grid.style.display = 'grid';
            }
            if (tempModel) {
                this.showEditModal(tempModel);
            }
        };

        if (!this.galleryLoaded) {
            this.loadGalleryImages(1, true);
        }
    }



export function showGalleryViewer(src) {
        let viewer = document.getElementById('anomalous-gallery-viewer');
        if (!viewer) {
            viewer = document.createElement('dialog');
            viewer.id = 'anomalous-gallery-viewer';
            viewer.className = 'anomalous-gallery-viewer';

            const closeBtn = document.createElement('div');
            closeBtn.className = 'anomalous-gallery-viewer-close';
            closeBtn.innerHTML = '&times;';

            const img = document.createElement('img');
            img.id = 'anomalous-gallery-viewer-img';

            viewer.appendChild(img);
            viewer.appendChild(closeBtn);

            let scale = 1;
            let translateX = 0;
            let translateY = 0;
            let isDragging = false;
            let startX = 0, startY = 0;

            const resetImgTransform = () => {
                scale = 1; translateX = 0; translateY = 0;
                img.style.transform = `translate(0px, 0px) scale(1)`;
                img.style.cursor = 'grab';
            };

            closeBtn.onclick = () => {
                viewer.close();
                resetImgTransform();
            };

            viewer.onclick = (e) => {
                if (e.target === viewer) {
                    viewer.close();
                    resetImgTransform();
                }
            };

            viewer.addEventListener('wheel', (e) => {
                e.preventDefault();
                const zoomFactor = 0.1;
                if (e.deltaY < 0) scale += zoomFactor;
                else scale = Math.max(0.1, scale - zoomFactor);
                img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            });

            img.addEventListener('mousedown', (e) => {
                e.preventDefault();
                isDragging = true;
                startX = e.clientX - translateX;
                startY = e.clientY - translateY;
                img.style.cursor = 'grabbing';
            });

            window.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                translateX = e.clientX - startX;
                translateY = e.clientY - startY;
                img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            });

            window.addEventListener('mouseup', () => {
                isDragging = false;
                img.style.cursor = 'grab';
            });

            document.body.appendChild(viewer);
        }

        const img = document.getElementById('anomalous-gallery-viewer-img');
        img.src = src;

        // Reset scale and translation when opening a new image
        img.style.transform = `translate(0px, 0px) scale(1)`;
        img.style.cursor = 'grab';

        if (!viewer.open) viewer.showModal();
    }
