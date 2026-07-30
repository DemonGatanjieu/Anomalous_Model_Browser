/**
 * ui_grid.js
 * Extracted Grid methods.
 */

import { app } from "../../../scripts/app.js";
import { i18n } from './locales.js';

const t = (key) => {
    let lang = window.anomalous_browser_lang || 'zh';
    if (lang.startsWith('en')) lang = 'en';
    return (i18n[lang] && i18n[lang][key]) ? i18n[lang][key] : (i18n['zh'][key] || key);
};



export async function loadModels() {
        try {
            const params = new URLSearchParams({ type: this.currentType, path_idx: this.currentPathIdx, subfolder: this.currentSubfolder });
            const res = await fetch('/anomalous/models?' + params.toString());
            const data = await res.json();

            if (window.anomalous_update_hash_cache && data.models) {
                window.anomalous_update_hash_cache(data.models);
            }

            this.models = data.models || [];
            const ts = Date.now();
            this.models.forEach(m => {
                if (m.preview_url) {
                    m.preview_url += (m.preview_url.includes('?') ? '&' : '?') + 't=' + ts;
                }
            });

            this.grid.innerHTML = '';

            if (!data.models || data.models.length === 0) {
                this.grid.innerHTML = `<div style="color:white; padding:20px;">${t('noModels')}</div>`;
                return;
            }

            data.models.forEach(model => {
                const card = document.createElement('div');
                card.className = 'anomalous-card';
                if (model.preview_url) {
                    const isVideo = model.preview_url.match(/\.mp4(?:&|$)/i) || model.preview_url.match(/\.webm(?:&|$)/i);
                    if (isVideo) {
                        const video = document.createElement('video');
                        video.src = model.preview_url;
                        video.muted = true; video.loop = true; video.playsInline = true;
                        if (this.energySaving) {
                            video.pause();
                            card.addEventListener('mouseenter', () => video.play().catch(e => { }));
                            card.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
                        } else {
                            video.autoplay = true;
                        }
                        card.appendChild(video);
                    } else {
                        const img = document.createElement('img');
                        img.src = model.preview_url;
                        card.appendChild(img);
                    }
                } else {
                    const ph = document.createElement('div');
                    ph.className = 'anomalous-card-placeholder';
                    ph.innerHTML = `<div style="text-align:center;color:#666;margin-top:80px;">${t('noPreview')}</div><div style="font-size:0.8em;text-align:center;opacity:0.5;margin-top:5px">${t('clickScan')}</div>`;
                    card.appendChild(ph);
                }
                const title = document.createElement('div');
                if (model.metadata && model.metadata.baseModel) {
                    const badge = document.createElement('div');
                    badge.innerText = model.metadata.baseModel;
                    badge.style.position = 'absolute';
                    badge.style.top = '6px';
                    badge.style.left = '6px';
                    badge.style.background = 'rgba(0,0,0,0.85)';
                    badge.style.color = '#00ffcc';
                    badge.style.padding = '3px 6px';
                    badge.style.borderRadius = '4px';
                    badge.style.fontSize = '0.75em';
                    badge.style.fontWeight = 'bold';
                    badge.style.border = '1px solid rgba(0,255,204,0.3)';
                    badge.style.pointerEvents = 'none';
                    badge.style.zIndex = '10';
                    card.appendChild(badge);
                }
                title.className = 'anomalous-card-title';
                title.innerText = model.filename;
                card.appendChild(title);

                card.onclick = () => { 
                    this.historyStack = []; 
                    this.currentDetailModel = model; 
                    this.showDetail(model); 
                };

                const applyBtn = document.createElement('button');
                applyBtn.innerHTML = '➕';
                applyBtn.title = t('applyToCanvas');
                applyBtn.style.position = 'absolute';
                applyBtn.style.top = '6px';
                applyBtn.style.right = '6px';
                applyBtn.style.background = 'rgba(0,0,0,0.7)';
                applyBtn.style.color = '#fff';
                applyBtn.style.border = '1px solid rgba(255,255,255,0.2)';
                applyBtn.style.borderRadius = '4px';
                applyBtn.style.cursor = 'pointer';
                applyBtn.style.padding = '4px 6px';
                applyBtn.style.zIndex = '20';
                applyBtn.style.fontSize = '1em';
                applyBtn.style.display = 'none';

                const singleScanBtn = document.createElement('button');
                singleScanBtn.innerHTML = '🎯';
                singleScanBtn.title = '精准扫描此模型';
                singleScanBtn.style.position = 'absolute';
                singleScanBtn.style.top = '6px';
                singleScanBtn.style.right = '40px';
                singleScanBtn.style.background = 'rgba(0,0,0,0.7)';
                singleScanBtn.style.color = '#fff';
                singleScanBtn.style.border = '1px solid rgba(255,255,255,0.2)';
                singleScanBtn.style.borderRadius = '4px';
                singleScanBtn.style.cursor = 'pointer';
                singleScanBtn.style.padding = '4px 6px';
                singleScanBtn.style.zIndex = '20';
                singleScanBtn.style.fontSize = '1em';
                singleScanBtn.style.display = 'none';

                singleScanBtn.onclick = (e) => {
                    e.stopPropagation();
                    createWizardModal(false, model.filename);
                };
                card.appendChild(singleScanBtn);

                const editBtn = document.createElement('button');
                editBtn.innerHTML = '⚙️';
                editBtn.title = window.anomalous_browser_lang === 'zh' ? '编辑模型 (Edit)' : 'Edit Model';
                editBtn.style.position = 'absolute';
                editBtn.style.top = '6px';
                editBtn.style.right = '74px'; // shifted left for new button
                editBtn.style.width = '26px';
                editBtn.style.height = '26px';
                editBtn.style.borderRadius = '50%';
                editBtn.style.border = 'none';
                editBtn.style.background = 'rgba(0,0,0,0.7)';
                editBtn.style.color = '#fff';
                editBtn.style.cursor = 'pointer';
                editBtn.style.display = 'none';
                editBtn.style.alignItems = 'center';
                editBtn.style.justifyContent = 'center';
                editBtn.style.fontSize = '14px';
                editBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.showEditModal(model);
                };
                card.appendChild(editBtn);

                card.addEventListener('mouseenter', () => {
                    applyBtn.style.display = 'block';
                    editBtn.style.display = 'flex';
                    singleScanBtn.style.display = 'block';
                });
                card.addEventListener('mouseleave', () => {
                    applyBtn.style.display = 'none';
                    editBtn.style.display = 'none';
                    singleScanBtn.style.display = 'none';
                });

                applyBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.applyModelToCanvas(this.currentType, this.currentSubfolder, model);
                };
                card.appendChild(applyBtn);


                this.grid.appendChild(card);
            });
        } catch (e) { }
    }




export function applyModelToCanvas(type, subfolder, model) {
        const nodeTypeMap = {
            'checkpoints': 'CheckpointLoaderSimple',
            'loras': 'LoraLoader',
            'unet': 'UNETLoader',
            'diffusion_models': 'UNETLoader'
        };
        const nodeType = nodeTypeMap[type];
        if (!nodeType) {
            alert(window.anomalous_browser_lang === 'zh' ? '不支持该类型模型的自动应用。' : 'Unsupported model type for auto-apply.');
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

        const sub = subfolder.replace(/^\/+/, '').replace(/\/+$/, '');
        const relPath = sub ? `${sub}/${model.filename}` : model.filename;

        this.setWidgetValuePath(node, relPath);

        this.close();

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