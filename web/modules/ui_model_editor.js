/**
 * Model metadata editor and cover-selection entry.
 */

import { translate } from './locales.js';
import { isPhysicalRenameProtectedType } from './model_policies.js';

const t = (key, params) => translate(key, params);

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
        galleryBtn.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>${t('detailPickGallery')}`;
        galleryBtn.style.padding = '8px';
        galleryBtn.style.background = '#303134';
        galleryBtn.style.color = '#e5e7eb';
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
        localBtn.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>${t('detailUploadLocal')}`;
        localBtn.style.padding = '8px';
        localBtn.style.background = '#303134';
        localBtn.style.color = '#e5e7eb';
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
        nameInput.onfocus = () => nameInput.style.borderColor = 'rgba(255, 255, 255, 0.4)';
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
        cancelBtn.style.color = '#9ca3af';
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
        saveBtn.style.background = '#e5e7eb';
        saveBtn.style.color = '#111827';
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
