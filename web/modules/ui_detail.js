/**
 * ui_detail.js
 * Extracted Detail Panel methods.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';
import { escapeHtml, setSafeRichHtml } from './safe_dom.js';

const t = (key, params) => translate(key, params);

function createModelLocationCard(model) {
    const card = document.createElement('div');
    card.className = 'anomalous-model-location';

    const appendValue = (labelKey, value) => {
        const row = document.createElement('div');
        row.className = 'anomalous-model-location-row';
        const label = document.createElement('span');
        label.className = 'anomalous-model-location-label';
        label.textContent = t(labelKey);
        const content = document.createElement('code');
        content.textContent = value;
        content.title = value;
        row.append(label, content);
        card.appendChild(row);
    };

    appendValue('detailPhysicalFilename', model.filename);
    if (model.file_path) {
        appendValue('detailFullPath', model.file_path);
        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'anomalous-model-location-copy';
        copyButton.textContent = t('detailCopyPath');
        copyButton.onclick = async () => {
            try {
                await navigator.clipboard.writeText(model.file_path);
                copyButton.textContent = t('detailPathCopied');
            } catch (error) {
                copyButton.textContent = t('detailPathCopyFailed');
            }
            setTimeout(() => { copyButton.textContent = t('detailCopyPath'); }, 1400);
        };
        card.appendChild(copyButton);
    }
    return card;
}



export function showDetail(model) {
        if (this.isPickingModelForNode) {
            const targetNode = this.isPickingModelForNode.node;
            const targetWidget = this.isPickingModelForNode.widget;
            if (!targetNode || !targetWidget || !model?.filename) {
                this.isPickingModelForNode = null;
                return;
            }

            const normVal = (model.filename).replace(/\\/g, '/');
            let foundPath = model.filename;
            if (targetWidget.options && targetWidget.options.values) {
                const exactMatch = targetWidget.options.values.find(v => typeof v === 'string' && v.replace(/\\/g, '/').endsWith(normVal));
                if (exactMatch) foundPath = exactMatch;
            }
            const oldValue = targetWidget.value;
            const widgetIndex = targetNode.widgets?.indexOf(targetWidget) ?? -1;
            app.graph?.beforeChange?.(targetNode);
            try {
                targetWidget.value = foundPath;
                if (widgetIndex >= 0) {
                    targetNode.widgets_values = Array.isArray(targetNode.widgets_values)
                        ? targetNode.widgets_values
                        : (targetNode.widgets || []).map((widget) => widget?.value);
                    targetNode.widgets_values[widgetIndex] = foundPath;
                }
                delete targetNode.color;
                delete targetNode.bgcolor;
                targetNode.has_errors = false;
                if (typeof targetWidget.callback === 'function') {
                    targetWidget.callback.call(targetWidget, targetWidget.value, app.canvas, targetNode, app.canvas?.graph_mouse, null);
                }
                if (typeof targetNode.onWidgetChanged === 'function' && widgetIndex >= 0) {
                    targetNode.onWidgetChanged(widgetIndex, targetWidget.value, oldValue, targetWidget);
                }
                app.graph?.afterChange?.(targetNode);
                app.graph?.change?.();
                app.graph?.setDirtyCanvas?.(true, true);
                app.canvas?.setDirty?.(true, true);
                try { window.dispatchEvent(new CustomEvent('graphChanged')); } catch (error) {}
            } catch (error) {
                targetWidget.value = oldValue;
                if (widgetIndex >= 0 && Array.isArray(targetNode.widgets_values)) targetNode.widgets_values[widgetIndex] = oldValue;
                app.graph?.afterChange?.(targetNode);
                console.error('Could not apply selected model to node:', error);
                return;
            }

            this.isPickingModelForNode = null;
            const banner = document.getElementById('anomalous-picker-banner');
            if (banner) banner.remove();

            if (this.grid) this.grid.style.display = 'none';
            this.doctorPanel.style.display = 'flex';
            this.diagnoseNode(targetNode);
            return;
        }
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

        const header = document.createElement('div');
        header.style.width = '100%';
        header.style.padding = '8px 15px';
        header.style.background = 'var(--comfy-menu-bg, #333)';
        header.style.borderBottom = '1px solid var(--border-color, #444)';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.boxSizing = 'border-box';

        const backBtn = document.createElement('button');
        let isFromDoctor = false;
        let isFromAssistant = false;
        if (this.historyStack.length > 0) {
            const lastHistory = this.historyStack[this.historyStack.length - 1];
            if (lastHistory.type === 'doctor') {
                isFromDoctor = true;
            } else if (lastHistory.type === 'assistant') {
                isFromAssistant = true;
            }
        }

        if (isFromDoctor) {
            backBtn.textContent = t('detailBackDoctor');
            backBtn.style.background = '#e5e7eb';
            backBtn.style.color = '#111827';
        } else if (isFromAssistant) {
            backBtn.textContent = t('detailBackAssistant');
            backBtn.style.background = '#e5e7eb';
            backBtn.style.color = '#111827';
        } else {
            backBtn.innerHTML = this.historyStack.length > 0 ? t('backToPrev') : t('back');
            backBtn.style.background = '#444';
            backBtn.style.color = '#fff';
        }
        backBtn.style.padding = '6px 12px';
        backBtn.style.border = 'none';
        backBtn.style.borderRadius = '4px';
        backBtn.style.cursor = 'pointer';
        backBtn.onclick = () => {
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
                if (prev.type === 'doctor') {
                    this.detailPanel.style.display = 'none';
                    this.stopMediaInContainer(this.detailPanel); this.detailPanel.innerHTML = '';
                    this.doctorPanel.style.display = 'flex';
                    return;
                }
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

        const title = document.createElement('h2');
        title.textContent = model.filename;
        title.style.margin = '0 20px 0 20px';
        title.style.color = '#fff';
        title.style.fontSize = '1.2em';
        // 强制单行并溢出显示省略号
        title.style.whiteSpace = 'nowrap';
        title.style.overflow = 'hidden';
        title.style.textOverflow = 'ellipsis';
        title.style.flex = '1'; // 撑开剩余空间，把右侧按钮挤到最右边

        const delBtn = document.createElement('button');
        delBtn.innerHTML = t('delModel');
        delBtn.style.padding = '6px 12px';
        delBtn.style.background = '#ff4444';
        delBtn.style.color = '#fff';
        delBtn.style.border = 'none';
        delBtn.style.borderRadius = '4px';
        delBtn.style.cursor = 'pointer';
        delBtn.style.marginLeft = 'auto'; // push to the right
        delBtn.style.whiteSpace = 'nowrap';
        delBtn.onclick = async () => {
            if (!confirm(`${t('delConfirm')} ${model.filename} ${t('delConfirm2')}`)) return;
            try {
                const res = await fetch('/anomalous/delete_model', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: this.currentType,
                        path_idx: this.currentPathIdx,
                        subfolder: this.currentSubfolder,
                        filename: model.filename
                    })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    if (this.currentDetailObserver) {
                        this.currentDetailObserver.disconnect();
                        this.currentDetailObserver = null;
                    }
                    alert(t('delSuccess') + data.deleted.join('\n') + t('delNote'));
                    this.detailPanel.style.display = 'none';
                    this.stopMediaInContainer(this.detailPanel); this.detailPanel.innerHTML = '';
                    this.grid.style.display = 'grid';
                    this.loadModels(); // refresh grid
                } else {
                    alert(t('delFail') + data.message);
                }
            } catch (e) {
                alert(t('delFail') + e.message);
            }
        };

        const jumpBtn = document.createElement('button');
        jumpBtn.innerHTML = '⬇️';
        jumpBtn.title = t('detailJumpToBottom');
        jumpBtn.style.padding = '6px 12px';
        jumpBtn.style.background = '#444';
        jumpBtn.style.color = '#fff';
        jumpBtn.style.border = 'none';
        jumpBtn.style.borderRadius = '4px';
        jumpBtn.style.cursor = 'pointer';
        jumpBtn.style.marginLeft = '10px';
        jumpBtn.onclick = () => {
            // Find rightPanel which is created later, so we bind it dynamically
            const rp = this.detailPanel.querySelector('.anomalous-split-right');
            if (rp) rp.scrollTo({ top: rp.scrollHeight, behavior: 'smooth' });
        };

        header.appendChild(backBtn);
        header.appendChild(title);
        header.appendChild(delBtn);
        header.appendChild(jumpBtn);

        const applyDetailBtn = document.createElement('button');
        applyDetailBtn.textContent = t('applyToCanvas');
        applyDetailBtn.style.padding = '6px 12px';
        applyDetailBtn.style.background = '#007bff';
        applyDetailBtn.style.color = '#fff';
        applyDetailBtn.style.border = 'none';
        applyDetailBtn.style.borderRadius = '4px';
        applyDetailBtn.style.cursor = 'pointer';
        applyDetailBtn.style.marginLeft = '10px';
        applyDetailBtn.style.fontWeight = 'bold';
        applyDetailBtn.onclick = () => {
            this.applyModelToCanvas(this.currentType, this.currentSubfolder, model);
        };
        header.appendChild(applyDetailBtn);


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
                leftPanel.innerHTML = `<div style="color:#aaa; text-align:center; margin-top:50px;">${t('noPreview')}</div>`;
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
        rightPanel.style.color = '#eee';

        const m = model.metadata || {};

        // 1. Top Bar (Title + Size + Model + Button) in a single compact row if possible
        const topRow = document.createElement('div');
        topRow.style.flexShrink = '0';
        topRow.style.display = 'flex';
        topRow.style.flexWrap = 'wrap';
        topRow.style.alignItems = 'center';
        topRow.style.gap = '10px';
        topRow.style.paddingBottom = '10px';
        topRow.style.marginBottom = '10px';
        topRow.style.borderBottom = '1px solid #444';

        const titleEl = document.createElement('h3');
        titleEl.style.margin = '0';
        titleEl.style.fontSize = '1.3em';
        titleEl.style.marginRight = '10px';
        titleEl.innerText = m.custom_name || m.name || model.filename;
        if (m.custom_name) {
            titleEl.style.color = '#88ff88';
        }
        topRow.appendChild(titleEl);

        const metaSpan = document.createElement('span');
        metaSpan.style.fontSize = '0.9em';
        metaSpan.style.color = '#aaa';
        metaSpan.innerHTML = `<strong>Size:</strong> ${escapeHtml(model.size_mb)} MB` + (m.baseModel ? ` <strong style="margin-left:10px;">Base:</strong> ${escapeHtml(m.baseModel)}` : '');
        topRow.appendChild(metaSpan);

        if (m.civitai_url) {
            const cBtn = document.createElement('a');
            cBtn.href = m.civitai_url;
            cBtn.target = '_blank';
            cBtn.rel = 'noopener noreferrer';
            cBtn.innerHTML = '🌐 Civitai';
            cBtn.style.marginLeft = 'auto';
            cBtn.style.padding = '4px 8px';
            cBtn.style.background = 'rgba(255, 255, 255, 0.1)';
            cBtn.style.border = '1px solid rgba(255, 255, 255, 0.15)';
            cBtn.style.color = '#fff';
            cBtn.style.textDecoration = 'none';
            cBtn.style.borderRadius = '4px';
            cBtn.style.fontSize = '0.85em';
            cBtn.style.fontWeight = 'bold';
            topRow.appendChild(cBtn);
        }

        const editMetaBtn = document.createElement('button');
        editMetaBtn.textContent = t('detailEdit');
        editMetaBtn.style.marginLeft = m.civitai_url ? '10px' : 'auto';
        editMetaBtn.style.padding = '4px 8px';
        editMetaBtn.style.background = '#444';
        editMetaBtn.style.color = '#fff';
        editMetaBtn.style.border = 'none';
        editMetaBtn.style.borderRadius = '4px';
        editMetaBtn.style.fontSize = '0.85em';
        editMetaBtn.style.fontWeight = 'bold';
        editMetaBtn.style.cursor = 'pointer';
        editMetaBtn.onclick = () => {
            this.showEditModal(model);
        };
        topRow.appendChild(editMetaBtn);

        rightPanel.appendChild(topRow);
        rightPanel.appendChild(createModelLocationCard(model));

        // 1.5 Custom Notes Section (Google Material Card)
        if (m.custom_notes) {
            const notesCard = document.createElement('div');
            notesCard.style.flexShrink = '0';
            notesCard.style.marginBottom = '15px';
            notesCard.style.padding = '12px 16px';
            // Dark yellowish/khaki paper background for dark mode notebook feel
            notesCard.style.background = 'linear-gradient(135deg, #262522 0%, #202124 100%)';
            notesCard.style.border = '1px solid #3c4043';
            notesCard.style.borderLeft = '4px solid #a38d53';
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
            notesTitle.style.color = '#a38d53';
            notesTitle.style.fontWeight = '600';
            notesTitle.style.fontSize = '0.85em';
            notesTitle.style.letterSpacing = '0.5px';

            const notesEditBtn = document.createElement('button');
            notesEditBtn.innerHTML = '<svg style="width:13px;height:13px;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
            notesEditBtn.title = t('detailEditNotes');
            notesEditBtn.style.background = 'transparent';
            notesEditBtn.style.border = 'none';
            notesEditBtn.style.color = '#a38d53';
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
            notesContent.style.color = '#d1c9b4'; // Warm off-white

            notesContent.style.fontSize = '0.95em';
            notesContent.style.lineHeight = '24px'; // Matches the repeating gradient exactly
            notesContent.style.whiteSpace = 'pre-wrap';
            notesContent.style.fontFamily = '"Consolas", "Courier New", monospace'; // Handwriting / typewriter feel
            // Removed text shadow for cleaner look

            notesCard.appendChild(notesHeader);
            notesCard.appendChild(notesContent);

            rightPanel.appendChild(notesCard);
        }
        // 1.8 Generated Gallery Button
        const galleryBtnCont = document.createElement('div');
        galleryBtnCont.style.flexShrink = '0';
        galleryBtnCont.style.marginBottom = '15px';

        const galleryBtn = document.createElement('button');
        galleryBtn.className = 'anomalous-nb-add-btn';
        galleryBtn.style.width = '100%';
        galleryBtn.style.display = 'flex';
        galleryBtn.style.justifyContent = 'center';
        galleryBtn.style.alignItems = 'center';
        galleryBtn.style.gap = '8px';
        galleryBtn.style.padding = '10px';
        galleryBtn.style.background = '#2a2b2f';
        galleryBtn.style.border = '1px solid #3c4043';
        galleryBtn.textContent = t('detailGeneratedGallery');
        galleryBtn.onmouseover = () => { galleryBtn.style.background = '#3c4043'; galleryBtn.style.borderColor = 'rgba(255, 255, 255, 0.3)'; };
        galleryBtn.onmouseout = () => { galleryBtn.style.background = '#2a2b2f'; galleryBtn.style.borderColor = '#3c4043'; };

        galleryBtn.onclick = () => {
            this.showGeneratedGallery(model);
        };
        galleryBtnCont.appendChild(galleryBtn);
        rightPanel.appendChild(galleryBtnCont);

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
            copyAll.style.background = '#444';
            copyAll.style.color = '#fff';
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
                tag.style.background = '#333';
                tag.style.padding = '2px 6px';
                tag.style.borderRadius = '4px';
                tag.style.fontSize = '0.85em';
                tag.style.cursor = 'pointer';
                tag.style.border = '1px solid #555';
                tag.title = t('clickToCopy') + w;
                tag.onclick = () => {
                    navigator.clipboard.writeText(w).then(() => {
                        tag.style.background = '#28a745';
                        setTimeout(() => { tag.style.background = '#333'; }, 500);
                    });
                };
                tagsCont.appendChild(tag);
            });
            twCont.appendChild(tagsCont);
            rightPanel.appendChild(twCont);
        }

        // 3. Description Section (Expands to fill remaining height)
        if (m.description) {
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
            descText.style.flex = 'none';

            descText.style.background = '#222';
            descText.style.padding = '10px';
            descText.style.borderRadius = '6px';
            descText.style.border = '1px solid #333';
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
            notesText.style.background = '#332b00';
            notesText.style.padding = '8px';
            notesText.style.borderRadius = '6px';
            notesText.style.marginTop = '5px';
            notesText.style.border = '1px solid #554400';
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
            compList.innerHTML = `<span style="color:#888;">${t('loadingCompatible') || 'Loading...'}</span>`;

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
                        noCompatible.style.color = '#888';
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
                            thumb = `<div style="width:30px; height:30px; background:#222; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#555;">?</div>`;
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

        splitContainer.appendChild(leftPanel);
        splitContainer.appendChild(resizer);
        splitContainer.appendChild(rightPanel);

        this.detailPanel.appendChild(header);
        this.detailPanel.appendChild(splitContainer);
    }
