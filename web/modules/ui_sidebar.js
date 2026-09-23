/**
 * ui_sidebar.js
 * Extracted Sidebar methods.
 */

import { translate } from './locales.js';
import { escapeHtml } from './safe_dom.js';
import { updateScanProgress, finishScanProgress, failScanProgress } from './scan_progress.js';
import { showUpdateGuide } from './ui_update_guide.js';
import { setScanButtonState } from './ui_scan_wizard.js';
import { createSettingsHub } from './ui_settings_hub.js';
import { createToolbox } from './ui_toolbox.js';
import { createGallerySearchBar } from './ui_gallery.js';

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
                }
            } catch (e) { }
        }, 3000);

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

        let settingsHubControl = null;
        const toolboxControl = createToolbox(this, {
            container,
            menuBtn,
            toolboxIcon: SIDEBAR_ICONS.TOOLBOX,
            isScanning: () => isCurrentlyScanning,
            getSettingsButton: () => settingsHubControl.button,
            onBeforeOpen: () => settingsHubControl?.close(),
        });
        settingsHubControl = createSettingsHub(this, {
            container,
            savedScale,
            savedBgOpacity,
            updateLangClass,
            modelsBtn,
            galleryBtn,
            toolboxBtn: toolboxControl.button,
            nbBtn,
            dockBtn,
            updateNoticeBtn,
            icons: SIDEBAR_ICONS,
            onBeforeOpen: () => toolboxControl.close(),
        });
        toolboxControl.mount();


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
        this.galleryPanel.append(createGallerySearchBar(this), this.galleryGrid);

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
