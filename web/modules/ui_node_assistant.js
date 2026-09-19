/** Node Assistant panel and model history cards. */

import { app } from "../../../scripts/app.js";
import { translate } from "./locales.js";
import { formatModelTypeLabel, inferPickerModelType } from "./model_picker.js";

const t = (key, params) => translate(key, params);

export function initAssistantPanel() {
        this.assistantPanelInitialized = true;
        this.assistantPanel.innerHTML = '';
        this.assistantPanel.style.padding = '0';
        this.assistantPanel.style.overflow = 'hidden';

if (!this._assistantPanelHooked) {
            this._assistantPanelHooked = true;
            const self = this;
            const originalOnSelected = app.canvas.onNodeSelected;
            app.canvas.onNodeSelected = function (node) {
                if (originalOnSelected) originalOnSelected.apply(this, arguments);
                if (self.assistantPanel && self.assistantPanel.style.display !== 'none') {
                    self.diagnoseNode(node);
                }
            };
            const originalOnDeselected = app.canvas.onNodeDeselected;
            app.canvas.onNodeDeselected = function (node) {
                if (originalOnDeselected) originalOnDeselected.apply(this, arguments);
                if (self.assistantPanel && self.assistantPanel.style.display !== 'none') {
                    const stillSelected = Object.values(app.canvas.selected_nodes || {});
                    if (stillSelected.length > 0) self.diagnoseNode(stillSelected[0]);
                    else self.diagnoseNode(null);
                }
            };
        }

        const placeholder = document.createElement('div');
        placeholder.id = 'anomalous-assistant-placeholder';
        placeholder.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;color:#666;font-size:15px;gap:12px;padding:40px;text-align:center;';
        placeholder.innerHTML = `<div style="font-size:48px;">🤖</div><div>${t('assistantSelectNode')}</div>`;
        this.assistantPanel.appendChild(placeholder);

        const nodeContent = document.createElement('div');
        nodeContent.id = 'anomalous-assistant-node-content';
        nodeContent.style.cssText = 'display:none;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
        this.assistantPanel.appendChild(nodeContent);
    }

export function renderAssistantModelCard(node, w, container) {
        const val = w.value;
        const filename = val.split(/[\\/]/).pop();
        const pickerType = inferPickerModelType(node, w);

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin:12px 16px 16px;padding:10px;border:1px solid rgba(255,255,255,0.075);border-radius:14px;background:linear-gradient(160deg,rgba(31,33,42,0.96),rgba(20,21,27,0.96));display:flex;flex-direction:column;gap:12px;box-shadow:0 16px 35px rgba(0,0,0,0.2);';

        // Preview image
        const previewBox = document.createElement('div');
        previewBox.style.cssText = 'width:100%;aspect-ratio:1.65;max-height:260px;background:radial-gradient(circle at 50% 20%,#252a3b,#0b0c10 70%);border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid rgba(255,255,255,0.05);';
        previewBox.innerHTML = `<span style="color:#444;font-size:13px;">${t('doctorLoadingPreview')}</span>`;
        wrapper.appendChild(previewBox);

        // Name and path
        const identityRow = document.createElement('div');
        identityRow.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:0 3px;';
        const identityCopy = document.createElement('div');
        identityCopy.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;';
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'color:#fff;font-weight:750;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        nameEl.title = filename;
        nameEl.innerText = filename;
        const pathEl = document.createElement('div');
        pathEl.style.cssText = 'color:#646b7a;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        pathEl.title = val;
        pathEl.innerText = val;
        const modelTypeBadge = document.createElement('span');
        modelTypeBadge.textContent = pickerType.label;
        modelTypeBadge.style.cssText = 'padding:5px 8px;border-radius:999px;background:rgba(138,180,248,0.1);border:1px solid rgba(138,180,248,0.22);color:#a9c7ff;font-size:9px;font-weight:750;white-space:nowrap;';
        identityCopy.append(nameEl, pathEl);
        identityRow.append(identityCopy, modelTypeBadge);
        wrapper.appendChild(identityRow);

        // Metadata zone (populated async)
        const metaZone = document.createElement('div');
        metaZone.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
        wrapper.appendChild(metaZone);

        // Secondary action; model replacement lives in the prominent node toolbar.
        const actionRow = document.createElement('div');
        actionRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
        const profileBtn = document.createElement('button');
        profileBtn.textContent = t('doctorProfile');
        profileBtn.style.cssText = 'flex:1;padding:10px 12px;background:rgba(138,180,248,0.09);color:#a9c7ff;border:1px solid rgba(138,180,248,0.22);border-radius:9px;cursor:pointer;font-size:12px;font-weight:700;transition:filter 0.2s;';
        profileBtn.onmouseover = () => profileBtn.style.filter = 'brightness(1.2)';
        profileBtn.onmouseout = () => profileBtn.style.filter = 'brightness(1)';

        actionRow.appendChild(profileBtn);
        wrapper.appendChild(actionRow);
        container.appendChild(wrapper);

        // Async: load preview + metadata
        fetch(`/anomalous/find_model?search=${encodeURIComponent(val.replace(/\\/g, '/'))}`)
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(d => {
                // Preview
                if (d.status === 'success' && d.model && d.model.preview_url) {
                    previewBox.innerHTML = '';
                    const pu = d.model.preview_url;
                    const isVid = /\.(mp4|webm)(?:$|\?|&|#)/i.test(pu);
if (isVid) {
                        const vid = document.createElement('video');
                        vid.src = pu; vid.muted = true; vid.loop = true; vid.autoplay = true; vid.playsInline = true;
                        vid.style.cssText = 'width:100%;height:100%;object-fit:contain;';
                        previewBox.appendChild(vid);
                    } else {
                        const img = document.createElement('img');
                        img.src = pu;
                        img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
                        previewBox.appendChild(img);
                    }
                } else {
                    previewBox.innerHTML = `<span style="color:#444;font-size:13px;">${t('doctorNoPreview')}</span>`;
                }

                // Profile button links to detail
                if (d.status === 'success' && d.model) {
                    profileBtn.onclick = () => {
                        this.assistantPanel.style.display = 'none';
                        this.currentType = d.type;
                        this.currentPathIdx = d.path_idx;
                        this.currentSubfolder = d.subfolder;
                        this.historyStack = this.historyStack || [];
                        this.historyStack.push({ type: 'assistant' });
                        this.showDetail(d.model);
                        if (this.foldersData) this.renderSidebar();
                    };
                }

                // Metadata
                if (d.status === 'success' && d.model && d.model.metadata) {
                    const meta = d.model.metadata;

                    // Type + base model badges
                    if (d.type) modelTypeBadge.textContent = formatModelTypeLabel(d.type, pickerType.label);
                    if (meta.baseModel) {
                        const badgeRow = document.createElement('div');
                        badgeRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
                        const b = document.createElement('span');
                        b.style.cssText = 'background:rgba(0,255,204,0.08);border:1px solid rgba(0,255,204,0.15);color:#77e6cf;padding:4px 8px;border-radius:999px;font-size:10px;';
                        b.textContent = `${t('doctorBase')} · ${meta.baseModel}`;
                        badgeRow.appendChild(b);
                        metaZone.appendChild(badgeRow);
                    }

                    // Trigger words
                    const triggers = meta.trainedWords || meta.trigger_words || meta.trained_words;
if (triggers && triggers.length > 0) {
                        const trigSection = document.createElement('div');
                        trigSection.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:6px;padding:10px 12px;';
                        const trigTitle = document.createElement('div');
                        trigTitle.style.cssText = 'color:#aaa;font-size:11px;margin-bottom:8px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;';
                        trigTitle.textContent = t('doctorTriggerWords');
                        const tagList = document.createElement('div');
                        tagList.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;';
                        const words = Array.isArray(triggers) ? triggers : [triggers];
                        words.forEach(word => {
                            const tag = document.createElement('span');
                            tag.style.cssText = 'background:rgba(255,193,7,0.12);color:#ffc107;padding:3px 8px;border-radius:4px;font-size:12px;cursor:pointer;';
                            tag.innerText = word;
                            tag.title = t('doctorClickCopy');
                            tag.onclick = () => {
                                navigator.clipboard.writeText(word).then(() => { const o = tag.innerText; tag.innerText = '✅'; setTimeout(() => tag.innerText = o, 1000); });
                            };
                            tagList.appendChild(tag);
                        });
                        const copyAll = document.createElement('button');
                        copyAll.style.cssText = 'background:transparent;border:1px solid #444;color:#888;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;margin-top:4px;';
                        copyAll.textContent = t('doctorCopyAll');
                        copyAll.onclick = () => {
                            navigator.clipboard.writeText(words.join(', ')).then(() => { copyAll.textContent = '✅'; setTimeout(() => copyAll.textContent = t('doctorCopyAll'), 1500); });
                        };
                        trigSection.appendChild(trigTitle);
                        trigSection.appendChild(tagList);
                        trigSection.appendChild(copyAll);
                        metaZone.appendChild(trigSection);
                    }

                    // Custom notes (parchment)
                    const textNotes = meta.custom_notes || meta.notes;
if (textNotes) {
                        const notesCard = document.createElement('div');
                        notesCard.style.cssText = 'background:linear-gradient(135deg,#262522 0%,#202124 100%);border:1px solid #3c4043;border-left:4px solid #a38d53;border-radius:4px 8px 8px 4px;padding:12px 14px;';
                        const notesTitle = document.createElement('div');
                        notesTitle.style.cssText = 'color:#a38d53;font-size:11px;font-weight:bold;margin-bottom:6px;';
                        notesTitle.textContent = t('doctorNotes');
                        const notesText = document.createElement('div');
                        notesText.style.cssText = 'color:#d4c4a0;font-size:13px;line-height:1.6;white-space:pre-wrap;';
                        notesText.innerText = textNotes;
                        notesCard.appendChild(notesTitle);
                        notesCard.appendChild(notesText);
                        metaZone.appendChild(notesCard);
                    }
                }

                // History gallery — always load if we can resolve the filename
                const resolvedFilename = (d.status === 'success' && d.model) ? (d.model.filename || filename) : filename;
                this._loadAssistantHistory(resolvedFilename, metaZone, d.status === 'success' ? d.model : null);
            }).catch(() => {
                previewBox.innerHTML = `<span style="color:#444;font-size:13px;">${t('assistantPreviewFailed')}</span>`;

                // Still try to load history gallery by filename
                this._loadAssistantHistory(filename, metaZone, null);
            });
    }

export function _loadAssistantHistory(filename, container, model) {
        fetch('/anomalous/model_images?model_name=' + encodeURIComponent(filename) + '&t=' + Date.now())
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(data => {
                const images = data.images || [];
                if (images.length === 0) return;

                const section = document.createElement('div');
                section.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

                // Section header with count + full gallery button
                const sectionHeader = document.createElement('div');
                sectionHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
                const sectionTitle = document.createElement('div');
                sectionTitle.style.cssText = 'color:#aaa;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;';
                sectionTitle.textContent = t('assistantHistoryTitle', { count: images.length });
                sectionHeader.appendChild(sectionTitle);

                // "View all" button if model is available
if (model) {
                    const viewAllBtn = document.createElement('button');
                    viewAllBtn.textContent = t('assistantViewAll');
                    viewAllBtn.style.cssText = 'background:transparent;border:1px solid rgba(255,255,255,0.2);color:#e5e7eb;font-size:11px;padding:3px 8px;border-radius:4px;cursor:pointer;transition:all 0.2s;';
                    viewAllBtn.onmouseover = () => { viewAllBtn.style.background = 'rgba(255,255,255,0.1)'; };
                    viewAllBtn.onmouseout = () => { viewAllBtn.style.background = 'transparent'; };
                    viewAllBtn.onclick = () => this.showGeneratedGallery(model);
                    sectionHeader.appendChild(viewAllBtn);
                }
                section.appendChild(sectionHeader);

                const grid = document.createElement('div');
                grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:6px;';
                images.slice(0, 16).forEach(img => {
                    const card = document.createElement('div');
                    card.style.cssText = 'border-radius:6px;overflow:hidden;aspect-ratio:1;background:#111;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;';
                    card.onmouseover = () => { 
                        card.style.transform = 'scale(1.05)'; card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)'; 
                        const v = card.querySelector('video'); if (v) v.play().catch(()=>{}); 
                    };
                    card.onmouseout = () => { 
                        card.style.transform = 'scale(1)'; card.style.boxShadow = 'none'; 
                        const v = card.querySelector('video'); if (v) v.pause(); 
                    };
                    const imgUrl = img.url || img;
                    const isVid = /\.(mp4|webm)(?:$|\?|&|#)/i.test(imgUrl);
                    if (isVid) {
                        const vidEl = document.createElement('video');
                        vidEl.src = imgUrl; vidEl.muted = true; vidEl.loop = true; vidEl.autoplay = false; vidEl.playsInline = true; vidEl.preload = 'metadata';
                        vidEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                        card.appendChild(vidEl);
                    } else {
                        const imgEl = document.createElement('img');
                        imgEl.src = imgUrl;
                        imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                        imgEl.loading = 'lazy';
                        card.appendChild(imgEl);
                    }
if (img.workflow) {
                        card.title = t('assistantRestoreWorkflow');
                        card.onclick = () => {
                            try {
                                const wf = typeof img.workflow === 'string' ? JSON.parse(img.workflow) : img.workflow;
                                if (app && app.loadGraphData) app.loadGraphData(wf);
                            } catch (e) { }
                        };
} else if (model) {
                        card.title = t('assistantViewGallery');
                        card.onclick = () => this.showGeneratedGallery(model);
                    }
                    grid.appendChild(card);
                });
                section.appendChild(grid);
                container.appendChild(section);
            }).catch(() => { });
    }

