/**
 * ui_detail.js
 * Extracted Detail Panel methods.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';
import { escapeHtml, setSafeRichHtml } from './safe_dom.js';
import { renderInferredNote } from './model_source.js';
import { createModelFileFoot } from './model_location.js';
import { createDetailHead } from './model_detail_head.js';
import { civitaiVersionsBox } from './ui_civitai_versions.js';

const t = (key, params) => translate(key, params);

export function showDetail(model) {
        if (this.currentDetailObserver) {
            this.currentDetailObserver.disconnect();
            this.currentDetailObserver = null;
        }
        if (this.detailMouseMoveHandler) window.removeEventListener('mousemove', this.detailMouseMoveHandler);
        if (this.detailMouseUpHandler) window.removeEventListener('mouseup', this.detailMouseUpHandler);
        if (!this.recipeModelReturn && this.grid && this.grid.style.display !== 'none') {
            this.gridReturnState = {
                type: this.currentType,
                pathIdx: this.currentPathIdx,
                subfolder: this.currentSubfolder,
                scrollTop: this.grid.scrollTop,
                scrollLeft: this.grid.scrollLeft,
            };
        }
        this.grid.style.display = 'none';
        this.detailPanel.style.display = 'flex';
        this.stopMediaInContainer(this.detailPanel); this.detailPanel.innerHTML = '';

        const goBack = () => {
            if (this.currentDetailObserver) {
                this.currentDetailObserver.disconnect();
                this.currentDetailObserver = null;
            }
            if (typeof this.recipeModelReturn === 'function') {
                const returnToRecipe = this.recipeModelReturn;
                this.recipeModelReturn = null;
                returnToRecipe();
                return;
            }
            if (this.historyStack.length > 0) {
                const prev = this.historyStack.pop();
                if (prev.type === 'assistant') {
                    this.detailPanel.style.display = 'none';
                    this.stopMediaInContainer(this.detailPanel); this.detailPanel.innerHTML = '';
                    this.assistantPanel.style.display = 'flex';
                    const container = document.getElementById('anomalous-container');
                    if (container) container.classList.add('anomalous-sidebar-closed');
                    return;
                }
                this.currentType = prev.type;
                this.currentPathIdx = prev.pathIdx;
                this.currentSubfolder = prev.subfolder;
                this.currentDetailModel = prev.model;
                this.renderSidebar();
                this.showDetail(prev.model);
            } else {
                this.detailPanel.style.display = 'none';
                this.stopMediaInContainer(this.detailPanel); this.detailPanel.innerHTML = '';
                this.grid.style.display = 'grid';
                const gridReturnState = this.gridReturnState;
                this.gridReturnState = null;
                if (gridReturnState
                    && gridReturnState.type === this.currentType
                    && gridReturnState.pathIdx === this.currentPathIdx
                    && gridReturnState.subfolder === this.currentSubfolder) {
                    requestAnimationFrame(() => {
                        this.grid.scrollTop = gridReturnState.scrollTop || 0;
                        this.grid.scrollLeft = gridReturnState.scrollLeft || 0;
                    });
                }
            }
        };

        const splitContainer = document.createElement('div');
        splitContainer.className = 'anomalous-split-container';

        const leftPanel = document.createElement('div');
        leftPanel.className = 'anomalous-split-left';

        let isMediaRendered = null;
        const renderMedia = (shouldRender) => {
            if (shouldRender === isMediaRendered) return;
            isMediaRendered = shouldRender;
            leftPanel.innerHTML = '';
            if (!shouldRender) return;

            if (model.preview_url) {
                const isVideo = model.preview_url.match(/\.mp4(?:&|$)/i) || model.preview_url.match(/\.webm(?:&|$)/i);
                if (isVideo) {
                    const video = document.createElement('video');
                    video.src = model.preview_url;
                    video.controls = true;
                    video.autoplay = true;
                    video.loop = true;
                    video.style.width = '100%';
                    video.style.height = '100%';
                    video.style.objectFit = 'contain';
                    leftPanel.appendChild(video);
                } else {
                    const img = document.createElement('img');
                    img.src = model.preview_url;
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'contain';
                    leftPanel.appendChild(img);
                }
            } else {
                leftPanel.innerHTML = `<div style="color:var(--amb-text-muted); text-align:center; margin-top:50px;">${t('noPreview')}</div>`;
            }
        };

        const containerEl = document.getElementById('anomalous-container');
        this.currentDetailObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                renderMedia(entry.contentRect.width >= 750);
            }
        });
        this.currentDetailObserver.observe(containerEl);

        const resizer = document.createElement('div');
        resizer.className = 'anomalous-resizer';

        let isResizing = false;
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });

        this.detailMouseMoveHandler = (e) => {
            if (!isResizing) return;
            const containerRect = splitContainer.getBoundingClientRect();
            let newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
            if (newWidth < 20) newWidth = 20;
            if (newWidth > 80) newWidth = 80;
            leftPanel.style.width = newWidth + '%';
            rightPanel.style.width = (100 - newWidth) + '%';
        };
        window.addEventListener('mousemove', this.detailMouseMoveHandler);

        this.detailMouseUpHandler = () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
            }
        };
        window.addEventListener('mouseup', this.detailMouseUpHandler);

        const rightPanel = document.createElement('div');
        rightPanel.className = 'anomalous-split-right';
        rightPanel.style.display = 'flex';
        rightPanel.style.flexDirection = 'column';
        rightPanel.style.height = '100%';
        rightPanel.style.boxSizing = 'border-box';
        rightPanel.style.overflow = 'auto';
        rightPanel.style.padding = '15px';
        rightPanel.style.color = 'var(--amb-text-main)';

        const m = model.metadata || {};

        const openVersion = other => { // another version of this model, in its place
            this.currentDetailModel = other;
            this.showDetail(other);
        };
        rightPanel.appendChild(createDetailHead(this, model, goBack, openVersion));
        const onCivitai = civitaiVersionsBox(this, model, openVersion);
        if (onCivitai) rightPanel.appendChild(onCivitai);
        const inferredNote = renderInferredNote(m, () => this.showEditModal(model));
        if (inferredNote) rightPanel.appendChild(inferredNote);

        // 1.5 Custom Notes Section (Google Material Card)
        if (m.custom_notes) {
            const notesCard = document.createElement('div');
            notesCard.style.flexShrink = '0';
            notesCard.style.marginBottom = '15px';
            notesCard.style.padding = '12px 16px';
            // Dark yellowish/khaki paper background for dark mode notebook feel
            notesCard.style.background = 'linear-gradient(135deg, var(--amb-bg-card-hover) 0%, var(--amb-bg-card) 100%)';
            notesCard.style.border = '1px solid var(--amb-border-strong)';
            notesCard.style.borderLeft = '4px solid var(--amb-note-accent)';
            notesCard.style.borderRadius = '4px 8px 8px 4px';
            notesCard.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
            notesCard.style.position = 'relative';
            notesCard.style.fontFamily = 'Inter, Roboto, sans-serif';
            // Faint notebook lines background
            notesCard.style.backgroundImage = 'repeating-linear-gradient(transparent, transparent 23px, rgba(163, 141, 83, 0.04) 23px, rgba(163, 141, 83, 0.04) 24px)';
            notesCard.style.backgroundAttachment = 'local'; // ensures lines scroll with text

            const notesHeader = document.createElement('div');
            notesHeader.style.display = 'flex';
            notesHeader.style.justifyContent = 'space-between';
            notesHeader.style.alignItems = 'center';
            notesHeader.style.marginBottom = '8px';

            const notesTitle = document.createElement('div');
            notesTitle.textContent = t('detailNotesTitle');
            notesTitle.style.color = 'var(--amb-note-accent)';
            notesTitle.style.fontWeight = '600';
            notesTitle.style.fontSize = '0.85em';
            notesTitle.style.letterSpacing = '0.5px';

            const notesEditBtn = document.createElement('button');
            notesEditBtn.innerHTML = '<svg style="width:13px;height:13px;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
            notesEditBtn.title = t('detailEditNotes');
            notesEditBtn.style.background = 'transparent';
            notesEditBtn.style.border = 'none';
            notesEditBtn.style.color = 'var(--amb-note-accent)';
            notesEditBtn.style.cursor = 'pointer';
            notesEditBtn.style.padding = '2px';
            notesEditBtn.style.fontSize = '1em';
            notesEditBtn.style.borderRadius = '50%';
            notesEditBtn.style.display = 'flex';
            notesEditBtn.style.alignItems = 'center';
            notesEditBtn.style.justifyContent = 'center';
            notesEditBtn.style.opacity = '0.7';
            notesEditBtn.onmouseover = () => notesEditBtn.style.opacity = '1';
            notesEditBtn.onmouseout = () => notesEditBtn.style.opacity = '0.7';
            notesEditBtn.onclick = () => {
                this.showEditModal(model);
            };

            notesHeader.appendChild(notesTitle);
            notesHeader.appendChild(notesEditBtn);

            const notesContent = document.createElement('div');
            notesContent.innerText = m.custom_notes;
            notesContent.style.color = 'var(--amb-note-text)'; // Warm off-white

            notesContent.style.fontSize = '0.95em';
            notesContent.style.lineHeight = '24px'; // Matches the repeating gradient exactly
            notesContent.style.whiteSpace = 'pre-wrap';
            notesContent.style.fontFamily = '"Consolas", "Courier New", monospace'; // Handwriting / typewriter feel
            // Removed text shadow for cleaner look

            notesCard.appendChild(notesHeader);
            notesCard.appendChild(notesContent);

            rightPanel.appendChild(notesCard);
        }

        // 2. Trained Words Section
        if (m.trainedWords && m.trainedWords.length > 0) {
            const twCont = document.createElement('div');
            twCont.style.flexShrink = '0';
            twCont.style.marginBottom = '10px';

            const twHeader = document.createElement('div');
            twHeader.style.display = 'flex';
            twHeader.style.alignItems = 'center';
            twHeader.style.marginBottom = '5px';

            const twLabel = document.createElement('strong');
            twLabel.textContent = t('detailTrainedWords');
            twHeader.appendChild(twLabel);

            const copyAll = document.createElement('button');
            copyAll.innerText = t('copyAll');
            copyAll.style.marginLeft = '10px';
            copyAll.style.padding = '2px 6px';
            copyAll.style.background = 'var(--amb-bg-card-hover)';
            copyAll.style.color = 'var(--amb-text-main)';
            copyAll.style.border = 'none';
            copyAll.style.borderRadius = '3px';
            copyAll.style.cursor = 'pointer';
            copyAll.style.fontSize = '0.8em';
            copyAll.onclick = () => {
                const allWords = m.trainedWords.join(', ');
                navigator.clipboard.writeText(allWords).then(() => {
                    const old = copyAll.innerText;
                    copyAll.innerText = t('copied');
                    setTimeout(() => { copyAll.innerText = old; }, 1500);
                });
            };
            twHeader.appendChild(copyAll);
            twCont.appendChild(twHeader);

            const tagsCont = document.createElement('div');
            tagsCont.style.display = 'flex';
            tagsCont.style.flexWrap = 'wrap';
            tagsCont.style.gap = '4px';

            m.trainedWords.forEach(w => {
                const tag = document.createElement('span');
                tag.innerText = w;
                tag.style.background = 'var(--amb-bg-card-hover)';
                tag.style.padding = '2px 6px';
                tag.style.borderRadius = '4px';
                tag.style.fontSize = '0.85em';
                tag.style.cursor = 'pointer';
                tag.style.border = '1px solid var(--amb-border-strong)';
                tag.title = t('clickToCopy') + w;
                tag.onclick = () => {
                    navigator.clipboard.writeText(w).then(() => {
                        tag.style.background = '#28a745';
                        setTimeout(() => { tag.style.background = 'var(--amb-bg-card-hover)'; }, 500);
                    });
                };
                tagsCont.appendChild(tag);
            });
            twCont.appendChild(tagsCont);
            rightPanel.appendChild(twCont);
        }

        // 3. Description Section (a model read from its file has the note above instead)
        if (m.description && m.info_source !== 'local') {
            const descCont = document.createElement('div');
            descCont.style.flex = 'none';
            descCont.style.display = 'flex';
            descCont.style.flexDirection = 'column';
            // important for flex scroll

            const descLabel = document.createElement('strong');
            descLabel.textContent = t('detailDescription');
            descLabel.style.marginBottom = '5px';
            descCont.appendChild(descLabel);

            const descText = document.createElement('div');
            descText.className = 'anomalous-detail-description'; // Civitai's headings kept to size
            descText.style.flex = 'none';

            descText.style.background = 'var(--amb-bg-card)';
            descText.style.padding = '10px';
            descText.style.borderRadius = '6px';
            descText.style.border = '1px solid var(--amb-border-strong)';
            descText.style.fontSize = '0.95em';
            descText.style.lineHeight = '1.4';
            setSafeRichHtml(descText, m.description);
            descCont.appendChild(descText);

            rightPanel.appendChild(descCont);
        }

        // 4. Notes Section
        if (m.notes) {
            const notesCont = document.createElement('div');
            notesCont.style.flexShrink = '0';
            notesCont.style.marginTop = '10px';

            const notesLabel = document.createElement('strong');
            notesLabel.textContent = t('detailNotes');
            notesCont.appendChild(notesLabel);

            const notesText = document.createElement('div');
            notesText.style.background = 'var(--amb-note-bg)';
            notesText.style.padding = '8px';
            notesText.style.borderRadius = '6px';
            notesText.style.marginTop = '5px';
            notesText.style.border = '1px solid var(--amb-note-border)';
            notesText.style.fontSize = '0.9em';
            setSafeRichHtml(notesText, m.notes);
            notesCont.appendChild(notesText);

            rightPanel.appendChild(notesCont);
        }

        // --- Compatible Models Section ---
        if (m.baseModel) {
            const compSec = document.createElement('div');
            compSec.className = 'anomalous-compatible-section';

            const compTitle = document.createElement('div');
            compTitle.className = 'anomalous-compatible-title';
            compTitle.innerHTML = `${t('compatibleModels') || '🔗 Compatible'} <span style="font-size:0.8em; opacity:0.6;">(${escapeHtml(m.baseModel)})</span>`;

            const compList = document.createElement('div');
            compList.className = 'anomalous-compatible-list';
            compList.innerHTML = `<span style="color:var(--amb-text-muted);">${t('loadingCompatible') || 'Loading...'}</span>`;

            compSec.appendChild(compTitle);
            compSec.appendChild(compList);
            rightPanel.appendChild(compSec);

            const targetType = this.currentType === 'loras' ? 'checkpoints,unet,diffusion_models' : 'loras';
            fetch(`/anomalous/compatible_models?base_model=${encodeURIComponent(m.baseModel)}&target_type=${encodeURIComponent(targetType)}`)
                .then(r => r.json())
                .then(d => {
                    compList.innerHTML = '';
                    if (window.anomalous_update_hash_cache && d.models) {
                        window.anomalous_update_hash_cache(d.models);
                    }
                    if (!d.models || d.models.length === 0) {
                        const noCompatible = document.createElement('span');
                        noCompatible.style.color = 'var(--amb-text-muted)';
                        noCompatible.textContent = t('detailNoCompatibleModels');
                        compList.replaceChildren(noCompatible);
                        return;
                    }
                    d.models.forEach(m_comp => {
                        const mItem = document.createElement('div');
                        mItem.className = 'anomalous-compatible-item';
                        mItem.title = m_comp.filename;

                        let thumb = '';
                        if (m_comp.preview_url) {
                            const isVid = m_comp.preview_url.match(/\.mp4(?:&|$)/i) || m_comp.preview_url.match(/\.webm(?:&|$)/i);
                            if (isVid) thumb = `<video src="${m_comp.preview_url}" muted loop playsinline></video>`;
                            else thumb = `<img src="${m_comp.preview_url}" />`;
                        } else {
                            thumb = `<div style="width:30px; height:30px; background:var(--amb-bg-card); border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:10px; color:var(--amb-text-dim);">?</div>`;
                        }

                        mItem.innerHTML = `${thumb}<div class="anomalous-compatible-item-name">${escapeHtml(m_comp.filename)}</div>`;

                        if (m_comp.preview_url && (m_comp.preview_url.match(/\.mp4(?:&|$)/i) || m_comp.preview_url.match(/\.webm(?:&|$)/i))) {
                            mItem.onmouseenter = () => { const v = mItem.querySelector('video'); if (v) v.play().catch(e => { }); };
                            mItem.onmouseleave = () => { const v = mItem.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } };
                        }

                        mItem.onclick = () => {
                            this.historyStack.push({
                                type: this.currentType,
                                pathIdx: this.currentPathIdx,
                                subfolder: this.currentSubfolder,
                                model: this.currentDetailModel
                            });

                            this.currentType = m_comp.type;
                            this.currentPathIdx = m_comp.path_idx;
                            this.currentSubfolder = m_comp.subfolder;
                            this.currentDetailModel = m_comp;

                            this.renderSidebar();
                            this.showDetail(m_comp);
                        };

                        compList.appendChild(mItem);
                    });
                })
                .catch(e => {
                    const compatibleError = document.createElement('span');
                    compatibleError.style.color = '#ff4444';
                    compatibleError.textContent = t('detailCompatibleLoadFailed');
                    compList.replaceChildren(compatibleError);
                });
        }
        // ---------------------------------

        rightPanel.appendChild(createModelFileFoot(this, model,
            { type: this.currentType, path_idx: this.currentPathIdx, subfolder: this.currentSubfolder }));

        splitContainer.appendChild(leftPanel);
        splitContainer.appendChild(resizer);
        splitContainer.appendChild(rightPanel);

        this.detailPanel.appendChild(splitContainer);
    }
