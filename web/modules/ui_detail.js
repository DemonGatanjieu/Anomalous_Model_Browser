/**
 * ui_detail.js
 * Extracted Detail Panel methods.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';
import { escapeHtml, setSafeRichHtml } from './safe_dom.js';
import { isPhysicalRenameProtectedType } from './model_policies.js';

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
            backBtn.style.background = '#8AB4F8';
            backBtn.style.color = '#000';
        } else if (isFromAssistant) {
            backBtn.textContent = t('detailBackAssistant');
            backBtn.style.background = '#8AB4F8';
            backBtn.style.color = '#000';
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
            cBtn.style.background = '#1a73e8';
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
            notesEditBtn.innerHTML = '✏️';
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
        galleryBtn.onmouseover = () => { galleryBtn.style.background = '#3c4043'; galleryBtn.style.borderColor = '#8ab4f8'; };
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




export function showEditModal(model) {
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100vw';
        modal.style.height = '100vh';
        modal.style.background = 'rgba(0,0,0,0.6)';
        modal.style.backdropFilter = 'blur(4px)';
        modal.style.zIndex = '10000';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';

        const content = document.createElement('div');
        content.style.background = '#202124';
        content.style.padding = '24px';
        content.style.borderRadius = '12px';
        content.style.width = '720px';
        content.style.maxWidth = '90%';
        content.style.border = '1px solid #3c4043';
        content.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
        content.style.display = 'flex';
        content.style.flexDirection = 'row';
        content.style.gap = '24px';
        content.style.fontFamily = 'Inter, Roboto, sans-serif';

        // --- LEFT COLUMN ---
        const leftCol = document.createElement('div');
        leftCol.style.width = '240px';
        leftCol.style.flexShrink = '0';
        leftCol.style.display = 'flex';
        leftCol.style.flexDirection = 'column';
        leftCol.style.gap = '12px';

        const previewContainer = document.createElement('div');
        previewContainer.style.width = '100%';
        previewContainer.style.height = '320px';
        previewContainer.style.background = '#303134';
        previewContainer.style.borderRadius = '8px';
        previewContainer.style.display = 'flex';
        previewContainer.style.alignItems = 'center';
        previewContainer.style.justifyContent = 'center';
        previewContainer.style.overflow = 'hidden';
        previewContainer.style.border = '1px solid #3c4043';
        previewContainer.style.position = 'relative';

        if (model.preview_url) {
            const isVideo = model.preview_url.match(/\.mp4(?:&|$)/i) || model.preview_url.match(/\.webm(?:&|$)/i);
            if (isVideo) {
                const video = document.createElement('video');
                video.src = model.preview_url;
                video.controls = false;
                video.autoplay = true;
                video.loop = true;
                video.muted = true;
                video.style.width = '100%';
                video.style.height = '100%';
                video.style.objectFit = 'cover';

                const muteBtn = document.createElement('div');
                muteBtn.innerHTML = '🔇';
                muteBtn.style.position = 'absolute';
                muteBtn.style.bottom = '8px';
                muteBtn.style.right = '8px';
                muteBtn.style.background = 'rgba(0,0,0,0.6)';
                muteBtn.style.color = '#fff';
                muteBtn.style.padding = '6px';
                muteBtn.style.borderRadius = '50%';
                muteBtn.style.cursor = 'pointer';
                muteBtn.style.fontSize = '14px';
                muteBtn.style.zIndex = '10';
                muteBtn.title = t('detailToggleSound');
                muteBtn.onclick = (e) => {
                    e.stopPropagation();
                    video.muted = !video.muted;
                    muteBtn.innerHTML = video.muted ? '🔇' : '🔊';
                };

                previewContainer.appendChild(video);
                previewContainer.appendChild(muteBtn);
            } else {
                const img = document.createElement('img');
                img.src = model.preview_url;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                previewContainer.appendChild(img);
            }
        } else {
            const noCover = document.createElement('div');
            noCover.style.color = '#9aa0a6';
            noCover.style.fontSize = '0.9em';
            noCover.style.textAlign = 'center';
            noCover.textContent = t('detailNoCover');
            previewContainer.appendChild(noCover);
        }

        const coverRow = document.createElement('div');
        coverRow.style.display = 'flex';
        coverRow.style.flexDirection = 'column';
        coverRow.style.gap = '8px';

        const galleryBtn = document.createElement('button');
        galleryBtn.textContent = `🖼️ ${t('detailPickGallery')}`;
        galleryBtn.style.padding = '8px';
        galleryBtn.style.background = '#303134';
        galleryBtn.style.color = '#8ab4f8';
        galleryBtn.style.border = '1px solid #5f6368';
        galleryBtn.style.borderRadius = '6px';
        galleryBtn.style.cursor = 'pointer';
        galleryBtn.style.fontWeight = '500';
        galleryBtn.style.fontSize = '0.9em';
        galleryBtn.onmouseover = () => galleryBtn.style.background = '#3c4043';
        galleryBtn.onmouseout = () => galleryBtn.style.background = '#303134';
        galleryBtn.onclick = () => {
            document.body.removeChild(modal);
            this.showGallerySelectMode(model);
        };

        const localBtn = document.createElement('button');
        localBtn.textContent = `📁 ${t('detailUploadLocal')}`;
        localBtn.style.padding = '8px';
        localBtn.style.background = '#303134';
        localBtn.style.color = '#8ab4f8';
        localBtn.style.border = '1px solid #5f6368';
        localBtn.style.borderRadius = '6px';
        localBtn.style.cursor = 'pointer';
        localBtn.style.fontWeight = '500';
        localBtn.style.fontSize = '0.9em';
        localBtn.onmouseover = () => localBtn.style.background = '#3c4043';
        localBtn.onmouseout = () => localBtn.style.background = '#303134';
        localBtn.onclick = () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.onchange = async (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    const file = e.target.files[0];
                    const formData = new FormData();
                    formData.append('type', this.currentType);
                    formData.append('path_idx', this.currentPathIdx);
                    formData.append('subfolder', this.currentSubfolder);
                    formData.append('filename', model.filename);
                    formData.append('image', file);
                    try {
                        const res = await fetch('/anomalous/upload_custom_cover', { method: 'POST', body: formData });
                        const data = await res.json();
                        if (data.status === 'success') {
                            await this.loadModels();
                            const updatedModel = this.models.find(m => m.filename === model.filename);
                            if (this.currentDetailModel && this.currentDetailModel.filename === model.filename) {
                                if (updatedModel) this.showDetail(updatedModel);
                            }
                            document.body.removeChild(modal);
                        } else {
                            alert(t('detailUploadError') + data.message);
                        }
                    } catch (err) {
                        alert(t('detailUploadFailed') + err);
                    }
                }
            };
            fileInput.click();
        };

        coverRow.appendChild(galleryBtn);
        coverRow.appendChild(localBtn);

        leftCol.appendChild(previewContainer);
        leftCol.appendChild(coverRow);

        // --- RIGHT COLUMN ---
        const rightCol = document.createElement('div');
        rightCol.style.flex = '1';
        rightCol.style.display = 'flex';
        rightCol.style.flexDirection = 'column';
        rightCol.style.gap = '15px';

        const title = document.createElement('h2');
        title.textContent = t('detailModelInfo');
        title.style.margin = '0';
        title.style.color = '#e8eaed';
        title.style.fontSize = '1.25em';
        title.style.fontWeight = '500';

        const filenameLabel = document.createElement('div');
        const filenamePrefix = document.createElement('span');
        filenamePrefix.style.color = '#9aa0a6';
        filenamePrefix.textContent = t('detailFile');
        filenameLabel.append(filenamePrefix, document.createTextNode(` ${model.filename}`));
        filenameLabel.style.color = '#e8eaed';
        filenameLabel.style.fontSize = '0.9em';
        filenameLabel.style.wordBreak = 'break-all';

        const inputStyle = `
            width: 100%;
            padding: 12px 14px;
            background: #303134;
            color: #e8eaed;
            border: 1px solid #5f6368;
            border-radius: 6px;
            box-sizing: border-box;
            outline: none;
            font-size: 14px;
            transition: border 0.2s;
        `;

        const nameInput = document.createElement('input');
        nameInput.placeholder = t('detailCustomNamePlaceholder');
        nameInput.value = (model.metadata && model.metadata.custom_name) ? model.metadata.custom_name : '';
        nameInput.style.cssText = inputStyle;
        nameInput.onfocus = () => nameInput.style.borderColor = '#8ab4f8';
        nameInput.onblur = () => nameInput.style.borderColor = '#5f6368';

        const notesInput = document.createElement('textarea');
        notesInput.placeholder = t('detailNotesPlaceholder');
        notesInput.value = (model.metadata && model.metadata.custom_notes) ? model.metadata.custom_notes : '';
        notesInput.style.cssText = inputStyle;
        notesInput.style.flex = '1'; // fill remaining space
        notesInput.style.minHeight = '150px';
        notesInput.style.resize = 'vertical';
        // Notebook styling override
        notesInput.style.background = 'linear-gradient(135deg, #262522 0%, #202124 100%)';
        notesInput.style.backgroundImage = 'repeating-linear-gradient(transparent, transparent 23px, rgba(163, 141, 83, 0.04) 23px, rgba(163, 141, 83, 0.04) 24px)';
        notesInput.style.backgroundAttachment = 'local';
        notesInput.style.border = '1px solid #3c4043';
        notesInput.style.borderLeft = '4px solid #a38d53';
        notesInput.style.borderRadius = '4px 8px 8px 4px';
        notesInput.style.color = '#d1c9b4';
        notesInput.style.fontFamily = '"Consolas", "Courier New", monospace';
        notesInput.style.lineHeight = '24px';
        // Removed text shadow for cleaner look

        notesInput.onfocus = () => {
            notesInput.style.boxShadow = '0 0 0 2px rgba(163, 141, 83, 0.2)';
            notesInput.style.borderColor = '#a38d53';
        };
        notesInput.onblur = () => {
            notesInput.style.boxShadow = 'none';
            notesInput.style.borderColor = '#3c4043';
        };

        const physicalRow = document.createElement('div');
        physicalRow.style.display = 'flex';
        physicalRow.style.flexDirection = 'column';
        physicalRow.style.gap = '4px';

        const physicalCheckboxWrapper = document.createElement('div');
        physicalCheckboxWrapper.style.display = 'flex';
        physicalCheckboxWrapper.style.alignItems = 'center';
        physicalCheckboxWrapper.style.gap = '8px';

        const physicalCheckbox = document.createElement('input');
        physicalCheckbox.type = 'checkbox';
        physicalCheckbox.id = 'anomalous-physical-rename-checkbox';
        physicalCheckbox.style.cursor = 'pointer';
        const physicalRenameProtected = isPhysicalRenameProtectedType(this.currentType);
        physicalCheckbox.disabled = physicalRenameProtected;
        physicalCheckbox.style.cursor = physicalRenameProtected ? 'not-allowed' : 'pointer';

        const physicalLabel = document.createElement('label');
        physicalLabel.htmlFor = 'anomalous-physical-rename-checkbox';
        physicalLabel.textContent = t('detailPhysicalRename');
        physicalLabel.style.color = '#e8eaed';
        physicalLabel.style.fontSize = '0.9em';
        physicalLabel.style.cursor = physicalRenameProtected ? 'not-allowed' : 'pointer';
        physicalLabel.style.opacity = physicalRenameProtected ? '0.6' : '1';

        physicalCheckboxWrapper.appendChild(physicalCheckbox);
        physicalCheckboxWrapper.appendChild(physicalLabel);

        const physicalDesc = document.createElement('div');
        physicalDesc.style.fontSize = '0.8em';
        physicalDesc.style.color = '#9aa0a6';
        physicalDesc.style.marginLeft = '22px';
        physicalDesc.textContent = t(physicalRenameProtected
            ? 'detailPhysicalRenameProtectedDesc'
            : 'detailPhysicalRenameDesc');

        physicalRow.appendChild(physicalCheckboxWrapper);
        physicalRow.appendChild(physicalDesc);

        const actionRow = document.createElement('div');
        actionRow.style.display = 'flex';
        actionRow.style.justifyContent = 'space-between';
        actionRow.style.marginTop = 'auto';

        const leftActions = document.createElement('div');
        leftActions.style.display = 'flex';
        leftActions.style.gap = '10px';

        const resetBtn = document.createElement('button');
        resetBtn.textContent = t('detailResetAll');
        resetBtn.style.padding = '8px 16px';
        resetBtn.style.background = 'transparent';
        resetBtn.style.color = '#f28b82';
        resetBtn.style.border = '1px solid #f28b82';
        resetBtn.style.borderRadius = '4px';
        resetBtn.style.cursor = 'pointer';
        resetBtn.style.fontWeight = '500';
        resetBtn.onclick = async () => {
            if (!confirm(t('detailResetConfirm'))) return;
            document.body.removeChild(modal);
            try {
                const res = await fetch('/anomalous/update_metadata', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: this.currentType,
                        path_idx: this.currentPathIdx,
                        subfolder: this.currentSubfolder,
                        filename: model.filename,
                        custom_name: '',
                        custom_notes: '',
                        reset_cover: true,
                        physical_rename: false
                    })
                });
                const result = await res.json();
                if (res.ok && result.status === 'success') {
                    await this.loadModels();
                    const updatedModel = this.models.find(m => m.filename === model.filename);
                    if (this.currentDetailModel && this.currentDetailModel.filename === model.filename) {
                        if (updatedModel) {
                            this.showDetail(updatedModel);
                        } else {
                            this.grid.style.display = 'grid';
                            this.detailPanel.style.display = 'none';
                        }
                    }
                    if (result.cover_reset === false) {
                        const noSource = result.cover_reset_source === 'preserved_current';
                        alert(t(noSource ? 'detailResetCoverPreserved' : 'detailResetCoverFailed'));
                    }
                } else {
                    alert(result.message || t('detailResetFailed'));
                }
            } catch (e) { console.error(e); }
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = t('detailCancel');
        cancelBtn.style.padding = '8px 16px';
        cancelBtn.style.background = 'transparent';
        cancelBtn.style.color = '#8ab4f8';
        cancelBtn.style.border = 'none';
        cancelBtn.style.borderRadius = '4px';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.fontWeight = '500';
        cancelBtn.onclick = () => document.body.removeChild(modal);

        leftActions.appendChild(resetBtn);
        leftActions.appendChild(cancelBtn);

        const saveBtn = document.createElement('button');
        saveBtn.textContent = t('detailSaveChanges');
        saveBtn.style.padding = '8px 24px';
        saveBtn.style.background = '#8ab4f8';
        saveBtn.style.color = '#202124';
        saveBtn.style.border = 'none';
        saveBtn.style.borderRadius = '4px';
        saveBtn.style.cursor = 'pointer';
        saveBtn.style.fontWeight = '600';
        saveBtn.onclick = () => {
            const newName = nameInput.value.trim();
            const newNotes = notesInput.value.trim();
            saveBtn.textContent = t('detailSaving');
            saveBtn.disabled = true;

            fetch('/anomalous/update_metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: this.currentType,
                    path_idx: this.currentPathIdx,
                    subfolder: this.currentSubfolder,
                    filename: model.filename,
                    custom_name: newName,
                    custom_notes: newNotes,
                    physical_rename: physicalCheckbox.checked
                })
            }).then(res => res.json()).then(data => {
                document.body.removeChild(modal);
                if (data.status === 'success') {
                    if (!model.metadata) model.metadata = {};
                    model.metadata.custom_name = newName;
                    model.metadata.custom_notes = newNotes;
                    if (data.new_filename && physicalCheckbox.checked) {
                        model.filename = data.new_filename;
                    }
                    this.loadModels();
                    if (this.currentDetailModel && (this.currentDetailModel.filename === model.filename || (data.new_filename && this.currentDetailModel.filename === data.new_filename))) {
                        this.showDetail(model);
                    }
                } else {
                    alert(t('detailUploadError') + data.message);
                }
            }).catch(e => {
                document.body.removeChild(modal);
                alert(t('detailUploadError') + e);
            });
        };

        actionRow.appendChild(leftActions);
        actionRow.appendChild(saveBtn);

        rightCol.appendChild(title);
        rightCol.appendChild(filenameLabel);
        rightCol.appendChild(nameInput);
        rightCol.appendChild(notesInput);
        rightCol.appendChild(physicalRow);
        rightCol.appendChild(actionRow);

        content.appendChild(leftCol);
        content.appendChild(rightCol);
        modal.appendChild(content);
        document.body.appendChild(modal);
    }



export function _openAdvancedModelSelector(initialSelectedMap, onConfirm) {
        let localSelection = new Map();
        for (const [k, v] of initialSelectedMap.entries()) {
            localSelection.set(k, new Set(v));
        }

        const getFolderSelectionCount = (folderKey) => {
            let nKey = folderKey;
            const parts = folderKey.split('|');
            if (parts.length >= 3 && parts[2].startsWith('/')) {
                parts[2] = parts[2].substring(1);
                nKey = parts.join('|');
            }
            return localSelection.has(nKey) ? localSelection.get(nKey).size : 0;
        };

        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100vw';
        modal.style.height = '100vh';
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        modal.style.zIndex = '9999999';
        modal.style.display = 'flex';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';
        modal.style.fontFamily = 'Roboto, Inter, sans-serif';

        const contentDiv = document.createElement('div');
        contentDiv.style.background = '#202124';
        contentDiv.style.borderRadius = '8px';
        contentDiv.style.width = '92vw';
        contentDiv.style.height = '88vh';
        contentDiv.style.display = 'flex';
        contentDiv.style.flexDirection = 'column';
        contentDiv.style.boxShadow = '0 24px 38px 3px rgba(0,0,0,0.4), 0 9px 46px 8px rgba(0,0,0,0.3), 0 11px 15px -7px rgba(0,0,0,0.5)';
        contentDiv.style.overflow = 'hidden';

        // Header
        const header = document.createElement('div');
        header.style.padding = '16px 24px';
        header.style.borderBottom = '1px solid #3c4043';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        
        const titleContainer = document.createElement('div');
        titleContainer.style.display = 'flex';
        titleContainer.style.alignItems = 'center';
        titleContainer.style.gap = '12px';

        const title = document.createElement('h2');
        title.textContent = t('detailSelectModels');
        title.style.margin = '0';
        title.style.color = '#e8eaed';
        title.style.fontSize = '20px';
        title.style.fontWeight = '500';
        
        titleContainer.appendChild(title);
        
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        closeBtn.style.background = 'transparent';
        closeBtn.style.color = '#9aa0a6';
        closeBtn.style.border = 'none';
        closeBtn.style.fontSize = '18px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => document.body.removeChild(modal);
        
        header.appendChild(titleContainer);
        header.appendChild(closeBtn);
        contentDiv.appendChild(header);

        // Body area
        const body = document.createElement('div');
        body.style.display = 'flex';
        body.style.flex = '1';
        body.style.overflow = 'hidden';
        
        // Left Panel
        const leftPanel = document.createElement('div');
        leftPanel.style.width = '280px';
        leftPanel.style.borderRight = '1px solid #3c4043';
        leftPanel.style.display = 'flex';
        leftPanel.style.flexDirection = 'column';
        leftPanel.style.background = '#171717';
        
        const leftTitle = document.createElement('div');
        leftTitle.textContent = t('detailFolders');
        leftTitle.style.padding = '16px 24px';
        leftTitle.style.fontWeight = '500';
        leftTitle.style.color = '#9aa0a6';
        leftTitle.style.fontSize = '14px';
        leftTitle.style.letterSpacing = '0.5px';
        leftPanel.appendChild(leftTitle);

        const treeContainer = document.createElement('div');
        treeContainer.style.flex = '1';
        treeContainer.style.overflowY = 'auto';
        treeContainer.style.padding = '0 12px 12px 12px';
        leftPanel.appendChild(treeContainer);
        
        // Right Panel
        const rightPanel = document.createElement('div');
        rightPanel.style.flex = '1';
        rightPanel.style.display = 'flex';
        rightPanel.style.flexDirection = 'column';
        rightPanel.style.background = '#202124';
        
        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.style.padding = '12px 24px';
        toolbar.style.borderBottom = '1px solid #3c4043';
        toolbar.style.display = 'flex';
        toolbar.style.gap = '12px';
        toolbar.style.alignItems = 'center';
        toolbar.style.flexWrap = 'wrap';
        
        const createTBtn = (text, onClick, primary = false) => {
            const b = document.createElement('button');
            b.innerText = text;
            b.style.padding = '6px 16px';
            b.style.background = primary ? 'rgba(138,180,248,0.15)' : 'rgba(255,255,255,0.04)';
            b.style.color = primary ? '#8ab4f8' : '#e8eaed';
            b.style.border = primary ? '1px solid rgba(138,180,248,0.2)' : '1px solid #5f6368';
            b.style.borderRadius = '4px';
            b.style.cursor = 'pointer';
            b.style.fontSize = '14px';
            b.style.fontWeight = '500';
            b.style.transition = 'background-color 0.15s, box-shadow 0.15s';
            b.onmouseover = () => {
                b.style.background = primary ? 'rgba(138,180,248,0.25)' : 'rgba(255,255,255,0.1)';
            };
            b.onmouseout = () => {
                b.style.background = primary ? 'rgba(138,180,248,0.15)' : 'rgba(255,255,255,0.04)';
            };
            b.onclick = onClick;
            return b;
        };
        
        let currentModels = [];
        let currentTotal = 0;
        let currentFolderKey = 'ALL'; 
        let currentBaseUrl = '';
        let currentPage = 1;
        let isLoading = false;
        
        const updateSummaryAndBadges = () => {
            let total = 0;
            for (const set of localSelection.values()) total += set.size;
            
            if (total > 0) {
                const countLabel = document.createElement('span');
                countLabel.textContent = total;
                countLabel.style.color = '#8ab4f8';
                countLabel.style.fontSize = '16px';
                countLabel.style.fontWeight = '500';
                summaryText.replaceChildren(
                    document.createTextNode(t('detailSelectedItemsPrefix')),
                    countLabel,
                    document.createTextNode(t('detailSelectedItemsSuffix')),
                );
            } else {
                summaryText.textContent = t('detailNothingSelected');
            }
            
            treeContainer.querySelectorAll('.folder-item').forEach(fBtn => {
                const fKey = fBtn.dataset.folderKey;
                const count = getFolderSelectionCount(fKey);
                const badge = fBtn.querySelector('.selection-badge');
                if (badge) {
                    if (count > 0) {
                        badge.innerText = count;
                        badge.style.display = 'inline-flex';
                    } else {
                        badge.style.display = 'none';
                    }
                }
            });
            
            // Also update total models text in grid
            const statusDiv = grid.querySelector('.status-text');
            if (statusDiv && !isLoading) {
                statusDiv.textContent = t('detailLoadedModels', { loaded: currentModels.length, total: currentTotal });
            }
        };

        const updateGridCheckboxes = () => {
            grid.querySelectorAll('.model-card').forEach(card => {
                const filename = card.dataset.filename;
                const mType = card.dataset.mtype;
                const mPathIdx = card.dataset.mpathidx;
                const mSubfolder = card.dataset.msubfolder;
                
                const fKey = `${mType}|${mPathIdx}|${mSubfolder}`;
                const set = localSelection.get(fKey) || new Set();
                const isChecked = set.has(filename);
                
                const cbWrapper = card.querySelector('.cb-wrapper');
                const cb = card.querySelector('input[type="checkbox"]');
                cb.checked = isChecked;
                
                if (isChecked) {

                
                    card.style.border = '2px solid #8ab4f8';

                
                    card.style.background = 'rgba(138,180,248,0.2)';

                
                    cbWrapper.style.background = '#8ab4f8';

                
                    cbWrapper.style.border = '2px solid #8ab4f8';

                
                    cbWrapper.querySelector('span').style.color = '#202124';

                
                } else {

                
                    card.style.border = '1px solid #3c4043';

                
                    card.style.background = '#303134';

                
                    cbWrapper.style.background = 'rgba(0,0,0,0.3)';

                
                    cbWrapper.style.border = '2px solid #5f6368';

                
                    cbWrapper.querySelector('span').style.color = 'transparent';

                
                }
            });
            updateSummaryAndBadges();
        };

        const handleBatchSelect = async (action) => {
            if (action === 'none') {
                if (currentFolderKey === 'ALL') {
                    localSelection.clear();
                } else {
                    let nCurKey = currentFolderKey;
                    const cParts = currentFolderKey.split('|');
                    if (cParts.length >= 3 && cParts[2].startsWith('/')) {
                        cParts[2] = cParts[2].substring(1);
                        nCurKey = cParts.join('|');
                    }
                    localSelection.delete(nCurKey);
                }
                updateGridCheckboxes();
                return;
            }
            
            summaryText.textContent = t('detailComputing');
            try {
                const res = await fetch(`/anomalous/batch_select?folderKey=${encodeURIComponent(currentFolderKey)}&action=${action}`);
                if (!res.ok) throw new Error('API failed');
                const data = await res.json();
                
                for (const [fKey, files] of Object.entries(data.selected)) {
                    let normalizedKey = fKey;
                    const parts = fKey.split('|');
                    if (parts.length >= 3 && parts[2].startsWith('/')) {
                        parts[2] = parts[2].substring(1);
                        normalizedKey = parts.join('|');
                    }
                    const set = localSelection.get(normalizedKey) || new Set();
                    files.forEach(f => set.add(f));
                    localSelection.set(normalizedKey, set);
                }
                updateGridCheckboxes();
            } catch (e) {
                console.error(e);
                summaryText.textContent = t('detailUploadError') + e.message;
                setTimeout(() => updateGridCheckboxes(), 2000);
            }
        };

        toolbar.appendChild(createTBtn(t('detailSelectNoPreview'), () => handleBatchSelect('no_preview'), true));
        toolbar.appendChild(createTBtn(t('detailSelectNoDesc'), () => handleBatchSelect('no_desc'), true));
        
        const divi = document.createElement('div');
        divi.style.width = '1px'; divi.style.height = '24px'; divi.style.background = '#3c4043'; divi.style.margin = '0 8px';
        toolbar.appendChild(divi);

        toolbar.appendChild(createTBtn(t('detailSelectAll'), () => handleBatchSelect('all')));
        toolbar.appendChild(createTBtn(t('detailClear'), () => handleBatchSelect('none')));

        const summaryText = document.createElement('div');
        summaryText.style.marginLeft = 'auto';
        summaryText.style.color = '#9aa0a6';
        summaryText.style.fontWeight = '400';
        toolbar.appendChild(summaryText);
        
        rightPanel.appendChild(toolbar);

        const grid = document.createElement('div');
        grid.style.flex = '1';
        grid.style.overflowY = 'auto';
        grid.style.padding = '24px';
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(180px, 1fr))';
        grid.style.gridAutoRows = 'max-content';
        grid.style.gap = '20px';
        grid.style.alignContent = 'start';
        grid.style.background = '#171717';
        rightPanel.appendChild(grid);

        body.appendChild(leftPanel);
        body.appendChild(rightPanel);
        contentDiv.appendChild(body);
        
        // Footer (Confirm)
        const footer = document.createElement('div');
        footer.style.padding = '12px 24px';
        footer.style.borderTop = '1px solid #3c4043';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '12px';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = t('detailCancel');
        cancelBtn.style.padding = '8px 24px';
        cancelBtn.style.background = 'transparent';
        cancelBtn.style.color = '#8ab4f8';
        cancelBtn.style.border = 'none';
        cancelBtn.style.borderRadius = '4px';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.fontWeight = '500';
        cancelBtn.style.fontSize = '14px';
        cancelBtn.onmouseover = () => cancelBtn.style.background = 'rgba(138,180,248,0.1)';
        cancelBtn.onmouseout = () => cancelBtn.style.background = 'transparent';
        cancelBtn.onclick = () => document.body.removeChild(modal);

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = t('detailConfirm');
        confirmBtn.style.padding = '8px 24px';
        confirmBtn.style.background = '#8ab4f8';
        confirmBtn.style.color = '#202124'; // dark text on bright accent button
        confirmBtn.style.border = 'none';
        confirmBtn.style.borderRadius = '4px';
        confirmBtn.style.cursor = 'pointer';
        confirmBtn.style.fontWeight = '600';
        confirmBtn.style.fontSize = '14px';
        confirmBtn.style.boxShadow = '0 1px 2px 0 rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15)';
        confirmBtn.onmouseover = () => { confirmBtn.style.background = '#aecbfa'; confirmBtn.style.boxShadow = '0 1px 3px 0 rgba(0,0,0,.3), 0 4px 8px 3px rgba(0,0,0,.15)'; };
        confirmBtn.onmouseout = () => { confirmBtn.style.background = '#8ab4f8'; confirmBtn.style.boxShadow = '0 1px 2px 0 rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15)'; };
        confirmBtn.onclick = () => {
            onConfirm(localSelection);
            document.body.removeChild(modal);
        };
        
        footer.appendChild(cancelBtn);
        footer.appendChild(confirmBtn);
        contentDiv.appendChild(footer);

        modal.appendChild(contentDiv);
        document.body.appendChild(modal);
        
        // Infinite Scroll Logic
        const renderCards = (modelsToRender) => {
            const frag = document.createDocumentFragment();
            modelsToRender.forEach(m => {
                const card = document.createElement('div');
                card.className = 'model-card';
                card.dataset.filename = m.filename;
                card.dataset.mtype = m.type;
                card.dataset.mpathidx = m.path_idx;
                card.dataset.msubfolder = m.subfolder;
                
                card.style.background = '#303134';
                card.style.borderRadius = '8px';
                card.style.overflow = 'hidden';
                card.style.position = 'relative';
                card.style.border = '1px solid #3c4043';
                card.style.display = 'flex';
                card.style.flexDirection = 'column';
                card.style.aspectRatio = '2 / 3';
                card.style.height = 'auto';
                card.style.cursor = 'pointer';
                card.style.boxShadow = '0 1px 2px 0 rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15)';
                
                const imgContainer = document.createElement('div');
                imgContainer.style.flex = '1';
                imgContainer.style.background = '#202124';
                imgContainer.style.display = 'flex';
                imgContainer.style.justifyContent = 'center';
                imgContainer.style.alignItems = 'center';
                imgContainer.style.overflow = 'hidden';
                
                if (m.preview_url) {

                
                    const isVid = m.preview_url.match(/\.(mp4|webm|mov|avi)(?:&|$)/i);

                
                    if (isVid) {

                
                        const video = document.createElement('video');

                
                        video.src = m.preview_url;

                
                        video.style.width = '100%';

                
                        video.style.height = '100%';

                
                        video.style.objectFit = 'cover';

                
                        video.muted = true;

                
                        video.loop = true;

                
                        video.playsInline = true;

                
                        card.addEventListener('mouseenter', () => video.play().catch(e => {}));

                
                        card.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });

                
                        imgContainer.appendChild(video);

                
                    } else {

                
                        const img = document.createElement('img');

                
                        img.src = m.preview_url;

                
                        img.style.width = '100%';

                
                        img.style.height = '100%';

                
                        img.style.objectFit = 'cover';

                
                        imgContainer.appendChild(img);

                
                    }

                
                } else {
                    imgContainer.innerHTML = '<span style="font-size:40px;opacity:0.2;">📄</span>';
                }
                card.appendChild(imgContainer);
                
                const nameBar = document.createElement('div');
                nameBar.style.padding = '12px';
                nameBar.style.background = '#303134';
                nameBar.style.fontSize = '13px';
                nameBar.style.color = '#e8eaed';
                nameBar.style.whiteSpace = 'nowrap';
                nameBar.style.overflow = 'hidden';
                nameBar.style.textOverflow = 'ellipsis';
                nameBar.style.borderTop = '1px solid #3c4043';
                nameBar.innerText = m.filename;
                card.appendChild(nameBar);
                
                const cbWrapper = document.createElement('div');
                cbWrapper.className = 'cb-wrapper';
                cbWrapper.style.position = 'absolute';
                cbWrapper.style.top = '8px';
                cbWrapper.style.right = '8px';
                cbWrapper.style.width = '20px';
                cbWrapper.style.height = '20px';
                cbWrapper.style.borderRadius = '50%';
                cbWrapper.style.background = 'rgba(0,0,0,0.3)';
                cbWrapper.style.border = '2px solid #5f6368';
                cbWrapper.style.display = 'flex';
                cbWrapper.style.justifyContent = 'center';
                cbWrapper.style.alignItems = 'center';
                cbWrapper.style.pointerEvents = 'none'; 
                
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.style.display = 'none'; 
                
                const checkIcon = document.createElement('span');
                checkIcon.innerHTML = '✓';
                checkIcon.style.color = 'transparent';
                checkIcon.style.fontSize = '12px';
                checkIcon.style.fontWeight = 'bold';
                cbWrapper.appendChild(checkIcon);
                cbWrapper.appendChild(cb);
                card.appendChild(cbWrapper);
                
                card.onclick = () => {
                    const mKey = `${m.type}|${m.path_idx}|${m.subfolder}`;
                    const cset = localSelection.get(mKey) || new Set();
                    if (!cset.has(m.filename)) {
                        cset.add(m.filename);
                    } else {
                        cset.delete(m.filename);
                    }
                    localSelection.set(mKey, cset);
                    updateGridCheckboxes();
                };
                
                frag.appendChild(card);
            });
            return frag;
        };
        
        const fetchModelsPage = async (isLoadMore = false) => {
            if (isLoading) return;
            isLoading = true;
            
            const prevStatus = grid.querySelector('.status-text');
            if (prevStatus) grid.removeChild(prevStatus);
            
            const loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'status-text';
            loadingIndicator.style.gridColumn = '1 / -1';
            loadingIndicator.style.padding = '40px';
            loadingIndicator.style.textAlign = 'center';
            loadingIndicator.style.color = '#9aa0a6';
            loadingIndicator.style.fontSize = '16px';
            loadingIndicator.textContent = t('detailLoading');
            grid.appendChild(loadingIndicator);
            
            try {
                const sep = currentBaseUrl.includes('?') ? '&' : '?';
                const url = `${currentBaseUrl}${sep}page=${currentPage}&limit=50`;
                const res = await fetch(url);
                if (!res.ok) {
                     const apiError = document.createElement('div');
                     apiError.className = 'status-text';
                     apiError.style.gridColumn = '1 / -1';
                     apiError.style.padding = '60px';
                     apiError.style.textAlign = 'center';
                     apiError.style.color = '#f28b82';
                     apiError.style.fontSize = '16px';
                     apiError.style.whiteSpace = 'pre-line';
                     apiError.textContent = t('detailApiRestart');
                     grid.replaceChildren(apiError);
                     isLoading = false;
                     return;
                }
                const data = await res.json();
                
                const fetchedModels = data.models || [];
                currentTotal = data.total || 0;
                
                if (isLoadMore) {
                    currentModels = currentModels.concat(fetchedModels);
                } else {
                    currentModels = fetchedModels;
                    // Keep the loading indicator temporarily, we clear grid except it
                    Array.from(grid.children).forEach(c => {
                        if (c !== loadingIndicator) grid.removeChild(c);
                    });
                }
                
                grid.removeChild(loadingIndicator);
                
                if (currentModels.length === 0 && !isLoadMore) {
                     const emptyModels = document.createElement('div');
                     emptyModels.className = 'status-text';
                     emptyModels.style.gridColumn = '1 / -1';
                     emptyModels.style.padding = '60px';
                     emptyModels.style.textAlign = 'center';
                     emptyModels.style.color = '#9aa0a6';
                     emptyModels.style.fontSize = '16px';
                     emptyModels.textContent = t('detailNoModels');
                     grid.replaceChildren(emptyModels);
                } else {
                     grid.appendChild(renderCards(fetchedModels));
                     updateGridCheckboxes();
                     
                     // Show status at bottom
                     const statusText = document.createElement('div');
                     statusText.className = 'status-text';
                     statusText.style.gridColumn = '1 / -1';
                     statusText.style.padding = '20px';
                     statusText.style.textAlign = 'center';
                     statusText.style.color = '#5f6368';
                     statusText.style.fontSize = '14px';
                     if (currentModels.length >= currentTotal) {
                         statusText.textContent = t('detailAllLoaded');
                     } else {
                         statusText.textContent = t('detailScrollMore');
                     }
                     grid.appendChild(statusText);
                }
            } catch (e) {
                console.error(e);
                grid.removeChild(loadingIndicator);
            }
            
            isLoading = false;
        };

        grid.onscroll = () => {
            if (isLoading || currentModels.length >= currentTotal) return;
            // Near bottom detection
            if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 150) {
                currentPage++;
                fetchModelsPage(true);
            }
        };

        // Render Folders
        const renderFolders = async () => {
            treeContainer.innerHTML = '';
            
            const allBtn = document.createElement('div');
            allBtn.className = 'folder-item';
            allBtn.dataset.folderKey = 'ALL';
            allBtn.style.padding = '10px 16px';
            allBtn.style.cursor = 'pointer';
            allBtn.style.color = '#e8eaed';
            allBtn.style.fontSize = '14px';
            allBtn.style.fontWeight = '500';
            allBtn.style.borderRadius = '0 16px 16px 0';
            allBtn.style.marginBottom = '8px';
            allBtn.style.display = 'flex';
            allBtn.style.justifyContent = 'space-between';
            allBtn.style.alignItems = 'center';
            allBtn.textContent = `🌟 ${t('models')}`;
            
            let loadFolder = async (fBtn, folderKey, fetchUrl) => {
                treeContainer.querySelectorAll('.folder-item').forEach(d => {
                    d.style.background = 'transparent';
                    d.style.color = '#9aa0a6';
                    d.style.fontWeight = '400';
                });
                fBtn.style.background = 'rgba(138,180,248,0.15)';
                fBtn.style.color = '#8ab4f8';
                fBtn.style.fontWeight = '500';
                
                currentFolderKey = folderKey;
                currentBaseUrl = fetchUrl;
                currentPage = 1;
                currentModels = [];
                currentTotal = 0;
                grid.innerHTML = '';
                
                await fetchModelsPage(false);
            };
            
            allBtn.onclick = () => loadFolder(allBtn, 'ALL', '/anomalous/all_scan_models');
            treeContainer.appendChild(allBtn);

            if (!this.foldersData) {
                const res = await fetch('/anomalous/folders');
                const data = await res.json();
                this.foldersData = data.folders || [];
            }
            this.foldersData.forEach(tData => {
                const typeItem = document.createElement('div');
                typeItem.style.marginBottom = '4px';
                
                const tTitle = document.createElement('div');
                tTitle.innerText = tData.label;
                tTitle.style.color = '#9aa0a6';
                tTitle.style.fontWeight = '500';
                tTitle.style.padding = '8px 16px';
                tTitle.style.fontSize = '12px';
                tTitle.style.marginTop = '8px';
                typeItem.appendChild(tTitle);
                
                for (const [path, fData] of Object.entries(tData.folders)) {
                    if (fData.model_count === 0 && !fData.has_models) continue;
                    
                    const folderKey = `${tData.type}|${tData.path_idx}|${path}`;
                    const fBtn = document.createElement('div');
                    fBtn.className = 'folder-item';
                    fBtn.dataset.folderKey = folderKey;
                    
                    const depth = path.split('/').length - 1;
                    fBtn.style.padding = `8px 16px 8px ${16 + depth * 16}px`;
                    fBtn.style.cursor = 'pointer';
                    fBtn.style.color = '#9aa0a6';
                    fBtn.style.fontSize = '14px';
                    fBtn.style.borderRadius = '0 16px 16px 0';
                    fBtn.style.display = 'flex';
                    fBtn.style.justifyContent = 'space-between';
                    fBtn.style.alignItems = 'center';
                    
                    const leftPart = document.createElement('div');
                    leftPart.style.display = 'flex';
                    leftPart.style.alignItems = 'center';
                    leftPart.style.gap = '8px';
                    leftPart.innerHTML = `<span style="color:#9aa0a6">📁</span> <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;">${escapeHtml(fData.name)}</span> <span style="color:#5f6368;font-size:12px">(${escapeHtml(fData.model_count)})</span>`;
                    
                    const badge = document.createElement('div');
                    badge.className = 'selection-badge';
                    badge.style.background = '#8ab4f8';
                    badge.style.color = '#202124';
                    badge.style.fontSize = '11px';
                    badge.style.fontWeight = '500';
                    badge.style.padding = '1px 6px';
                    badge.style.borderRadius = '10px';
                    badge.style.display = 'none';
                    
                    fBtn.appendChild(leftPart);
                    fBtn.appendChild(badge);
                    
                    fBtn.onmouseover = () => { if (currentFolderKey !== folderKey) fBtn.style.background = 'rgba(255,255,255,0.04)'; };
                    fBtn.onmouseout = () => { if (currentFolderKey !== folderKey) fBtn.style.background = 'transparent'; };
                    
                    fBtn.onclick = () => {
                        const params = new URLSearchParams({ type: tData.type, path_idx: tData.path_idx, subfolder: path });
                        loadFolder(fBtn, folderKey, '/anomalous/models?' + params.toString());
                    };
                    typeItem.appendChild(fBtn);
                }
                treeContainer.appendChild(typeItem);
            });
            
            allBtn.onclick();
        };
        renderFolders();
    }


export function setWidgetValuePath(node, relPath) {
        if (!node.widgets || node.widgets.length === 0) return;
        const w = node.widgets.find(wg => wg.type === 'combo');
        const targetWidget = w || node.widgets[0];
        if (!targetWidget) return;

        if (targetWidget.options && targetWidget.options.values) {
            const normalizedTarget = relPath.replace(/\\/g, '/');
            const match = targetWidget.options.values.find(v => {
                return String(v).replace(/\\/g, '/') === normalizedTarget;
            });
            if (match) {
                targetWidget.value = match;
                return;
            }
        }
        targetWidget.value = relPath;
    }
