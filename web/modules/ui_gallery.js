/**
 * ui_gallery.js
 * Extracted Gallery Viewer methods.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';

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



export async function loadGalleryImages(page = 1, reset = false) {
        if (this.galleryLoading) return;
        this.galleryLoading = true;
        this.gallerySentinel.textContent = t('galleryLoading');

        try {
            const res = await fetch(`/anomalous/gallery_images?page=${page}&limit=50`);
            const data = await res.json();

            if (reset) {
                // Clear existing cards
                const cards = this.galleryGrid.querySelectorAll('.anomalous-gallery-card');
                cards.forEach(c => c.remove());
                this.galleryLoaded = true;
            }

            if (data.images && data.images.length > 0) {
                data.images.forEach(imgData => {
                    const card = document.createElement('div');
                    card.className = 'anomalous-gallery-card';

                    const q_sub = encodeURIComponent(imgData.subfolder);
                    const q_file = encodeURIComponent(imgData.filename);
                    const imgUrl = `/view?filename=${q_file}&subfolder=${q_sub}&type=output`;

                    const img = document.createElement('img');
                    img.src = imgUrl;
                    img.loading = 'lazy';
                    img.draggable = true;

                    // Drag and drop support for ComfyUI
                    img.addEventListener('dragstart', (e) => {
                        const fullUrl = new URL(imgUrl, window.location.href).href;
                        e.dataTransfer.setData('text/uri-list', fullUrl);
                        e.dataTransfer.setData('text/plain', fullUrl);

                        // Fix for Chromium failing to initiate drag for extremely large (Hires Fix) images
                        if (window.anomalousDragGhostImg) {
                            e.dataTransfer.setDragImage(window.anomalousDragGhostImg, 40, 40);
                        }
                    });

                    // Click to view
                    img.onclick = () => {
                        if (this.gallerySelectModel) {
                            const model = this.gallerySelectModel;
                            fetch('/anomalous/set_custom_cover', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    type: this.currentType,
                                    path_idx: this.currentPathIdx,
                                    subfolder: this.currentSubfolder,
                                    filename: model.filename,
                                    source_image: imgData.subfolder ? imgData.subfolder + '/' + imgData.filename : imgData.filename
                                })
                            }).then(res => res.json()).then(async data => {
                                if (data.status === 'success') {
                                    const tempModel = this.gallerySelectModel;
                                    this.gallerySelectModel = null;
                                    const banner = document.getElementById('anomalous-gallery-select-banner');
                                    if (banner) banner.style.display = 'none';
                                    this.galleryPanel.style.display = 'none';

                                    await this.loadModels();
                                    const updatedModel = this.models.find(m => m.filename === model.filename);

                                    if (this.currentDetailModel && this.currentDetailModel.filename === model.filename) {
                                        this.detailPanel.style.display = 'flex';
                                        if (updatedModel) this.showDetail(updatedModel);
                                    } else {
                                        this.grid.style.display = 'grid';
                                        // Grid was already refreshed by loadModels
                                    }


                                } else {
                                    alert(t('galleryErrorPrefix') + data.message);
                                }
                            });
                            return;
                        }
                        this.showGalleryViewer(imgUrl);
                    };

                    const delBtn = document.createElement('button');
                    delBtn.className = 'anomalous-gallery-delete';
                    delBtn.innerHTML = '🗑️';
                    delBtn.title = t('galleryDelete');

                    delBtn.onclick = (e) => {
                        e.stopPropagation();

                        const overlay = document.createElement('div');
                        overlay.style.position = 'absolute';
                        overlay.style.top = '0';
                        overlay.style.left = '0';
                        overlay.style.width = '100%';
                        overlay.style.height = '100%';
                        overlay.style.background = 'rgba(0,0,0,0.85)';
                        overlay.style.display = 'flex';
                        overlay.style.flexDirection = 'column';
                        overlay.style.alignItems = 'center';
                        overlay.style.justifyContent = 'center';
                        overlay.style.gap = '15px';
                        overlay.style.zIndex = '10';

                        const msg = document.createElement('div');
                        const msgTitle = document.createElement('div');
                        msgTitle.textContent = t('galleryDeleteConfirm');
                        const msgHint = document.createElement('div');
                        msgHint.textContent = t('galleryDeleteConfirmHint');
                        msgHint.style.fontSize = '0.8em';
                        msgHint.style.color = '#aaa';
                        msg.append(msgTitle, msgHint);
                        msg.style.color = '#fff';
                        msg.style.fontWeight = 'bold';
                        msg.style.textAlign = 'center';

                        const btnRow = document.createElement('div');
                        btnRow.style.display = 'flex';
                        btnRow.style.gap = '12px';

                        const confirmBtn = document.createElement('button');
                        confirmBtn.textContent = `🗑️ ${t('galleryDelete')}`;
                        confirmBtn.style.background = '#dc3545';
                        confirmBtn.style.color = '#fff';
                        confirmBtn.style.border = 'none';
                        confirmBtn.style.padding = '10px 16px';
                        confirmBtn.style.borderRadius = '6px';
                        confirmBtn.style.cursor = 'pointer';
                        confirmBtn.style.fontWeight = 'bold';
                        confirmBtn.style.transition = 'background 0.2s';
                        confirmBtn.onmouseover = () => confirmBtn.style.background = '#ff0000';
                        confirmBtn.onmouseout = () => confirmBtn.style.background = '#dc3545';

                        const cancelBtn = document.createElement('button');
                        cancelBtn.textContent = t('galleryCancel');
                        cancelBtn.style.background = '#444';
                        cancelBtn.style.color = '#fff';
                        cancelBtn.style.border = 'none';
                        cancelBtn.style.padding = '10px 16px';
                        cancelBtn.style.borderRadius = '6px';
                        cancelBtn.style.cursor = 'pointer';
                        cancelBtn.style.transition = 'background 0.2s';
                        cancelBtn.onmouseover = () => cancelBtn.style.background = '#666';
                        cancelBtn.onmouseout = () => cancelBtn.style.background = '#444';

                        cancelBtn.onclick = (ce) => {
                            ce.stopPropagation();
                            overlay.remove();
                        };

                        confirmBtn.onclick = async (ce) => {
                            ce.stopPropagation();
                            confirmBtn.textContent = t('galleryDeleting');
                            confirmBtn.disabled = true;
                            try {
                                const dr = await fetch('/anomalous/delete_gallery_image', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ filename: imgData.filename, subfolder: imgData.subfolder })
                                });
                                const dd = await dr.json();
                                if (dd.status === 'success') {
                                    card.remove();
                                } else {
                                    alert(t('galleryDeleteFailed') + dd.message);
                                    overlay.remove();
                                }
                            } catch (err) {
                                alert(t('galleryErrorPrefix') + err);
                                overlay.remove();
                            }
                        };

                        btnRow.appendChild(cancelBtn);
                        btnRow.appendChild(confirmBtn);
                        overlay.appendChild(msg);
                        overlay.appendChild(btnRow);

                        card.appendChild(overlay);
                    };

                    card.appendChild(img);
                    card.appendChild(delBtn);
                    this.galleryGrid.insertBefore(card, this.gallerySentinel);
                });

                this.galleryCurrentPage = page;
                this.galleryHasMore = page < data.pages;

                if (!this.galleryHasMore) {
                    this.gallerySentinel.textContent = t('galleryNoMore');
                } else {
                    this.gallerySentinel.textContent = t('galleryScrollMore');
                }
            } else {
                this.galleryHasMore = false;
                this.gallerySentinel.textContent = reset ? t('galleryEmpty') : t('galleryNoMore');
            }
        } catch (e) {
            console.error('Failed to load gallery images', e);
            this.gallerySentinel.textContent = t('galleryLoadFailed');
        }

        this.galleryLoading = false;
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
            modalBox.style.backgroundColor = 'var(--comfy-menu-bg, #222)';
            modalBox.style.borderRadius = '12px';
            modalBox.style.display = 'flex';
            modalBox.style.flexDirection = 'column';
            modalBox.style.overflow = 'hidden';
            modalBox.style.boxShadow = '0 10px 40px rgba(0, 0, 0, 0.8)';

            const header = document.createElement('div');
            header.style.padding = '15px 25px';
            header.style.background = '#333';
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';
            header.style.borderBottom = '1px solid #444';

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
                setCoverBtn.style.border = '1px solid rgba(255,255,255,0.3)';
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
                    this.showGalleryViewer(img.url || img);
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
