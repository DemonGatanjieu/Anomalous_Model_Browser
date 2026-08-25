/**
 * ui_sidebar.js
 * Extracted Sidebar methods.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';
import { escapeHtml } from './safe_dom.js';
import { updateScanProgress, finishScanProgress, failScanProgress } from './scan_progress.js';

const t = (key, params) => translate(key, params);



export function createDOM() {
        localStorage.removeItem('anomalous_api_key');
        localStorage.removeItem('anomalous_civitai_api_key');
        this.modal = document.createElement('div');
        this.modal.id = 'anomalous-modal';

        const container = document.createElement('div');
        container.id = 'anomalous-container';

        const updateLangClass = () => {
            let lang = window.anomalous_browser_lang || 'zh';
            if (lang === 'en') container.classList.add('anomalous-lang-en');
            else container.classList.remove('anomalous-lang-en');
        };
        updateLangClass();

        const savedScale = localStorage.getItem('anomalous_ui_scale') || 1;
        container.style.setProperty('--anomalous-scale', savedScale);

        // Sidebar
        this.sidebarWrapper = document.createElement('div');
        this.sidebarWrapper.id = 'anomalous-sidebar-wrapper';
        this.sidebarWrapper.style.position = 'relative';

        const brandBar = document.createElement('div');
        brandBar.style.padding = '15px 15px 10px 15px';
        brandBar.style.display = 'flex';
        brandBar.style.alignItems = 'center';
        brandBar.style.justifyContent = 'space-between';
        brandBar.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

        const badge = document.createElement('div');
        badge.style.background = 'linear-gradient(135deg, #444, #222)';
        badge.style.color = '#ccc';
        badge.style.fontSize = '0.7em';
        badge.style.padding = '4px 8px';
        badge.style.borderRadius = '6px';
        badge.style.letterSpacing = '1px';
        badge.style.border = '1px solid #555';
        badge.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
        badge.style.textTransform = 'uppercase';
        badge.style.fontWeight = 'bold';
        badge.innerHTML = 'Anomalous Browser';

        const menuBtn = document.createElement('button');
        menuBtn.innerHTML = '☰';
        menuBtn.title = t('sidebarToggle');
        menuBtn.style.background = 'transparent';
        menuBtn.style.border = 'none';
        menuBtn.style.color = '#ccc';
        menuBtn.style.fontSize = '1.2em';
        menuBtn.style.cursor = 'pointer';
        menuBtn.onclick = () => {
            if (container.classList.contains('anomalous-sidebar-closed')) {
                container.classList.remove('anomalous-sidebar-closed');
                localStorage.setItem('anomalous_user_sidebar_closed', 'false');
            } else {
                container.classList.add('anomalous-sidebar-closed');
                localStorage.setItem('anomalous_user_sidebar_closed', 'true');
            }
        };

        brandBar.appendChild(badge);
        brandBar.appendChild(menuBtn);

        this.sidebar = document.createElement('div');
        this.sidebar.id = 'anomalous-sidebar';

        this.sidebarActions = document.createElement('div');
        this.sidebarActions.id = 'anomalous-sidebar-actions';
        this.sidebarActions.style.padding = '10px 15px';
        this.sidebarActions.style.display = 'flex';
        this.sidebarActions.style.flexDirection = 'row';
        this.sidebarActions.style.justifyContent = 'flex-start';
        this.sidebarActions.style.alignItems = 'center';
        this.sidebarActions.style.gap = '10px';
        this.sidebarActions.style.borderTop = '1px solid rgba(255,255,255,0.05)';
        this.sidebarActions.style.background = 'transparent';
        this.sidebarActions.style.borderRadius = '0';
        this.sidebarActions.style.width = '100%';
        this.sidebarActions.style.boxSizing = 'border-box';
        this.sidebarActions.style.margin = '0';

        this.sidebarWrapper.appendChild(brandBar);
        this.sidebarWrapper.appendChild(this.sidebar);
        this.sidebarWrapper.appendChild(this.sidebarActions);

        // Content Area
        const content = document.createElement('div');
        content.id = 'anomalous-content';

        const header = document.createElement('div');
        header.id = 'anomalous-header';

        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        const enforceBounds = (x, y) => {
            let newX = x;
            let newY = y;
            if (newX + container.offsetWidth > window.innerWidth) newX = window.innerWidth - container.offsetWidth;
            if (newY + container.offsetHeight > window.innerHeight) newY = window.innerHeight - container.offsetHeight;
            if (newX < 0) newX = 0;
            if (newY < 0) newY = 0;
            return { x: newX, y: newY };
        };

        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.id === 'anomalous-close') return;
            isDragging = true;
            const rect = container.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const pos = enforceBounds(e.clientX - dragOffsetX, e.clientY - dragOffsetY);
            container.style.left = pos.x + 'px';
            container.style.top = pos.y + 'px';
            container.style.transform = 'none';
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                localStorage.setItem('anomalous_pos_x', container.style.left);
                localStorage.setItem('anomalous_pos_y', container.style.top);
            }
        });

        const savedX = localStorage.getItem('anomalous_pos_x');
        const savedY = localStorage.getItem('anomalous_pos_y');
        if (savedX && savedY) {
            container.style.left = savedX;
            container.style.top = savedY;
        }

        // Periodically enforce bounds to catch resize/zoom changes
        setInterval(() => {
            if (!isDragging && container.style.display !== 'none' && !container.classList.contains('anomalous-docked')) {
                const rect = container.getBoundingClientRect();
                const pos = enforceBounds(rect.left, rect.top);
                if (pos.x !== rect.left || pos.y !== rect.top) {
                    if (container.style.left.endsWith('px') && container.style.top.endsWith('px')) {
                        container.style.left = pos.x + 'px';
                        container.style.top = pos.y + 'px';
                    }
                }
            }
        }, 1000);

        const spacer = document.createElement('div');
        spacer.style.flex = '1 1 auto';

        const leftGroup = document.createElement('div');
        leftGroup.className = 'anomalous-header-group';

        const rightGroup = document.createElement('div');
        rightGroup.className = 'anomalous-header-group';

        // We will define hideAllPanels as a class method instead of a local closure to make it globally accessible.

        const showSidebar = () => {
            container.classList.remove('anomalous-sidebar-closed');
        };

        const modelsBtn = document.createElement('button');
        modelsBtn.id = 'anomalous-models-btn';
        modelsBtn.innerHTML = `🏠 <span class="anomalous-btn-text">${t('models')}</span>`;
        modelsBtn.onclick = () => {
            this.hideAllPanels();
            if (localStorage.getItem('anomalous_user_sidebar_closed') === 'true') {
                container.classList.add('anomalous-sidebar-closed');
            } else {
                showSidebar();
            }
            menuBtn.disabled = false;
            menuBtn.style.opacity = '1';
            menuBtn.style.cursor = 'pointer';
            this.grid.style.display = 'grid';
            if (this.detailPanel.innerHTML !== '') {
                this.stopMediaInContainer(this.detailPanel); this.detailPanel.innerHTML = '';
                this.currentDetailModel = null;
                this.historyStack = [];
            }
        };

        const galleryBtn = document.createElement('button');
        galleryBtn.innerHTML = `🖼️ <span class="anomalous-btn-text">${t('gallery') || '图库'}</span>`;
        galleryBtn.onclick = () => {
            this.hideAllPanels();
            container.classList.add('anomalous-sidebar-closed');
            menuBtn.disabled = true;
            menuBtn.style.opacity = '0.3';
            menuBtn.style.cursor = 'not-allowed';
            this.galleryPanel.style.display = 'flex';
            void this.refreshGalleryImages();
        };

        const dockBtn = document.createElement('button');
        dockBtn.innerHTML = '◧';
        dockBtn.title = t('dockTitle');
        dockBtn.onclick = () => {
            container.classList.toggle('anomalous-docked');
            if (container.classList.contains('anomalous-docked')) {
                localStorage.setItem('anomalous_docked', 'true');
            } else {
                localStorage.setItem('anomalous_docked', 'false');
            }
        };

        if (localStorage.getItem('anomalous_docked') === 'true') {
            container.classList.add('anomalous-docked');
        }

        const helpBtn = document.createElement('button');
        helpBtn.id = 'anomalous-help-btn';
        helpBtn.title = t('helpTitle');
        helpBtn.innerHTML = `❓ <span class="anomalous-btn-text">${t('help')}</span>`;
        helpBtn.onclick = () => this.showHelp();

        const nbBtn = document.createElement('button');
        nbBtn.id = 'anomalous-notebook-btn';
        nbBtn.title = t('workspaceTitle');
        nbBtn.innerHTML = `📑 <span class="anomalous-btn-text">${t('workspace')}</span>`;

        const dBtn = document.getElementById('anomalous-doctor-btn');
        if (dBtn) dBtn.title = t('sidebarDoctor');
        const aBtn = document.getElementById('anomalous-assistant-btn');
        if (aBtn) aBtn.title = t('sidebarAssistant');
        const iBtn = document.getElementById('anomalous-import-btn');
        if (iBtn) iBtn.title = t('sidebarPreflight');
        const sBtn = document.getElementById('anomalous-settings-btn');
        if (sBtn) sBtn.title = t('sidebarSettings');

        // Reset dynamic panels so they re-render in new language
        if (window.anomalousBrowserInstance) {
            const b = window.anomalousBrowserInstance;
            if (b.doctorPanel) {
                b.doctorPanel.innerHTML = '';
                b.doctorPanelInitialized = false;
            }
        }
        const impOverlay = document.getElementById('anomalous-import-overlay');
        if (impOverlay && impOverlay.parentNode) {
            impOverlay.parentNode.removeChild(impOverlay);
        }

        nbBtn.onclick = () => {
            if (typeof this.recipeModelReturn !== 'function') {
                this.workspaceReturnState = {
                    grid: this.grid?.style.display || 'none',
                    detail: this.detailPanel?.style.display || 'none',
                    gallery: this.galleryPanel?.style.display || 'none',
                    doctor: this.doctorPanel?.style.display || 'none',
                    assistant: this.assistantPanel?.style.display || 'none',
                };
            } else if (!this.workspaceReturnState) {
                this.workspaceReturnState = {
                    grid: 'grid',
                    detail: 'none',
                    gallery: 'none',
                    doctor: 'none',
                    assistant: 'none',
                };
            }
            this.nbPanel.style.display = 'flex';
            this.showNotebooks();
        };

        rightGroup.appendChild(modelsBtn);
        rightGroup.appendChild(galleryBtn);
        rightGroup.appendChild(nbBtn);

        const apiKeyBtn = document.createElement('button');
        apiKeyBtn.id = 'anomalous-api-btn';
        apiKeyBtn.innerHTML = `<span class="anomalous-btn-text">${t('apiKeyConfig')}</span>`;
        apiKeyBtn.onclick = async () => {
            const val = prompt(t('apiKeyPrompt'), '');
            if (val !== null) {
                try {
                    await fetch('/anomalous/save_config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ api_key: val.trim() })
                    });
                } catch (e) { }
            }
        };

        const scanBtn = document.createElement('button');
        scanBtn.id = 'anomalous-scan-btn';
        scanBtn.title = t('sidebarScanWizard');
        scanBtn.innerHTML = `🔄`;
        scanBtn.style.background = 'transparent';
        scanBtn.style.color = '#ccc';
        scanBtn.style.border = 'none';
        scanBtn.style.borderRadius = '6px';
        scanBtn.style.padding = '6px';
        scanBtn.style.fontSize = '1.1em';
        scanBtn.style.cursor = 'pointer';
        scanBtn.style.transition = 'all 0.2s ease';
        scanBtn.onmouseover = () => { scanBtn.style.background = 'rgba(255,255,255,0.1)'; scanBtn.style.color = '#fff'; };
        scanBtn.onmouseout = () => { scanBtn.style.background = 'transparent'; scanBtn.style.color = '#ccc'; };

        let isCurrentlyScanning = false;
        setInterval(async () => {
            try {
                let isScanning = false;
                let activeStatus = null;
                if (this.currentType) {
                    const params = new URLSearchParams({ type: this.currentType, path_idx: this.currentPathIdx || 0, subfolder: this.currentSubfolder || '/' });
                    const resLocal = await fetch('/anomalous/scan_status?' + params.toString());
                    const dataLocal = await resLocal.json();
                    if (dataLocal.scanning) {
                        isScanning = true;
                        activeStatus = dataLocal;
                    } else if (dataLocal.interrupted) {
                        failScanProgress(t('scanProgressInterrupted'));
                    }
                }
                const resGlobal = await fetch('/anomalous/global_scan_status');
                const dataGlobal = await resGlobal.json();
                if (dataGlobal.scanning) {
                    isScanning = true;
                    activeStatus = dataGlobal;
                } else if (dataGlobal.interrupted) {
                    failScanProgress(t('scanProgressInterrupted'));
                }

                if (activeStatus) updateScanProgress(activeStatus);

                if (isScanning && !isCurrentlyScanning) {
                    isCurrentlyScanning = true;
                    scanBtn.innerHTML = `⏳`;
                    scanBtn.style.opacity = '0.7';
                } else if (!isScanning && isCurrentlyScanning) {
                    isCurrentlyScanning = false;
                    scanBtn.innerHTML = `🔄`;
                    scanBtn.style.opacity = '1';
                    finishScanProgress();
                    this.loadModels();
                    if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
                    alert(t('sidebarScanComplete'));
                }
            } catch (e) { }
        }, 3000);

        const createWizardModal = (isGlobal = false, targetFiles = null) => {
            let wizard = document.getElementById('anomalous-wizard-modal');
            if (wizard) document.body.removeChild(wizard);

            wizard = document.createElement('div');
            wizard.id = 'anomalous-wizard-modal';
            wizard.style.position = 'fixed';
            wizard.style.top = '0';
            wizard.style.left = '0';
            wizard.style.width = '100vw';
            wizard.style.height = '100vh';
            wizard.style.backgroundColor = 'rgba(0,0,0,0.6)';
            wizard.style.zIndex = '999999';
            wizard.style.display = 'flex';
            wizard.style.justifyContent = 'center';
            wizard.style.alignItems = 'center';
            wizard.style.fontFamily = 'Roboto, "Segoe UI", sans-serif';

            const content = document.createElement('div');
            content.style.background = '#1E1E1E';
            content.style.borderRadius = '12px';
            content.style.padding = '32px';
            content.style.width = '760px';
            content.style.maxWidth = '95%';
            content.style.maxHeight = '90vh';
            content.style.overflowY = 'auto';
            content.style.boxShadow = '0 11px 15px -7px rgba(0,0,0,0.2), 0 24px 38px 3px rgba(0,0,0,0.14), 0 9px 46px 8px rgba(0,0,0,0.12)';
            content.style.color = '#fff';
            content.style.position = 'relative';

            // Top Header Area
            const headerArea = document.createElement('div');
            headerArea.style.display = 'flex';
            headerArea.style.justifyContent = 'space-between';
            headerArea.style.alignItems = 'center';
            headerArea.style.marginBottom = '24px';

            const title = document.createElement('h2');
            if (targetFiles) {
                title.textContent = t('sidebarSingleModelScan', { files: targetFiles });
            } else {
                title.textContent = t(isGlobal ? 'sidebarGlobalScanWizard' : 'sidebarScanWizardTitle');
            }
            title.style.margin = '0';
            title.style.fontSize = '1.6em';
            title.style.fontWeight = '500';

            // Toolbar right
            const topToolbar = document.createElement('div');
            topToolbar.style.display = 'flex';
            topToolbar.style.gap = '8px';

            const createGhostBtn = (icon, textKey, onClick) => {
                const btn = document.createElement('button');
                btn.textContent = `${icon} ${t(textKey)}`;
                btn.style.padding = '6px 12px';
                btn.style.background = 'transparent';
                btn.style.color = '#ccc';
                btn.style.border = '1px solid rgba(255,255,255,0.1)';
                btn.style.borderRadius = '6px';
                btn.style.cursor = 'pointer';
                btn.style.fontSize = '0.85em';
                btn.style.transition = 'all 0.2s';
                btn.onmouseover = () => { btn.style.background = 'rgba(255,255,255,0.08)'; btn.style.color = '#fff'; };
                btn.onmouseout = () => { btn.style.background = 'transparent'; btn.style.color = '#ccc'; };
                btn.onclick = onClick;
                return btn;
            };

            const apiKeyBtn = createGhostBtn('🔑', 'sidebarApiKey', () => {
                const newKey = prompt(t('sidebarApiKeyPrompt'), '');
                if (newKey !== null) {
                    fetch('/anomalous/save_config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ api_key: newKey.trim() })
                    }).then(res => res.json()).then(data => {
                        if (data.status !== 'ok') throw new Error(data.message || 'Save failed');
                        alert(t('sidebarKeySaved'));
                    }).catch(error => alert(t('sidebarSaveFailed') + error.message));
                }
            });

            topToolbar.appendChild(apiKeyBtn);

            headerArea.appendChild(title);
            headerArea.appendChild(topToolbar);
            content.appendChild(headerArea);

            let scanMode = 'civitai';
            let enableRename = true;
            let enableAutoCheck = true;
            let enableForceOverwrite = false;
            let updateSections = () => { };

            const formGroup = document.createElement('div');
            formGroup.style.display = 'flex';
            formGroup.style.flexDirection = 'column';
            formGroup.style.gap = '24px';

            const createChoiceCard = (id, icon, titleKey, descKey, isSelected) => {
                const card = document.createElement('div');
                card.style.flex = '1';
                card.style.background = isSelected ? 'rgba(138, 180, 248, 0.15)' : 'rgba(255, 255, 255, 0.05)';
                card.style.border = `2px solid ${isSelected ? '#8AB4F8' : 'transparent'}`;
                card.style.borderRadius = '8px';
                card.style.padding = '16px';
                card.style.cursor = 'pointer';
                card.style.transition = 'all 0.2s';
                card.style.display = 'flex';
                card.style.flexDirection = 'column';
                card.style.gap = '12px';
                card.style.alignItems = 'flex-start';

                card.onmouseover = () => {
                    if (!isSelected) card.style.background = 'rgba(255, 255, 255, 0.08)';
                };
                card.onmouseout = () => {
                    if (!isSelected) card.style.background = 'rgba(255, 255, 255, 0.05)';
                };

                const topRow = document.createElement('div');
                topRow.style.display = 'flex';
                topRow.style.alignItems = 'center';
                topRow.style.gap = '12px';

                const iconDiv = document.createElement('div');
                iconDiv.innerText = icon;
                iconDiv.style.fontSize = '1.6em';

                const tTitle = document.createElement('div');
                tTitle.textContent = t(titleKey);
                tTitle.style.fontWeight = '500';
                tTitle.style.fontSize = '1.05em';
                tTitle.style.color = isSelected ? '#8AB4F8' : '#fff';

                topRow.appendChild(iconDiv);
                topRow.appendChild(tTitle);

                const tDesc = document.createElement('div');
                tDesc.textContent = t(descKey);
                tDesc.style.fontSize = '0.85em';
                tDesc.style.color = '#bbb';
                tDesc.style.lineHeight = '1.5';

                card.appendChild(topRow);
                card.appendChild(tDesc);
                return card;
            };

            let targetMode = 'all';
            let selectedForScan = new Map();
            
            if (!targetFiles) {
                const section0 = document.createElement('div');
                const sec0Title = document.createElement('div');
                sec0Title.textContent = t('sidebarStep0');
                sec0Title.style.fontWeight = '500';
                sec0Title.style.color = '#8AB4F8';
                sec0Title.style.marginBottom = '12px';
                sec0Title.style.fontSize = '0.95em';
                section0.appendChild(sec0Title);

                const tContainer = document.createElement('div');
                tContainer.style.display = 'flex';
                tContainer.style.flexDirection = 'row';
                tContainer.style.gap = '16px';
                tContainer.style.marginBottom = '16px';

                const customActionDiv = document.createElement('div');
                customActionDiv.style.display = 'none';
                customActionDiv.style.marginTop = '16px';
                
                const openSelectorBtn = document.createElement('button');
                openSelectorBtn.textContent = t('sidebarOpenSelector');
                openSelectorBtn.style.cssText = 'width:100%;padding:12px;background:#8AB4F8;color:#1E1E1E;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:1.05em;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
                
                const selectedCountSpan = document.createElement('div');
                selectedCountSpan.style.cssText = 'text-align:center;color:#8AB4F8;margin-top:8px;font-size:0.9em;';
                selectedCountSpan.textContent = t('sidebarSelectedZero');
                
                const updateSelectedCount = () => {
                    let total = 0;
                    for (const set of selectedForScan.values()) total += set.size;
                    selectedCountSpan.textContent = t('sidebarSelectedCount', { count: total });
                };

                openSelectorBtn.onclick = () => {
                    this._openAdvancedModelSelector(selectedForScan, (newSelection) => {
                        selectedForScan = newSelection;
                        updateSelectedCount();
                    });
                };
                
                customActionDiv.appendChild(openSelectorBtn);
                customActionDiv.appendChild(selectedCountSpan);

                let tCard1, tCard2;
                const updateTargetCards = () => {
                    if (tCard1 && tCard2) {
                        tContainer.removeChild(tCard1);
                        tContainer.removeChild(tCard2);
                    }
                    tCard1 = createChoiceCard('all', '📂', 'sidebarTargetGlobal', 'sidebarTargetGlobalDesc', targetMode === 'all');
                    tCard2 = createChoiceCard('custom', '☑️', 'sidebarTargetCustom', 'sidebarTargetCustomDesc', targetMode === 'custom');

                    tCard1.onclick = () => { 
                        targetMode = 'all'; 
                        updateTargetCards(); 
                        customActionDiv.style.display = 'none';
                    };
                    tCard2.onclick = () => { 
                        targetMode = 'custom'; 
                        updateTargetCards(); 
                        customActionDiv.style.display = 'block';
                    };

                    tContainer.appendChild(tCard1);
                    tContainer.appendChild(tCard2);
                };
                updateTargetCards();
                section0.appendChild(tContainer);
                section0.appendChild(customActionDiv);
                formGroup.appendChild(section0);
            }

            // === Step 1: Fetch Data ===
            const section1 = document.createElement('div');
            const sec1Title = document.createElement('div');
            sec1Title.textContent = t('sidebarStep1');
            sec1Title.style.fontWeight = '500';
            sec1Title.style.color = '#8AB4F8';
            sec1Title.style.marginBottom = '12px';
            sec1Title.style.fontSize = '0.95em';
            section1.appendChild(sec1Title);

            const cardsContainer = document.createElement('div');
            cardsContainer.style.display = 'flex';
            cardsContainer.style.flexDirection = 'row';
            cardsContainer.style.gap = '16px';



            let card1, card2;
            const updateCards = () => {
                if (card1 && card2) {
                    cardsContainer.removeChild(card1);
                    cardsContainer.removeChild(card2);
                }
                card1 = createChoiceCard('civitai', '🌍', 'sidebarOnline', 'sidebarOnlineDesc', scanMode === 'civitai');
                card2 = createChoiceCard('offline', '🔌', 'sidebarOffline', 'sidebarOfflineDesc', scanMode === 'offline');

                card1.onclick = () => { scanMode = 'civitai'; updateCards(); updateSections(); };
                card2.onclick = () => { scanMode = 'offline'; updateCards(); updateSections(); };

                cardsContainer.appendChild(card1);
                cardsContainer.appendChild(card2);
            };
            updateCards();
            section1.appendChild(cardsContainer);
            formGroup.appendChild(section1);

            // Material Switch Builder
            const createMaterialSwitch = (initialState, onChange) => {
                const track = document.createElement('div');
                track.style.width = '36px';
                track.style.height = '14px';
                track.style.borderRadius = '7px';
                track.style.background = initialState ? 'rgba(138, 180, 248, 0.5)' : 'rgba(255,255,255,0.3)';
                track.style.position = 'relative';
                track.style.cursor = 'pointer';
                track.style.transition = 'background 0.3s';
                track.style.display = 'flex';
                track.style.alignItems = 'center';

                const thumb = document.createElement('div');
                thumb.style.width = '20px';
                thumb.style.height = '20px';
                thumb.style.borderRadius = '50%';
                thumb.style.background = initialState ? '#8AB4F8' : '#bdbdbd';
                thumb.style.position = 'absolute';
                thumb.style.left = initialState ? '16px' : '0px';
                thumb.style.transition = 'left 0.3s, background 0.3s';
                thumb.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';

                let state = initialState;
                track.onclick = () => {
                    state = !state;
                    track.style.background = state ? 'rgba(138, 180, 248, 0.5)' : 'rgba(255,255,255,0.3)';
                    thumb.style.background = state ? '#8AB4F8' : '#bdbdbd';
                    thumb.style.left = state ? '16px' : '0px';
                    onChange(state);
                };
                track.appendChild(thumb);
                return track;
            };

            const createListRow = (icon, titleKey, descKey, actionEl) => {
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.justifyContent = 'space-between';
                row.style.padding = '12px 0';
                row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

                const left = document.createElement('div');
                left.style.display = 'flex';
                left.style.alignItems = 'flex-start';
                left.style.gap = '16px';

                const iconEl = document.createElement('div');
                iconEl.innerText = icon;
                iconEl.style.fontSize = '1.4em';
                iconEl.style.lineHeight = '1.2';
                iconEl.style.width = '24px';
                iconEl.style.textAlign = 'center';

                const textDiv = document.createElement('div');
                const titleEl = document.createElement('div');
                titleEl.textContent = t(titleKey);
                titleEl.style.fontWeight = '500';
                titleEl.style.fontSize = '1.0em';
                titleEl.style.color = '#fff';

                const d = document.createElement('div');
                d.innerHTML = t(descKey);
                d.style.fontSize = '0.85em';
                d.style.color = '#aaa';
                d.style.marginTop = '4px';

                textDiv.appendChild(titleEl);
                textDiv.appendChild(d);
                left.appendChild(iconEl);
                left.appendChild(textDiv);
                row.appendChild(left);
                if (actionEl) row.appendChild(actionEl);

                return row;
            };

            // === Step 2: Normalize Naming ===
            const section2 = document.createElement('div');
            const sec2Title = document.createElement('div');
            sec2Title.textContent = t('sidebarStep2');
            sec2Title.style.fontWeight = '500';
            sec2Title.style.color = '#8AB4F8';
            sec2Title.style.marginBottom = '8px';
            sec2Title.style.fontSize = '0.95em';
            section2.appendChild(sec2Title);

            const s2List = document.createElement('div');
            let enableVirtualRename = true;
            let enablePhysicalRename = false;

            const dualChannelRow = document.createElement('div');
            dualChannelRow.style.display = 'flex';
            dualChannelRow.style.flexDirection = 'column';
            dualChannelRow.style.gap = '14px';
            dualChannelRow.style.padding = '0 16px 12px 16px';
            dualChannelRow.style.marginLeft = '40px';

            const updateDualChannelUI = () => {
                dualChannelRow.style.opacity = enableRename ? '1' : '0.4';
                dualChannelRow.style.pointerEvents = enableRename ? 'auto' : 'none';
            };

            const virtualSwitch = createMaterialSwitch(enableVirtualRename, (s) => enableVirtualRename = s);
            let physicalProtectionNotice = null;
            const physicalSwitch = createMaterialSwitch(enablePhysicalRename, (s) => {
                enablePhysicalRename = s;
                if (physicalProtectionNotice) {
                    physicalProtectionNotice.style.display = s ? 'block' : 'none';
                }
            });

            const vContainer = document.createElement('div');
            vContainer.style.display = 'flex';
            vContainer.style.flexDirection = 'column';

            const vRow = document.createElement('div');
            vRow.style.display = 'flex';
            vRow.style.alignItems = 'center';
            vRow.style.gap = '8px';
            vRow.innerHTML = `<span style="font-size:0.9em; color:#ddd;">✨ ${t('sidebarVirtualRename')}</span>`;
            vRow.appendChild(virtualSwitch);

            const vDesc = document.createElement('div');
            vDesc.style.fontSize = '0.8em';
            vDesc.style.color = '#888';
            vDesc.style.marginTop = '4px';
            vDesc.textContent = t('sidebarVirtualRenameDesc');
            vContainer.appendChild(vRow);
            vContainer.appendChild(vDesc);

            const pContainer = document.createElement('div');
            pContainer.style.display = 'flex';
            pContainer.style.flexDirection = 'column';

            const pRow = document.createElement('div');
            pRow.style.display = 'flex';
            pRow.style.alignItems = 'center';
            pRow.style.gap = '8px';
            pRow.innerHTML = `<span style="font-size:0.9em; color:#ddd;">💾 ${t('sidebarPhysicalRename')}</span>`;
            pRow.appendChild(physicalSwitch);

            const pDesc = document.createElement('div');
            pDesc.style.fontSize = '0.8em';
            pDesc.style.color = '#888';
            pDesc.style.marginTop = '4px';
            pDesc.innerHTML = t('sidebarPhysicalRenameDesc');
            pContainer.appendChild(pRow);
            pContainer.appendChild(pDesc);

            physicalProtectionNotice = document.createElement('div');
            physicalProtectionNotice.style.display = enablePhysicalRename ? 'block' : 'none';
            physicalProtectionNotice.style.marginTop = '8px';
            physicalProtectionNotice.style.padding = '9px 11px';
            physicalProtectionNotice.style.border = '1px solid rgba(251, 188, 4, 0.45)';
            physicalProtectionNotice.style.borderRadius = '6px';
            physicalProtectionNotice.style.background = 'rgba(251, 188, 4, 0.08)';
            physicalProtectionNotice.style.color = '#fdd663';
            physicalProtectionNotice.style.fontSize = '0.8em';
            physicalProtectionNotice.style.lineHeight = '1.45';
            physicalProtectionNotice.textContent = t('sidebarPhysicalRenameProtectedNotice');
            pContainer.appendChild(physicalProtectionNotice);

            dualChannelRow.appendChild(vContainer);
            dualChannelRow.appendChild(pContainer);

            s2List.appendChild(createListRow('📝', 'sidebarNormalize', 'sidebarNormalizeDesc', createMaterialSwitch(enableRename, (s) => { enableRename = s; updateDualChannelUI(); })));
            s2List.lastChild.style.borderBottom = 'none';
            s2List.appendChild(dualChannelRow);
            updateDualChannelUI();
            section2.appendChild(s2List);
            formGroup.appendChild(section2);

            // === Step 3: Workflow Protection & Fix ===
            const section3 = document.createElement('div');
            const sec3Title = document.createElement('div');
            sec3Title.textContent = t('sidebarStep3');
            sec3Title.style.fontWeight = '500';
            sec3Title.style.color = '#8AB4F8';
            sec3Title.style.marginBottom = '8px';
            sec3Title.style.fontSize = '0.95em';
            section3.appendChild(sec3Title);

            const s3List = document.createElement('div');
            const isInject = localStorage.getItem('anomalous_inject_hash') !== 'false';
            s3List.appendChild(createListRow('📦', 'sidebarProvenance', 'sidebarProvenanceDesc', createMaterialSwitch(isInject, (s) => localStorage.setItem('anomalous_inject_hash', s ? 'true' : 'false'))));
            s3List.appendChild(createListRow('⚠️', 'sidebarOverwrite', 'sidebarOverwriteDesc', createMaterialSwitch(enableForceOverwrite, (s) => enableForceOverwrite = s)));
            s3List.appendChild(createListRow('🪄', 'sidebarSmartFix', 'sidebarSmartFixDesc', createMaterialSwitch(enableAutoCheck, (s) => enableAutoCheck = s)));
            s3List.lastChild.style.borderBottom = 'none';

            section3.appendChild(s3List);
            formGroup.appendChild(section3);
            content.appendChild(formGroup);

            updateSections = () => {
                if (scanMode === 'offline') {
                    section2.style.opacity = '0.3';
                    section2.style.pointerEvents = 'none';
                    section3.style.opacity = '0.3';
                    section3.style.pointerEvents = 'none';
                } else {
                    section2.style.opacity = '1';
                    section2.style.pointerEvents = 'auto';
                    section3.style.opacity = '1';
                    section3.style.pointerEvents = 'auto';
                }
            };
            updateSections();

            // Execute Scan Logic
                        const doScan = async () => {
                try {
                    const reqBody = {
                        offline_only: scanMode === 'offline',
                        skip_rename: !enableRename,
                        virtual_rename: enableRename ? enableVirtualRename : false,
                        physical_rename: enableRename ? enablePhysicalRename : false,
                        force_overwrite: enableForceOverwrite
                    };

                    if (targetMode === 'custom') {
                        let hasAny = false;
                        for (const set of selectedForScan.values()) {
                            if (set.size > 0) hasAny = true;
                        }
                        if (!hasAny) {
                            alert(t('sidebarNoModelsSelected'));
                            return;
                        }
                        
                        document.body.removeChild(wizard);
                        if (typeof scanBtn !== 'undefined') {
                            scanBtn.innerHTML = `⏳`;
                            scanBtn.style.animation = 'anomalous-spin 2s linear infinite';
                        }

                        const customFolders = Array.from(selectedForScan.entries()).filter(([, files]) => files.size > 0);
                        let customFolderCurrent = 0;
                        updateScanProgress({
                            scanning: true,
                            phase: 'preparing',
                            folder_total: customFolders.length,
                            folder_current: 0,
                        });
                        
                        // Sequential scan for multiple folders
                        for (const [folderKey, fileSet] of customFolders) {
                            customFolderCurrent += 1;
                            const parts = folderKey.split('|');
                            if (parts.length < 3) continue;
                            const type = parts[0], path_idx = parts[1], subfolder = parts.slice(2).join('|');
                            
                            const params = new URLSearchParams({ type, path_idx, subfolder });
                            const targetUrl = '/anomalous/scan?' + params.toString();
                            
                            const currentReqBody = { ...reqBody, target_files: Array.from(fileSet) };
                            
                            try {
                                const res = await fetch(targetUrl, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(currentReqBody)
                                });
                                const data = await res.json();
                                if (data.status === 'ok') {
                                    // wait for this folder to finish scanning before starting next
                                    await new Promise(resolve => {
                                        const poll = setInterval(async () => {
                                            try {
                                                const statusUrl = '/anomalous/scan_status?' + params.toString();
                                                const statusRes = await fetch(statusUrl);
                                                const statusData = await statusRes.json();
                                                updateScanProgress({
                                                    ...statusData,
                                                    folder_total: customFolders.length,
                                                    folder_current: customFolderCurrent,
                                                    folder: subfolder,
                                                });
                                                if (!statusData.scanning) {
                                                    clearInterval(poll);
                                                    resolve();
                                                }
                                            } catch (err) {
                                                clearInterval(poll);
                                                resolve();
                                            }
                                        }, 2000);
                                    });
                                } else {
                                    console.error("Scan failed for folder: " + folderKey, data.message);
                                }
                            } catch(e) {
                                console.error("Request failed for folder: " + folderKey, e);
                            }
                        }
                        
                        if (typeof scanBtn !== 'undefined') {
                            scanBtn.innerHTML = `🔄`;
                            scanBtn.style.animation = '';
                        }
                        finishScanProgress();
                        if (enableAutoCheck && window.anomalous_resolve_all_missing_nodes) {
                            window.anomalous_resolve_all_missing_nodes(true);
                        }
                        this.loadModels();
                        
                        return;
                    }

                    // Existing logic for 'all' mode or single file
                    let finalTargetFiles = targetFiles;
                    let currentReqBody = { ...reqBody };
                    
                    let targetUrl = '';
                    if (isGlobal && targetMode !== 'custom') {
                        targetUrl = '/anomalous/scan_all';
                    } else {
                        const params = new URLSearchParams({ type: this.currentType, path_idx: this.currentPathIdx, subfolder: this.currentSubfolder });
                        if (finalTargetFiles) {
                            currentReqBody.target_files = finalTargetFiles.split(',');
                        }
                        targetUrl = '/anomalous/scan?' + params.toString();
                    }

                    const res = await fetch(targetUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(currentReqBody)
                    });
                    
                    const data = await res.json();
                    if (data.status === 'ok') {
                        updateScanProgress({ scanning: true, phase: 'preparing', recovered: data.recovered });
                        if (typeof scanBtn !== 'undefined') {
                            scanBtn.innerHTML = `⏳`;
                            scanBtn.style.animation = 'anomalous-spin 2s linear infinite';
                        }

                        // Start polling
                        const poll = setInterval(async () => {
                            try {
                                let statusUrl = '/anomalous/global_scan_status';
                                if (!isGlobal) {
                                    const params = new URLSearchParams({ type: this.currentType, path_idx: this.currentPathIdx, subfolder: this.currentSubfolder });
                                    statusUrl = '/anomalous/scan_status?' + params.toString();
                                }
                                const statusRes = await fetch(statusUrl);
                                const statusData = await statusRes.json();
                                updateScanProgress(statusData);
                                if (!statusData.scanning) {
                                    clearInterval(poll);
                                    if (statusData.interrupted) failScanProgress(t('scanProgressInterrupted'));
                                    else finishScanProgress();
                                    if (typeof scanBtn !== 'undefined') {
                                        scanBtn.innerHTML = `🔄`;
                                        scanBtn.style.animation = '';
                                    }

                                    if (enableAutoCheck && window.anomalous_resolve_all_missing_nodes) {
                                        window.anomalous_resolve_all_missing_nodes(true);
                                    }
                                    this.loadModels();
                                }
                            } catch (err) {
                                clearInterval(poll);
                                if (typeof scanBtn !== 'undefined') {
                                    scanBtn.innerHTML = `🔄`;
                                    scanBtn.style.animation = '';
                                }
                            }
                        }, 2000);
                        document.body.removeChild(wizard);
                        return; // return early so we don't remove wizard again below
                    } else {
                        failScanProgress(t('sidebarScanFailed') + data.message);
                        alert(t('sidebarScanFailed') + data.message);
                    }
                } catch (e) {
                    failScanProgress(String(e));
                    alert("Error: " + e);
                }

                document.body.removeChild(wizard);
            };

            const footer = document.createElement('div');
            footer.style.marginTop = '32px';
            footer.style.display = 'flex';
            footer.style.justifyContent = 'flex-end';
            footer.style.gap = '8px';

            const closeBtn = document.createElement('button');
        closeBtn.textContent = t('sidebarCancel');
            closeBtn.style.padding = '8px 16px';
            closeBtn.style.background = 'transparent';
            closeBtn.style.color = '#8AB4F8';
            closeBtn.style.border = 'none';
            closeBtn.style.borderRadius = '4px';
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.fontSize = '0.95em';
            closeBtn.style.fontWeight = '500';
            closeBtn.style.textTransform = 'uppercase';
            closeBtn.style.transition = 'background 0.2s';
            closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(138, 180, 248, 0.08)';
            closeBtn.onmouseout = () => closeBtn.style.background = 'transparent';
            closeBtn.onclick = () => document.body.removeChild(wizard);

            const startBtn = document.createElement('button');
        startBtn.textContent = t('sidebarExecute');
            startBtn.style.padding = '8px 24px';
            startBtn.style.background = '#8AB4F8'; // Material Primary
            startBtn.style.color = '#1E1E1E';
            startBtn.style.border = 'none';
            startBtn.style.borderRadius = '4px';
            startBtn.style.cursor = 'pointer';
            startBtn.style.fontSize = '0.95em';
            startBtn.style.fontWeight = '500';
            startBtn.style.textTransform = 'uppercase';
            startBtn.style.transition = 'background 0.2s, box-shadow 0.2s';
            startBtn.style.boxShadow = '0 3px 1px -2px rgba(0,0,0,0.2), 0 2px 2px 0 rgba(0,0,0,0.14), 0 1px 5px 0 rgba(0,0,0,0.12)';
            startBtn.onmouseover = () => {
                startBtn.style.background = '#aecbf9';
                startBtn.style.boxShadow = '0 2px 4px -1px rgba(0,0,0,0.2), 0 4px 5px 0 rgba(0,0,0,0.14), 0 1px 10px 0 rgba(0,0,0,0.12)';
            };
            startBtn.onmouseout = () => {
                startBtn.style.background = '#8AB4F8';
                startBtn.style.boxShadow = '0 3px 1px -2px rgba(0,0,0,0.2), 0 2px 2px 0 rgba(0,0,0,0.14), 0 1px 5px 0 rgba(0,0,0,0.12)';
            };
            startBtn.onclick = doScan;

            footer.appendChild(closeBtn);
            footer.appendChild(startBtn);
            content.appendChild(footer);
            wizard.appendChild(content);
            document.body.appendChild(wizard);
        };

        scanBtn.onclick = () => createWizardModal(true);
        this.sidebarActions.appendChild(scanBtn);


        let refreshModelSettingsText = () => {};

        const closeBtn = document.createElement('div');
        closeBtn.id = 'anomalous-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => this.close();



        rightGroup.appendChild(dockBtn);
        rightGroup.appendChild(closeBtn);

        header.appendChild(leftGroup);
        header.appendChild(spacer);
        header.appendChild(rightGroup);

        const settingsHubModal = document.createElement('div');
        settingsHubModal.style.position = 'absolute';
        settingsHubModal.style.bottom = '15px';
        settingsHubModal.style.left = '100%';
        settingsHubModal.style.marginLeft = '10px';
        settingsHubModal.style.width = '260px';
        settingsHubModal.style.background = 'var(--comfy-menu-bg, #2a2a2a)';
        settingsHubModal.style.border = '1px solid rgba(255,255,255,0.1)';
        settingsHubModal.style.borderRadius = '12px';
        settingsHubModal.style.padding = '10px';
        settingsHubModal.style.display = 'none';
        settingsHubModal.style.flexDirection = 'column';
        settingsHubModal.style.gap = '4px';
        settingsHubModal.style.boxShadow = '0 10px 40px rgba(0,0,0,0.5)';
        settingsHubModal.style.zIndex = '1000';

        const langBtn = document.createElement('button');
        langBtn.className = 'anomalous-lang-btn';
        langBtn.textContent = t(window.anomalous_browser_lang === 'zh' ? 'sidebarSwitchToEnglish' : 'sidebarSwitchToChinese');
        langBtn.onclick = () => {
            let newLang = window.anomalous_browser_lang === 'zh' ? 'en' : 'zh';
            localStorage.setItem('anomalous_lang', newLang);
            window.anomalous_browser_lang = newLang;
            langBtn.textContent = t(window.anomalous_browser_lang === 'zh' ? 'sidebarSwitchToEnglish' : 'sidebarSwitchToChinese');
            updateLangClass();
            modelsBtn.innerHTML = `🏠 <span class="anomalous-btn-text">${t('models')}</span>`;
            galleryBtn.innerHTML = `🖼️ <span class="anomalous-btn-text">${t('gallery')}</span>`;
            scanBtn.title = t('scanTitle');
            scanBtn.innerHTML = `🔄`;
            helpBtn.innerHTML = `❓ <span class="anomalous-btn-text">${t('help')}</span>`;
            nbBtn.title = t('workspaceTitle');
            nbBtn.innerHTML = `📑 <span class="anomalous-btn-text">${t('workspace')}</span>`;

            const dBtn = document.getElementById('anomalous-doctor-btn');
            if (dBtn) dBtn.title = t('sidebarDoctor');
            const aBtn = document.getElementById('anomalous-assistant-btn');
            if (aBtn) aBtn.title = t('sidebarAssistant');
            const iBtn = document.getElementById('anomalous-import-btn');
            if (iBtn) iBtn.title = t('sidebarImportExport');
            const sBtn = document.getElementById('anomalous-global-settings-btn');
            if (sBtn) sBtn.title = t('sidebarSettings');

            // Reset dynamic panels so they re-render in new language
            if (window.anomalousBrowserInstance) {
                const b = window.anomalousBrowserInstance;
                if (b.doctorPanel) {
                    b.doctorPanel.innerHTML = '';
                    b.doctorPanelInitialized = false;
                }
                if (b.assistantPanel && b.assistantPanelInitialized) {
                    const selectedNode = Object.values(app.canvas?.selected_nodes || {})[0] || null;
                    b.assistantPanelInitialized = false;
                    b.initAssistantPanel();
                    b.diagnoseNode(selectedNode, true);
                }
                if (b.notebookNotesTab) b.notebookNotesTab.textContent = t('promptNotes');
                if (b.notebookRecipesTab) b.notebookRecipesTab.textContent = t('recipeTitle');
            }
            document.querySelectorAll('[data-anomalous-i18n-key]').forEach((element) => {
                const key = element.dataset.anomalousI18nKey;
                if (key) element.textContent = t(key);
            });
            const impOverlay = document.getElementById('anomalous-import-overlay');
            if (impOverlay && impOverlay.parentNode) {
                impOverlay.parentNode.removeChild(impOverlay);
            }

            apiKeyBtn.innerHTML = `<span class="anomalous-btn-text">${t('apiKeyConfig')}</span>`;
            const globalScanBtnRef = document.getElementById('anomalous-global-scan-btn');
            if (globalScanBtnRef) globalScanBtnRef.textContent = t('sidebarGlobalQuickScan');
            const checkUnscannedBtnRef = document.getElementById('anomalous-check-unscanned-btn');
            if (checkUnscannedBtnRef) checkUnscannedBtnRef.textContent = t('sidebarCheckMissing');
            const resetBtnRef = document.getElementById('anomalous-reset-btn');
            if (resetBtnRef) resetBtnRef.textContent = t('sidebarResetLayout');
            const scaleLabelRef = document.getElementById('anomalous-scale-label');
            if (scaleLabelRef) scaleLabelRef.textContent = t('sidebarUiScale');
            const hashBtnRef = document.getElementById('anomalous-hash-toggle-btn');
            if (hashBtnRef) {
                const isInject = localStorage.getItem('anomalous_inject_hash') !== 'false';
                hashBtnRef.textContent = t(isInject ? 'sidebarInjectHash' : 'sidebarSkipHash');
            }
            const folderMgrRef = document.getElementById('anomalous-folder-manager-btn');
            if (folderMgrRef) folderMgrRef.textContent = t('sidebarManageFolders');
            const feedbackRef = document.getElementById('anomalous-feedback-btn');
            if (feedbackRef) feedbackRef.textContent = t('sidebarFeedback');

            refreshModelSettingsText();
            this.renderSidebar();
            this.loadModels();
            if (this.detailPanel.style.display !== 'none' && this.currentDetailModel) {
                this.showDetail(this.currentDetailModel);
            }
            if (this.nbEditor && this.nbEditor.innerHTML !== '') {
                this.renderNotebookEditor();
                this.refreshNotebooks();
            }
        };

        const styleHubBtn = (btn) => {
            btn.style.background = 'transparent';
            btn.style.border = '1px solid rgba(255,255,255,0.05)';
            btn.style.color = '#ccc';
            btn.style.textAlign = 'left';
            btn.style.padding = '8px 10px';
            btn.style.borderRadius = '8px';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '0.85em';
            btn.style.transition = 'all 0.2s';
            btn.onmouseover = () => { btn.style.background = 'rgba(255,255,255,0.08)'; btn.style.color = '#fff'; };
            btn.onmouseout = () => { btn.style.background = 'transparent'; btn.style.color = '#ccc'; };
        };

        styleHubBtn(apiKeyBtn);
        styleHubBtn(langBtn);
        styleHubBtn(helpBtn);

        const modelSettingsBtn = document.createElement('button');
        modelSettingsBtn.id = 'anomalous-model-settings-btn';
        styleHubBtn(modelSettingsBtn);

        const modelSettingsOverlay = document.createElement('div');
        modelSettingsOverlay.className = 'anomalous-model-settings-overlay';
        modelSettingsOverlay.hidden = true;

        const modelSettingsDialog = document.createElement('div');
        modelSettingsDialog.className = 'anomalous-model-settings-dialog';
        modelSettingsDialog.setAttribute('role', 'dialog');
        modelSettingsDialog.setAttribute('aria-modal', 'false');

        const modelSettingsTitle = document.createElement('h2');
        const modelSettingsDescription = document.createElement('p');
        modelSettingsDescription.className = 'anomalous-model-settings-description';

        const createSettingRow = () => {
            const row = document.createElement('label');
            row.className = 'anomalous-model-setting-row';
            const copy = document.createElement('span');
            copy.className = 'anomalous-model-setting-copy';
            const name = document.createElement('strong');
            const help = document.createElement('small');
            copy.append(name, help);
            const select = document.createElement('select');
            select.className = 'anomalous-model-setting-select';
            row.append(copy, select);
            return { row, name, help, select };
        };

        const videoSetting = createSettingRow();
        const alwaysPlayOption = new Option('', 'always');
        const hoverPlayOption = new Option('', 'hover');
        videoSetting.select.append(alwaysPlayOption, hoverPlayOption);

        const thumbnailSetting = createSettingRow();
        const balancedThumbnailOption = new Option('', 'balanced');
        const originalThumbnailOption = new Option('', 'original');
        thumbnailSetting.select.append(balancedThumbnailOption, originalThumbnailOption);

        const modelSettingsNote = document.createElement('div');
        modelSettingsNote.className = 'anomalous-model-settings-note';

        const modelSettingsClose = document.createElement('button');
        modelSettingsClose.className = 'anomalous-model-settings-close';

        modelSettingsDialog.append(
            modelSettingsTitle,
            modelSettingsDescription,
            videoSetting.row,
            thumbnailSetting.row,
            modelSettingsNote,
            modelSettingsClose,
        );
        modelSettingsOverlay.appendChild(modelSettingsDialog);
        container.appendChild(modelSettingsOverlay);

        refreshModelSettingsText = () => {
            modelSettingsBtn.textContent = t('sidebarModelSettings');
            modelSettingsTitle.textContent = t('sidebarModelCardSettings');
            modelSettingsDescription.textContent = t('sidebarModelCardDescription');
            videoSetting.name.textContent = t('sidebarVideoPlayback');
            videoSetting.help.textContent = t('sidebarVideoHelp');
            alwaysPlayOption.textContent = t('sidebarAlwaysPlay');
            hoverPlayOption.textContent = t('sidebarHoverPlay');
            thumbnailSetting.name.textContent = t('sidebarCardQuality');
            thumbnailSetting.help.textContent = t('sidebarCardQualityHelp');
            balancedThumbnailOption.textContent = t('sidebarOptimizedThumbnail');
            originalThumbnailOption.textContent = t('sidebarOriginalCover');
            modelSettingsNote.textContent = t('sidebarModelSettingsNote');
            modelSettingsClose.textContent = t('sidebarDone');
            videoSetting.select.value = this.energySaving ? 'hover' : 'always';
            thumbnailSetting.select.value = this.cardThumbnailMode;
        };
        refreshModelSettingsText();

        const setModelSettingsOpen = (isOpen) => {
            modelSettingsOverlay.hidden = !isOpen;
            modelSettingsDialog.setAttribute('aria-modal', String(isOpen));
        };
        const closeModelSettings = () => { setModelSettingsOpen(false); };
        modelSettingsBtn.onclick = () => {
            refreshModelSettingsText();
            settingsHubModal.style.display = 'none';
            setModelSettingsOpen(true);
            videoSetting.select.focus();
        };
        modelSettingsClose.onclick = closeModelSettings;
        modelSettingsOverlay.onclick = (event) => {
            if (event.target === modelSettingsOverlay) closeModelSettings();
        };
        videoSetting.select.onchange = () => {
            this.energySaving = videoSetting.select.value === 'hover';
            localStorage.setItem('anomalous_energy_saving', String(this.energySaving));
            this.loadModels();
        };
        thumbnailSetting.select.onchange = () => {
            this.cardThumbnailMode = thumbnailSetting.select.value === 'original' ? 'original' : 'balanced';
            localStorage.setItem('anomalous_card_thumbnail_mode', this.cardThumbnailMode);
            this.loadModels();
        };

        const globalScanBtn = document.createElement('button');
        globalScanBtn.id = 'anomalous-global-scan-btn';
        globalScanBtn.textContent = t('sidebarGlobalQuickScan');
        styleHubBtn(globalScanBtn);

        globalScanBtn.onclick = async () => {
            if (!confirm(t('sidebarGlobalQuickConfirm'))) return;
            globalScanBtn.textContent = t('sidebarScanning');
            globalScanBtn.disabled = true;
            try {
                const res = await fetch('/anomalous/scan_all', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        use_local_metadata: localStorage.getItem('anomalous_local_metadata_scan') !== 'false',
                        skip_rename: true,
                        skip_media: true
                    })
                });
                const data = await res.json();
                if (data.status === 'ok') {
                    updateScanProgress({ scanning: true, phase: 'preparing', recovered: data.recovered });
                    alert(t('sidebarGlobalStarted'));
                    const pollTimer = setInterval(async () => {
                        try {
                            const statusRes = await fetch('/anomalous/global_scan_status');
                            const statusData = await statusRes.json();
                            updateScanProgress(statusData);
                            if (!statusData.scanning) {
                                clearInterval(pollTimer);
                                if (statusData.interrupted) failScanProgress(t('scanProgressInterrupted'));
                                else finishScanProgress();
                                globalScanBtn.textContent = t('sidebarScanDone');
                                setTimeout(() => {
                                    globalScanBtn.textContent = t('sidebarGlobalQuickScanShort');
                                    globalScanBtn.disabled = false;
                                }, 3000);
                            }
                        } catch (e) { }
                    }, 3000);
                } else {
                    failScanProgress(t('sidebarError') + data.message);
                    alert(t('sidebarError') + data.message);
                    globalScanBtn.disabled = false;
                }
            } catch (e) {
                failScanProgress(String(e));
                globalScanBtn.disabled = false;
            }
        };

        const localParseToggleBtn = document.createElement('button');
        localParseToggleBtn.id = 'anomalous-local-parse-toggle-btn';
        const renderLocalParseToggleBtn = () => {
            let isLocalEnabled = localStorage.getItem('anomalous_local_metadata_scan') !== 'false';
            localParseToggleBtn.textContent = t(isLocalEnabled ? 'sidebarLocalScanOn' : 'sidebarLocalScanOff');
        };
        renderLocalParseToggleBtn();
        styleHubBtn(localParseToggleBtn);
        localParseToggleBtn.onclick = () => {
            let isLocalEnabled = localStorage.getItem('anomalous_local_metadata_scan') !== 'false';
            localStorage.setItem('anomalous_local_metadata_scan', isLocalEnabled ? 'false' : 'true');
            renderLocalParseToggleBtn();
        };


        const checkUnscannedBtn = document.createElement('button');
        checkUnscannedBtn.id = 'anomalous-check-unscanned-btn';
        checkUnscannedBtn.textContent = t('sidebarCheckMissing');
        styleHubBtn(checkUnscannedBtn);
        checkUnscannedBtn.onclick = async () => {
            checkUnscannedBtn.textContent = t('sidebarChecking');
            checkUnscannedBtn.disabled = true;
            try {
                const res = await fetch('/anomalous/all_hashes');
                const data = await res.json();
                const hashesObj = data.hashes ? data.hashes : data;
                let hasUnscanned = false;
                for (const key in hashesObj) {
                    if (hashesObj[key].hash === "") {
                        hasUnscanned = true;
                        break;
                    }
                }

                if (hasUnscanned) {
                    checkUnscannedBtn.textContent = t('sidebarMissingScanning');
                    const scanRes = await fetch('/anomalous/scan_all', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            use_local_metadata: localStorage.getItem('anomalous_local_metadata_scan') !== 'false'
                        })
                    });
                    const scanData = await scanRes.json();
                    if (scanData.status === 'ok') {
                        updateScanProgress({ scanning: true, phase: 'preparing', recovered: scanData.recovered });
                        const pollTimer = setInterval(async () => {
                            try {
                                const statusRes = await fetch('/anomalous/global_scan_status');
                                const statusData = await statusRes.json();
                                updateScanProgress(statusData);
                                if (!statusData.scanning) {
                                    clearInterval(pollTimer);
                                    if (statusData.interrupted) failScanProgress(t('scanProgressInterrupted'));
                                    else finishScanProgress();
                                    checkUnscannedBtn.textContent = t('sidebarInfoComplete');
                                    setTimeout(() => {
                                        checkUnscannedBtn.textContent = t('sidebarCheckMissing');
                                        checkUnscannedBtn.disabled = false;
                                    }, 3000);
                                }
                            } catch (e) { }
                        }, 3000);
                    } else {
                        failScanProgress(t('sidebarError') + scanData.message);
                        alert(t('sidebarError') + scanData.message);
                        checkUnscannedBtn.disabled = false;
                        checkUnscannedBtn.textContent = t('sidebarCheckMissing');
                    }
                } else {
                    checkUnscannedBtn.textContent = t('sidebarAllInfoComplete');
                    setTimeout(() => {
                        checkUnscannedBtn.textContent = t('sidebarCheckMissing');
                        checkUnscannedBtn.disabled = false;
                    }, 3000);
                }
            } catch (e) {
                failScanProgress(String(e));
                checkUnscannedBtn.disabled = false;
                checkUnscannedBtn.textContent = t('sidebarCheckMissing');
            }
        };

        const scaleContainer = document.createElement('div');
        scaleContainer.style.display = 'flex';
        scaleContainer.style.alignItems = 'center';
        scaleContainer.style.justifyContent = 'space-between';
        scaleContainer.style.background = '#1a1a1a';
        scaleContainer.style.padding = '8px 12px';
        scaleContainer.style.borderRadius = '4px';
        scaleContainer.style.border = '2px solid #555';
        scaleContainer.style.marginBottom = '4px';

        const scaleLabel = document.createElement('span');
        scaleLabel.id = 'anomalous-scale-label';
        scaleLabel.textContent = t('sidebarUiScale');
        scaleLabel.style.color = '#ccc';
        scaleLabel.style.fontSize = '0.9em';

        let currentScale = parseFloat(savedScale);

        const controlsWrapper = document.createElement('div');
        controlsWrapper.style.display = 'flex';
        controlsWrapper.style.alignItems = 'center';
        controlsWrapper.style.gap = '8px';

        const scaleVal = document.createElement('span');
        scaleVal.innerText = `${Math.round(currentScale * 100)}%`;
        scaleVal.style.color = '#fff';
        scaleVal.style.fontSize = '0.9em';
        scaleVal.style.minWidth = '45px';
        scaleVal.style.textAlign = 'center';

        const createScaleBtn = (text, delta) => {
            const btn = document.createElement('button');
            btn.innerText = text;
            btn.style.background = '#333';
            btn.style.color = '#fff';
            btn.style.border = '1px solid #555';
            btn.style.borderRadius = '4px';
            btn.style.width = '24px';
            btn.style.height = '24px';
            btn.style.cursor = 'pointer';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.onmouseover = () => btn.style.background = '#444';
            btn.onmouseout = () => btn.style.background = '#333';
            btn.onclick = () => {
                currentScale = Math.max(0.5, Math.min(1.5, currentScale + delta));
                scaleVal.innerText = `${Math.round(currentScale * 100)}%`;
                container.style.setProperty('--anomalous-scale', currentScale);
                localStorage.setItem('anomalous_ui_scale', currentScale);
            };
            return btn;
        };

        const minusBtn = createScaleBtn('-', -0.1);
        const plusBtn = createScaleBtn('+', 0.1);

        controlsWrapper.appendChild(minusBtn);
        controlsWrapper.appendChild(scaleVal);
        controlsWrapper.appendChild(plusBtn);

        scaleContainer.appendChild(scaleLabel);
        scaleContainer.appendChild(controlsWrapper);

        const resetBtn = document.createElement('button');
        resetBtn.id = 'anomalous-reset-btn';
        resetBtn.textContent = t('sidebarResetLayout');
        styleHubBtn(resetBtn);
        resetBtn.onclick = () => {
            if (confirm(t('sidebarResetConfirm'))) {
                localStorage.removeItem('anomalous_pos_x');
                localStorage.removeItem('anomalous_pos_y');
                localStorage.removeItem('anomalous_width');
                localStorage.removeItem('anomalous_height');
                localStorage.removeItem('anomalous_docked');
                localStorage.removeItem('anomalous_ui_scale');
                container.style.left = '5%';
                container.style.top = '5%';
                container.style.width = '90%';
                container.style.height = '90%';
                container.style.setProperty('--anomalous-scale', '1');
                currentScale = 1;
                scaleVal.innerText = '100%';
                if (container.classList.contains('anomalous-docked')) {
                    container.classList.remove('anomalous-docked');
                }
            }
        };

        const hashToggleBtn = document.createElement('button');
        hashToggleBtn.id = 'anomalous-hash-toggle-btn';
        styleHubBtn(hashToggleBtn);
        const updateHashToggleBtn = () => {
            const isInject = localStorage.getItem('anomalous_inject_hash') !== 'false';
            hashToggleBtn.textContent = t(isInject ? 'sidebarInjectHash' : 'sidebarSkipHash');
        };
        updateHashToggleBtn();
        hashToggleBtn.onclick = () => {
            const isInject = localStorage.getItem('anomalous_inject_hash') !== 'false';
            localStorage.setItem('anomalous_inject_hash', isInject ? 'false' : 'true');
            updateHashToggleBtn();
        };

        const folderManagerBtn = document.createElement('button');
        folderManagerBtn.id = 'anomalous-folder-manager-btn';
        folderManagerBtn.textContent = t('sidebarManageFolders');
        styleHubBtn(folderManagerBtn);
        folderManagerBtn.onclick = () => {
            if (settingsHubModal.style.display !== 'none') {
                settingsHubModal.style.display = 'none';
                settingsBtn.style.color = '#ccc';
            }
            this.openFolderManager();
        };

        // Many redundant buttons have been migrated to the Wizard!
        
        const feedbackBtn = document.createElement('button');
        feedbackBtn.id = 'anomalous-feedback-btn';
        feedbackBtn.textContent = t('sidebarFeedback');
        styleHubBtn(feedbackBtn);
        feedbackBtn.onclick = () => {
            window.open('https://github.com/DemonGatanjieu/Anomalous_Model_Browser/issues', '_blank');
            if (settingsHubModal.style.display !== 'none') {
                settingsHubModal.style.display = 'none';
                settingsBtn.style.color = '#ccc';
            }
        };
        
        settingsHubModal.appendChild(folderManagerBtn);
        settingsHubModal.appendChild(modelSettingsBtn);
        settingsHubModal.appendChild(scaleContainer);
        settingsHubModal.appendChild(langBtn);
        settingsHubModal.appendChild(helpBtn);
        settingsHubModal.appendChild(feedbackBtn);
        settingsHubModal.appendChild(resetBtn);

        this.sidebarWrapper.appendChild(settingsHubModal);

        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'anomalous-global-settings-btn';
        settingsBtn.innerHTML = `⚙️`;
        settingsBtn.title = t('sidebarSettings');
        settingsBtn.style.background = 'transparent';
        settingsBtn.style.color = '#ccc';
        settingsBtn.style.border = 'none';
        settingsBtn.style.borderRadius = '6px';
        settingsBtn.style.padding = '6px';
        settingsBtn.style.fontSize = '1.1em';
        settingsBtn.style.marginLeft = 'auto';
        settingsBtn.style.cursor = 'pointer';
        settingsBtn.style.transition = 'all 0.2s ease';
        settingsBtn.onmouseover = () => { settingsBtn.style.background = 'rgba(255,255,255,0.1)'; settingsBtn.style.color = '#fff'; };
        settingsBtn.onmouseout = () => { settingsBtn.style.background = 'transparent'; settingsBtn.style.color = '#ccc'; };
        const closeSettingsHub = (e) => {
            if (settingsHubModal.style.display !== 'none' && !settingsHubModal.contains(e.target) && !settingsBtn.contains(e.target)) {
                settingsHubModal.style.display = 'none';
                settingsBtn.style.color = '#ccc';
                document.removeEventListener('mousedown', closeSettingsHub);
            }
        };

        settingsBtn.onclick = () => {
            if (settingsHubModal.style.display === 'none') {
                settingsHubModal.style.display = 'flex';
                settingsBtn.style.color = '#fff';
                // Delay adding the listener slightly to avoid triggering it on the same click
                setTimeout(() => document.addEventListener('mousedown', closeSettingsHub), 10);
            } else {
                settingsHubModal.style.display = 'none';
                settingsBtn.style.color = '#ccc';
                document.removeEventListener('mousedown', closeSettingsHub);
            }
        };

        const importBtn = document.createElement('button');
        importBtn.id = 'anomalous-import-btn';
        importBtn.title = t('importBtn');
        importBtn.innerHTML = `📥`;
        importBtn.style.background = 'transparent';
        importBtn.style.color = '#ccc';
        importBtn.style.border = 'none';
        importBtn.style.borderRadius = '6px';
        importBtn.style.padding = '6px';
        importBtn.style.fontSize = '1.1em';
        importBtn.style.cursor = 'pointer';
        importBtn.style.transition = 'all 0.2s ease';
        importBtn.onmouseover = () => { importBtn.style.background = 'rgba(255,255,255,0.1)'; importBtn.style.color = '#fff'; };
        importBtn.onmouseout = () => { importBtn.style.background = 'transparent'; importBtn.style.color = '#ccc'; };
        importBtn.onclick = () => {
            if (window.AMB_WorkflowShare) {
                window.AMB_WorkflowShare.showUnifiedModal();
            } else {
                alert(t('sidebarModuleNotLoaded'));
            }
        };


        const doctorBtn = document.createElement('button');
        doctorBtn.id = 'anomalous-doctor-btn';
        doctorBtn.title = t('sidebarDoctor');
        doctorBtn.innerHTML = `🩺`;
        doctorBtn.style.background = 'transparent';
        doctorBtn.style.color = '#ccc';
        doctorBtn.style.border = 'none';
        doctorBtn.style.borderRadius = '6px';
        doctorBtn.style.padding = '6px';
        doctorBtn.style.fontSize = '1.1em';
        doctorBtn.style.cursor = 'pointer';
        doctorBtn.style.transition = 'all 0.2s ease';
        doctorBtn.onmouseover = () => { doctorBtn.style.background = 'rgba(255,255,255,0.1)'; doctorBtn.style.color = '#fff'; };
        doctorBtn.onmouseout = () => { doctorBtn.style.background = 'transparent'; doctorBtn.style.color = '#ccc'; };
        doctorBtn.onclick = async () => {
            this.hideAllPanels();
            if (localStorage.getItem('anomalous_user_sidebar_closed') === 'true') {
                container.classList.add('anomalous-sidebar-closed');
            } else {
                container.classList.remove('anomalous-sidebar-closed');
            }
            menuBtn.disabled = false;
            menuBtn.style.opacity = '1';
            menuBtn.style.cursor = 'pointer';
            this.doctorPanel.style.display = 'flex';
            if (!this.doctorPanelInitialized) {
                this.initDoctorPanel();
            }
            // Trigger auto hash-resolve when opening Doctor
            if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
            if (window.anomalous_resolve_all_missing_nodes) {
                await window.anomalous_resolve_all_missing_nodes(true, false);
            }
            this.renderGlobalDashboard();
        };

        const assistantBtn = document.createElement('button');
        assistantBtn.id = 'anomalous-assistant-btn';
        assistantBtn.title = t('sidebarAssistant');
        assistantBtn.innerHTML = `🤖`;
        assistantBtn.style.background = 'transparent';
        assistantBtn.style.color = '#ccc';
        assistantBtn.style.border = 'none';
        assistantBtn.style.borderRadius = '6px';
        assistantBtn.style.padding = '6px';
        assistantBtn.style.fontSize = '1.1em';
        assistantBtn.style.cursor = 'pointer';
        assistantBtn.style.transition = 'all 0.2s ease';
        assistantBtn.onmouseover = () => { assistantBtn.style.background = 'rgba(255,255,255,0.1)'; assistantBtn.style.color = '#fff'; };
        assistantBtn.onmouseout = () => { assistantBtn.style.background = 'transparent'; assistantBtn.style.color = '#ccc'; };
        assistantBtn.onclick = async () => {
            this.hideAllPanels();
            if (localStorage.getItem('anomalous_user_sidebar_closed') === 'true') {
                container.classList.add('anomalous-sidebar-closed');
            } else {
                container.classList.remove('anomalous-sidebar-closed');
            }
            menuBtn.disabled = false;
            menuBtn.style.opacity = '1';
            menuBtn.style.cursor = 'pointer';
            this.assistantPanel.style.display = 'flex';
            if (!this.assistantPanelInitialized) {
                this.initAssistantPanel();
            }
            // Show current selected node immediately
            if (Object.keys(app.canvas.selected_nodes || {}).length > 0) {
                const firstSelected = Object.values(app.canvas.selected_nodes)[0];
                this.diagnoseNode(firstSelected);
            } else {
                this.diagnoseNode(null);
            }
        };

        this.sidebarActions.appendChild(doctorBtn);
        this.sidebarActions.appendChild(assistantBtn);
        this.sidebarActions.appendChild(importBtn);
        this.sidebarActions.appendChild(settingsBtn);

        this.grid = document.createElement('div');
        this.grid.id = 'anomalous-grid';

        this.detailPanel = document.createElement('div');
        this.detailPanel.id = 'anomalous-detail';
        this.detailPanel.style.display = 'none';

        this.galleryPanel = document.createElement('div');
        this.galleryPanel.id = 'anomalous-gallery-panel';

        this.doctorPanel = document.createElement('div');
        this.doctorPanel.id = 'anomalous-doctor-panel';
        this.doctorPanel.style.display = 'none';
        this.doctorPanel.style.flexDirection = 'column';
        this.doctorPanel.style.flex = '1';
        this.doctorPanel.style.overflowY = 'auto';
        this.doctorPanel.style.boxSizing = 'border-box';
        this.doctorPanelInitialized = false;

        this.assistantPanel = document.createElement('div');
        this.assistantPanel.id = 'anomalous-assistant-panel';
        this.assistantPanel.style.display = 'none';
        this.assistantPanel.style.flexDirection = 'column';
        this.assistantPanel.style.flex = '1';
        this.assistantPanel.style.overflowY = 'auto';
        this.assistantPanel.style.boxSizing = 'border-box';
        this.assistantPanelInitialized = false;

        this.galleryGrid = document.createElement('div');
        this.galleryGrid.className = 'anomalous-gallery-grid';
        this.galleryPanel.appendChild(this.galleryGrid);

        this.gallerySentinel = document.createElement('div');
        this.gallerySentinel.className = 'anomalous-gallery-sentinel';
        this.galleryGrid.appendChild(this.gallerySentinel);

        this.galleryCurrentPage = 1;
        this.galleryLoaded = false;
        this.galleryLoading = false;
        this.galleryHasMore = true;

        if (typeof IntersectionObserver === 'function') {
            this.galleryObserver = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting && !this.galleryLoading && this.galleryHasMore) {
                    this.loadGalleryImages(this.galleryCurrentPage + 1);
                }
            }, { root: this.galleryGrid, rootMargin: '100px' });
            this.galleryObserver.observe(this.gallerySentinel);
        } else {
            // Some embedded ComfyUI webviews do not expose IntersectionObserver.
            // The gallery still opens and loads its first page; do not abort the
            // whole extension setup when infinite scroll is unavailable.
            this.galleryObserver = null;
        }

        this.nbPanel = document.createElement('div');
        this.nbPanel.className = 'anomalous-nb-modal';
        this.nbPanel.style.display = 'none';
        this.nbPanel.onclick = (e) => {
            if (e.target === this.nbPanel) this.closeWorkspace();
        };

        content.appendChild(header);
        content.appendChild(this.grid);
        content.appendChild(this.detailPanel);
        content.appendChild(this.galleryPanel);
        content.appendChild(this.doctorPanel);
        content.appendChild(this.assistantPanel);

        container.appendChild(this.sidebarWrapper);
        container.appendChild(content);
        container.appendChild(this.nbPanel);

        this.modal.appendChild(container);

        // Resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'anomalous-resize-handle';
        let isResizing = false;
        resizeHandle.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            isResizing = true;
        };
        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const rect = container.getBoundingClientRect();
            let newWidth = e.clientX - rect.left;
            let newHeight = e.clientY - rect.top;
            if (newWidth < 600) newWidth = 600;
            if (newHeight < 400) newHeight = 400;
            container.style.width = newWidth + 'px';
            container.style.height = newHeight + 'px';
        });
        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                localStorage.setItem('anomalous_width', container.style.width);
                localStorage.setItem('anomalous_height', container.style.height);
            }
        });
        const savedW = localStorage.getItem('anomalous_width');
        const savedH = localStorage.getItem('anomalous_height');
        if (savedW) container.style.width = savedW;
        if (savedH) container.style.height = savedH;

        container.appendChild(resizeHandle);
        document.body.appendChild(this.modal);
    }



export function renderSidebar() {
        this.sidebar.innerHTML = '';

        const topBar = document.createElement('div');
        topBar.style.display = 'flex';
        topBar.style.justifyContent = 'space-between';
        topBar.style.alignItems = 'center';
        topBar.style.padding = '10px 15px 15px 15px';

        const title = document.createElement('h3');
        title.innerHTML = t('folders');
        title.style.color = '#fff';
        title.style.margin = '0';

        const isAllCollapsed = this.expandedFolders.size === 0;
        const collapseAllBtn = document.createElement('button');
        collapseAllBtn.textContent = t(isAllCollapsed ? 'sidebarExpandAll' : 'sidebarCollapseAll');
        collapseAllBtn.style.padding = '4px 8px';
        collapseAllBtn.style.background = '#444';
        collapseAllBtn.style.color = '#fff';
        collapseAllBtn.style.border = 'none';
        collapseAllBtn.style.borderRadius = '4px';
        collapseAllBtn.style.cursor = 'pointer';
        collapseAllBtn.onclick = () => {
            if (isAllCollapsed) {
                (this.foldersData || []).forEach(typeGroup => {
                    this.expandedFolders.add(typeGroup.type);
                    Object.keys(typeGroup.folders).forEach(path => {
                        this.expandedFolders.add(typeGroup.type + path);
                    });
                });
            } else {
                this.expandedFolders.clear();
            }
            this.renderSidebar();
        };

        topBar.appendChild(title);
        topBar.appendChild(collapseAllBtn);
        this.sidebar.appendChild(topBar);

        const searchBox = document.createElement('div');
        searchBox.style.padding = '0 15px 15px 15px';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = t('sidebarSearchModels');
        searchInput.style.width = '100%';
        searchInput.style.padding = '8px 12px';
        searchInput.style.borderRadius = '8px';
        searchInput.style.border = '1px solid rgba(255,255,255,0.1)';
        searchInput.style.background = 'rgba(0,0,0,0.2)';
        searchInput.style.color = '#fff';
        searchInput.style.boxSizing = 'border-box';
        searchInput.style.outline = 'none';
        searchInput.style.transition = 'border-color 0.2s';
        searchInput.onfocus = () => searchInput.style.border = '1px solid #007aff';
        searchInput.onblur = () => searchInput.style.border = '1px solid rgba(255,255,255,0.1)';

        searchInput.oninput = (e) => {
            if (this.currentDetailModel) {
                this.detailPanel.style.display = 'none';
                this.stopMediaInContainer(this.detailPanel);
                this.detailPanel.innerHTML = '';
                this.currentDetailModel = null;
                this.grid.style.display = 'grid';
            }
            const val = e.target.value.toLowerCase();
            const cards = this.grid.querySelectorAll('.anomalous-card');
            cards.forEach(card => {
                const titleEl = card.querySelector('.anomalous-card-title');
                if (!titleEl) return;
                const titleText = titleEl.innerText.toLowerCase();
                if (titleText.includes(val)) {
                    card.style.display = 'flex';
                } else {
                    card.style.display = 'none';
                }
            });
        };

        searchBox.appendChild(searchInput);
        this.sidebar.appendChild(searchBox);

        (this.foldersData || []).forEach(typeGroup => {
            const header = document.createElement('div');
            header.className = 'anomalous-type-header';
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.cursor = 'pointer';

            const isTypeExpanded = this.expandedFolders.has(typeGroup.type);
            header.innerHTML = `<span>${escapeHtml(typeGroup.label)}</span> <span>${isTypeExpanded ? '▼' : '▶'}</span>`;

            header.onclick = () => {
                if (isTypeExpanded) this.expandedFolders.delete(typeGroup.type);
                else this.expandedFolders.add(typeGroup.type);
                this.renderSidebar();
            };
            this.sidebar.appendChild(header);

            if (!isTypeExpanded) return;

            const sortedPaths = Object.keys(typeGroup.folders).sort();

            sortedPaths.forEach(path => {
                const info = typeGroup.folders[path];
                const parts = path.split('/').filter(p => p);
                const parentPath = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : '/';

                if (path !== '/' && parentPath !== '/') {
                    let parentId = typeGroup.type + parentPath;
                    if (!this.expandedFolders.has(parentId)) return;
                }

                const hasChildren = sortedPaths.some(p => p !== path && p.startsWith(path === '/' ? '/' : path + '/'));

                const item = document.createElement('div');
                item.className = 'anomalous-folder-item';

                const depth = path === '/' ? 0 : parts.length;
                item.style.paddingLeft = (15 + depth * 15) + 'px';

                const myId = typeGroup.type + path;
                const isExpanded = this.expandedFolders.has(myId);

                let toggleIcon = '';
                if (hasChildren) {
                    toggleIcon = `<span class="anomalous-folder-toggle" style="margin-right: 8px; width: 12px; display: inline-block; font-size: 0.8em; color: #888;">${isExpanded ? '▼' : '▶'}</span>`;
                } else {
                    toggleIcon = `<span style="margin-right: 8px; width: 12px; display: inline-block;"></span>`;
                }

                item.innerHTML = `${toggleIcon}<span class="anomalous-folder-name" style="color: #ddd;">${escapeHtml(info.name)}</span> <span style="opacity:0.4; font-size:0.8em; margin-left: 5px;">${escapeHtml(info.model_count)}</span>`;

                if (this.currentType === typeGroup.type && this.currentPathIdx === typeGroup.path_idx && this.currentSubfolder === path) {
                    item.classList.add('active');
                }

                item.onclick = (e) => {
                    if (e.target.classList.contains('anomalous-folder-toggle')) {
                        if (isExpanded) this.expandedFolders.delete(myId);
                        else this.expandedFolders.add(myId);
                        this.renderSidebar();
                        return;
                    }
                    this.currentType = typeGroup.type;
                    this.currentPathIdx = typeGroup.path_idx;
                    this.currentSubfolder = path;

                    this.hideAllPanels();
                    this.grid.style.display = 'grid';

                    this.renderSidebar();
                    this.loadModels();
                };

                this.sidebar.appendChild(item);
            });
        });
    }



export async function loadFolders() {
        try {
            const res = await fetch('/anomalous/folders');
            const data = await res.json();
            this.foldersData = data.folders || [];

            if (!this.firstLoadDone && this.foldersData.length > 0) {
                this.firstLoadDone = true;
                let found = false;
                for (const typeGroup of this.foldersData) {
                    const sortedPaths = Object.keys(typeGroup.folders).sort();
                    for (const path of sortedPaths) {
                        if (typeGroup.folders[path].model_count > 0) {
                            this.currentType = typeGroup.type;
                            this.currentPathIdx = typeGroup.path_idx;
                            this.currentSubfolder = path;
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }
            }

            // Auto expand all
            (this.foldersData || []).forEach(typeGroup => {
                this.expandedFolders.add(typeGroup.type);
                Object.keys(typeGroup.folders).forEach(path => {
                    this.expandedFolders.add(typeGroup.type + path);
                });
            });

            this.renderSidebar();
            this.loadModels();
        } catch (e) { }
    }




export function showHelp() {
        if (this.helpModal) {
            this.helpModal.remove();
        }
        this.helpModal = document.createElement('div');
        this.helpModal.style.position = 'absolute';
        this.helpModal.style.top = '0';
        this.helpModal.style.left = '0';
        this.helpModal.style.width = '100%';
        this.helpModal.style.height = '100%';
        this.helpModal.style.background = 'rgba(0,0,0,0.85)';
        this.helpModal.style.zIndex = '9999';
        this.helpModal.style.display = 'flex';
        this.helpModal.style.alignItems = 'center';
        this.helpModal.style.justifyContent = 'center';

        const box = document.createElement('div');
        box.style.background = 'var(--bg-color, #222)';
        box.style.border = '1px solid var(--border-color, #444)';
        box.style.borderRadius = '8px';
        box.style.width = '550px';
        box.style.maxWidth = '90%';
        box.style.boxShadow = '0 10px 40px rgba(0,0,0,0.8)';
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        box.style.maxHeight = '90vh';

        const header = document.createElement('div');
        header.style.padding = '15px 20px';
        header.style.borderBottom = '1px solid #444';
        header.style.background = '#333';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';

        const title = document.createElement('h2');
        title.innerHTML = t('helpTitle');
        title.style.margin = '0';
        title.style.color = '#fff';
        title.style.fontSize = '1.2em';

        const closeX = document.createElement('div');
        closeX.innerHTML = '&times;';
        closeX.style.position = 'absolute';
        closeX.style.top = '10px';
        closeX.style.right = '15px';
        closeX.style.fontSize = '1.8em';
        closeX.style.cursor = 'pointer';
        closeX.style.color = '#ff4444';
        closeX.onclick = () => this.helpModal.remove();

        header.appendChild(title);
        header.appendChild(closeX);

        const body = document.createElement('div');
        body.style.padding = '20px';
        body.innerHTML = t('helpContent');
        body.style.overflowY = 'auto';
        body.style.flex = '1';

        const footer = document.createElement('div');
        footer.style.padding = '15px';
        footer.style.borderTop = '1px solid #444';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = t('closeHelp');
        closeBtn.style.padding = '8px 16px';
        closeBtn.style.background = '#444';
        closeBtn.style.color = '#fff';
        closeBtn.style.border = 'none';
        closeBtn.style.borderRadius = '4px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => this.helpModal.remove();

        footer.appendChild(closeBtn);

        box.appendChild(header);
        box.appendChild(body);
        box.appendChild(footer);
        this.helpModal.appendChild(box);

        document.getElementById('anomalous-container').appendChild(this.helpModal);
    }



export function hideAllPanels() {
        const abandonedRecipeModel = typeof this.recipeModelReturn === 'function';
        this.recipeModelReturn = null;
        if (abandonedRecipeModel) {
            this.recipeReturnState = null;
            delete this.recipeDetailPayload;
            if (this.recipeListContainer) this.recipeListContainer.style.display = '';
            const actionbar = this.recipeView?.querySelector('.anomalous-recipe-actionbar');
            if (actionbar) actionbar.style.display = '';
            if (this.detailPanel) {
                this.stopMediaInContainer?.(this.detailPanel);
                this.detailPanel.replaceChildren();
            }
            this.currentDetailModel = null;
            this.historyStack = [];
        }
        this.grid.style.display = 'none';
        this.detailPanel.style.display = 'none';
        if (this.galleryPanel) this.galleryPanel.style.display = 'none';
        if (this.nbPanel) this.nbPanel.style.display = 'none';
        if (this.doctorPanel) this.doctorPanel.style.display = 'none';
        if (this.assistantPanel) this.assistantPanel.style.display = 'none';
        if (this.paramPanel) this.paramPanel.style.display = 'none';
        if (this.currentDetailObserver) {
            this.currentDetailObserver.disconnect();
            this.currentDetailObserver = null;
        }
    }

export async function openFolderManager() {
    let modal = document.getElementById('anomalous-folder-manager-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'anomalous-folder-manager-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.backgroundColor = 'rgba(0,0,0,0.7)';
    modal.style.zIndex = '9999999';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.fontFamily = 'Roboto, "Segoe UI", sans-serif';

    const content = document.createElement('div');
    content.style.background = '#1e1e1e';
    content.style.borderRadius = '12px';
    content.style.padding = '24px';
    content.style.width = '500px';
    content.style.maxWidth = '90%';
    content.style.maxHeight = '85vh';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';

    const header = document.createElement('h2');
    header.textContent = t('sidebarFolderManagerTitle');
    header.style.margin = '0 0 16px 0';
    header.style.color = '#fff';
    header.style.fontSize = '1.4em';
    content.appendChild(header);

    const desc = document.createElement('div');
    desc.textContent = t('sidebarFolderManagerDesc');
    desc.style.color = '#aaa';
    desc.style.fontSize = '0.9em';
    desc.style.marginBottom = '20px';
    desc.style.lineHeight = '1.5';
    content.appendChild(desc);

    const toggleContainer = document.createElement('div');
    toggleContainer.style.display = 'flex';
    toggleContainer.style.alignItems = 'center';
    toggleContainer.style.justifyContent = 'center';
    toggleContainer.style.marginBottom = '15px';
    toggleContainer.style.gap = '20px';
    toggleContainer.style.background = '#222';
    toggleContainer.style.padding = '10px';
    toggleContainer.style.borderRadius = '8px';
    toggleContainer.style.border = '1px solid #444';

    const abstractRadio = document.createElement('input');
    abstractRadio.type = 'radio';
    abstractRadio.name = 'viewMode';
    abstractRadio.value = 'abstract';
    abstractRadio.id = 'anomalous_mode_abstract';
    
    const abstractLabel = document.createElement('label');
    abstractLabel.htmlFor = 'anomalous_mode_abstract';
    abstractLabel.textContent = t('sidebarCategoryMode');
    abstractLabel.style.cursor = 'pointer';
    abstractLabel.style.color = '#ccc';

    const physicalRadio = document.createElement('input');
    physicalRadio.type = 'radio';
    physicalRadio.name = 'viewMode';
    physicalRadio.value = 'physical';
    physicalRadio.id = 'anomalous_mode_physical';

    const physicalLabel = document.createElement('label');
    physicalLabel.htmlFor = 'anomalous_mode_physical';
    physicalLabel.textContent = t('sidebarPhysicalMode');
    physicalLabel.style.cursor = 'pointer';
    physicalLabel.style.color = '#ccc';
    
    const div1 = document.createElement('div');
    div1.style.display = 'flex';
    div1.style.alignItems = 'center';
    div1.style.gap = '6px';
    div1.appendChild(abstractRadio);
    div1.appendChild(abstractLabel);

    const div2 = document.createElement('div');
    div2.style.display = 'flex';
    div2.style.alignItems = 'center';
    div2.style.gap = '6px';
    div2.appendChild(physicalRadio);
    div2.appendChild(physicalLabel);

    toggleContainer.appendChild(div1);
    toggleContainer.appendChild(div2);
    content.appendChild(toggleContainer);

    const listContainer = document.createElement('div');
    listContainer.style.flex = '1';
    listContainer.style.overflowY = 'auto';
    listContainer.style.border = '1px solid #444';
    listContainer.style.borderRadius = '8px';
    listContainer.style.background = '#2a2a2a';
    listContainer.style.padding = '8px';

    content.appendChild(listContainer);

    let typesData = [];
    let currentMode = 'abstract';
    
    const fetchData = async () => {
        try {
            const res = await fetch('/anomalous/all_folder_types');
            const data = await res.json();
            typesData = data.folder_types || [];
            currentMode = data.folder_view_mode || 'abstract';
            
            if (currentMode === 'physical') {
                physicalRadio.checked = true;
            } else {
                abstractRadio.checked = true;
            }
            
            typesData.sort((a, b) => {
                if (a.visible && !b.visible) return -1;
                if (!a.visible && b.visible) return 1;
                return 0;
            });
            renderList();
        } catch(e) {
            alert(t('sidebarFolderLoadFailed'));
        }
    };
    
    const onModeSwitch = async (e) => {
        const newMode = e.target.value;
        if (newMode === currentMode) return;
        
        try {
            await fetch('/anomalous/save_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder_view_mode: newMode })
            });
            await fetchData();
            this.firstLoadDone = false;
            this.expandedFolders.clear();
            await this.loadFolders();
        } catch(err) {
            alert(t('sidebarFolderModeError'));
        }
    };
    
    abstractRadio.addEventListener('change', onModeSwitch);
    physicalRadio.addEventListener('change', onModeSwitch);

    let dragSrcEl = null;

    const renderList = () => {
        listContainer.innerHTML = '';
        typesData.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'anomalous-folder-manager-row';
            row.draggable = true;
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.padding = '10px 12px';
            row.style.margin = '4px 0';
            row.style.background = '#333';
            row.style.borderRadius = '6px';
            row.style.cursor = 'grab';
            row.style.border = '1px solid transparent';
            
            row.dataset.index = index;
            row.dataset.type = item.type;
            row.dataset.visible = item.visible;

            row.addEventListener('dragstart', function(e) {
                this.style.opacity = '0.4';
                dragSrcEl = this;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', this.innerHTML);
            });

            row.addEventListener('dragover', function(e) {
                if (e.preventDefault) e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                return false;
            });

            row.addEventListener('dragenter', function(e) {
                this.style.border = '1px dashed #8AB4F8';
            });

            row.addEventListener('dragleave', function(e) {
                this.style.border = '1px solid transparent';
            });

            row.addEventListener('drop', function(e) {
                if (e.stopPropagation) e.stopPropagation();
                if (dragSrcEl !== this) {
                    const fromIdx = parseInt(dragSrcEl.dataset.index);
                    const toIdx = parseInt(this.dataset.index);
                    const movedItem = typesData.splice(fromIdx, 1)[0];
                    typesData.splice(toIdx, 0, movedItem);
                    renderList();
                }
                return false;
            });

            row.addEventListener('dragend', function(e) {
                this.style.opacity = '1';
                const rows = listContainer.querySelectorAll('.anomalous-folder-manager-row');
                rows.forEach(r => r.style.border = '1px solid transparent');
            });

            const leftGroup = document.createElement('div');
            leftGroup.style.display = 'flex';
            leftGroup.style.alignItems = 'center';
            leftGroup.style.gap = '12px';
            
            const handle = document.createElement('div');
            handle.innerHTML = '☰';
            handle.style.color = '#888';
            handle.style.cursor = 'grab';

            const name = document.createElement('div');
            name.innerText = item.type;
            name.style.color = item.visible ? '#fff' : '#666';
            name.style.fontWeight = '500';

            leftGroup.appendChild(handle);
            leftGroup.appendChild(name);

            const visBtn = document.createElement('button');
            visBtn.innerHTML = item.visible ? '👁️' : '❌';
            visBtn.style.background = 'transparent';
            visBtn.style.border = 'none';
            visBtn.style.cursor = 'pointer';
            visBtn.style.fontSize = '1.2em';
            visBtn.style.opacity = item.visible ? '1' : '0.5';
            visBtn.title = t(item.visible ? 'sidebarVisible' : 'sidebarHidden');
            
            visBtn.onclick = (e) => {
                e.stopPropagation();
                typesData[index].visible = !typesData[index].visible;
                renderList();
            };

            row.appendChild(leftGroup);
            row.appendChild(visBtn);

            listContainer.appendChild(row);
        });
    };
    fetchData(); // initial load
    
    // --- End Drag & Drop Logic ---

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '12px';
    footer.style.marginTop = '20px';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = t('sidebarCancel');
    cancelBtn.style.padding = '8px 16px';
    cancelBtn.style.background = 'transparent';
    cancelBtn.style.color = '#ccc';
    cancelBtn.style.border = '1px solid #555';
    cancelBtn.style.borderRadius = '6px';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.onclick = () => modal.remove();

    const saveBtn = document.createElement('button');
    saveBtn.textContent = t('sidebarSaveReload');
    saveBtn.style.padding = '8px 16px';
    saveBtn.style.background = '#8AB4F8';
    saveBtn.style.color = '#1e1e1e';
    saveBtn.style.border = 'none';
    saveBtn.style.borderRadius = '6px';
    saveBtn.style.cursor = 'pointer';
    saveBtn.style.fontWeight = 'bold';
    saveBtn.onclick = async () => {
        saveBtn.innerText = '⏳...';
        saveBtn.disabled = true;
        try {
            const payload = {};
            if (currentMode === 'physical') {
                payload.physical_folders_config = typesData;
            } else {
                payload.folder_types_config = typesData;
            }
            await fetch('/anomalous/save_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            modal.remove();
            
            this.firstLoadDone = false;
            this.expandedFolders.clear();
            await this.loadFolders();
        } catch(e) {
            alert(t('sidebarSaveConfigError') + e);
            saveBtn.textContent = t('sidebarSaveReload');
            saveBtn.disabled = false;
        }
    };

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    content.appendChild(footer);
    modal.appendChild(content);
    document.body.appendChild(modal);
}
