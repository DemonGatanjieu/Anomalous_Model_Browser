/**
 * Advanced model selector and model-widget path helpers.
 */

import { translate } from './locales.js';
import { escapeHtml } from './safe_dom.js';

const t = (key, params) => translate(key, params);

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
            b.style.background = primary ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255,255,255,0.04)';
            b.style.color = primary ? '#ffffff' : '#e8eaed';
            b.style.border = primary ? '1px solid rgba(255, 255, 255, 0.25)' : '1px solid #5f6368';
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
                countLabel.style.color = '#e5e7eb';
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

                
                    card.style.border = '2px solid #ffffff';

                
                    card.style.background = 'rgba(255, 255, 255, 0.1)';

                
                    cbWrapper.style.background = '#ffffff';

                
                    cbWrapper.style.border = '2px solid #ffffff';

                
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
        cancelBtn.style.color = '#9ca3af';
        cancelBtn.style.border = 'none';
        cancelBtn.style.borderRadius = '4px';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.fontWeight = '500';
        cancelBtn.style.fontSize = '14px';
        cancelBtn.onmouseover = () => cancelBtn.style.background = 'rgba(255, 255, 255, 0.08)';
        cancelBtn.onmouseout = () => cancelBtn.style.background = 'transparent';
        cancelBtn.onclick = () => document.body.removeChild(modal);

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = t('detailConfirm');
        confirmBtn.style.padding = '8px 24px';
        confirmBtn.style.background = '#e5e7eb';
        confirmBtn.style.color = '#111827'; // dark text on bright accent button
        confirmBtn.style.border = 'none';
        confirmBtn.style.borderRadius = '4px';
        confirmBtn.style.cursor = 'pointer';
        confirmBtn.style.fontWeight = '600';
        confirmBtn.style.fontSize = '14px';
        confirmBtn.style.boxShadow = '0 1px 2px 0 rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15)';
        confirmBtn.onmouseover = () => { confirmBtn.style.background = '#ffffff'; confirmBtn.style.boxShadow = '0 1px 3px 0 rgba(0,0,0,.3), 0 4px 8px 3px rgba(0,0,0,.15)'; };
        confirmBtn.onmouseout = () => { confirmBtn.style.background = '#e5e7eb'; confirmBtn.style.boxShadow = '0 1px 2px 0 rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15)'; };
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
                    imgContainer.innerHTML = '<span style="display:inline-block;opacity:0.25;"><svg style="width:40px;height:40px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>';
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
                fBtn.style.background = 'rgba(255, 255, 255, 0.1)';
                fBtn.style.color = '#ffffff';
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
                    leftPart.innerHTML = `<span style="display:inline-flex;align-items:center;color:#9aa0a6"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span> <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;">${escapeHtml(fData.name)}</span> <span style="color:#5f6368;font-size:12px">(${escapeHtml(fData.model_count)})</span>`;
                    
                    const badge = document.createElement('div');
                    badge.className = 'selection-badge';
                    badge.style.background = '#e5e7eb';
                    badge.style.color = '#111827';
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
