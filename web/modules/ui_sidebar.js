/**
 * ui_sidebar.js
 * Extracted Sidebar methods.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';
import { escapeHtml } from './safe_dom.js';
import { updateScanProgress, finishScanProgress, failScanProgress } from './scan_progress.js';
import { openModelSourcesModal } from './ui_model_sources.js';
import { showUpdateGuide } from './ui_update_guide.js';
import { configureSidebarAction, configureSidebarActions } from './sidebar_actions.js';
import { CATALOG_TOOLS, FIXED_ANCHORS, getToolDefinition } from './tool_registry.js';
import { loadShortcutLayout, resetShortcutLayout, isToolPinned } from './shortcut_layout.js';
import { bindDraggableTool, openToolboxCardMenu } from './ui_shortcut_organizer.js';
import { setScanButtonState } from './ui_scan_wizard.js';

const t = (key, params) => translate(key, params);

const SIDEBAR_ICONS = {
    MODELS: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="anomalous-btn-icon"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    GALLERY: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="anomalous-btn-icon"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
    RECIPES: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="anomalous-btn-icon"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v6"/><path d="M9 6h6"/><path d="M7.8 7.8l8.4 8.4"/></svg>`,
    DOCK: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>`,
    HELP: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;margin-right:7px;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    TOOLBOX: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><rect width="20" height="14" x="2" y="6" rx="2"/><path d="M2 12h20"/><path d="M10 12v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-2"/></svg>`,
    DOCTOR: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M4.5 3v5a5.5 5.5 0 0 0 11 0V3"/><circle cx="4.5" cy="3" r="1.5" fill="currentColor"/><circle cx="15.5" cy="3" r="1.5" fill="currentColor"/><path d="M10 13.5v3a3.5 3.5 0 0 0 3.5 3.5h1"/><circle cx="18" cy="20" r="2.2" stroke-width="1.8"/></svg>`,
    ASSISTANT: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/><path d="M18 3v4m-2-2h4" stroke-opacity="0.8"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`,
    SETTINGS: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    FOLDER: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-3px;margin-right:7px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
    CHEVRON_UP: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-right:4px;"><polyline points="18 15 12 9 6 15"/></svg>`,
    CHEVRON_DOWN: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-right:4px;"><polyline points="6 9 12 15 18 9"/></svg>`
};

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

        const savedBgOpacity = localStorage.getItem('anomalous_bg_opacity') || '0.2';
        container.style.setProperty('--anomalous-bg-opacity', savedBgOpacity);

        const savedViewMode = localStorage.getItem('anomalous_view_mode') || 'compact';
        container.classList.add(`view-mode-${savedViewMode}`);

        // Sidebar
        this.sidebarWrapper = document.createElement('div');
        this.sidebarWrapper.id = 'anomalous-sidebar-wrapper';
        this.sidebarWrapper.style.position = 'relative';

        const brandBar = document.createElement('div');
        brandBar.id = 'anomalous-brand-bar';
        brandBar.style.padding = '0 14px';
        brandBar.style.height = '48px';
        brandBar.style.boxSizing = 'border-box';
        brandBar.style.display = 'flex';
        brandBar.style.alignItems = 'center';
        brandBar.style.justifyContent = 'space-between';
        brandBar.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

        const badge = document.createElement('div');
        badge.className = 'anomalous-brand-badge';
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
        badge.style.cursor = 'pointer';
        badge.style.userSelect = 'none';
        badge.style.transition = 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
        badge.innerHTML = 'Anomalous Browser';

        let easterEggClicks = 0;
        let easterEggResetTimer = null;
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            easterEggClicks++;
            clearTimeout(easterEggResetTimer);
            easterEggResetTimer = setTimeout(() => {
                easterEggClicks = 0;
                badge.removeAttribute('title');
            }, 2500);

            badge.style.transform = 'scale(0.92)';
            setTimeout(() => { badge.style.transform = ''; }, 120);

            if (easterEggClicks >= 5) {
                easterEggClicks = 0;
                badge.removeAttribute('title');
                const isCurrentlyActive = document.documentElement.classList.contains('theme-abyssal-scarlet');
                if (typeof window.setAbyssalScarletTheme === 'function') {
                    window.setAbyssalScarletTheme(!isCurrentlyActive, true);
                }
            } else if (easterEggClicks >= 2) {
                badge.title = t('themeEasterEggHint', { count: easterEggClicks });
            }
        });

        const menuBtn = document.createElement('button');
        menuBtn.innerHTML = '☰';
        menuBtn.title = t('sidebarToggle');
        menuBtn.style.background = 'transparent';
        menuBtn.style.border = 'none';
        menuBtn.style.color = '#ccc';
        menuBtn.style.fontSize = '1.2em';
        menuBtn.style.cursor = 'pointer';
        menuBtn.onclick = () => {
            const isClosed = container.classList.contains('anomalous-sidebar-closed');
            if (isClosed) {
                container.classList.remove('anomalous-sidebar-closed');
            } else {
                container.classList.add('anomalous-sidebar-closed');
            }
            if (this.grid && this.grid.style.display !== 'none') {
                localStorage.setItem('anomalous_user_sidebar_closed', isClosed ? 'false' : 'true');
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
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('textarea') || e.target.id === 'anomalous-close' || e.target.closest('.anomalous-header-close')) return;
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

        const leftGroup = document.createElement('div');
        leftGroup.className = 'anomalous-header-group anomalous-header-left';

        const centerGroup = document.createElement('div');
        centerGroup.className = 'anomalous-header-group anomalous-header-center';

        const rightGroup = document.createElement('div');
        rightGroup.className = 'anomalous-header-group anomalous-header-right';

        // We will define hideAllPanels as a class method instead of a local closure to make it globally accessible.

        const showSidebar = () => {
            container.classList.remove('anomalous-sidebar-closed');
        };

        const modelsBtn = document.createElement('button');
        modelsBtn.id = 'anomalous-models-btn';
        modelsBtn.classList.add('active');
        modelsBtn.innerHTML = `${SIDEBAR_ICONS.MODELS}<span class="anomalous-btn-text">${t('models')}</span>`;

        const galleryBtn = document.createElement('button');
        galleryBtn.id = 'anomalous-gallery-btn';
        galleryBtn.innerHTML = `${SIDEBAR_ICONS.GALLERY}<span class="anomalous-btn-text">${t('gallery') || '图库'}</span>`;

        const setActiveHeaderTab = (btn) => {
            modelsBtn.classList.remove('active');
            galleryBtn.classList.remove('active');
            if (typeof nbBtn !== 'undefined') nbBtn.classList.remove('active');
            if (btn) btn.classList.add('active');
        };
        this.setActiveHeaderTab = setActiveHeaderTab;

        modelsBtn.onclick = () => {
            this.hideAllPanels();
            setActiveHeaderTab(modelsBtn);
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

        galleryBtn.onclick = () => {
            this.hideAllPanels();
            setActiveHeaderTab(galleryBtn);
            this.gallerySelectModel = null;
            this.galleryPanel.classList.remove('is-cover-selecting');
            const selectBanner = document.getElementById('anomalous-gallery-select-banner');
            if (selectBanner) selectBanner.style.display = 'none';
            container.classList.add('anomalous-sidebar-closed');
            menuBtn.disabled = true;
            menuBtn.style.opacity = '0.3';
            menuBtn.style.cursor = 'not-allowed';
            this.galleryPanel.style.display = 'flex';
            void this.refreshGalleryImages();
        };

        const dockBtn = document.createElement('button');
        dockBtn.id = 'anomalous-dock-btn';
        dockBtn.className = 'anomalous-tooltip-target';
        dockBtn.innerHTML = SIDEBAR_ICONS.DOCK;
        dockBtn.removeAttribute('title');
        dockBtn.setAttribute('aria-label', t('dockTitle'));
        dockBtn.setAttribute('data-tooltip', t('dockTitle'));
        dockBtn.setAttribute('data-tooltip-pos', 'bottom');
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
        helpBtn.innerHTML = `${SIDEBAR_ICONS.HELP}<span class="anomalous-btn-text">${t('help')}</span>`;
        helpBtn.onclick = () => this.showHelp();

        const nbBtn = document.createElement('button');
        nbBtn.id = 'anomalous-notebook-btn';
        nbBtn.title = t('recipeTitle');
        nbBtn.innerHTML = `${SIDEBAR_ICONS.RECIPES}<span class="anomalous-btn-text">${t('recipeTitle')}</span>`;

        const dBtn = document.getElementById('anomalous-doctor-btn');
        if (dBtn) { dBtn.removeAttribute('title'); dBtn.setAttribute('aria-label', t('sidebarDoctor')); }
        const aBtn = document.getElementById('anomalous-assistant-btn');
        if (aBtn) { aBtn.removeAttribute('title'); aBtn.setAttribute('aria-label', t('sidebarAssistant')); }
        const iBtn = document.getElementById('anomalous-materials-btn');
        if (iBtn) { iBtn.removeAttribute('title'); iBtn.setAttribute('aria-label', t('materialLibrary')); }
        const sBtn = document.getElementById('anomalous-settings-btn');
        if (sBtn) { sBtn.removeAttribute('title'); sBtn.setAttribute('aria-label', t('sidebarSettings')); }

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
            setActiveHeaderTab(nbBtn);
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
            this.showRecipes();
        };

        centerGroup.appendChild(modelsBtn);
        centerGroup.appendChild(galleryBtn);
        centerGroup.appendChild(nbBtn);

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

                const currentScanBtn = document.getElementById('anomalous-scan-btn');
                if (isScanning && !isCurrentlyScanning) {
                    isCurrentlyScanning = true;
                    if (currentScanBtn) setScanButtonState(currentScanBtn, true);
                } else if (!isScanning && isCurrentlyScanning) {
                    isCurrentlyScanning = false;
                    if (currentScanBtn) setScanButtonState(currentScanBtn, false);
                    finishScanProgress();
                    this.loadModels();
                    if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
                    alert(t('sidebarScanComplete'));
                }
            } catch (e) { }
        }, 3000);

        const toolboxBtn = document.createElement('button');
        toolboxBtn.id = 'anomalous-toolbox-btn';
        toolboxBtn.className = 'anomalous-tooltip-target';
        toolboxBtn.removeAttribute('title');
        toolboxBtn.setAttribute('aria-label', t('sidebarToolbox'));
        toolboxBtn.setAttribute('data-tooltip', t('sidebarToolbox'));
        toolboxBtn.setAttribute('data-tooltip-pos', 'top');
        toolboxBtn.innerHTML = SIDEBAR_ICONS.TOOLBOX;
        toolboxBtn.style.background = 'transparent';
        toolboxBtn.style.border = 'none';
        toolboxBtn.style.borderRadius = '6px';
        toolboxBtn.style.padding = '6px';
        toolboxBtn.style.fontSize = '1.1em';
        toolboxBtn.style.cursor = 'pointer';


        let refreshModelSettingsText = () => {};

        const closeBtn = document.createElement('div');
        closeBtn.id = 'anomalous-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => this.close();

        const updateNoticeBtn = document.createElement('button');
        updateNoticeBtn.id = 'anomalous-update-notice-btn';
        updateNoticeBtn.className = 'anomalous-update-notice-btn anomalous-tooltip-target';
        updateNoticeBtn.setAttribute('data-tooltip', t('updateGuideNoticeTooltip'));
        updateNoticeBtn.setAttribute('data-tooltip-pos', 'bottom');
        updateNoticeBtn.setAttribute('aria-label', t('updateGuideNoticeTooltip'));
        updateNoticeBtn.type = 'button';
        const updateNoticeIcon = document.createElement('span');
        updateNoticeIcon.className = 'anomalous-update-notice-icon';
        updateNoticeIcon.setAttribute('aria-hidden', 'true');
        updateNoticeIcon.textContent = '!';
        updateNoticeBtn.appendChild(updateNoticeIcon);
        updateNoticeBtn.onclick = () => showUpdateGuide(this, { force: true });

        rightGroup.appendChild(updateNoticeBtn);
        rightGroup.appendChild(dockBtn);
        rightGroup.appendChild(closeBtn);

        header.appendChild(leftGroup);
        header.appendChild(centerGroup);
        header.appendChild(rightGroup);

        const settingsHubModal = document.createElement('div');
        settingsHubModal.id = 'anomalous-settings-hub-modal';
        settingsHubModal.style.display = 'none';
        settingsHubModal.style.flexDirection = 'column';
        settingsHubModal.style.gap = '4px';

        const langBtn = document.createElement('button');
        langBtn.className = 'anomalous-lang-btn';
        langBtn.textContent = t(window.anomalous_browser_lang === 'zh' ? 'sidebarSwitchToEnglish' : 'sidebarSwitchToChinese');
        const refreshLanguageUi = () => {
            langBtn.textContent = t(window.anomalous_browser_lang === 'zh' ? 'sidebarSwitchToEnglish' : 'sidebarSwitchToChinese');
            updateLangClass();
            modelsBtn.innerHTML = `${SIDEBAR_ICONS.MODELS}<span class="anomalous-btn-text">${t('models')}</span>`;
            galleryBtn.innerHTML = `${SIDEBAR_ICONS.GALLERY}<span class="anomalous-btn-text">${t('gallery')}</span>`;
            toolboxBtn.removeAttribute('title');
            toolboxBtn.setAttribute('aria-label', t('sidebarToolbox'));
            toolboxBtn.setAttribute('data-tooltip', t('sidebarToolbox'));
            toolboxBtn.setAttribute('data-tooltip-pos', 'top');
            helpBtn.innerHTML = `${SIDEBAR_ICONS.HELP}<span class="anomalous-btn-text">${t('help')}</span>`;
            if (this.renderToolboxModal) this.renderToolboxModal();
            if (this.renderShortcutActions) this.renderShortcutActions();
            nbBtn.removeAttribute('title');
            nbBtn.setAttribute('data-tooltip', t('recipeTitle'));
            nbBtn.setAttribute('data-tooltip-pos', 'bottom');
            nbBtn.innerHTML = `${SIDEBAR_ICONS.RECIPES}<span class="anomalous-btn-text">${t('recipeTitle')}</span>`;

            const sBtn = document.getElementById('anomalous-global-settings-btn');
            if (sBtn) { sBtn.removeAttribute('title'); sBtn.setAttribute('data-tooltip', t('sidebarSettings')); sBtn.setAttribute('data-tooltip-pos', 'top'); }
            configureSidebarActions(this.sidebarWrapper);
            const bgLabel = document.getElementById('anomalous-bg-opacity-label');
            if (bgLabel) bgLabel.textContent = t('sidebarBgAtmosphere');
            if (dockBtn) {
                dockBtn.removeAttribute('title');
                dockBtn.setAttribute('aria-label', t('dockTitle'));
                dockBtn.setAttribute('data-tooltip', t('dockTitle'));
                dockBtn.setAttribute('data-tooltip-pos', 'bottom');
            }
            if (updateNoticeBtn) {
                updateNoticeBtn.setAttribute('data-tooltip', t('updateGuideNoticeTooltip'));
                updateNoticeBtn.setAttribute('aria-label', t('updateGuideNoticeTooltip'));
            }

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
            const vmLabelRef = document.getElementById('anomalous-view-mode-label');
            if (vmLabelRef) vmLabelRef.textContent = t('sidebarViewMode');
            const stdBtnRef = document.getElementById('anomalous-view-mode-btn-standard');
            if (stdBtnRef) stdBtnRef.textContent = t('sidebarViewModeStandard');
            const cmpBtnRef = document.getElementById('anomalous-view-mode-btn-compact');
            if (cmpBtnRef) cmpBtnRef.textContent = t('sidebarViewModeCompact');
            const aesBtnRef = document.getElementById('anomalous-view-mode-btn-aesthetic');
            if (aesBtnRef) aesBtnRef.textContent = t('sidebarViewModeAesthetic');
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

        langBtn.onclick = async () => {
            const newLang = window.anomalous_browser_lang === 'zh' ? 'en' : 'zh';
            try {
                const settings = app.extensionManager?.setting;
                if (typeof settings?.set !== 'function') throw new Error('Settings API unavailable');
                await settings.set('Anomalous.ModelBrowser.Language', newLang);
            } catch (error) {
                localStorage.setItem('anomalous_lang', newLang);
                window.anomalous_browser_lang = newLang;
                refreshLanguageUi();
            }
        };
        window.addEventListener('anomalous-language-change', refreshLanguageUi);

        const styleHubBtn = (btn) => {
            btn.style.background = 'transparent';
            btn.style.border = '1px solid rgba(255,255,255,0.05)';
            btn.style.color = '#ccc';
            btn.style.textAlign = 'left';
            btn.style.padding = '8px 10px';
            btn.style.borderRadius = '8px';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '0.85em';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
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

        // Display Mode Selector (标准模式 / 高密度 / 沉浸模式)
        const viewModeContainer = document.createElement('div');
        viewModeContainer.id = 'anomalous-view-mode-container';
        viewModeContainer.style.display = 'flex';
        viewModeContainer.style.flexDirection = 'column';
        viewModeContainer.style.gap = '6px';
        viewModeContainer.style.background = 'rgba(255, 255, 255, 0.03)';
        viewModeContainer.style.padding = '8px 10px';
        viewModeContainer.style.borderRadius = '8px';
        viewModeContainer.style.border = '1px solid rgba(255, 255, 255, 0.08)';
        viewModeContainer.style.marginBottom = '4px';

        const viewModeHeader = document.createElement('div');
        viewModeHeader.style.display = 'flex';
        viewModeHeader.style.justifyContent = 'space-between';
        viewModeHeader.style.alignItems = 'center';

        const viewModeLabel = document.createElement('span');
        viewModeLabel.id = 'anomalous-view-mode-label';
        viewModeLabel.textContent = t('sidebarViewMode');
        viewModeLabel.style.color = '#ccc';
        viewModeLabel.style.fontSize = '0.88em';
        viewModeLabel.style.fontWeight = '500';
        viewModeHeader.appendChild(viewModeLabel);

        const viewModeGroup = document.createElement('div');
        viewModeGroup.style.display = 'grid';
        viewModeGroup.style.gridTemplateColumns = '1fr 1fr 1fr';
        viewModeGroup.style.gap = '4px';
        viewModeGroup.style.background = 'rgba(0, 0, 0, 0.35)';
        viewModeGroup.style.padding = '3px';
        viewModeGroup.style.borderRadius = '6px';
        viewModeGroup.style.border = '1px solid rgba(255, 255, 255, 0.06)';

        const modeDefinitions = [
            { id: 'compact', key: 'sidebarViewModeCompact' },
            { id: 'standard', key: 'sidebarViewModeStandard' },
            { id: 'aesthetic', key: 'sidebarViewModeAesthetic' }
        ];

        let currentViewMode = localStorage.getItem('anomalous_view_mode') || 'compact';
        if (!['compact', 'standard', 'aesthetic'].includes(currentViewMode)) {
            currentViewMode = 'compact';
        }

        const modeBtnElements = [];

        const applyViewMode = (mode) => {
            currentViewMode = mode;
            localStorage.setItem('anomalous_view_mode', mode);
            container.classList.remove('view-mode-standard', 'view-mode-compact', 'view-mode-aesthetic');
            container.classList.add(`view-mode-${mode}`);

            modeBtnElements.forEach(({ btn, mId }) => {
                const isActive = mId === mode;
                btn.style.background = isActive ? 'rgba(255, 255, 255, 0.16)' : 'transparent';
                btn.style.color = isActive ? '#ffffff' : '#94a3b8';
                btn.style.fontWeight = isActive ? '600' : '400';
                btn.style.boxShadow = isActive ? '0 1px 4px rgba(0, 0, 0, 0.4)' : 'none';
            });

            if (bgOpacityContainer) {
                bgOpacityContainer.style.display = mode === 'aesthetic' ? 'flex' : 'none';
            }
        };

        modeDefinitions.forEach(m => {
            const btn = document.createElement('button');
            btn.id = `anomalous-view-mode-btn-${m.id}`;
            btn.textContent = t(m.key);
            btn.style.border = 'none';
            btn.style.borderRadius = '4px';
            btn.style.padding = '5px 2px';
            btn.style.fontSize = '0.78em';
            btn.style.cursor = 'pointer';
            btn.style.transition = 'all 0.18s ease';
            btn.style.textAlign = 'center';
            btn.onclick = () => applyViewMode(m.id);
            viewModeGroup.appendChild(btn);
            modeBtnElements.push({ btn, mId: m.id, key: m.key });
        });

        viewModeContainer.appendChild(viewModeHeader);
        viewModeContainer.appendChild(viewModeGroup);

        const scaleContainer = document.createElement('div');
        scaleContainer.style.display = 'flex';
        scaleContainer.style.alignItems = 'center';
        scaleContainer.style.justifyContent = 'space-between';
        scaleContainer.style.background = 'rgba(255, 255, 255, 0.03)';
        scaleContainer.style.padding = '8px 10px';
        scaleContainer.style.borderRadius = '8px';
        scaleContainer.style.border = '1px solid rgba(255, 255, 255, 0.08)';
        scaleContainer.style.marginBottom = '4px';

        const scaleLabel = document.createElement('span');
        scaleLabel.id = 'anomalous-scale-label';
        scaleLabel.textContent = t('sidebarUiScale');
        scaleLabel.style.color = '#ccc';
        scaleLabel.style.fontSize = '0.88em';

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

        const bgOpacityContainer = document.createElement('div');
        bgOpacityContainer.style.display = 'flex';
        bgOpacityContainer.style.alignItems = 'center';
        bgOpacityContainer.style.justifyContent = 'space-between';
        bgOpacityContainer.style.background = 'rgba(255, 255, 255, 0.03)';
        bgOpacityContainer.style.padding = '8px 10px';
        bgOpacityContainer.style.borderRadius = '8px';
        bgOpacityContainer.style.border = '1px solid rgba(255, 255, 255, 0.08)';
        bgOpacityContainer.style.marginBottom = '4px';

        const bgOpacityLabel = document.createElement('span');
        bgOpacityLabel.id = 'anomalous-bg-opacity-label';
        bgOpacityLabel.textContent = t('sidebarBgAtmosphere');
        bgOpacityLabel.style.color = '#ccc';
        bgOpacityLabel.style.fontSize = '0.88em';

        let currentBgOpacity = parseFloat(savedBgOpacity);

        const bgControlsWrapper = document.createElement('div');
        bgControlsWrapper.style.display = 'flex';
        bgControlsWrapper.style.alignItems = 'center';
        bgControlsWrapper.style.gap = '8px';

        const bgOpacityVal = document.createElement('span');
        bgOpacityVal.innerText = `${Math.round(currentBgOpacity * 100)}%`;
        bgOpacityVal.style.color = '#fff';
        bgOpacityVal.style.fontSize = '0.9em';
        bgOpacityVal.style.minWidth = '45px';
        bgOpacityVal.style.textAlign = 'center';

        const createBgBtn = (text, delta) => {
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
                currentBgOpacity = Math.max(0, Math.min(1, Math.round((currentBgOpacity + delta) * 100) / 100));
                bgOpacityVal.innerText = `${Math.round(currentBgOpacity * 100)}%`;
                container.style.setProperty('--anomalous-bg-opacity', currentBgOpacity);
                localStorage.setItem('anomalous_bg_opacity', currentBgOpacity);
            };
            return btn;
        };

        const minusBgBtn = createBgBtn('-', -0.1);
        const plusBgBtn = createBgBtn('+', 0.1);

        bgControlsWrapper.appendChild(minusBgBtn);
        bgControlsWrapper.appendChild(bgOpacityVal);
        bgControlsWrapper.appendChild(plusBgBtn);

        bgOpacityContainer.appendChild(bgOpacityLabel);
        bgOpacityContainer.appendChild(bgControlsWrapper);

        // Synchronize view mode active button & atmosphere visibility
        applyViewMode(currentViewMode);

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
                localStorage.removeItem('anomalous_bg_opacity');
                localStorage.removeItem('anomalous_view_mode');
                applyViewMode('compact');
                container.style.left = '5%';
                container.style.top = '5%';
                container.style.width = '90%';
                container.style.height = '90%';
                container.style.setProperty('--anomalous-scale', '1');
                container.style.setProperty('--anomalous-bg-opacity', '0.2');
                currentScale = 1;
                scaleVal.innerText = '100%';
                currentBgOpacity = 0.2;
                bgOpacityVal.innerText = '20%';
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
        settingsHubModal.appendChild(viewModeContainer);
        settingsHubModal.appendChild(scaleContainer);
        settingsHubModal.appendChild(bgOpacityContainer);
        settingsHubModal.appendChild(langBtn);
        settingsHubModal.appendChild(helpBtn);
        settingsHubModal.appendChild(feedbackBtn);
        settingsHubModal.appendChild(resetBtn);

        container.appendChild(settingsHubModal);

        const toolboxModal = document.createElement('div');
        toolboxModal.id = 'anomalous-toolbox-modal';
        toolboxModal.style.display = 'none';
        toolboxModal.addEventListener('mouseenter', () => {
            if (window.AMB_hideTooltipImmediately) window.AMB_hideTooltipImmediately();
        });

        const closeToolbox = (e) => {
            if (toolboxModal.style.display !== 'none' && !toolboxModal.contains(e.target) && !toolboxBtn.contains(e.target)) {
                toolboxModal.style.display = 'none';
                toolboxBtn.classList.remove('is-active');
                document.removeEventListener('mousedown', closeToolbox);
            }
        };

        toolboxBtn.onclick = (e) => {
            e.stopPropagation();
            if (window.AMB_hideTooltipImmediately) window.AMB_hideTooltipImmediately();
            toolboxBtn.classList.remove('anomalous-action-label-active');
            toolboxBtn.__suppress_text_until_leave = true;
            if (settingsHubModal.style.display !== 'none') {
                settingsHubModal.style.display = 'none';
                settingsBtn.classList.remove('is-active');
            }
            if (toolboxModal.style.display === 'none') {
                toolboxModal.style.display = 'flex';
                toolboxBtn.classList.add('is-active');
                setTimeout(() => document.addEventListener('mousedown', closeToolbox), 10);
            } else {
                toolboxModal.style.display = 'none';
                toolboxBtn.classList.remove('is-active');
                document.removeEventListener('mousedown', closeToolbox);
            }
        };

        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'anomalous-global-settings-btn';
        settingsBtn.className = 'anomalous-tooltip-target';
        settingsBtn.innerHTML = SIDEBAR_ICONS.SETTINGS;
        settingsBtn.removeAttribute('title');
        settingsBtn.setAttribute('aria-label', t('sidebarSettings'));
        settingsBtn.setAttribute('data-tooltip', t('sidebarSettings'));
        settingsBtn.setAttribute('data-tooltip-pos', 'top');
        settingsBtn.style.background = 'transparent';
        settingsBtn.style.border = 'none';
        settingsBtn.style.borderRadius = '6px';
        settingsBtn.style.padding = '6px';
        settingsBtn.style.fontSize = '1.1em';
        settingsBtn.style.marginLeft = 'auto';
        settingsBtn.style.cursor = 'pointer';
        const closeSettingsHub = (e) => {
            if (settingsHubModal.style.display !== 'none' && !settingsHubModal.contains(e.target) && !settingsBtn.contains(e.target)) {
                settingsHubModal.style.display = 'none';
                settingsBtn.classList.remove('is-active');
                document.removeEventListener('mousedown', closeSettingsHub);
            }
        };

        settingsBtn.onclick = (e) => {
            e.stopPropagation();
            if (window.AMB_hideTooltipImmediately) window.AMB_hideTooltipImmediately();
            if (toolboxModal.style.display !== 'none') {
                toolboxModal.style.display = 'none';
                toolboxBtn.classList.remove('is-active');
            }
            if (settingsHubModal.style.display === 'none') {
                settingsHubModal.style.display = 'flex';
                settingsBtn.classList.add('is-active');
                setTimeout(() => document.addEventListener('mousedown', closeSettingsHub), 10);
            } else {
                settingsHubModal.style.display = 'none';
                settingsBtn.classList.remove('is-active');
                document.removeEventListener('mousedown', closeSettingsHub);
            }
        };

        const executeToolAction = async (toolId) => {
            switch (toolId) {
                case 'scan':
                    this.openScanWizard({ isGlobal: true });
                    break;
                case 'doctor':
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
                    if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
                    if (window.anomalous_resolve_all_missing_nodes) {
                        await window.anomalous_resolve_all_missing_nodes(true, false);
                    }
                    this.renderGlobalDashboard();
                    break;
                case 'assistant':
                    this.hideAllPanels();
                    if (this.setActiveHeaderTab) this.setActiveHeaderTab(null);
                    container.classList.add('anomalous-sidebar-closed');
                    menuBtn.disabled = false;
                    menuBtn.style.opacity = '1';
                    menuBtn.style.cursor = 'pointer';
                    this.assistantPanel.style.display = 'flex';
                    if (!this.assistantPanelInitialized) {
                        this.initAssistantPanel();
                    }
                    if (Object.keys(app.canvas?.selected_nodes || {}).length > 0) {
                        const firstSelected = Object.values(app.canvas.selected_nodes)[0];
                        this.diagnoseNode(firstSelected);
                    } else {
                        this.diagnoseNode(null);
                    }
                    break;
                case 'materials':
                    this.openMaterialLibrary();
                    break;
                case 'workflow-transfer':
                    if (window.AMB_WorkflowShare && typeof window.AMB_WorkflowShare.showUnifiedModal === 'function') {
                        window.AMB_WorkflowShare.showUnifiedModal();
                    }
                    break;
                case 'prompt-studio':
                    if (typeof this.openPromptStudio === 'function') {
                        this.openPromptStudio();
                    } else if (typeof this.openMaterialLibrary === 'function') {
                        this.openMaterialLibrary();
                    }
                    break;
                case 'prompt-translator':
                    if (typeof this.openPromptTranslator === 'function') {
                        this.openPromptTranslator();
                    }
                    break;
                case 'model-sources':
                    openModelSourcesModal('workflow');
                    break;
                case 'prompt-notes':
                    if (typeof this.showNotebooks === 'function') {
                        this.showNotebooks();
                    }
                    break;
                default: {
                    const custom = (this.customToolboxItems || []).find(it => it.id === toolId);
                    if (custom && typeof custom.action === 'function') {
                        custom.action();
                    }
                    break;
                }
            }
        };
        this.executeToolAction = executeToolAction;

        const renderShortcutActions = () => {
            this.sidebarActions.replaceChildren();
            this.sidebarActions.appendChild(toolboxBtn);

            const defaultLayout = ['scan', 'doctor', 'assistant', 'materials'];
            for (const toolId of defaultLayout) {
                const def = getToolDefinition(toolId);
                if (!def) continue;

                const btn = document.createElement('button');
                btn.id = def.domId;
                btn.setAttribute('data-tool-id', toolId);
                btn.className = 'anomalous-tooltip-target';
                btn.removeAttribute('title');
                btn.setAttribute('aria-label', t(def.nameKey));
                btn.setAttribute('data-tooltip', t(def.nameKey));
                btn.setAttribute('data-tooltip-pos', 'top');
                btn.style.background = 'transparent';
                btn.style.border = 'none';
                btn.style.borderRadius = '6px';
                btn.style.padding = '6px';
                btn.style.fontSize = '1.1em';
                btn.style.cursor = 'pointer';

                if (toolId === 'scan') {
                    setScanButtonState(btn, isCurrentlyScanning);
                } else {
                    btn.innerHTML = def.icon;
                }

                btn.onclick = (e) => {
                    e.stopPropagation();
                    executeToolAction(toolId);
                };

                this.sidebarActions.appendChild(btn);
            }

            this.sidebarActions.appendChild(settingsBtn);
            configureSidebarActions(this.sidebarWrapper);
        };
        this.renderShortcutActions = renderShortcutActions;

        const renderToolboxModal = () => {
            toolboxModal.replaceChildren();

            const headerRow = document.createElement('div');
            headerRow.style.display = 'flex';
            headerRow.style.alignItems = 'center';
            headerRow.style.justifyContent = 'space-between';
            headerRow.style.padding = '1px 2px 3px';
            headerRow.style.borderBottom = '1px solid rgba(255, 255, 255, 0.06)';

            const titleBox = document.createElement('div');
            titleBox.style.display = 'flex';
            titleBox.style.alignItems = 'center';
            titleBox.style.gap = '5px';

            const titleIcon = document.createElement('span');
            titleIcon.textContent = '🧰';
            titleIcon.style.fontSize = '11px';

            const titleText = document.createElement('span');
            titleText.textContent = t('toolboxTitle');
            titleText.style.fontWeight = '600';
            titleText.style.fontSize = '11px';
            titleText.style.color = '#fff';

            titleBox.append(titleIcon, titleText);

            const closeModalBtn = document.createElement('div');
            closeModalBtn.innerHTML = '&times;';
            closeModalBtn.style.cursor = 'pointer';
            closeModalBtn.style.color = '#888';
            closeModalBtn.style.fontSize = '14px';
            closeModalBtn.style.lineHeight = '1';
            closeModalBtn.style.padding = '1px 3px';
            closeModalBtn.style.borderRadius = '3px';
            closeModalBtn.onmouseover = () => { closeModalBtn.style.color = '#fff'; closeModalBtn.style.background = 'rgba(255,255,255,0.08)'; };
            closeModalBtn.onmouseout = () => { closeModalBtn.style.color = '#888'; closeModalBtn.style.background = 'transparent'; };
            closeModalBtn.onclick = () => {
                toolboxModal.style.display = 'none';
                toolboxBtn.classList.remove('is-active');
            };

            headerRow.appendChild(titleBox);
            headerRow.appendChild(closeModalBtn);
            toolboxModal.appendChild(headerRow);

            const gridContainer = document.createElement('div');
            gridContainer.className = 'anomalous-toolbox-grid';

            // 过滤掉已经常驻底栏的工具（scan, doctor, assistant, materials 及两端锚点）
            const outsideToolIds = new Set(['scan', 'doctor', 'assistant', 'materials', 'toolbox', 'settings']);
            const defaultTools = [
                {
                    id: 'workflow-transfer',
                    action: () => {
                        toolboxModal.style.display = 'none';
                        if (typeof toolboxBtn !== 'undefined' && toolboxBtn) {
                            toolboxBtn.classList.remove('is-active');
                        }
                        if (window.AMB_WorkflowShare && typeof window.AMB_WorkflowShare.showUnifiedModal === 'function') {
                            window.AMB_WorkflowShare.showUnifiedModal();
                        }
                    }
                }
            ];
            const allTools = [...CATALOG_TOOLS, ...(this.customToolboxItems || [])];
            const toolboxTools = allTools.filter(tool => !outsideToolIds.has(tool.id));

            const COLOR_ICONS = {
                'workflow-transfer': '🔄',
                'prompt-studio': '🎛️',
                'prompt-translator': '🌐',
                'model-sources': '🔗',
                'prompt-notes': '📝',
            };

            toolboxTools.forEach(tool => {
                const tile = document.createElement('div');
                tile.className = 'anomalous-toolbox-tile';
                tile.setAttribute('data-tool-id', tool.id);

                const iconEl = document.createElement('div');
                iconEl.className = 'anomalous-toolbox-tile-icon';
                iconEl.innerHTML = COLOR_ICONS[tool.id] || tool.icon || '🔧';
                tile.appendChild(iconEl);

                const labelEl = document.createElement('div');
                labelEl.className = 'anomalous-toolbox-tile-label';
                labelEl.textContent = t(tool.labelKey) || t(tool.nameKey);
                tile.appendChild(labelEl);

                tile.onclick = (e) => {
                    e.stopPropagation();
                    if (window.AMB_hideTooltipImmediately) window.AMB_hideTooltipImmediately();
                    toolboxModal.style.display = 'none';
                    toolboxBtn.classList.remove('is-active');
                    executeToolAction(tool.id);
                };

                gridContainer.appendChild(tile);
            });

            toolboxModal.appendChild(gridContainer);
        };
        this.renderToolboxModal = renderToolboxModal;
        this.registerToolboxItem = (item) => {
            this.customToolboxItems = this.customToolboxItems || [];
            this.customToolboxItems.push(item);
            if (this.renderToolboxModal) this.renderToolboxModal();
        };
        this.openModelSources = (scope = 'workflow') => openModelSourcesModal(scope);

        container.appendChild(toolboxModal);

        renderToolboxModal();
        renderShortcutActions();

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
        title.innerHTML = `${SIDEBAR_ICONS.FOLDER}<span>${t('folders')}</span>`;
        title.style.color = '#fff';
        title.style.margin = '0';
        title.style.display = 'inline-flex';
        title.style.alignItems = 'center';
        title.style.fontSize = '1.05em';

        const isAllCollapsed = this.expandedFolders.size === 0;
        const collapseAllBtn = document.createElement('button');
        const collapseIcon = isAllCollapsed ? SIDEBAR_ICONS.CHEVRON_DOWN : SIDEBAR_ICONS.CHEVRON_UP;
        collapseAllBtn.innerHTML = `${collapseIcon}<span>${t(isAllCollapsed ? 'sidebarExpandAll' : 'sidebarCollapseAll')}</span>`;
        collapseAllBtn.style.display = 'inline-flex';
        collapseAllBtn.style.alignItems = 'center';
        collapseAllBtn.style.padding = '4px 9px';
        collapseAllBtn.style.background = 'rgba(255, 255, 255, 0.08)';
        collapseAllBtn.style.color = '#e2e8f0';
        collapseAllBtn.style.border = '1px solid rgba(255, 255, 255, 0.12)';
        collapseAllBtn.style.borderRadius = '3px 8px 3px 8px';
        collapseAllBtn.style.cursor = 'pointer';
        collapseAllBtn.style.fontSize = '0.82em';
        collapseAllBtn.style.transition = 'all 0.2s ease';
        collapseAllBtn.onmouseover = () => { collapseAllBtn.style.background = 'rgba(255, 255, 255, 0.15)'; collapseAllBtn.style.borderColor = 'rgba(255, 255, 255, 0.25)'; };
        collapseAllBtn.onmouseout = () => { collapseAllBtn.style.background = 'rgba(255, 255, 255, 0.08)'; collapseAllBtn.style.borderColor = 'rgba(255, 255, 255, 0.12)'; };
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
        const tbModal = document.getElementById('anomalous-toolbox-modal');
        if (tbModal) tbModal.style.display = 'none';
        const setModal = document.getElementById('anomalous-settings-hub-modal');
        if (setModal) setModal.style.display = 'none';
    }
