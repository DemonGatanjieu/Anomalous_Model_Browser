import { initDoctorPanel, diagnoseNode, renderGlobalDashboard, initAssistantPanel, renderAssistantModelCard, _loadAssistantHistory, _openGalleryReplacer, runGlobalDoctorScan } from './modules/ui_doctor.js';
import { app } from "../../scripts/app.js";

import { i18n } from './modules/locales.js';

// ============================================================================
// TABLE OF CONTENTS (TOC)
// 1. App Registration & Entry     (Search for "app.registerExtension")
// 2. State & Class Constructor    (Search for "class AnomalousBrowser")
// 3. UI - Sidebar                 (Search for "createDOM")
// 4. UI - Main Grid               (Search for "renderGrid")
// 5. UI - Detail Panel            (Search for "showDetail")
// 6. UI - Gallery Viewer          (Search for "createGalleryViewer")
// 7. UI - Doctor Panel            (Search for "createDoctorPanel")
// 8. Notebooks                    (Search for "Notebook")
// ============================================================================

let defaultLang = 'zh';
try {
    let comfyDetected = false;
    const aglLang = localStorage.getItem('Comfy.Settings.AIGODLIKE-COMFYUI-TRANSLATION.Language');
    if (aglLang) {
        defaultLang = aglLang.toLowerCase().includes('en') ? 'en' : 'zh';
        comfyDetected = true;
    } else {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.toLowerCase().includes('lang') || key.toLowerCase().includes('locale'))) {
                const val = localStorage.getItem(key);
                if (typeof val === 'string') {
                    const lowerVal = val.toLowerCase();
                    if (lowerVal.includes('zh') || lowerVal.includes('chinese')) {
                        defaultLang = 'zh';
                        comfyDetected = true;
                        break;
                    } else if (lowerVal.includes('en') || lowerVal.includes('english')) {
                        defaultLang = 'en';
                        comfyDetected = true;
                        break;
                    }
                }
            }
        }
    }

    if (!comfyDetected && navigator.language && !navigator.language.toLowerCase().startsWith('zh')) {
        defaultLang = 'en';
    }
} catch (e) {
    if (navigator.language && !navigator.language.toLowerCase().startsWith('zh')) {
        defaultLang = 'en';
    }
}
let currentLang = localStorage.getItem('anomalous_lang') || defaultLang;
window.anomalous_browser_lang = currentLang;
const t = (key) => i18n[currentLang][key] || key;

class AnomalousBrowser {
    constructor() {
        this.modal = null;
        this.sidebar = null;
        this.grid = null;
        this.detailPanel = null;
        this.currentType = 'loras';
        this.currentPathIdx = 0;
        this.currentSubfolder = '/';
        this.foldersData = null;
        this.expandedFolders = new Set(['/', 'checkpoints', 'loras', 'unet', 'diffusion_models']);
        this.energySaving = localStorage.getItem('anomalous_energy_saving') === 'true';
        this.createDOM();
    }

    createDOM() {
        this.modal = document.createElement('div');
        this.modal.id = 'anomalous-modal';

        const container = document.createElement('div');
        container.id = 'anomalous-container';

        const updateLangClass = () => {
            if (currentLang === 'en') container.classList.add('anomalous-lang-en');
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
        menuBtn.title = window.anomalous_browser_lang === 'zh' ? '收起/展开侧边栏' : 'Toggle Sidebar';
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
            if (!this.galleryLoaded) {
                this.loadGalleryImages(1, true);
            }
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
        nbBtn.title = t('notebookTitle');
        nbBtn.innerHTML = `📑 <span class="anomalous-btn-text">${t('notebooks')}</span>`;

        const dBtn = document.getElementById('anomalous-doctor-btn');
        if (dBtn) dBtn.title = window.anomalous_browser_lang === 'zh' ? '模型医生' : 'Model Doctor';
        const aBtn = document.getElementById('anomalous-assistant-btn');
        if (aBtn) aBtn.title = window.anomalous_browser_lang === 'zh' ? '节点助手' : 'Node Assistant';
        const iBtn = document.getElementById('anomalous-import-btn');
        if (iBtn) iBtn.title = window.anomalous_browser_lang === 'zh' ? '📥 预检导入工作流' : '📥 Preflight Import';
        const sBtn = document.getElementById('anomalous-settings-btn');
        if (sBtn) sBtn.title = window.anomalous_browser_lang === 'zh' ? '设置中心' : 'Settings Hub';

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
            const current = localStorage.getItem('anomalous_api_key') || '';
            const val = prompt(t('apiKeyPrompt'), current);
            if (val !== null) {
                localStorage.setItem('anomalous_api_key', val.trim());
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
        scanBtn.title = window.anomalous_browser_lang === 'zh' ? '🔄 扫描向导 (Scan Wizard)' : '🔄 Scan Wizard';
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
                if (this.currentType) {
                    const params = new URLSearchParams({ type: this.currentType, path_idx: this.currentPathIdx || 0, subfolder: this.currentSubfolder || '/' });
                    const resLocal = await fetch('/anomalous/scan_status?' + params.toString());
                    const dataLocal = await resLocal.json();
                    if (dataLocal.scanning) isScanning = true;
                }
                const resGlobal = await fetch('/anomalous/global_scan_status');
                const dataGlobal = await resGlobal.json();
                if (dataGlobal.scanning) isScanning = true;

                if (isScanning && !isCurrentlyScanning) {
                    isCurrentlyScanning = true;
                    scanBtn.innerHTML = `⏳`;
                    scanBtn.style.opacity = '0.7';
                } else if (!isScanning && isCurrentlyScanning) {
                    isCurrentlyScanning = false;
                    scanBtn.innerHTML = `🔄`;
                    scanBtn.style.opacity = '1';
                    this.loadModels();
                    if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
                    alert(window.anomalous_browser_lang === 'zh' ? '✅ 扫描/重命名已完成！数据已为您更新。' : '✅ Scan/Rename completed! Data updated.');
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
                title.innerText = window.anomalous_browser_lang === 'zh'
                    ? `🎯 单模型扫描向导: ${targetFiles}`
                    : `🎯 Single Model Scan: ${targetFiles}`;
            } else {
                title.innerText = window.anomalous_browser_lang === 'zh'
                    ? (isGlobal ? '全局扫描向导' : '扫描向导')
                    : (isGlobal ? 'Global Scan Wizard' : 'Scan Wizard');
            }
            title.style.margin = '0';
            title.style.fontSize = '1.6em';
            title.style.fontWeight = '500';

            // Toolbar right
            const topToolbar = document.createElement('div');
            topToolbar.style.display = 'flex';
            topToolbar.style.gap = '8px';

            const createGhostBtn = (icon, textZh, textEn, onClick) => {
                const btn = document.createElement('button');
                btn.innerHTML = `${icon} ${window.anomalous_browser_lang === 'zh' ? textZh : textEn}`;
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

            const apiKeyBtn = createGhostBtn('🔑', 'API 密钥', 'API Key', () => {
                const currentKey = localStorage.getItem('anomalous_civitai_api_key') || '';
                const newKey = prompt(window.anomalous_browser_lang === 'zh' ? '请输入 Civitai API Key (留空取消):' : 'Enter Civitai API Key:', currentKey);
                if (newKey !== null) {
                    localStorage.setItem('anomalous_civitai_api_key', newKey.trim());
                    alert(window.anomalous_browser_lang === 'zh' ? '✅ 密钥保存成功' : '✅ Key Saved');
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

            const createChoiceCard = (id, icon, titleZh, titleEn, descZh, descEn, isSelected) => {
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
                tTitle.innerText = window.anomalous_browser_lang === 'zh' ? titleZh : titleEn;
                tTitle.style.fontWeight = '500';
                tTitle.style.fontSize = '1.05em';
                tTitle.style.color = isSelected ? '#8AB4F8' : '#fff';

                topRow.appendChild(iconDiv);
                topRow.appendChild(tTitle);

                const tDesc = document.createElement('div');
                tDesc.innerText = window.anomalous_browser_lang === 'zh' ? descZh : descEn;
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
                sec0Title.innerText = window.anomalous_browser_lang === 'zh' ? 'Step 0. 扫描目标' : 'Step 0. Scan Target';
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
                openSelectorBtn.innerText = window.anomalous_browser_lang === 'zh' ? '📂 打开高级模型选择面板' : '📂 Open Advanced Model Selector';
                openSelectorBtn.style.cssText = 'width:100%;padding:12px;background:#8AB4F8;color:#1E1E1E;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:1.05em;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
                
                const selectedCountSpan = document.createElement('div');
                selectedCountSpan.style.cssText = 'text-align:center;color:#8AB4F8;margin-top:8px;font-size:0.9em;';
                selectedCountSpan.innerText = window.anomalous_browser_lang === 'zh' ? '已选择 0 个模型' : '0 models selected';
                
                const updateSelectedCount = () => {
                    let total = 0;
                    for (const set of selectedForScan.values()) total += set.size;
                    selectedCountSpan.innerText = window.anomalous_browser_lang === 'zh' ? `已选择 ${total} 个模型` : `${total} models selected`;
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
                    tCard1 = createChoiceCard('all', '📂', '默认全局扫描', 'Default Global Scan', '扫描系统中所有的模型文件，自动匹配封面和信息', 'Scan all models in the system for covers and metadata', targetMode === 'all');
                    tCard2 = createChoiceCard('custom', '☑️', '高级自定义多选', 'Advanced Selection', '跨目录选择特定模型，启动按序队列扫描', 'Select specific models across folders, launches sequential scan', targetMode === 'custom');

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
            sec1Title.innerText = window.anomalous_browser_lang === 'zh' ? 'Step 1. 获取数据' : 'Step 1. Fetch Data';
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
                card1 = createChoiceCard('civitai', '🌍', '在线完整匹配', 'Online Full Matching', '自动连接 Civitai 平台，深度获取模型封面图、触发词 (Trigger Words)、作者备注及详细标签。推荐日常使用。', 'Connects to Civitai to fetch comprehensive model covers, trigger words, author notes, and tags. Recommended for daily use.', scanMode === 'civitai');
                card2 = createChoiceCard('offline', '🔌', '离线极速读取', 'Offline Fast Read', '不消耗任何网络。仅通过本地张量计算极速提取模型内的基础元数据，速度极快但信息较基础。', 'No network required. Extremely fast extraction of basic metadata via local tensor computation, but info is limited.', scanMode === 'offline');

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

            const createListRow = (icon, titleZh, titleEn, descZh, descEn, actionEl) => {
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
                const t = document.createElement('div');
                t.innerText = window.anomalous_browser_lang === 'zh' ? titleZh : titleEn;
                t.style.fontWeight = '500';
                t.style.fontSize = '1.0em';
                t.style.color = '#fff';

                const d = document.createElement('div');
                d.innerHTML = window.anomalous_browser_lang === 'zh' ? descZh : descEn;
                d.style.fontSize = '0.85em';
                d.style.color = '#aaa';
                d.style.marginTop = '4px';

                textDiv.appendChild(t);
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
            sec2Title.innerText = window.anomalous_browser_lang === 'zh' ? 'Step 2. 规范命名' : 'Step 2. Normalize Naming';
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
            const physicalSwitch = createMaterialSwitch(enablePhysicalRename, (s) => enablePhysicalRename = s);

            const vContainer = document.createElement('div');
            vContainer.style.display = 'flex';
            vContainer.style.flexDirection = 'column';

            const vRow = document.createElement('div');
            vRow.style.display = 'flex';
            vRow.style.alignItems = 'center';
            vRow.style.gap = '8px';
            vRow.innerHTML = `<span style="font-size:0.9em; color:#ddd;">✨ ${window.anomalous_browser_lang === 'zh' ? '虚拟重命名 (安全推荐)' : 'Virtual Rename (Safe)'}</span>`;
            vRow.appendChild(virtualSwitch);

            const vDesc = document.createElement('div');
            vDesc.style.fontSize = '0.8em';
            vDesc.style.color = '#888';
            vDesc.style.marginTop = '4px';
            vDesc.innerHTML = window.anomalous_browser_lang === 'zh' ? '仅将标准名称注入浏览器插件中，不修改硬盘上的真实文件名，随时可无损还原。' : 'Inject standard names into the browser only, without modifying actual files on disk. Safely reversible.';
            vContainer.appendChild(vRow);
            vContainer.appendChild(vDesc);

            const pContainer = document.createElement('div');
            pContainer.style.display = 'flex';
            pContainer.style.flexDirection = 'column';

            const pRow = document.createElement('div');
            pRow.style.display = 'flex';
            pRow.style.alignItems = 'center';
            pRow.style.gap = '8px';
            pRow.innerHTML = `<span style="font-size:0.9em; color:#ddd;">💾 ${window.anomalous_browser_lang === 'zh' ? '物理重命名' : 'Physical Rename'}</span>`;
            pRow.appendChild(physicalSwitch);

            const pDesc = document.createElement('div');
            pDesc.style.fontSize = '0.8em';
            pDesc.style.color = '#888';
            pDesc.style.marginTop = '4px';
            pDesc.innerHTML = window.anomalous_browser_lang === 'zh' ? '真实修改底层的 <code>.safetensors</code> 及其所有附属文件名，彻底告别乱码文件名。' : 'Permanently rename the underlying <code>.safetensors</code> and associated files on disk.';
            pContainer.appendChild(pRow);
            pContainer.appendChild(pDesc);

            dualChannelRow.appendChild(vContainer);
            dualChannelRow.appendChild(pContainer);

            s2List.appendChild(createListRow('📝', '自动规范命名', 'Auto-Normalize Naming', '强迫症福音。自动将杂乱无章的模型文件名重命名为 <b>模型名_版本名.safetensors</b> 的标准格式。<br><span style="color:#8AB4F8; display:inline-block; margin-top:4px;">例如：</span> <span style="color:#ff6b6b; text-decoration:line-through;">model_final(1).safetensors</span> ➔ <span style="color:#28a745;">Beautiful_Mix_V1.0.safetensors</span>', 'Automatically rename messy model files to the official standard format: <b>ModelName_VersionName.safetensors</b>.<br><span style="color:#8AB4F8; display:inline-block; margin-top:4px;">e.g. </span> <span style="color:#ff6b6b; text-decoration:line-through;">model_final(1).safetensors</span> ➔ <span style="color:#28a745;">Beautiful_Mix_V1.0.safetensors</span>', createMaterialSwitch(enableRename, (s) => { enableRename = s; updateDualChannelUI(); })));
            s2List.lastChild.style.borderBottom = 'none';
            s2List.appendChild(dualChannelRow);
            updateDualChannelUI();
            section2.appendChild(s2List);
            formGroup.appendChild(section2);

            // === Step 3: Workflow Protection & Fix ===
            const section3 = document.createElement('div');
            const sec3Title = document.createElement('div');
            sec3Title.innerText = window.anomalous_browser_lang === 'zh' ? 'Step 3. 工作流保障与修复' : 'Step 3. Workflow Protection & Fix';
            sec3Title.style.fontWeight = '500';
            sec3Title.style.color = '#8AB4F8';
            sec3Title.style.marginBottom = '8px';
            sec3Title.style.fontSize = '0.95em';
            section3.appendChild(sec3Title);

            const s3List = document.createElement('div');
            const isInject = localStorage.getItem('anomalous_inject_hash') !== 'false';
            s3List.appendChild(createListRow('📦', '模型溯源绑定', 'Model Provenance Binding', '全局生效。每次生成图片或保存工作流时，将模型的精确哈希值隐式写入到图像元数据与工作流 JSON 中，防止未来模型改名或换环境后报错找不到。', 'Global effect. Implicitly embed exact model hashes into generated images and saved workflows, ensuring missing models can always be auto-fixed.', createMaterialSwitch(isInject, (s) => localStorage.setItem('anomalous_inject_hash', s ? 'true' : 'false'))));
            s3List.appendChild(createListRow('⚠️', '强制覆盖已有配置', 'Force Overwrite Configs', '扫描时忽略本地已存在的 .info 文件，强制重新计算哈希并覆盖下载。用于修复匹配错乱的模型。', 'Ignore existing .info files and force re-scan/overwrite. Useful for fixing mismatched models.', createMaterialSwitch(enableForceOverwrite, (s) => enableForceOverwrite = s)));
            s3List.appendChild(createListRow('🪄', '智能修复当前工作流', 'Smart Fix Current Workflow', '扫描完成后，自动尝试用最新数据修复当前画布中提示缺失的报错模型节点。', 'After scanning, automatically attempt to fix missing model errors on the current canvas.', createMaterialSwitch(enableAutoCheck, (s) => enableAutoCheck = s)));
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
                            alert(window.anomalous_browser_lang === 'zh' ? '未选择任何模型' : 'No models selected');
                            return;
                        }
                        
                        document.body.removeChild(wizard);
                        if (typeof scanBtn !== 'undefined') {
                            scanBtn.innerHTML = `⏳`;
                            scanBtn.style.animation = 'anomalous-spin 2s linear infinite';
                        }
                        
                        // Sequential scan for multiple folders
                        for (const [folderKey, fileSet] of selectedForScan.entries()) {
                            if (fileSet.size === 0) continue;
                            const parts = folderKey.split('|');
                            if (parts.length < 3) continue;
                            const type = parts[0], path_idx = parts[1], subfolder = parts.slice(2).join('|');
                            
                            const params = new URLSearchParams({ type, path_idx, subfolder });
                            params.append('target_files', Array.from(fileSet).join(','));
                            const targetUrl = '/anomalous/scan?' + params.toString();
                            
                            try {
                                const res = await fetch(targetUrl, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(reqBody)
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
                        if (enableAutoCheck && window.anomalous_resolve_all_missing_nodes) {
                            window.anomalous_resolve_all_missing_nodes(true);
                        }
                        this.loadModels();
                        
                        return;
                    }

                    // Existing logic for 'all' mode or single file
                    let finalTargetFiles = targetFiles;
                    
                    let targetUrl = '';
                    if (isGlobal && targetMode !== 'custom') {
                        targetUrl = '/anomalous/scan_all';
                    } else {
                        const params = new URLSearchParams({ type: this.currentType, path_idx: this.currentPathIdx, subfolder: this.currentSubfolder });
                        if (finalTargetFiles) {
                            params.append('target_files', finalTargetFiles);
                        }
                        targetUrl = '/anomalous/scan?' + params.toString();
                    }

                    const res = await fetch(targetUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(reqBody)
                    });
                    
                    const data = await res.json();
                    if (data.status === 'ok') {
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
                                if (!statusData.scanning) {
                                    clearInterval(poll);
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
                        alert(window.anomalous_browser_lang === 'zh' ? '扫描失败: ' + data.message : 'Scan failed: ' + data.message);
                    }
                } catch (e) { alert("Error: " + e); }

                document.body.removeChild(wizard);
            };

            const footer = document.createElement('div');
            footer.style.marginTop = '32px';
            footer.style.display = 'flex';
            footer.style.justifyContent = 'flex-end';
            footer.style.gap = '8px';

            const closeBtn = document.createElement('button');
            closeBtn.innerText = window.anomalous_browser_lang === 'zh' ? '取消' : 'Cancel';
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
            startBtn.innerText = window.anomalous_browser_lang === 'zh' ? '执行扫描' : 'Execute Scan';
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


        const energyBtn = document.createElement('button');
        energyBtn.id = 'anomalous-energy-btn';
        energyBtn.title = t('togglePlayTitle');
        const renderEnergyBtn = () => {
            energyBtn.innerHTML = this.energySaving
                ? `<span class="anomalous-btn-text">${(window.anomalous_browser_lang === 'zh' ? '🔋 视频悬浮播放 (节能模式)' : '🔋 Eco Mode (Play video on hover)')}</span>`
                : `<span class="anomalous-btn-text">${(window.anomalous_browser_lang === 'zh' ? '🎬 自动播放视频封面 (高能耗)' : '🎬 AutoPlay Videos (High perf cost)')}</span>`;
        };
        renderEnergyBtn();
        energyBtn.onclick = () => {
            this.energySaving = !this.energySaving;
            localStorage.setItem('anomalous_energy_saving', this.energySaving);
            renderEnergyBtn();
            this.loadModels();
        };

        const closeBtn = document.createElement('div');
        closeBtn.id = 'anomalous-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => this.close();

        const cleanBtn = document.createElement('button');
        cleanBtn.id = 'anomalous-clean-btn';
        cleanBtn.title = t('cleanTitle');
        cleanBtn.innerHTML = `<span class="anomalous-btn-text">${t('clean')}</span>`;

        cleanBtn.onclick = async () => {
            if (!confirm(t('cleanConfirm'))) return;
            cleanBtn.innerHTML = `⏳ <span class="anomalous-btn-text">${t('cleaning')}</span>`;
            cleanBtn.disabled = true;
            try {
                const res = await fetch('/anomalous/clean_civitai_info', { method: 'POST' });
                const data = await res.json();
                if (data.status === 'success') {
                    alert(`${t('cleanDone')} ${data.count} ${t('files')}`);
                } else {
                    alert(t('cleanFail') + data.message);
                }
            } catch (e) { alert(t('cleanErr') + e.message); }
            cleanBtn.innerHTML = `<span class="anomalous-btn-text">${t('clean')}</span>`;
            cleanBtn.disabled = false;
        };

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
        langBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '🌐 Language: EN' : '🌐 语言: 中文';
        langBtn.onclick = () => {
            currentLang = window.anomalous_browser_lang === 'zh' ? 'en' : 'zh';
            localStorage.setItem('anomalous_lang', currentLang);
            window.anomalous_browser_lang = currentLang;
            langBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '🌐 Language: EN' : '🌐 语言: 中文';
            updateLangClass();
            modelsBtn.innerHTML = `🏠 <span class="anomalous-btn-text">${t('models')}</span>`;
            galleryBtn.innerHTML = `🖼️ <span class="anomalous-btn-text">${t('gallery')}</span>`;
            scanBtn.title = t('scanTitle');
            scanBtn.innerHTML = `🔄`;
            cleanBtn.title = t('cleanTitle');
            cleanBtn.innerHTML = `<span class="anomalous-btn-text">${t('clean')}</span>`;
            helpBtn.innerHTML = `❓ <span class="anomalous-btn-text">${t('help')}</span>`;
            nbBtn.title = t('notebookTitle');
            nbBtn.innerHTML = `📑 <span class="anomalous-btn-text">${t('notebooks')}</span>`;

            const dBtn = document.getElementById('anomalous-doctor-btn');
            if (dBtn) dBtn.title = window.anomalous_browser_lang === 'zh' ? '模型医生' : 'Model Doctor';
            const aBtn = document.getElementById('anomalous-assistant-btn');
            if (aBtn) aBtn.title = window.anomalous_browser_lang === 'zh' ? '节点助手' : 'Node Assistant';
            const iBtn = document.getElementById('anomalous-import-btn');
            if (iBtn) iBtn.title = window.anomalous_browser_lang === 'zh' ? '📥 预检导入工作流' : '📥 Preflight Import';
            const sBtn = document.getElementById('anomalous-global-settings-btn');
            if (sBtn) sBtn.title = window.anomalous_browser_lang === 'zh' ? '设置中心' : 'Settings Hub';

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

            apiKeyBtn.innerHTML = `<span class="anomalous-btn-text">${t('apiKeyConfig')}</span>`;
            const globalScanBtnRef = document.getElementById('anomalous-global-scan-btn');
            if (globalScanBtnRef) globalScanBtnRef.innerHTML = window.anomalous_browser_lang === 'zh' ? '🌍 一键全盘极速扫描 (不下载封面/不改名)' : '🌍 Global Quick Scan (No rename/No media)';
            const checkUnscannedBtnRef = document.getElementById('anomalous-check-unscanned-btn');
            if (checkUnscannedBtnRef) checkUnscannedBtnRef.innerHTML = window.anomalous_browser_lang === 'zh' ? '🔍 检查并极速录入缺失模型信息' : '🔍 Check & Auto-Scan Missing Info';
            const resetBtnRef = document.getElementById('anomalous-reset-btn');
            if (resetBtnRef) resetBtnRef.innerHTML = window.anomalous_browser_lang === 'zh' ? '🔄 重置界面布局' : '🔄 Reset Layout';
            const scaleLabelRef = document.getElementById('anomalous-scale-label');
            if (scaleLabelRef) scaleLabelRef.innerText = window.anomalous_browser_lang === 'zh' ? 'UI 缩放' : 'UI Scale';

            renderEnergyBtn();
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

        styleHubBtn(cleanBtn);
        styleHubBtn(energyBtn);
        styleHubBtn(apiKeyBtn);
        styleHubBtn(langBtn);
        styleHubBtn(helpBtn);

        const globalScanBtn = document.createElement('button');
        globalScanBtn.id = 'anomalous-global-scan-btn';
        globalScanBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '🌍 一键全盘极速扫描 (不下载封面/不改名)' : '🌍 Global Quick Scan (No rename/No media)';
        styleHubBtn(globalScanBtn);

        globalScanBtn.onclick = async () => {
            if (!confirm(window.anomalous_browser_lang === 'zh' ? '即将执行极速全盘扫描并同步Hash，此操作不改名也不下载封面，是否继续？' : 'Start global quick scan to sync all hashes?')) return;
            globalScanBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '⏳ 扫描中...' : '⏳ Scanning...';
            globalScanBtn.disabled = true;
            try {
                const res = await fetch('/anomalous/scan_all', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        use_local_metadata: localStorage.getItem('anomalous_local_metadata_scan') !== 'false'
                    })
                });
                const data = await res.json();
                if (data.status === 'ok') {
                    alert(window.anomalous_browser_lang === 'zh' ? '🚀 全局扫描已后台启动！' : '🚀 Global Scan started in background!');
                    const pollTimer = setInterval(async () => {
                        try {
                            const statusRes = await fetch('/anomalous/global_scan_status');
                            const statusData = await statusRes.json();
                            if (!statusData.scanning) {
                                clearInterval(pollTimer);
                                globalScanBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '✅ 扫描完成' : '✅ Scan Complete';
                                setTimeout(() => {
                                    globalScanBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '🌍 一键全盘扫描 (不下载封面/不改名)' : '🌍 Global Quick Scan (No rename/No media)';
                                    globalScanBtn.disabled = false;
                                }, 3000);
                            }
                        } catch (e) { }
                    }, 3000);
                } else {
                    alert((window.anomalous_browser_lang === 'zh' ? '错误: ' : 'Error: ') + data.message);
                    globalScanBtn.disabled = false;
                }
            } catch (e) {
                globalScanBtn.disabled = false;
            }
        };

        const localParseToggleBtn = document.createElement('button');
        localParseToggleBtn.id = 'anomalous-local-parse-toggle-btn';
        const renderLocalParseToggleBtn = () => {
            let isLocalEnabled = localStorage.getItem('anomalous_local_metadata_scan') !== 'false';
            localParseToggleBtn.innerHTML = window.anomalous_browser_lang === 'zh'
                ? (isLocalEnabled ? '☑ 开启非C站模型本地扫描 (读取内置参数) [已开启]' : '☐ 开启非C站模型本地扫描 (读取内置参数) [已关闭]')
                : (isLocalEnabled ? '☑ Local metadata scan for non-Civitai [ON]' : '☐ Local metadata scan for non-Civitai [OFF]');
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
        checkUnscannedBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '🔍 检查并极速录入缺失模型信息' : '🔍 Check & Auto-Scan Missing Info';
        styleHubBtn(checkUnscannedBtn);
        checkUnscannedBtn.onclick = async () => {
            checkUnscannedBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '⏳ 检查中...' : '⏳ Checking...';
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
                    checkUnscannedBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '⚠️ 发现缺失，正在自动极速扫描...' : '⚠️ Missing info found, Auto-Scanning...';
                    const scanRes = await fetch('/anomalous/scan_all', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            use_local_metadata: localStorage.getItem('anomalous_local_metadata_scan') !== 'false'
                        })
                    });
                    const scanData = await scanRes.json();
                    if (scanData.status === 'ok') {
                        const pollTimer = setInterval(async () => {
                            try {
                                const statusRes = await fetch('/anomalous/global_scan_status');
                                const statusData = await statusRes.json();
                                if (!statusData.scanning) {
                                    clearInterval(pollTimer);
                                    checkUnscannedBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '✅ 补全完成' : '✅ Info Complete';
                                    setTimeout(() => {
                                        checkUnscannedBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '🔍 检查并极速录入缺失模型信息' : '🔍 Check & Auto-Scan Missing Info';
                                        checkUnscannedBtn.disabled = false;
                                    }, 3000);
                                }
                            } catch (e) { }
                        }, 3000);
                    } else {
                        alert((window.anomalous_browser_lang === 'zh' ? '错误: ' : 'Error: ') + scanData.message);
                        checkUnscannedBtn.disabled = false;
                        checkUnscannedBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '🔍 检查并极速录入缺失模型信息' : '🔍 Check & Auto-Scan Missing Info';
                    }
                } else {
                    checkUnscannedBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '✨ 所有模型信息已完整' : '✨ All Model Info is Complete';
                    setTimeout(() => {
                        checkUnscannedBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '🔍 检查并极速录入缺失模型信息' : '🔍 Check & Auto-Scan Missing Info';
                        checkUnscannedBtn.disabled = false;
                    }, 3000);
                }
            } catch (e) {
                checkUnscannedBtn.disabled = false;
                checkUnscannedBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '🔍 检查并极速录入缺失模型信息' : '🔍 Check & Auto-Scan Missing Info';
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
        scaleLabel.innerText = window.anomalous_browser_lang === 'zh' ? 'UI 缩放' : 'UI Scale';
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
        resetBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '🔄 重置界面布局' : '🔄 Reset Layout';
        styleHubBtn(resetBtn);
        resetBtn.onclick = () => {
            if (confirm(window.anomalous_browser_lang === 'zh' ? '确认重置窗口位置、缩放和停靠状态吗？' : 'Reset window position, scale and dock state?')) {
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
            hashToggleBtn.innerHTML = window.anomalous_browser_lang === 'zh'
                ? (isInject ? '🟢 注入工作流哈希' : '⚪ 不注入工作流哈希')
                : (isInject ? '🟢 Inject Workflow Hash' : '⚪ Skip Workflow Hash');
        };
        updateHashToggleBtn();
        hashToggleBtn.onclick = () => {
            const isInject = localStorage.getItem('anomalous_inject_hash') !== 'false';
            localStorage.setItem('anomalous_inject_hash', isInject ? 'false' : 'true');
            updateHashToggleBtn();
        };

        // Many redundant buttons have been migrated to the Wizard!

        settingsHubModal.appendChild(cleanBtn);
        settingsHubModal.appendChild(energyBtn);
        settingsHubModal.appendChild(scaleContainer);
        settingsHubModal.appendChild(langBtn);
        settingsHubModal.appendChild(helpBtn);
        settingsHubModal.appendChild(resetBtn);

        this.sidebarWrapper.appendChild(settingsHubModal);

        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'anomalous-global-settings-btn';
        settingsBtn.innerHTML = `⚙️`;
        settingsBtn.title = window.anomalous_browser_lang === 'zh' ? '设置中心' : 'Settings Hub';
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
                alert(window.anomalous_browser_lang === 'zh' ? '模块尚未加载，请稍等或刷新页面！' : 'Module not loaded, please refresh!');
            }
        };


        const doctorBtn = document.createElement('button');
        doctorBtn.id = 'anomalous-doctor-btn';
        doctorBtn.title = window.anomalous_browser_lang === 'zh' ? '模型医生' : 'Model Doctor';
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
            if (window.anomalous_resolve_all_missing_nodes) {
                window.anomalous_resolve_all_missing_nodes(true, false).then(() => {
                    if (app.graph && app.graph.extra && app.graph.extra.anomalous_hashes) {
                        this.renderGlobalDashboard(app.graph.extra.anomalous_hashes);
                    }
                });
            }
        };

        const assistantBtn = document.createElement('button');
        assistantBtn.id = 'anomalous-assistant-btn';
        assistantBtn.title = window.anomalous_browser_lang === 'zh' ? '节点助手' : 'Node Assistant';
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

        this.galleryObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !this.galleryLoading && this.galleryHasMore) {
                this.loadGalleryImages(this.galleryCurrentPage + 1);
            }
        }, { root: this.galleryGrid, rootMargin: '100px' });
        this.galleryObserver.observe(this.gallerySentinel);

        this.nbPanel = document.createElement('div');
        this.nbPanel.className = 'anomalous-nb-modal';
        this.nbPanel.style.display = 'none';
        this.nbPanel.onclick = (e) => {
            if (e.target === this.nbPanel) this.nbPanel.style.display = 'none';
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


    showHelp() {
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

    async loadFolders() {
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

    renderSidebar() {
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
        collapseAllBtn.innerHTML = isAllCollapsed ? (window.anomalous_browser_lang === 'zh' ? '➕ 展开全部' : '➕ Expand All') : (window.anomalous_browser_lang === 'zh' ? '➖ 收起全部' : '➖ Collapse All');
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
        searchInput.placeholder = window.anomalous_browser_lang === 'zh' ? '🔍 搜索模型...' : '🔍 Search models...';
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
            header.innerHTML = `<span>${typeGroup.label}</span> <span>${isTypeExpanded ? '▼' : '▶'}</span>`;

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

                item.innerHTML = `${toggleIcon}<span class="anomalous-folder-name" style="color: #ddd;">${info.name}</span> <span style="opacity:0.4; font-size:0.8em; margin-left: 5px;">${info.model_count}</span>`;

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

    async loadModels() {
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


    applyModelToCanvas(type, subfolder, model) {
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


    stopMediaInContainer(container) {
        if (!container) return;
        const mediaElements = container.querySelectorAll('video, audio');
        mediaElements.forEach(media => {
            media.pause();
            media.removeAttribute('src');
            media.load();
        });
    }

    showDetail(model) {
        if (this.isPickingModelForNode) {
            const targetNode = this.isPickingModelForNode.node;
            const targetWidget = this.isPickingModelForNode.widget;

            const normVal = (model.filename).replace(/\\/g, '/');
            let foundPath = model.filename;
            if (targetWidget.options && targetWidget.options.values) {
                const exactMatch = targetWidget.options.values.find(v => typeof v === 'string' && v.replace(/\\/g, '/').endsWith(normVal));
                if (exactMatch) foundPath = exactMatch;
            }
            targetWidget.value = foundPath;

            delete targetNode.color;
            delete targetNode.bgcolor;
            targetNode.has_errors = false;
            if (targetWidget.callback) targetWidget.callback(targetWidget.value, app.canvas, targetNode, app.canvas.graph_mouse, null);
            app.graph.setDirtyCanvas(true, true);

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
            backBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '⬅ 返回医生面板' : '⬅ Back to Doctor';
            backBtn.style.background = '#8AB4F8';
            backBtn.style.color = '#000';
        } else if (isFromAssistant) {
            backBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '⬅ 返回助手面板' : '⬅ Back to Assistant';
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
            }
        };

        const title = document.createElement('h2');
        title.innerHTML = model.filename;
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
        jumpBtn.title = t('jumpToBottom') || 'Jump to bottom';
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
        applyDetailBtn.innerHTML = t('applyToCanvas') || 'Apply to Canvas';
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

        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const containerRect = splitContainer.getBoundingClientRect();
            let newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
            if (newWidth < 20) newWidth = 20;
            if (newWidth > 80) newWidth = 80;
            leftPanel.style.width = newWidth + '%';
            rightPanel.style.width = (100 - newWidth) + '%';
        });

        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
            }
        });

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
        metaSpan.innerHTML = `<strong>Size:</strong> ${model.size_mb} MB` + (m.baseModel ? ` <strong style="margin-left:10px;">Base:</strong> ${m.baseModel}` : '');
        topRow.appendChild(metaSpan);

        if (m.civitai_url) {
            const cBtn = document.createElement('a');
            cBtn.href = m.civitai_url;
            cBtn.target = '_blank';
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
        editMetaBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '⚙️ 编辑' : '⚙️ Edit';
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
            notesTitle.innerHTML = window.anomalous_browser_lang === 'zh' ? '📓 专属备注 (Notes)' : '📓 Custom Notes';
            notesTitle.style.color = '#a38d53';
            notesTitle.style.fontWeight = '600';
            notesTitle.style.fontSize = '0.85em';
            notesTitle.style.letterSpacing = '0.5px';

            const notesEditBtn = document.createElement('button');
            notesEditBtn.innerHTML = '✏️';
            notesEditBtn.title = window.anomalous_browser_lang === 'zh' ? '编辑备注' : 'Edit Notes';
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
        galleryBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '🖼️ 查看历史生成作品' : '🖼️ View Generated Gallery';
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
            twLabel.innerText = 'Trained Words:';
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
            descLabel.innerText = 'Description:';
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
            descText.innerHTML = m.description;
            descCont.appendChild(descText);

            rightPanel.appendChild(descCont);
        }

        // 4. Notes Section
        if (m.notes) {
            const notesCont = document.createElement('div');
            notesCont.style.flexShrink = '0';
            notesCont.style.marginTop = '10px';

            const notesLabel = document.createElement('strong');
            notesLabel.innerText = 'Notes:';
            notesCont.appendChild(notesLabel);

            const notesText = document.createElement('div');
            notesText.style.background = '#332b00';
            notesText.style.padding = '8px';
            notesText.style.borderRadius = '6px';
            notesText.style.marginTop = '5px';
            notesText.style.border = '1px solid #554400';
            notesText.style.fontSize = '0.9em';
            notesText.innerHTML = m.notes;
            notesCont.appendChild(notesText);

            rightPanel.appendChild(notesCont);
        }

        // --- Compatible Models Section ---
        if (m.baseModel) {
            const compSec = document.createElement('div');
            compSec.className = 'anomalous-compatible-section';

            const compTitle = document.createElement('div');
            compTitle.className = 'anomalous-compatible-title';
            compTitle.innerHTML = `${t('compatibleModels') || '🔗 Compatible'} <span style="font-size:0.8em; opacity:0.6;">(${m.baseModel})</span>`;

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
                        compList.innerHTML = `<span style="color:#888;">No compatible models found.</span>`;
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

                        mItem.innerHTML = `${thumb}<div class="anomalous-compatible-item-name">${m_comp.filename}</div>`;

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
                    compList.innerHTML = `<span style="color:#ff4444;">Failed to load.</span>`;
                });
        }
        // ---------------------------------

        splitContainer.appendChild(leftPanel);
        splitContainer.appendChild(resizer);
        splitContainer.appendChild(rightPanel);

        this.detailPanel.appendChild(header);
        this.detailPanel.appendChild(splitContainer);
    }

    show() {
        this.modal.classList.add('visible');
        if (!this.foldersData) {
            this.loadFolders();
        } else {
            this.loadModels();
        }
    }

    close() { this.modal.classList.remove('visible'); }

    async showNotebooks() {
        if (this.nbInitialized) {
            this.refreshNotebooks(true);
            return;
        }
        this.nbInitialized = true;

        this.nbPanel.innerHTML = '';

        const nbContainer = document.createElement('div');
        nbContainer.className = 'anomalous-nb-container';

        const nbHeader = document.createElement('div');
        nbHeader.className = 'anomalous-nb-header';
        nbHeader.innerHTML = `<h2>${t('notebookTitle')}</h2>`;
        const closeNb = document.createElement('span');
        closeNb.className = 'anomalous-nb-close';
        closeNb.innerHTML = '&times;';
        closeNb.onclick = () => { this.nbPanel.style.display = 'none'; };
        nbHeader.appendChild(closeNb);

        const body = document.createElement('div');
        body.className = 'anomalous-nb-body';

        // Sidebar for notebooks list
        const sidebar = document.createElement('div');
        sidebar.className = 'anomalous-nb-sidebar';

        const nbList = document.createElement('div');
        nbList.className = 'anomalous-nb-list';

        const btnRow = document.createElement('div');
        btnRow.style.padding = '10px';
        btnRow.style.display = 'flex';
        btnRow.style.gap = '5px';

        const createBtn = document.createElement('button');
        createBtn.innerHTML = `➕ <span class="anomalous-nb-create-text">${t('createNotebook')}</span>`;
        createBtn.className = 'anomalous-btn-primary';

        const createInput = document.createElement('input');
        createInput.type = 'text';
        createInput.placeholder = t('newNotebookName');
        createInput.style.display = 'none';
        createInput.style.flex = '1';
        createInput.style.padding = '4px';
        createInput.style.background = '#222';
        createInput.style.color = '#fff';
        createInput.style.border = '1px solid #555';
        createInput.style.borderRadius = '4px';

        createBtn.onclick = () => {
            if (createInput.style.display === 'none') {
                createInput.style.display = 'block';
                createBtn.innerHTML = '✓';
                createInput.focus();
            } else {
                const name = createInput.value.trim();
                if (name) {
                    this.currentNotebook = { filename: name + '.json', name: name, data: { baseModel: '', mainModel: null, loras: [], promptEn: '', promptZh: '' } };
                    this.saveCurrentNotebook();
                    this.renderNotebookEditor();
                    createInput.value = '';
                }
                createInput.style.display = 'none';
                createBtn.innerHTML = `➕ <span class="anomalous-nb-create-text">${t('createNotebook')}</span>`;
            }
        };

        btnRow.appendChild(createInput);
        btnRow.appendChild(createBtn);
        sidebar.appendChild(btnRow);
        sidebar.appendChild(nbList);

        // Editor area
        this.nbEditor = document.createElement('div');
        this.nbEditor.className = 'anomalous-nb-editor';

        body.appendChild(sidebar);
        body.appendChild(this.nbEditor);

        nbContainer.appendChild(nbHeader);
        nbContainer.appendChild(body);

        this.nbPanel.appendChild(nbContainer);

        this.nbListEl = nbList;
        this.refreshNotebooks(true);
    }

    async translateText(text) {
        if (!text || !text.trim()) return "";
        try {
            const res = await fetch('/anomalous/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, target_lang: window.anomalous_browser_lang === 'zh' ? 'zh-CN' : 'en' })
            });
            const data = await res.json();
            return data.translated || text;
        } catch (e) { return text; }
    }

    async loadGalleryImages(page = 1, reset = false) {
        if (this.galleryLoading) return;
        this.galleryLoading = true;
        this.gallerySentinel.innerHTML = window.anomalous_browser_lang === 'zh' ? '加载中...' : 'Loading...';

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
                                    alert((window.anomalous_browser_lang === 'zh' ? '错误: ' : 'Error: ') + data.message);
                                }
                            });
                            return;
                        }
                        this.showGalleryViewer(imgUrl);
                    };

                    const delBtn = document.createElement('button');
                    delBtn.className = 'anomalous-gallery-delete';
                    delBtn.innerHTML = '🗑️';
                    delBtn.title = window.anomalous_browser_lang === 'zh' ? '删除' : 'Delete';

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
                        msg.innerHTML = '彻底删除这张图片？<br><span style="font-size:0.8em;color:#aaa">Delete permanently?</span>';
                        msg.style.color = '#fff';
                        msg.style.fontWeight = 'bold';
                        msg.style.textAlign = 'center';

                        const btnRow = document.createElement('div');
                        btnRow.style.display = 'flex';
                        btnRow.style.gap = '12px';

                        const confirmBtn = document.createElement('button');
                        confirmBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '🗑️ 删除' : '🗑️ Delete';
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
                        cancelBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '取消' : 'Cancel';
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
                            confirmBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '删除中...' : 'Deleting...';
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
                                    alert((window.anomalous_browser_lang === 'zh' ? '删除失败: ' : 'Delete failed: ') + dd.message);
                                    overlay.remove();
                                }
                            } catch (err) {
                                alert((window.anomalous_browser_lang === 'zh' ? '错误: ' : 'Error: ') + err);
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
                    this.gallerySentinel.innerHTML = window.anomalous_browser_lang === 'zh' ? '没有更多图片了' : 'No more images';
                } else {
                    this.gallerySentinel.innerHTML = window.anomalous_browser_lang === 'zh' ? '向下滚动加载更多' : 'Scroll for more';
                }
            } else {
                this.galleryHasMore = false;
                this.gallerySentinel.innerHTML = reset ? '图库为空 / Gallery is empty' : '没有更多图片了 / No more images';
            }
        } catch (e) {
            console.error('Failed to load gallery images', e);
            this.gallerySentinel.innerHTML = window.anomalous_browser_lang === 'zh' ? '加载失败' : 'Load failed';
        }

        this.galleryLoading = false;
    }


    showEditModal(model) {
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
                muteBtn.title = window.anomalous_browser_lang === 'zh' ? '开启/关闭声音' : 'Toggle Sound';
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
            previewContainer.innerHTML = `<div style="color:#9aa0a6; font-size:0.9em; text-align:center;">${window.anomalous_browser_lang === 'zh' ? '暂无封面' : 'No Cover'}</div>`;
        }

        const coverRow = document.createElement('div');
        coverRow.style.display = 'flex';
        coverRow.style.flexDirection = 'column';
        coverRow.style.gap = '8px';

        const galleryBtn = document.createElement('button');
        galleryBtn.innerHTML = '🖼️ ' + (window.anomalous_browser_lang === 'zh' ? '从历史图库挑选' : 'Pick from Gallery');
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
        localBtn.innerHTML = '📁 ' + (window.anomalous_browser_lang === 'zh' ? '从本地上传' : 'Upload Local');
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
                            alert((window.anomalous_browser_lang === 'zh' ? '错误: ' : 'Error: ') + data.message);
                        }
                    } catch (err) {
                        alert((window.anomalous_browser_lang === 'zh' ? '上传失败: ' : 'Upload failed: ') + err);
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
        title.innerText = window.anomalous_browser_lang === 'zh' ? '编辑模型信息' : 'Edit Model Info';
        title.style.margin = '0';
        title.style.color = '#e8eaed';
        title.style.fontSize = '1.25em';
        title.style.fontWeight = '500';

        const filenameLabel = document.createElement('div');
        filenameLabel.innerHTML = `<span style="color:#9aa0a6;">${window.anomalous_browser_lang === 'zh' ? '文件:' : 'File:'}</span> ${model.filename}`;
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
        nameInput.placeholder = window.anomalous_browser_lang === 'zh' ? '自定义名称 (留空则使用原名)' : 'Custom Name (Leave empty to use original)';
        nameInput.value = (model.metadata && model.metadata.custom_name) ? model.metadata.custom_name : '';
        nameInput.style.cssText = inputStyle;
        nameInput.onfocus = () => nameInput.style.borderColor = '#8ab4f8';
        nameInput.onblur = () => nameInput.style.borderColor = '#5f6368';

        const notesInput = document.createElement('textarea');
        notesInput.placeholder = window.anomalous_browser_lang === 'zh' ? '📓 专属备注... (支持多行)' : '📓 Custom Notes...';
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

        const physicalLabel = document.createElement('label');
        physicalLabel.htmlFor = 'anomalous-physical-rename-checkbox';
        physicalLabel.innerText = window.anomalous_browser_lang === 'zh' ? '同步物理重命名' : 'Physical Rename on Disk';
        physicalLabel.style.color = '#e8eaed';
        physicalLabel.style.fontSize = '0.9em';
        physicalLabel.style.cursor = 'pointer';

        physicalCheckboxWrapper.appendChild(physicalCheckbox);
        physicalCheckboxWrapper.appendChild(physicalLabel);

        const physicalDesc = document.createElement('div');
        physicalDesc.style.fontSize = '0.8em';
        physicalDesc.style.color = '#9aa0a6';
        physicalDesc.style.marginLeft = '22px';
        physicalDesc.innerText = window.anomalous_browser_lang === 'zh' ? '若不勾选则仅虚拟重命名，安全不破坏原文件。' : 'Virtual rename only if unchecked. Safe for originals.';

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
        resetBtn.innerText = window.anomalous_browser_lang === 'zh' ? '重置设置' : 'Reset All';
        resetBtn.style.padding = '8px 16px';
        resetBtn.style.background = 'transparent';
        resetBtn.style.color = '#f28b82';
        resetBtn.style.border = '1px solid #f28b82';
        resetBtn.style.borderRadius = '4px';
        resetBtn.style.cursor = 'pointer';
        resetBtn.style.fontWeight = '500';
        resetBtn.onclick = async () => {
            if (!confirm(window.anomalous_browser_lang === 'zh' ? '确定要重置该模型的所有自定义信息（名称、封面、备注）吗？' : 'Reset all custom info for this model?')) return;
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
                if (res.ok) {
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
                }
            } catch (e) { console.error(e); }
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = window.anomalous_browser_lang === 'zh' ? '取消' : 'Cancel';
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
        saveBtn.innerText = window.anomalous_browser_lang === 'zh' ? '保存更改' : 'Save Changes';
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
            saveBtn.innerText = window.anomalous_browser_lang === 'zh' ? '保存中...' : 'Saving...';
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
                    alert((window.anomalous_browser_lang === 'zh' ? '错误: ' : 'Error: ') + data.message);
                }
            }).catch(e => {
                document.body.removeChild(modal);
                alert((window.anomalous_browser_lang === 'zh' ? '错误: ' : 'Error: ') + e);
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


    async showGeneratedGallery(model) {
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
            closeBtn.innerHTML = '&#10006; ' + (window.anomalous_browser_lang === 'zh' ? '关闭图库' : 'Close Gallery');
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
        title.innerText = (window.anomalous_browser_lang === 'zh' ? '历史生成图库: ' : 'Generated History: ') + (model.name || model.filename);

        const contentCont = document.getElementById('anomalous-generated-gallery-content');
        contentCont.innerHTML = '';

        const loading = document.createElement('div');
        loading.innerText = window.anomalous_browser_lang === 'zh' ? '加载中，正在扫描图片元数据...' : 'Loading, scanning metadata...';
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
                emptyMsg.innerText = window.anomalous_browser_lang === 'zh' ? '没有找到使用此模型生成的历史图片。' : 'No images found generated by this model.';
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
                setCoverBtn.innerText = window.anomalous_browser_lang === 'zh' ? '设为封面' : 'Set Cover';
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
                    if (!confirm(window.anomalous_browser_lang === 'zh' ? '确定将此图片设为封面吗？' : 'Set this image as cover?')) return;

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
                            alert(window.anomalous_browser_lang === 'zh' ? '设置成功！' : 'Cover set successfully!');
                            await this.loadModels();
                            const updatedModel = this.models.find(m => m.filename === model.filename);
                            if (updatedModel && this.currentDetailModel && this.currentDetailModel.filename === model.filename) {
                                this.showDetail(updatedModel);
                            }
                        } else {
                            alert((window.anomalous_browser_lang === 'zh' ? '错误: ' : 'Error: ') + result.message);
                        }
                    }).catch(err => {
                        alert('Error: ' + err.message);
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
            contentCont.innerHTML = '<div style="color:red; text-align:center; grid-column: 1/-1; padding: 50px;">Error loading images</div>';
        }
    }

    showGallerySelectMode(model) {
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
        banner.innerHTML = window.anomalous_browser_lang === 'zh'
            ? `正在为模型 <span style="color:#ff0;">${model.filename}</span> 选择封面。请点击下方的图片。<button id="anomalous-cancel-select" style="margin-left:15px;color:#000;background:#fff;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;">取消</button>`
            : `Selecting cover for <span style="color:#ff0;">${model.filename}</span>. Click an image below.<button id="anomalous-cancel-select" style="margin-left:15px;color:#000;background:#fff;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;">Cancel</button>`;

        document.getElementById('anomalous-cancel-select').onclick = () => {
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

        if (this.galleryImages.length === 0) {
            this.loadGalleryImages(1, true);
        }
    }

    showGalleryViewer(src) {
        let viewer = document.getElementById('anomalous-gallery-viewer');
        if (!viewer) {
            viewer = document.createElement('div');
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
                viewer.style.display = 'none';
                resetImgTransform();
            };

            viewer.onclick = (e) => {
                if (e.target === viewer) {
                    viewer.style.display = 'none';
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

        viewer.style.display = 'flex';
    }

    async refreshNotebooks(autoOpenFirst = false) {
        try {
            const res = await fetch('/anomalous/notebooks');
            const data = await res.json();
            this.nbListEl.innerHTML = '';

            if (data.notebooks && data.notebooks.length > 0) {
                if (autoOpenFirst) {
                    if (!this.currentNotebook) {
                        this.currentNotebook = data.notebooks[0];
                    }
                    if (this.currentNotebook) {
                        this.renderNotebookEditor();
                    }
                }

                data.notebooks.forEach(nb => {
                    const item = document.createElement('div');
                    item.className = 'anomalous-nb-item';
                    if (this.currentNotebook && this.currentNotebook.filename === nb.filename) {
                        item.classList.add('active');
                    }
                    item.innerHTML = `<span class="anomalous-nb-item-icon">📄&nbsp;</span><span class="anomalous-nb-item-text">${nb.name}</span>`;
                    item.onclick = () => {
                        this.currentNotebook = nb;
                        this.renderNotebookEditor();
                        this.refreshNotebooks();
                    };
                    this.nbListEl.appendChild(item);
                });
            }
        } catch (e) { }
    }

    async saveCurrentNotebook() {
        if (!this.currentNotebook) return;
        try {
            await fetch('/anomalous/save_notebook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.currentNotebook)
            });
            this.refreshNotebooks();
        } catch (e) { }
    }

    async deleteCurrentNotebook(skipConfirm = false) {
        if (!this.currentNotebook) return;
        if (!skipConfirm && !confirm(t('deleteNotebook') + ' ?')) return;
        try {
            await fetch('/anomalous/delete_notebook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: this.currentNotebook.filename })
            });
            this.currentNotebook = null;
            this.nbEditor.innerHTML = '';
            this.refreshNotebooks();
        } catch (e) { }
    }

    renderNotebookEditor() {
        this.nbEditor.innerHTML = '';
        if (!this.currentNotebook) return;

        const data = this.currentNotebook.data || {};
        if (!data.loras) data.loras = [];

        // Toolbar
        const tb = document.createElement('div');
        tb.className = 'anomalous-nb-toolbar';

        const titleArea = document.createElement('h3');
        titleArea.innerHTML = this.currentNotebook.name;
        titleArea.style.margin = '0';

        const rightBtns = document.createElement('div');

        const saveBtn = document.createElement('button');
        saveBtn.innerHTML = t('saveNotebook');
        saveBtn.className = 'anomalous-btn-primary';
        saveBtn.onclick = async () => {
            const orig = saveBtn.innerHTML;
            saveBtn.innerHTML = '⏳...';
            await this.saveCurrentNotebook();
            saveBtn.innerHTML = '✅';
            saveBtn.style.background = '#2e8b57';
            setTimeout(() => {
                saveBtn.innerHTML = orig;
                saveBtn.style.background = '';
            }, 1500);
        };

        let delTimer = null;
        const delContainer = document.createElement('span');
        delContainer.style.display = 'inline-flex';
        delContainer.style.alignItems = 'center';

        const delBtn = document.createElement('button');
        delBtn.innerHTML = t('deleteNotebook');
        delBtn.className = 'anomalous-btn-danger';

        const cancelDelBtn = document.createElement('button');
        cancelDelBtn.innerHTML = '✕';
        cancelDelBtn.className = 'anomalous-btn-danger';
        cancelDelBtn.style.display = 'none';
        cancelDelBtn.style.background = '#555';
        cancelDelBtn.style.marginLeft = '2px';
        cancelDelBtn.style.padding = '6px 8px';

        delContainer.appendChild(delBtn);
        delContainer.appendChild(cancelDelBtn);

        const resetDel = () => {
            clearTimeout(delTimer);
            delBtn.innerHTML = t('deleteNotebook');
            delBtn.style.background = '';
            cancelDelBtn.style.display = 'none';
        };

        delBtn.onclick = () => {
            if (delBtn.innerHTML === t('deleteNotebook')) {
                delBtn.innerHTML = t('delSure');
                delBtn.style.background = '#800';
                cancelDelBtn.style.display = 'block';
                delTimer = setTimeout(resetDel, 4000);
            } else {
                resetDel();
                this.deleteCurrentNotebook(true);
            }
        };

        cancelDelBtn.onclick = resetDel;

        const sendBtn = document.createElement('button');
        sendBtn.innerHTML = t('sendToCanvas');
        sendBtn.className = 'anomalous-btn-success';
        sendBtn.onclick = () => this.sendNotebookToCanvas();

        rightBtns.appendChild(saveBtn);
        rightBtns.appendChild(sendBtn);
        rightBtns.appendChild(delContainer);

        tb.appendChild(titleArea);
        tb.appendChild(rightBtns);

        // Settings / Models
        const modelSection = document.createElement('div');
        modelSection.className = 'anomalous-nb-section';

        // Base Model
        const baseRow = document.createElement('div');
        baseRow.className = 'anomalous-nb-row';
        baseRow.innerHTML = `<strong>${t('baseModel')}</strong>`;
        const baseSelect = document.createElement('select');
        baseSelect.className = 'anomalous-nb-select';
        const buildSelect = (bases) => {
            baseSelect.innerHTML = '';
            bases.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b; opt.text = b;
                if (data.baseModel === b) opt.selected = true;
                baseSelect.appendChild(opt);
            });
            if (!data.baseModel && bases.length > 0) data.baseModel = bases[0];
        };

        if (this.baseModelsCache) {
            buildSelect(this.baseModelsCache);
        } else {
            const tempBases = ['SD 1.5', 'SD 2.1', 'SDXL', 'SD 3.0', 'SD 3.5', 'Flux.1', 'Pony', 'HunyuanVideo', 'LTX-Video', 'OmniGen'];
            buildSelect(tempBases);
            fetch('/anomalous/base_models').then(r => r.json()).then(d => {
                if (d.base_models && d.base_models.length > 0) {
                    this.baseModelsCache = d.base_models;
                    buildSelect(this.baseModelsCache);
                }
            }).catch(e => { });
        }
        if (!data.baseModel) data.baseModel = 'SDXL';
        baseSelect.onchange = () => {
            data.baseModel = baseSelect.value;
            data.mainModel = null;
            data.loras = [];
            this.saveCurrentNotebook();
            this.renderNotebookEditor();
        };
        baseRow.appendChild(baseSelect);

        // Main Model (Card Selection)
        const mainBox = document.createElement('div');
        mainBox.className = 'anomalous-nb-gallery-box';
        const mainRow = document.createElement('div');
        mainRow.className = 'anomalous-nb-row';
        mainRow.innerHTML = `<strong>${t('mainModel')}</strong>`;

        const mainGallery = document.createElement('div');
        mainGallery.className = 'anomalous-nb-gallery-wrap';

        mainBox.appendChild(mainRow);
        mainBox.appendChild(mainGallery);

        // Loras (Card Selection)
        const loraBox = document.createElement('div');
        loraBox.className = 'anomalous-nb-gallery-box';
        const loraRow = document.createElement('div');
        loraRow.className = 'anomalous-nb-row';
        loraRow.innerHTML = `<strong>Loras</strong>`;

        const loraGallery = document.createElement('div');
        loraGallery.className = 'anomalous-nb-gallery-wrap';

        loraBox.appendChild(loraRow);
        loraBox.appendChild(loraGallery);

        modelSection.appendChild(baseRow);
        modelSection.appendChild(mainBox);
        modelSection.appendChild(loraBox);

        // Prompt Section
        const promptSec = document.createElement('div');
        promptSec.className = 'anomalous-nb-section';

        // Toolbar
        const pToolbar = document.createElement('div');
        pToolbar.className = 'anomalous-nb-prompt-toolbar';

        const langSelect = document.createElement('select');
        langSelect.className = 'anomalous-nb-select';
        const langs = [
            { v: 'zh-CN', l: '🇨🇳 中文 (zh-CN)' }, { v: 'en', l: '🇬🇧 English (en)' },
            { v: 'ja', l: '🇯🇵 日本语 (ja)' }, { v: 'ko', l: '🇰🇷 한국어 (ko)' },
            { v: 'fr', l: '🇫🇷 Français (fr)' }, { v: 'de', l: '🇩🇪 Deutsch (de)' },
            { v: 'es', l: '🇪🇸 Español (es)' }, { v: 'ru', l: '🇷🇺 Русский (ru)' }
        ];
        langs.forEach(lg => {
            const opt = document.createElement('option');
            opt.value = lg.v; opt.text = lg.l;
            if ((data.targetLang || 'zh-CN') === lg.v) opt.selected = true;
            langSelect.appendChild(opt);
        });
        langSelect.onchange = () => {
            data.targetLang = langSelect.value;
            data.translations = {}; // Clear translation cache on lang change
            this.saveCurrentNotebook();
            updateVisualTags();
        };

        const findInput = document.createElement('input');
        findInput.className = 'anomalous-nb-select';
        findInput.placeholder = t('findPlaceholder');
        findInput.style.flex = '1';

        const replaceInput = document.createElement('input');
        replaceInput.className = 'anomalous-nb-select';
        replaceInput.placeholder = t('replacePlaceholder');
        replaceInput.style.flex = '1';

        const replaceBtn = document.createElement('button');
        replaceBtn.className = 'anomalous-btn-primary';
        replaceBtn.innerHTML = t('replaceAll');

        pToolbar.appendChild(langSelect);
        pToolbar.appendChild(findInput);
        pToolbar.appendChild(replaceInput);
        pToolbar.appendChild(replaceBtn);

        // Raw Input Toggle
        const toggleRow = document.createElement('div');
        toggleRow.style.display = 'flex';
        toggleRow.style.justifyContent = 'space-between';
        toggleRow.style.marginBottom = '5px';
        toggleRow.innerHTML = `<strong>Prompt Editor</strong>`;
        const rawBtn = document.createElement('button');
        rawBtn.className = 'anomalous-btn-primary';
        rawBtn.innerHTML = t('editRaw');
        toggleRow.appendChild(rawBtn);

        // Raw Textarea
        const rawArea = document.createElement('textarea');
        rawArea.className = 'anomalous-nb-textarea';
        rawArea.value = data.promptEn || '';
        rawArea.style.display = 'none';
        rawArea.style.height = '150px';

        // Visual Dual Pane
        const dualPane = document.createElement('div');
        dualPane.className = 'anomalous-nb-dual-pane';

        if (!data.translations) data.translations = {};

        const updateVisualTags = () => {
            dualPane.innerHTML = '';
            const txt = rawArea.value;
            data.promptEn = txt;
            this.saveCurrentNotebook();
            if (!txt.trim()) return;

            const tags = txt.split(',').map(s => s.trim()).filter(s => s);
            tags.forEach((tag, idx) => {
                const tagRow = document.createElement('div');
                tagRow.className = 'anomalous-nb-tag-row';

                const tagL = document.createElement('div');
                tagL.className = 'anomalous-nb-visual-tag';
                tagL.style.flex = '1';
                tagL.style.justifyContent = 'space-between';
                const txtL = document.createElement('span');
                txtL.innerText = tag;
                const copyL = document.createElement('span');
                copyL.className = 'anomalous-nb-copy-btn';
                copyL.innerHTML = '📋';
                copyL.onclick = (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(tag).then(() => { copyL.innerHTML = '✅'; setTimeout(() => copyL.innerHTML = '📋', 1000); });
                };
                tagL.appendChild(txtL);
                tagL.appendChild(copyL);

                const tagR = document.createElement('div');
                tagR.className = 'anomalous-nb-visual-tag';
                tagR.style.flex = '1';
                tagR.style.justifyContent = 'space-between';
                const transTxt = data.translations[tag] ? data.translations[tag] : '...';
                const txtR = document.createElement('span');
                txtR.innerText = transTxt;
                const copyR = document.createElement('span');
                copyR.className = 'anomalous-nb-copy-btn';
                copyR.innerHTML = '📋';
                copyR.onclick = (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(txtR.innerText).then(() => { copyR.innerHTML = '✅'; setTimeout(() => copyR.innerHTML = '📋', 1000); });
                };
                tagR.appendChild(txtR);
                tagR.appendChild(copyR);

                tagL.onmouseenter = () => { tagL.classList.add('hover'); tagR.classList.add('hover'); };
                tagL.onmouseleave = () => { tagL.classList.remove('hover'); tagR.classList.remove('hover'); };
                tagR.onmouseenter = () => { tagL.classList.add('hover'); tagR.classList.add('hover'); };
                tagR.onmouseleave = () => { tagL.classList.remove('hover'); tagR.classList.remove('hover'); };

                tagL.onclick = () => {
                    const inp = document.createElement('input');
                    inp.value = tag; inp.className = 'anomalous-nb-tag-edit';
                    tagL.innerHTML = ''; tagL.appendChild(inp); inp.focus();
                    const finish = () => {
                        tags[idx] = inp.value.trim();
                        rawArea.value = tags.join(', ');
                        updateVisualTags();
                    };
                    inp.onblur = finish;
                    inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
                };

                tagR.onclick = () => {
                    const inp = document.createElement('input');
                    inp.value = data.translations[tag] || ''; inp.className = 'anomalous-nb-tag-edit';
                    tagR.innerHTML = ''; tagR.appendChild(inp); inp.focus();
                    const finish = () => {
                        data.translations[tag] = inp.value.trim();
                        this.saveCurrentNotebook();
                        updateVisualTags();
                    };
                    inp.onblur = finish;
                    inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
                };

                tagRow.appendChild(tagL);
                tagRow.appendChild(tagR);
                dualPane.appendChild(tagRow);

                if (!data.translations[tag]) {
                    fetch('/anomalous/translate', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: tag, target_lang: data.targetLang || 'zh-CN' })
                    }).then(r => r.json()).then(d => {
                        if (d.translated) {
                            data.translations[tag] = d.translated;
                            txtR.innerText = d.translated;
                            this.saveCurrentNotebook();
                        }
                    }).catch(() => { });
                }
            });
        };

        rawBtn.onclick = () => {
            if (rawArea.style.display === 'none') {
                rawArea.style.display = 'block';
                dualPane.style.display = 'none';
                rawBtn.innerHTML = '👁️ Done Editing';
                pToolbar.style.display = 'none';
            } else {
                rawArea.style.display = 'none';
                dualPane.style.display = 'flex';
                rawBtn.innerHTML = '📝 Edit Raw / Paste';
                pToolbar.style.display = 'flex';
                updateVisualTags();
            }
        };

        replaceBtn.onclick = () => {
            const findStr = findInput.value;
            const repStr = replaceInput.value;
            if (!findStr) return;
            const newTxt = rawArea.value.split(findStr).join(repStr);
            rawArea.value = newTxt;
            updateVisualTags();
        };

        rawArea.oninput = () => {
            clearTimeout(this.pTimeout);
            this.pTimeout = setTimeout(() => { data.promptEn = rawArea.value; this.saveCurrentNotebook(); }, 500);
        };

        updateVisualTags();

        promptSec.appendChild(pToolbar);
        promptSec.appendChild(toggleRow);
        promptSec.appendChild(rawArea);
        promptSec.appendChild(dualPane);

        this.nbEditor.appendChild(tb);
        this.nbEditor.appendChild(modelSection);
        this.nbEditor.appendChild(promptSec);

        // Fetch compatible models and fill galleries
        this.fillNotebookGalleries(data.baseModel, mainGallery, loraGallery, data);
    }

    fillNotebookGalleries(baseModel, mainGallery, loraGallery, data) {
        if (!baseModel) return;

        const buildThumbHtml = (m) => {
            let thumb = '';
            if (m.preview_url) {
                const isVid = m.preview_url.match(/\.mp4(?:&|$)/i) || m.preview_url.match(/\.webm(?:&|$)/i);
                if (isVid) thumb = `<video src="${m.preview_url}" muted loop playsinline></video>`;
                else thumb = `<img src="${m.preview_url}" />`;
            } else {
                thumb = `<div style="width:30px; height:30px; background:#222; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#555;">?</div>`;
            }
            return thumb;
        };

        fetch(`/anomalous/compatible_models?base_model=${encodeURIComponent(baseModel)}&target_type=checkpoints,unet,diffusion_models`)
            .then(r => r.json()).then(d => {
                const buildMainDOM = (models) => {
                    mainGallery.innerHTML = '';
                    if (!models || !models.length) {
                        mainGallery.innerHTML = '<span style="color:#666;">No compatible main models found.</span>';
                    } else {
                        models.forEach(m => {
                            const isSelected = (data.mainModel && data.mainModel.filename === m.filename);
                            const card = document.createElement('div');
                            card.className = 'anomalous-nb-minicheck ' + (isSelected ? 'selected' : '');
                            card.innerHTML = `${buildThumbHtml(m)}<div class="anomalous-nb-minicheck-name" title="${m.filename}">${m.filename}</div>`;

                            if (m.preview_url && (m.preview_url.match(/\.mp4(?:&|$)/i) || m.preview_url.match(/\.webm(?:&|$)/i))) {
                                card.onmouseenter = () => { const v = card.querySelector('video'); if (v) v.play().catch(e => { }); };
                                card.onmouseleave = () => { const v = card.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } };
                            }

                            card.onclick = () => {
                                data.mainModel = m;
                                this.saveCurrentNotebook();
                                buildMainDOM(models); // re-render just the main gallery
                            };
                            mainGallery.appendChild(card);
                        });
                    }
                };
                buildMainDOM(d.models || []);
            });

        fetch(`/anomalous/compatible_models?base_model=${encodeURIComponent(baseModel)}&target_type=loras`)
            .then(r => r.json()).then(d => {
                const buildLoraDOM = (models) => {
                    loraGallery.innerHTML = '';
                    if (!models || !models.length) {
                        loraGallery.innerHTML = '<span style="color:#666;">No compatible Loras found.</span>';
                    } else {
                        models.forEach(m => {
                            const loraIndex = data.loras.findIndex(l => l.filename === m.filename);
                            const isSelected = loraIndex !== -1;
                            const card = document.createElement('div');
                            card.className = 'anomalous-nb-minilora ' + (isSelected ? 'selected' : '');
                            card.style.position = 'relative'; // for badge positioning

                            let badgeHtml = '';
                            if (isSelected) {
                                badgeHtml = `<div style="position:absolute; top:-5px; right:-5px; background:#00ffcc; color:#000; border-radius:50%; width:20px; height:20px; font-size:12px; display:flex; align-items:center; justify-content:center; font-weight:bold; z-index:10; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">${loraIndex + 1}</div>`;
                            }

                            card.innerHTML = `${badgeHtml}${buildThumbHtml(m)}<div class="anomalous-nb-minilora-name" title="${m.filename}">${m.filename}</div>`;

                            if (m.preview_url && (m.preview_url.match(/\.mp4(?:&|$)/i) || m.preview_url.match(/\.webm(?:&|$)/i))) {
                                card.onmouseenter = () => { const v = card.querySelector('video'); if (v) v.play().catch(e => { }); };
                                card.onmouseleave = () => { const v = card.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } };
                            }

                            card.onclick = () => {
                                if (isSelected) {
                                    data.loras = data.loras.filter(l => l.filename !== m.filename);
                                } else {
                                    data.loras.push(m);
                                }
                                this.saveCurrentNotebook();
                                buildLoraDOM(models); // re-render just the lora gallery
                            };
                            loraGallery.appendChild(card);
                        });
                    }
                };
                buildLoraDOM(d.models || []);
            });
    }

    sendNotebookToCanvas() {
        if (!this.currentNotebook) return;
        const data = this.currentNotebook.data || {};
        if (!data.mainModel) {
            alert(window.anomalous_browser_lang === 'zh' ? "请先选择一个主模型。" : "Please select a Main Model first.");
            return;
        }

        const groupNodes = [];
        const isUnet = data.mainModel.type === 'unet' || data.mainModel.type === 'diffusion_models';

        const ckptNode = LiteGraph.createNode(isUnet ? "UNETLoader" : "CheckpointLoaderSimple");
        app.graph.add(ckptNode);
        groupNodes.push({ node: ckptNode, relX: 0, relY: 0 });

        const sub = data.mainModel.subfolder.replace(/^\/+/, '').replace(/\/+$/, '');
        const relPath = sub ? `${sub}/${data.mainModel.filename}` : data.mainModel.filename;
        this.setWidgetValuePath(ckptNode, relPath);

        let lastNode = ckptNode;
        let lastModelSlot = isUnet ? 0 : 0;
        let lastClipSlot = isUnet ? null : 1;

        let relX = 350;
        let relY = 0;

        data.loras.forEach((lora, idx) => {
            const loraNode = LiteGraph.createNode("LoraLoader");
            app.graph.add(loraNode);
            groupNodes.push({ node: loraNode, relX: relX, relY: relY });

            const lsub = lora.subfolder.replace(/^\/+/, '').replace(/\/+$/, '');
            const lrelPath = lsub ? `${lsub}/${lora.filename}` : lora.filename;
            this.setWidgetValuePath(loraNode, lrelPath);

            lastNode.connect(lastModelSlot, loraNode, 0);
            if (lastClipSlot !== null) lastNode.connect(lastClipSlot, loraNode, 1);

            lastNode = loraNode;
            lastModelSlot = 0;
            lastClipSlot = 1;
            relX += 350;
        });

        if (data.promptEn) {
            const posNode = LiteGraph.createNode("CLIPTextEncode");
            posNode.title = "CLIP Text Encode (Positive)";
            app.graph.add(posNode);
            groupNodes.push({ node: posNode, relX: relX, relY: 0 });

            if (posNode.widgets && posNode.widgets.length > 0) {
                const tw = posNode.widgets.find(w => w.name === 'text' || w.type === 'customtext');
                if (tw) tw.value = data.promptEn;
            }
            if (lastClipSlot !== null) {
                lastNode.connect(lastClipSlot, posNode, 0);
            }

            const negNode = LiteGraph.createNode("CLIPTextEncode");
            negNode.title = "CLIP Text Encode (Negative)";
            app.graph.add(negNode);
            groupNodes.push({ node: negNode, relX: relX, relY: 250 });

            if (negNode.widgets && negNode.widgets.length > 0) {
                const tw = negNode.widgets.find(w => w.name === 'text' || w.type === 'customtext');
                if (tw) tw.value = "text, watermark, ugly, bad anatomy";
            }
            if (lastClipSlot !== null) {
                lastNode.connect(lastClipSlot, negNode, 0);
            }
        }

        this.nbPanel.style.display = 'none';
        this.close();

        // Magnetic Sticking Logic
        let isSticking = true;
        const stickHandler = (e) => {
            if (!isSticking || !app.canvas) return;
            const canvas = app.canvas;

            let canvasX, canvasY;
            if (canvas.convertEventToCanvasOffset) {
                const pos = canvas.convertEventToCanvasOffset(e);
                canvasX = pos[0];
                canvasY = pos[1];
            } else {
                const rect = canvas.canvas.getBoundingClientRect();
                canvasX = (e.clientX - rect.left - canvas.ds.offset[0]) / canvas.ds.scale;
                canvasY = (e.clientY - rect.top - canvas.ds.offset[1]) / canvas.ds.scale;
            }

            groupNodes.forEach(item => {
                const w = (item.node.size && item.node.size[0]) ? item.node.size[0] : 200;
                item.node.pos = [canvasX - (w / 2) + item.relX, canvasY - 20 + item.relY];
            });
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
    setWidgetValuePath(node, relPath) {
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

    hideAllPanels() {
        this.grid.style.display = 'none';
        this.detailPanel.style.display = 'none';
        if (this.galleryPanel) this.galleryPanel.style.display = 'none';
        if (this.nbPanel) this.nbPanel.style.display = 'none';
        if (this.doctorPanel) this.doctorPanel.style.display = 'none';
        if (this.assistantPanel) this.assistantPanel.style.display = 'none';
        if (this.currentDetailObserver) {
            this.currentDetailObserver.disconnect();
            this.currentDetailObserver = null;
        }
    }

    // [Doctor & Assistant Panel methods extracted to ui_doctor.js]

    showPreflightImportModal() {
        let overlay = document.getElementById('anomalous-import-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'anomalous-import-overlay';
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100vw';
            overlay.style.height = '100vh';
            overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
            overlay.style.zIndex = '9999999';
            overlay.style.display = 'flex';
            overlay.style.justifyContent = 'center';
            overlay.style.alignItems = 'center';

            const modal = document.createElement('div');
            modal.style.width = '600px';
            modal.style.maxWidth = '90vw';
            modal.style.background = '#222';
            modal.style.borderRadius = '12px';
            modal.style.padding = '20px';
            modal.style.border = '1px solid rgba(255,255,255,0.1)';
            modal.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
            modal.style.display = 'flex';
            modal.style.flexDirection = 'column';
            modal.style.gap = '15px';

            const header = document.createElement('h2');
            header.style.margin = '0';
            header.style.color = '#fff';
            header.innerText = window.anomalous_browser_lang === 'zh' ? '📥 导入工作流 (预检海关)' : '📥 Pre-flight Import Workflow';
            modal.appendChild(header);

            const desc = document.createElement('div');
            desc.style.color = '#aaa';
            desc.style.fontSize = '14px';
            desc.innerText = window.anomalous_browser_lang === 'zh' ? '请在此处粘贴工作流的 JSON 代码（未来将支持分享码）。我们将为您提取并校验所有模型依赖。' : 'Paste the workflow JSON here. We will extract and validate all model dependencies before loading.';
            modal.appendChild(desc);

            const textarea = document.createElement('textarea');
            textarea.id = 'anomalous-import-textarea';
            textarea.style.width = '100%';
            textarea.style.height = '150px';
            textarea.style.background = '#111';
            textarea.style.color = '#fff';
            textarea.style.border = '1px solid #444';
            textarea.style.borderRadius = '6px';
            textarea.style.padding = '10px';
            textarea.style.fontFamily = 'monospace';
            textarea.style.resize = 'vertical';
            textarea.style.boxSizing = 'border-box';
            textarea.placeholder = '{"last_node_id": ...}';
            modal.appendChild(textarea);

            const resultArea = document.createElement('div');
            resultArea.id = 'anomalous-import-result';
            resultArea.style.maxHeight = '300px';
            resultArea.style.overflowY = 'auto';
            resultArea.style.display = 'none';
            resultArea.style.flexDirection = 'column';
            resultArea.style.gap = '10px';
            resultArea.style.background = 'rgba(0,0,0,0.2)';
            resultArea.style.padding = '15px';
            resultArea.style.borderRadius = '8px';
            modal.appendChild(resultArea);

            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.justifyContent = 'flex-end';
            btnRow.style.gap = '10px';

            const closeBtn = document.createElement('button');
            closeBtn.innerText = window.anomalous_browser_lang === 'zh' ? '取消' : 'Cancel';
            closeBtn.style.padding = '8px 16px';
            closeBtn.style.background = 'transparent';
            closeBtn.style.color = '#ccc';
            closeBtn.style.border = '1px solid #555';
            closeBtn.style.borderRadius = '6px';
            closeBtn.style.cursor = 'pointer';
            closeBtn.onclick = () => { overlay.style.display = 'none'; };

            const analyzeBtn = document.createElement('button');
            analyzeBtn.id = 'anomalous-import-analyze-btn';
            analyzeBtn.innerText = window.anomalous_browser_lang === 'zh' ? '🔍 解析并预检' : '🔍 Analyze & Pre-flight';
            analyzeBtn.style.padding = '8px 16px';
            analyzeBtn.style.background = '#1a73e8';
            analyzeBtn.style.color = '#fff';
            analyzeBtn.style.border = 'none';
            analyzeBtn.style.borderRadius = '6px';
            analyzeBtn.style.cursor = 'pointer';

            const loadBtn = document.createElement('button');
            loadBtn.id = 'anomalous-import-load-btn';
            loadBtn.innerText = window.anomalous_browser_lang === 'zh' ? '🚀 强制载入画布' : '🚀 Force Load to Canvas';
            loadBtn.style.padding = '8px 16px';
            loadBtn.style.background = '#28a745';
            loadBtn.style.color = '#fff';
            loadBtn.style.border = 'none';
            loadBtn.style.borderRadius = '6px';
            loadBtn.style.cursor = 'pointer';
            loadBtn.style.display = 'none';

            let parsedGraphData = null;

            analyzeBtn.onclick = async () => {
                try {
                    const jsonStr = textarea.value.trim();
                    if (!jsonStr) return;
                    parsedGraphData = JSON.parse(jsonStr);

                    try {
                        const res = await fetch('/anomalous/all_hashes');
                        const hData = await res.json();
                        const hObj = hData.hashes ? hData.hashes : hData;
                        Object.assign(window.anomalous_hash_cache, hObj);
                    } catch (e) { }

                    const models = [];
                    if (parsedGraphData.nodes) {
                        for (const node of parsedGraphData.nodes) {
                            if (node.widgets_values) {
                                for (const v of node.widgets_values) {
                                    if (typeof v === 'string' && (v.endsWith('.safetensors') || v.endsWith('.ckpt') || v.endsWith('.pt') || v.endsWith('.sft') || v.endsWith('.bin'))) {
                                        models.push({ nodeType: node.type, value: v });
                                    }
                                }
                            }
                        }
                    }

                    textarea.style.display = 'none';
                    resultArea.style.display = 'flex';
                    analyzeBtn.style.display = 'none';
                    loadBtn.style.display = 'block';

                    if (models.length === 0) {
                        resultArea.innerHTML = `<div style="color:#28a745;">${window.anomalous_browser_lang === 'zh' ? '✅ 未检测到任何模型依赖。' : '✅ No model dependencies detected.'}</div>`;
                        return;
                    }

                    resultArea.innerHTML = `<div style="color:#fff; font-weight:bold; margin-bottom:10px;">${window.anomalous_browser_lang === 'zh' ? `扫描到 ${models.length} 个模型资源：` : `Detected ${models.length} model resources:`}</div>`;

                    for (const m of models) {
                        const val = m.value;
                        const parts = val.split(/[\\/]/);
                        const basename = parts[parts.length - 1];

                        let isHealthy = false;
                        let cacheHit = window.anomalous_hash_cache[basename] || window.anomalous_hash_cache[val];

                        const fetchRes = await fetch(`/anomalous/resolve_hash?hash=unknown&size=&filename=${encodeURIComponent(val)}`);
                        const fetchData = await fetchRes.json();
                        if (fetchData.found) {
                            isHealthy = true;
                        } else if (cacheHit) {
                            const resolveRes = await fetch(`/anomalous/resolve_hash?hash=${encodeURIComponent(cacheHit.hash || cacheHit)}&size=`);
                            const resolveData = await resolveRes.json();
                            if (resolveData.found) isHealthy = true;
                        }

                        const item = document.createElement('div');
                        item.style.display = 'flex';
                        item.style.alignItems = 'center';
                        item.style.justifyContent = 'space-between';
                        item.style.padding = '8px';
                        item.style.background = 'rgba(255,255,255,0.05)';
                        item.style.borderRadius = '4px';

                        const left = document.createElement('div');
                        left.style.display = 'flex';
                        left.style.alignItems = 'center';
                        left.style.gap = '8px';

                        const icon = document.createElement('span');
                        icon.innerText = isHealthy ? '✅' : '⚠️';

                        const text = document.createElement('span');
                        text.innerText = `[${m.nodeType}] ${basename}`;
                        text.style.color = isHealthy ? '#ccc' : '#ff6b6b';
                        text.style.fontSize = '14px';

                        left.appendChild(icon);
                        left.appendChild(text);
                        item.appendChild(left);

                        if (!isHealthy) {
                            const right = document.createElement('a');
                            right.href = `https://civitai.com/search/models?sortBy=models_v9&query=${encodeURIComponent(basename.replace('.safetensors', '').replace('.ckpt', ''))}`;
                            right.target = '_blank';
                            right.innerText = window.anomalous_browser_lang === 'zh' ? '去 C站下载' : 'Download';
                            right.style.color = '#1a73e8';
                            right.style.fontSize = '12px';
                            right.style.textDecoration = 'none';
                            item.appendChild(right);
                        } else {
                            const right = document.createElement('span');
                            right.innerText = window.anomalous_browser_lang === 'zh' ? '已就绪' : 'Ready';
                            right.style.color = '#28a745';
                            right.style.fontSize = '12px';
                            item.appendChild(right);
                        }

                        resultArea.appendChild(item);
                    }

                } catch (e) {
                    alert('Invalid JSON! ' + e.message);
                }
            };

            loadBtn.onclick = () => {
                if (parsedGraphData && app) {
                    app.loadGraphData(parsedGraphData);
                    overlay.style.display = 'none';
                }
            };

            btnRow.appendChild(closeBtn);
            btnRow.appendChild(analyzeBtn);
            btnRow.appendChild(loadBtn);
            modal.appendChild(btnRow);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        }

        const textarea = document.getElementById('anomalous-import-textarea');
        const resultArea = document.getElementById('anomalous-import-result');
        const analyzeBtn = document.getElementById('anomalous-import-analyze-btn');
        const loadBtn = document.getElementById('anomalous-import-load-btn');

        if (textarea) {
            textarea.value = '';
            textarea.style.display = 'block';
        }
        if (resultArea) {
            resultArea.style.display = 'none';
            resultArea.innerHTML = '';
        }
        if (analyzeBtn) analyzeBtn.style.display = 'block';
        if (loadBtn) loadBtn.style.display = 'none';

        overlay.style.display = 'flex';
    }

    _openAdvancedModelSelector(initialSelectedMap, onConfirm) {
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
        title.innerText = window.anomalous_browser_lang === 'zh' ? '选择模型' : 'Select Models';
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
        leftTitle.innerText = window.anomalous_browser_lang === 'zh' ? '目录列表' : 'Folders';
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
                summaryText.innerHTML = window.anomalous_browser_lang === 'zh' 
                    ? `已选 <span style="color: #8ab4f8; font-size: 16px; font-weight: 500;">${total}</span> 项` 
                    : `Selected <span style="color: #8ab4f8; font-size: 16px; font-weight: 500;">${total}</span> items`;
            } else {
                summaryText.innerHTML = window.anomalous_browser_lang === 'zh' ? '暂未选择' : 'Nothing selected';
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
                statusDiv.innerText = window.anomalous_browser_lang === 'zh'
                    ? `已加载 ${currentModels.length} / ${currentTotal} 个模型`
                    : `Loaded ${currentModels.length} / ${currentTotal} models`;
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
            
            summaryText.innerHTML = window.anomalous_browser_lang === 'zh' ? '计算中...' : 'Computing...';
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
                summaryText.innerHTML = '<span style="color:#f28b82">Error</span>';
                setTimeout(() => updateGridCheckboxes(), 2000);
            }
        };

        toolbar.appendChild(createTBtn(window.anomalous_browser_lang === 'zh' ? '选无预览图' : 'Select No Preview', () => handleBatchSelect('no_preview'), true));
        toolbar.appendChild(createTBtn(window.anomalous_browser_lang === 'zh' ? '选无介绍' : 'Select No Desc', () => handleBatchSelect('no_desc'), true));
        
        const divi = document.createElement('div');
        divi.style.width = '1px'; divi.style.height = '24px'; divi.style.background = '#3c4043'; divi.style.margin = '0 8px';
        toolbar.appendChild(divi);

        toolbar.appendChild(createTBtn(window.anomalous_browser_lang === 'zh' ? '全选' : 'Select All', () => handleBatchSelect('all')));
        toolbar.appendChild(createTBtn(window.anomalous_browser_lang === 'zh' ? '清空' : 'Clear', () => handleBatchSelect('none')));

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
        cancelBtn.innerText = window.anomalous_browser_lang === 'zh' ? '取消' : 'Cancel';
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
        confirmBtn.innerText = window.anomalous_browser_lang === 'zh' ? '确定' : 'Confirm';
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
            loadingIndicator.innerText = window.anomalous_browser_lang === 'zh' ? '加载中 (Loading)...' : 'Loading...';
            grid.appendChild(loadingIndicator);
            
            try {
                const sep = currentBaseUrl.includes('?') ? '&' : '?';
                const url = `${currentBaseUrl}${sep}page=${currentPage}&limit=50`;
                const res = await fetch(url);
                if (!res.ok) {
                     grid.innerHTML = `<div class="status-text" style="grid-column: 1 / -1; padding: 60px; text-align: center; color: #f28b82; font-size: 16px;">❌ 请求后端 API 失败！<br><br>你必须重启 ComfyUI 进程，刚写入后端的代码才能生效。</div>`;
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
                     grid.innerHTML = `<div class="status-text" style="grid-column: 1 / -1; padding: 60px; text-align: center; color: #9aa0a6; font-size: 16px;">No models found.</div>`;
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
                         statusText.innerText = window.anomalous_browser_lang === 'zh' ? '✅ 已加载全部' : '✅ All models loaded';
                     } else {
                         statusText.innerText = window.anomalous_browser_lang === 'zh' ? '滑动加载更多...' : 'Scroll for more...';
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
            allBtn.innerHTML = `<span>🌟 ${window.anomalous_browser_lang === 'zh' ? '全部模型' : 'All Models'}</span>`;
            
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
                    leftPart.innerHTML = `<span style="color:#9aa0a6">📁</span> <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;">${fData.name}</span> <span style="color:#5f6368;font-size:12px">(${fData.model_count})</span>`;
                    
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

}


// --- Extracted Module Bindings ---
AnomalousBrowser.prototype.initDoctorPanel = initDoctorPanel;
AnomalousBrowser.prototype.diagnoseNode = diagnoseNode;
AnomalousBrowser.prototype.renderGlobalDashboard = renderGlobalDashboard;
AnomalousBrowser.prototype.initAssistantPanel = initAssistantPanel;
AnomalousBrowser.prototype.renderAssistantModelCard = renderAssistantModelCard;
AnomalousBrowser.prototype._loadAssistantHistory = _loadAssistantHistory;
AnomalousBrowser.prototype._openGalleryReplacer = _openGalleryReplacer;
AnomalousBrowser.prototype.runGlobalDoctorScan = runGlobalDoctorScan;

app.registerExtension({
    name: 'Anomalous.ModelBrowser',
    async setup() {
        const cssUrl = '/extensions/Anomalous_Model_Browser/styles.css?v=' + Date.now();
        if (!document.querySelector(`link[href^="/extensions/Anomalous_Model_Browser/styles.css"]`)) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.type = "text/css";
            link.href = cssUrl;
            document.head.appendChild(link);
        }
        if (!localStorage.getItem('anomalous_lang')) {
            try {
                if (app && app.ui && app.ui.settings) {
                    const locale = app.ui.settings.getSettingValue('Comfy.Locale') || app.ui.settings.getSettingValue('Comfy.Locale.Language');
                    if (locale) {
                        currentLang = locale.toLowerCase().includes('en') ? 'en' : 'zh';
                        window.anomalous_browser_lang = currentLang;
                    }
                }
            } catch (e) { }
        }

        const browser = new AnomalousBrowser();
        window.anomalousBrowserInstance = browser;
        const btn = document.createElement('button');
        btn.id = 'anomalous-trigger-btn';
        btn.innerHTML = '📦';
        btn.title = window.anomalous_browser_lang === 'zh' ? '打开 Anomalous 模型浏览器' : 'Open Anomalous Model Browser';

        let isDragging = false;
        let startX, startY, initialX, initialY;

        btn.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = btn.getBoundingClientRect();
            initialX = rect.left; initialY = rect.top;
            btn.style.transition = 'none';
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            let newX = initialX + (e.clientX - startX);
            let newY = initialY + (e.clientY - startY);
            if (newX < 0) newX = 0;
            if (newY < 0) newY = 0;
            if (newX > window.innerWidth - 60) newX = window.innerWidth - 60;
            if (newY > window.innerHeight - 60) newY = window.innerHeight - 60;
            btn.style.left = newX + 'px';
            btn.style.top = newY + 'px';
            btn.style.right = 'auto'; btn.style.bottom = 'auto';
        });
        window.addEventListener('mouseup', (e) => {
            if (isDragging) {
                isDragging = false;
                btn.style.transition = 'transform 0.15s, box-shadow 0.15s';
                localStorage.setItem('anomalous_btn_x', btn.style.left);
                localStorage.setItem('anomalous_btn_y', btn.style.top);
                if (Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5) browser.show();
            }
        });

        const savedX = localStorage.getItem('anomalous_btn_x');
        const savedY = localStorage.getItem('anomalous_btn_y');

        const updateBtnBounds = () => {
            let numX = parseInt(btn.style.left || savedX);
            let numY = parseInt(btn.style.top || savedY);
            if (isNaN(numX)) numX = window.innerWidth - 90;
            if (isNaN(numY)) numY = window.innerHeight - 90;

            if (numX < 0) numX = 0;
            if (numY < 0) numY = 0;
            if (numX > window.innerWidth - 60) numX = window.innerWidth - 60;
            if (numY > window.innerHeight - 60) numY = window.innerHeight - 60;
            btn.style.left = numX + 'px';
            btn.style.top = numY + 'px';
        };

        if (savedX && savedY && savedX !== 'NaN' && savedY !== 'NaN') {
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
            btn.style.left = savedX;
            btn.style.top = savedY;
        }

        // Always trigger an update slightly after load to ensure it's in bounds
        setTimeout(updateBtnBounds, 200);

        window.addEventListener('resize', () => {
            if (btn.style.left) updateBtnBounds();
        });

        document.body.appendChild(btn);

        // Pre-create a lightweight, translucent, and aesthetic drag ghost image for huge Hires Fix images
        window.anomalousDragGhostImg = new Image();
        window.anomalousDragGhostImg.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='76' height='76' x='2' y='2' fill='%231a1a1a' fill-opacity='0.6' rx='16' stroke='%2300ffcc' stroke-width='2'/><text x='40' y='50' font-family='sans-serif' font-size='32' font-weight='bold' fill='%2300ffcc' text-anchor='middle'>W</text></svg>";
    }
});


// --- INJECTED WORKFLOW SHARE MODULE ---
// Workflow Share and Preview Modal for Anomalous_Model_Browser

const AMB_WorkflowShare = {
    // ----------------------------------------------------------------------
    // 1. Data Compression & Base64 Utils
    // ----------------------------------------------------------------------
    strToU8(str) {
        return new TextEncoder().encode(str);
    },
    u8ToStr(u8) {
        return new TextDecoder().decode(u8);
    },
    u8ToBase64(u8) {
        let binary = '';
        const len = u8.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(u8[i]);
        }
        return window.btoa(binary);
    },
    base64ToU8(b64) {
        const binary = window.atob(b64);
        const len = binary.length;
        const u8 = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            u8[i] = binary.charCodeAt(i);
        }
        return u8;
    },
    async compress(str) {
        const stream = new Blob([this.strToU8(str)]).stream();
        const compressedStream = stream.pipeThrough(new CompressionStream('deflate-raw'));
        const response = new Response(compressedStream);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        return new Uint8Array(buffer);
    },
    async decompress(u8) {
        const stream = new Blob([u8]).stream();
        const decompressedStream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
        const response = new Response(decompressedStream);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        return this.u8ToStr(new Uint8Array(buffer));
    },

    // ----------------------------------------------------------------------
    // 2. Skeleton Generation (Strip visual / default data)
    // ----------------------------------------------------------------------
    skeletonize(workflowJson) {
        const wf = JSON.parse(JSON.stringify(workflowJson)); // deep copy
        
        // ComfyUI workflow JSON format has "nodes" array
        if (wf.nodes && Array.isArray(wf.nodes)) {
            wf.nodes.forEach(node => {
                // Delete layout coords and styles
                delete node.pos;
                delete node.size;
                delete node.color;
                delete node.bgcolor;
                delete node.shape;
                delete node.flags;
                // Delete empty properties
                if (node.properties && Object.keys(node.properties).length === 0) {
                    delete node.properties;
                }
            });
        }
        
        // Remove view metadata
        if (wf.extra) {
            delete wf.extra.ds; // scale/offset
        }
        
        return wf;
    },

    // ----------------------------------------------------------------------
    // 3. Auto-Layout Algorithm
    // ----------------------------------------------------------------------
    autoLayout(workflowJson) {
        if (!workflowJson.nodes || !Array.isArray(workflowJson.nodes)) return workflowJson;
        
        const nodes = workflowJson.nodes;
        
        // 1. Build adjacency list and in-degrees
        const adj = new Map();
        const inDegree = new Map();
        
        nodes.forEach(n => {
            adj.set(n.id, []);
            if (!inDegree.has(n.id)) inDegree.set(n.id, 0);
        });
        
        // Check links
        if (workflowJson.links) {
            workflowJson.links.forEach(link => {
                if (!link) return;
                const fromId = link[1];
                const toId = link[3];
                if (adj.has(fromId) && adj.has(toId)) {
                    adj.get(fromId).push(toId);
                    inDegree.set(toId, inDegree.get(toId) + 1);
                }
            });
        }
        
        // 2. Topological sort with depth levels
        const depthMap = new Map(); // id -> depth
        const queue = [];
        
        nodes.forEach(n => {
            if (inDegree.get(n.id) === 0) {
                queue.push(n.id);
                depthMap.set(n.id, 0);
            }
        });
        
        while (queue.length > 0) {
            const curr = queue.shift();
            const currDepth = depthMap.get(curr);
            
            const neighbors = adj.get(curr);
            if (neighbors) {
                neighbors.forEach(nxt => {
                    // Reduce in-degree
                    const ind = inDegree.get(nxt) - 1;
                    inDegree.set(nxt, ind);
                    
                    // Update depth to be max(existing depth, currDepth + 1)
                    const existingDepth = depthMap.get(nxt) || 0;
                    depthMap.set(nxt, Math.max(existingDepth, currDepth + 1));
                    
                    if (ind === 0) {
                        queue.push(nxt);
                    }
                });
            }
        }
        
        // Handle cycles (nodes not reached)
        nodes.forEach(n => {
            if (!depthMap.has(n.id)) {
                depthMap.set(n.id, 0);
            }
        });
        
        // 3. Assign X, Y coordinates
        const nodesByDepth = {};
        nodes.forEach(n => {
            const d = depthMap.get(n.id);
            if (!nodesByDepth[d]) nodesByDepth[d] = [];
            nodesByDepth[d].push(n);
        });
        
        // Spacing constants
        const X_SPACING = 400;
        const Y_SPACING = 300;
        
        Object.keys(nodesByDepth).forEach(d => {
            const levelNodes = nodesByDepth[d];
            const depth = parseInt(d);
            levelNodes.forEach((n, idx) => {
                // Approximate size
                n.pos = [
                    depth * X_SPACING,
                    idx * Y_SPACING
                ];
            });
        });
        
        return workflowJson;
    },

    // ----------------------------------------------------------------------
    // 4. Encode / Decode
    // ----------------------------------------------------------------------
    async encodeShareCode(workflowJson, isSkeleton) {
        let targetJson = workflowJson;
        if (isSkeleton) {
            targetJson = this.skeletonize(workflowJson);
        }
        
        const jsonStr = JSON.stringify(targetJson);
        const compressedU8 = await this.compress(jsonStr);
        const base64Str = this.u8ToBase64(compressedU8);
        
        const prefix = isSkeleton ? 'AMB1-' : 'AMB0-';
        return prefix + base64Str;
    },
    
    async decodeShareCode(shareCode) {
        if (!shareCode.startsWith('AMB0-') && !shareCode.startsWith('AMB1-')) {
            throw new Error('Invalid Share Code Format.');
        }
        
        const isSkeleton = shareCode.startsWith('AMB1-');
        const base64Str = shareCode.substring(5);
        
        const compressedU8 = this.base64ToU8(base64Str);
        const jsonStr = await this.decompress(compressedU8);
        
        let workflowJson = JSON.parse(jsonStr);
        
        if (isSkeleton) {
            workflowJson = this.autoLayout(workflowJson);
        }
        
        return workflowJson;
    },
    
    // ----------------------------------------------------------------------
    // 5. UI Modals
    // ----------------------------------------------------------------------
    showToast(message, color) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed; bottom: 30px; right: 30px; background: #2a2a2b; color: ${color || '#fff'};
            padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            font-family: Arial, sans-serif; font-size: 14px; z-index: 9999999;
            opacity: 0; transition: opacity 0.3s ease; border-left: 4px solid ${color || '#fff'};
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.style.opacity = '1', 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    showExportModal() {
        const lang = window.anomalous_browser_lang || 'en';
        
        const overlay = document.createElement('div');
        overlay.id = 'amb-export-modal';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            z-index: 999999; display: flex; justify-content: center; align-items: center;
            font-family: Arial, sans-serif;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2b; color: #fff; padding: 30px; border-radius: 12px;
            width: 500px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; gap: 20px;
        `;
        
        const title = document.createElement('h2');
        title.style.margin = '0';
        title.textContent = lang === 'zh' ? '📦 导出工作流分享码' : '📦 Export Workflow Share Code';
        
        const typeSelectContainer = document.createElement('div');
        typeSelectContainer.innerHTML = `
            <label style="display: block; margin-bottom: 8px; cursor: pointer;">
                <input type="radio" name="amb-share-type" value="skeleton" checked />
                ${lang === 'zh' ? '精简版 (推荐 B站评论区, 体积小, 丢失坐标)' : 'Skeleton (Compact, best for comments, loses coords)'}
            </label>
            <label style="display: block; cursor: pointer;">
                <input type="radio" name="amb-share-type" value="full" />
                ${lang === 'zh' ? '完整版 (保留所有坐标与颜色, 较长)' : 'Full (Keeps coords and colors, longer string)'}
            </label>
        `;
        
        const textArea = document.createElement('textarea');
        textArea.style.cssText = `
            width: 100%; height: 150px; background: #1e1e1f; color: #eee;
            border: 1px solid #444; border-radius: 6px; padding: 10px;
            font-family: monospace; font-size: 12px; resize: none; box-sizing: border-box;
        `;
        textArea.readOnly = true;
        
        const btnGroup = document.createElement('div');
        btnGroup.style.cssText = `display: flex; gap: 10px; justify-content: flex-end;`;
        
        const generateBtn = document.createElement('button');
        generateBtn.textContent = lang === 'zh' ? '生成分享码' : 'Generate';
        generateBtn.style.cssText = `padding: 8px 16px; background: #4a90e2; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        const copyBtn = document.createElement('button');
        copyBtn.textContent = lang === 'zh' ? '复制到剪贴板' : 'Copy';
        copyBtn.style.cssText = `padding: 8px 16px; background: #5cb85c; color: #fff; border: none; border-radius: 6px; cursor: pointer; display: none;`;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = lang === 'zh' ? '关闭' : 'Close';
        closeBtn.style.cssText = `padding: 8px 16px; background: #555; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        closeBtn.onclick = () => overlay.remove();
        
        generateBtn.onclick = async () => {
            const isSkeleton = document.querySelector('input[name="amb-share-type"]:checked').value === 'skeleton';
            
            // Get current workflow from app graph
            const p = await app.graphToPrompt();
            const workflowJson = p.workflow;
            
            try {
                const code = await AMB_WorkflowShare.encodeShareCode(workflowJson, isSkeleton);
                textArea.value = code;
                copyBtn.style.display = 'block';
            } catch (err) {
                textArea.value = 'Error generating code: ' + err.message;
            }
        };
        
        copyBtn.onclick = () => {
            textArea.select();
            document.execCommand('copy');
            AMB_WorkflowShare.showToast(lang === 'zh' ? '✅ 复制成功！' : '✅ Copied successfully!', '#5cb85c');
        };
        
        btnGroup.appendChild(generateBtn);
        btnGroup.appendChild(copyBtn);
        btnGroup.appendChild(closeBtn);
        
        content.appendChild(title);
        content.appendChild(typeSelectContainer);
        content.appendChild(textArea);
        content.appendChild(btnGroup);
        overlay.appendChild(content);
        
        document.body.appendChild(overlay);
    },
    
    showImportModal() {
        const lang = window.anomalous_browser_lang || 'en';
        
        const overlay = document.createElement('div');
        overlay.id = 'amb-import-modal';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            z-index: 999999; display: flex; justify-content: center; align-items: center;
            font-family: Arial, sans-serif;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2b; color: #fff; padding: 30px; border-radius: 12px;
            width: 600px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; gap: 20px;
        `;
        
        const title = document.createElement('h2');
        title.style.margin = '0';
        title.textContent = lang === 'zh' ? '📥 导入工作流分享码' : '📥 Import Workflow Share Code';
        
        const inputArea = document.createElement('textarea');
        inputArea.placeholder = lang === 'zh' ? '粘贴 AMB0- 或 AMB1- 开头的分享码...' : 'Paste AMB0- or AMB1- share code here...';
        inputArea.style.cssText = `
            width: 100%; height: 100px; background: #1e1e1f; color: #eee;
            border: 1px solid #444; border-radius: 6px; padding: 10px;
            font-family: monospace; font-size: 12px; resize: none; box-sizing: border-box;
        `;
        
        const btnGroup = document.createElement('div');
        btnGroup.style.cssText = `display: flex; gap: 10px; justify-content: flex-end;`;
        
        const loadBtn = document.createElement('button');
        loadBtn.textContent = lang === 'zh' ? '导入并加载' : 'Import & Load';
        loadBtn.style.cssText = `padding: 8px 16px; background: #e07a5f; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = lang === 'zh' ? '取消' : 'Cancel';
        closeBtn.style.cssText = `padding: 8px 16px; background: #555; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        closeBtn.onclick = () => overlay.remove();
        
        loadBtn.onclick = async () => {
            const code = inputArea.value.trim();
            if (!code) {
                AMB_WorkflowShare.showToast(lang === 'zh' ? '❌ 分享码为空' : '❌ Share code is empty', '#ff6b6b');
                return;
            }
            try {
                const pendingWorkflow = await AMB_WorkflowShare.decodeShareCode(code);
                app.loadGraphData(pendingWorkflow);
                overlay.remove();
                
                const nodesCount = pendingWorkflow.nodes ? pendingWorkflow.nodes.length : 0;
                AMB_WorkflowShare.showToast(lang === 'zh' ? `✅ 成功导入 ${nodesCount} 个节点配置` : `✅ Successfully imported ${nodesCount} nodes`, '#5cb85c');
                
                // Auto close the main browser panel
                const mainCloseBtn = document.getElementById('anomalous-close');
                if (mainCloseBtn) mainCloseBtn.click();
            } catch (err) {
                AMB_WorkflowShare.showToast(lang === 'zh' ? `❌ 解析失败: ${err.message}` : `❌ Decode Failed: ${err.message}`, '#ff6b6b');
            }
        };
        
        btnGroup.appendChild(loadBtn);
        btnGroup.appendChild(closeBtn);
        
        content.appendChild(title);
        content.appendChild(inputArea);
        content.appendChild(btnGroup);
        overlay.appendChild(content);
        
        document.body.appendChild(overlay);
    },
    showUnifiedModal() {
        const lang = window.anomalous_browser_lang || 'en';
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            z-index: 999999; display: flex; justify-content: center; align-items: center;
            font-family: Arial, sans-serif;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2b; color: #fff; padding: 30px; border-radius: 12px;
            width: 400px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; gap: 20px; text-align: center;
        `;
        
        const title = document.createElement('h2');
        title.style.margin = '0';
        title.textContent = lang === 'zh' ? '🔄 工作流分享与导入' : '🔄 Workflow Share & Import';
        
        const exportBtn = document.createElement('button');
        exportBtn.textContent = lang === 'zh' ? '📤 导出当前工作流为分享码' : '📤 Export Workflow to Share Code';
        exportBtn.style.cssText = `padding: 12px; background: #4a90e2; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;`;
        exportBtn.onclick = () => { overlay.remove(); this.showExportModal(); };
        
        const importBtn = document.createElement('button');
        importBtn.textContent = lang === 'zh' ? '📥 从分享码导入工作流' : '📥 Import Workflow from Share Code';
        importBtn.style.cssText = `padding: 12px; background: #e07a5f; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;`;
        importBtn.onclick = () => { overlay.remove(); this.showImportModal(); };
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = lang === 'zh' ? '关闭' : 'Close';
        closeBtn.style.cssText = `padding: 8px; background: #555; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; margin-top: 10px;`;
        closeBtn.onclick = () => overlay.remove();
        
        content.appendChild(title);
        content.appendChild(exportBtn);
        content.appendChild(importBtn);
        content.appendChild(closeBtn);
        overlay.appendChild(content);
        
        document.body.appendChild(overlay);
    }
};

window.AMB_WorkflowShare = AMB_WorkflowShare;
