/**
 * ui_grid.js
 * Extracted Grid methods.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';

const t = (key, params) => translate(key, params);

export function cardPreviewUrl(previewUrl, thumbnailMode) {
    if (!previewUrl || thumbnailMode === 'original') return previewUrl;
    return `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}variant=card`;
}

function modelCardDisplayName(model) {
    const metadata = model?.metadata || {};
    return metadata.custom_name || model?.filename || '';
}



export async function loadModels() {
        try {
            if (this._modelLoadController) this._modelLoadController.abort();
            this._modelRenderGeneration = (this._modelRenderGeneration || 0) + 1;
            const loadController = new AbortController();
            this._modelLoadController = loadController;
            const params = new URLSearchParams({ type: this.currentType, path_idx: this.currentPathIdx, subfolder: this.currentSubfolder });
            const res = await fetch('/anomalous/models?' + params.toString(), { signal: loadController.signal });
            const data = await res.json();
            if (this._modelLoadController !== loadController) return;

            if (window.anomalous_update_hash_cache && data.models) {
                window.anomalous_update_hash_cache(data.models);
            }

            this.models = data.models || [];
            const renderGeneration = this._modelRenderGeneration;
            if (this._modelMediaObserver) this._modelMediaObserver.disconnect();
            this._modelMediaObserver = typeof IntersectionObserver === 'function'
                ? new IntersectionObserver((entries, observer) => {
                    entries.forEach(entry => {
                        const media = entry.target;
                        const shouldAutoplay = media.tagName === 'VIDEO' && media.dataset.anomalousAutoplay === 'true';
                        if (!entry.isIntersecting) {
                            if (media.tagName === 'VIDEO') {
                                media.pause();
                                if (media.getAttribute('src')) {
                                    media.removeAttribute('src');
                                    media.load();
                                }
                            }
                            return;
                        }
                        if (media.tagName === 'VIDEO' && !shouldAutoplay) return;
                        const pendingSrc = media.dataset.anomalousSrc;
                        if (pendingSrc && !media.getAttribute('src')) media.src = pendingSrc;
                        if (shouldAutoplay) media.play().catch(() => {});
                    });
                }, { rootMargin: '300px' })
                : null;
            stopMediaInContainer(this.grid);
            this.grid.replaceChildren();

            if (!data.models || data.models.length === 0) {
                this.grid.innerHTML = `<div style="color:white; padding:20px;">${t('noModels')}</div>`;
                return;
            }

            let renderIndex = 0;
            const renderChunk = () => {
                if (this._modelRenderGeneration !== renderGeneration) return;
                const fragment = document.createDocumentFragment();
                const end = Math.min(renderIndex + 40, data.models.length);
                for (; renderIndex < end; renderIndex++) {
                const model = data.models[renderIndex];
                const card = document.createElement('div');
                card.className = 'anomalous-card';
                if (model.preview_url) {
                    const isVideo = model.preview_url.match(/\.mp4(?:&|$)/i) || model.preview_url.match(/\.webm(?:&|$)/i);
                    if (isVideo) {
                        const video = document.createElement('video');
                        video.dataset.anomalousSrc = model.preview_url;
                        video.muted = true; video.loop = true; video.playsInline = true;
                        video.preload = 'metadata';
                        const ensureVideoSource = () => {
                            if (!video.getAttribute('src')) video.src = video.dataset.anomalousSrc;
                        };
                        if (this.energySaving) {
                            video.pause();
                            card.addEventListener('mouseenter', () => {
                                ensureVideoSource();
                                video.play().catch(() => {});
                            });
                            card.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
                        } else {
                            video.dataset.anomalousAutoplay = 'true';
                        }
                        if (this._modelMediaObserver) {
                            this._modelMediaObserver.observe(video);
                        } else {
                            ensureVideoSource();
                            if (!this.energySaving) video.autoplay = true;
                        }
                        card.appendChild(video);
                    } else {
                        const img = document.createElement('img');
                        img.loading = 'lazy';
                        img.decoding = 'async';
                        img.className = 'anomalous-skeleton-shimmer';
                        img.onload = () => { img.classList.remove('anomalous-skeleton-shimmer'); };
                        img.onerror = () => { img.classList.remove('anomalous-skeleton-shimmer'); };
                        img.src = cardPreviewUrl(model.preview_url, this.cardThumbnailMode);
                        card.appendChild(img);
                    }
                } else {
                    const ph = document.createElement('div');
                    ph.className = 'anomalous-card-placeholder';
                    ph.style.display = 'flex';
                    ph.style.flexDirection = 'column';
                    ph.style.alignItems = 'center';
                    ph.style.justifyContent = 'center';
                    ph.style.height = '100%';
                    ph.style.minHeight = '180px';
                    ph.style.color = '#888';
                    ph.style.userSelect = 'none';
                    ph.innerHTML = `
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.35;margin-bottom:6px;">
                            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                            <circle cx="9" cy="9" r="2"/>
                            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                        </svg>
                        <div style="font-size:0.85em;font-weight:500;opacity:0.7;">${t('noPreview')}</div>
                    `;
                    card.appendChild(ph);
                }
                if (model.metadata && model.metadata.baseModel) {
                    const badge = document.createElement('div');
                    badge.className = 'anomalous-card-badge';
                    const bm = String(model.metadata.baseModel);
                    badge.textContent = bm;
                    const bmLower = bm.toLowerCase();
                    if (bmLower.includes('flux')) {
                        badge.classList.add('badge-flux');
                    } else if (bmLower.includes('pony') || bmLower.includes('illustrious') || bmLower.includes('anime')) {
                        badge.classList.add('badge-rose');
                    } else if (bmLower.includes('sdxl') || bmLower.includes('xl')) {
                        badge.classList.add('badge-gold');
                    } else {
                        badge.classList.add('badge-amber');
                    }
                    card.appendChild(badge);
                }
                const labels = document.createElement('div');
                labels.className = 'anomalous-card-labels';
                const title = document.createElement('div');
                title.className = 'anomalous-card-title';
                title.textContent = modelCardDisplayName(model);
                labels.appendChild(title);

                const physicalName = document.createElement('div');
                physicalName.className = 'anomalous-card-filename';
                physicalName.textContent = model.filename;
                physicalName.removeAttribute('title');
                labels.appendChild(physicalName);
                card.appendChild(labels);

                card.onclick = () => { 
                    this.recipeModelReturn = null;
                    this.historyStack = []; 
                    this.currentDetailModel = model; 
                    this.showDetail(model); 
                };

                const applyBtn = document.createElement('button');
                applyBtn.type = 'button';
                applyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
                applyBtn.className = 'anomalous-card-action-btn action-apply anomalous-tooltip-target';
                applyBtn.removeAttribute('title');
                applyBtn.setAttribute('data-tooltip', window.anomalous_browser_lang === 'zh' ? '一键发布到画布' : 'Add Node to Canvas');
                applyBtn.setAttribute('data-tooltip-pos', 'bottom');
                applyBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.applyModelToCanvas(this.currentType, this.currentSubfolder, model);
                };
                card.appendChild(applyBtn);

                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
                editBtn.className = 'anomalous-card-action-btn action-edit anomalous-tooltip-target';
                editBtn.removeAttribute('title');
                editBtn.setAttribute('data-tooltip', window.anomalous_browser_lang === 'zh' ? '编辑模型信息' : 'Edit Model Info');
                editBtn.setAttribute('data-tooltip-pos', 'bottom');
                editBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.showEditModal(model);
                };
                card.appendChild(editBtn);

                const singleScanBtn = document.createElement('button');
                singleScanBtn.type = 'button';
                singleScanBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`;
                singleScanBtn.className = 'anomalous-card-action-btn action-scan anomalous-tooltip-target';
                singleScanBtn.removeAttribute('title');
                singleScanBtn.setAttribute('data-tooltip', window.anomalous_browser_lang === 'zh' ? '立即精准扫描此模型' : 'Scan Model Directly');
                singleScanBtn.setAttribute('data-tooltip-pos', 'bottom');
                singleScanBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (typeof this.scanSingleModel === 'function') {
                        this.scanSingleModel(model, singleScanBtn);
                    } else if (typeof this.openScanWizard === 'function') {
                        this.openScanWizard({ targetFiles: model.filename });
                    }
                };
                card.appendChild(singleScanBtn);


                fragment.appendChild(card);
                }
                this.grid.appendChild(fragment);
                if (renderIndex < data.models.length) requestAnimationFrame(renderChunk);
            };
            requestAnimationFrame(renderChunk);
        } catch (e) {
            if (e && e.name !== 'AbortError') console.error('[Anomalous] Failed to load models', e);
        }
    }




export function applyModelToCanvas(type, subfolder, model) {
        const nodeTypeMap = {
            'checkpoints': 'CheckpointLoaderSimple',
            'loras': 'LoraLoader',
            'unet': 'UNETLoader',
            'diffusion_models': 'UNETLoader',
            'vae': 'VAELoader',
            'clip': 'CLIPLoader',
            'controlnet': 'ControlNetLoader'
        };
        const nodeType = nodeTypeMap[type];
        if (!nodeType) {
            alert(window.anomalous_browser_lang === 'zh' ? '当前类型暂不支持自动发布到画布' : 'Unsupported auto apply for this type');
            return;
        }

        const node = LiteGraph.createNode(nodeType);
        if (!node) {
            alert((window.anomalous_browser_lang === 'zh' ? '创建节点失败: ' : 'Failed to create node: ') + nodeType);
            return;
        }

        if (app.canvas && app.canvas.graph_mouse) {
            node.pos = [
                app.canvas.graph_mouse[0] || (window.innerWidth / 2),
                app.canvas.graph_mouse[1] || (window.innerHeight / 2)
            ];
        } else {
            node.pos = [window.innerWidth / 2, window.innerHeight / 2];
        }

        app.graph.add(node);

        const sub = (subfolder || '').replace(/^\/+/, '').replace(/\/+$/, '');
        const relPath = sub ? `${sub}/${model.filename}` : model.filename;

        this.setWidgetValuePath(node, relPath);

        const isDocked = this.container?.classList.contains('anomalous-docked');
        if (!isDocked) {
            this.close();
        }

        // 粘到鼠标上的逻辑
        let isSticking = true;
        const stickHandler = (e) => {
            if (!isSticking || !app.canvas) return;
            const canvas = app.canvas;

            // LiteGraph内置了坐标转换，它会完美处理缩放和偏移带来的坐标偏移问题
            let canvasX, canvasY;
            if (canvas.convertEventToCanvasOffset) {
                const pos = canvas.convertEventToCanvasOffset(e);
                canvasX = pos[0];
                canvasY = pos[1];
            } else {
                // 如果API不可用，使用标准降级计算
                const rect = canvas.canvas.getBoundingClientRect();
                canvasX = (e.clientX - rect.left - canvas.ds.offset[0]) / canvas.ds.scale;
                canvasY = (e.clientY - rect.top - canvas.ds.offset[1]) / canvas.ds.scale;
            }

            const w = (node.size && node.size[0]) ? node.size[0] : 200;
            node.pos = [canvasX - w / 2, canvasY - 20];
            canvas.setDirty(true, true);
        };
        const dropHandler = (e) => {
            if (!isSticking) return;
            isSticking = false;
            window.removeEventListener('mousemove', stickHandler, true);
            window.removeEventListener('pointerdown', dropHandler, true);
            window.removeEventListener('mousedown', dropHandler, true);
            window.removeEventListener('click', dropHandler, true);
            e.preventDefault();
            e.stopPropagation();
        };
        window.addEventListener('mousemove', stickHandler, true);
        setTimeout(() => {
            window.addEventListener('pointerdown', dropHandler, true);
            window.addEventListener('mousedown', dropHandler, true);
            window.addEventListener('click', dropHandler, true);
        }, 100);
    }




export function stopMediaInContainer(container) {
        if (!container) return;
        const mediaElements = container.querySelectorAll('video, audio');
        mediaElements.forEach(media => {
            media.pause();
            media.removeAttribute('src');
            media.load();
        });
    }
