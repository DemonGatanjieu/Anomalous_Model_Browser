/**
 * ui_sidebar.js
 * The browser window (rail, list column, header, page panels) and the model folder list.
 */

import { translate } from './locales.js';
import { escapeHtml } from './safe_dom.js';
import { showUpdateGuide } from './ui_update_guide.js';
import { AUDIO_USAGE_GUIDE, CURRENT_UPDATE_GUIDE } from './update_guide_data.js';
import { createSettingsHub } from './ui_settings_hub.js';
import { createToolbox } from './ui_toolbox.js';
import { getActiveDomain } from './ui_domain_switcher.js';
import { renderAudioSidebar } from './ui_audio_sidebar.js';
import { createGallerySearchBar } from './ui_gallery.js';
import { bindWorkspaceEscape } from './ui_browser_navigation.js';
import { createShellRail } from './ui_shell_rail.js';
import { installShellNavigation } from './ui_shell_nav.js';
import { bindShellDrag, bindShellResize } from './ui_shell_frame.js';
import { watchScans } from './ui_scan_watch.js';
import { watchCanvasChanges } from './activity_canvas.js';
import { watchWorkflowLoads } from './ui_doctor_banner.js';
import { settleModelScope } from './ui_model_types.js';

const t = (key, params) => translate(key, params);

const SIDEBAR_ICONS = {
    DOCK: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>`,
    LIST: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>`,
    HELP: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;margin-right:7px;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    TOOLBOX: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><rect width="20" height="14" x="2" y="6" rx="2"/><path d="M2 12h20"/><path d="M10 12v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-2"/></svg>`,
    SETTINGS: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    FOLDER: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-3px;margin-right:7px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
    CHEVRON_UP: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-right:4px;"><polyline points="18 15 12 9 6 15"/></svg>`,
    CHEVRON_DOWN: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-right:4px;"><polyline points="6 9 12 15 18 9"/></svg>`
};

/** Five quick clicks on the rail's logo toggle the Abyssal Scarlet theme. */
function themeEasterEgg(badge) {
    let clicks = 0;
    let resetTimer = null;
    return (e) => {
        e.stopPropagation();
        clicks++;
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
            clicks = 0;
            badge.removeAttribute('title');
        }, 2500);
        badge.style.transform = 'scale(0.92)';
        setTimeout(() => { badge.style.transform = ''; }, 120);
        if (clicks >= 5) {
            clicks = 0;
            badge.removeAttribute('title');
            const active = document.documentElement.classList.contains('theme-abyssal-scarlet');
            if (typeof window.setAbyssalScarletTheme === 'function') window.setAbyssalScarletTheme(!active, true);
        } else if (clicks >= 2) {
            badge.title = t('themeEasterEggHint', { count: clicks });
        }
    };
}

function headerButton(id, html, tooltip) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = 'anomalous-tooltip-target';
    button.innerHTML = html; // static markup only
    button.setAttribute('aria-label', tooltip);
    button.setAttribute('data-tooltip', tooltip);
    button.setAttribute('data-tooltip-pos', 'bottom');
    return button;
}

function panel(id, display = 'none') {
    const node = document.createElement('div');
    node.id = id;
    node.style.display = display;
    return node;
}

export function createDOM() {
        localStorage.removeItem('anomalous_api_key');
        localStorage.removeItem('anomalous_civitai_api_key');
        this.modal = document.createElement('div');
        this.modal.id = 'anomalous-modal';

        const container = document.createElement('div');
        container.id = 'anomalous-container';
        container.classList.add('anomalous-has-rail');

        const updateLangClass = () => {
            container.classList.toggle('anomalous-lang-en', (window.anomalous_browser_lang || 'zh') === 'en');
        };
        updateLangClass();

        const savedScale = localStorage.getItem('anomalous_ui_scale') || 1;
        container.style.setProperty('--anomalous-scale', savedScale);
        const savedBgOpacity = localStorage.getItem('anomalous_bg_opacity') || '0.2';
        container.style.setProperty('--anomalous-bg-opacity', savedBgOpacity);
        const savedViewMode = localStorage.getItem('anomalous_view_mode') || 'compact';
        container.classList.add(`view-mode-${savedViewMode}`);

        // Rail: pages, tools, settings. The toolbox fills its tool slots below.
        const rail = createShellRail(this);
        const brand = rail.root.querySelector('.anomalous-rail-brand');
        brand.addEventListener('click', themeEasterEgg(brand));
        this.modelsBtn = rail.items.get('models');
        this.galleryBtn = rail.items.get('gallery');
        this.nbBtn = rail.items.get('recipes');
        this.sidebarActions = this.railTools; // tools used to sit under the list

        // List column: the model folders, or the characters on the audio pages.
        this.sidebarWrapper = panel('anomalous-sidebar-wrapper', '');
        this.sidebar = panel('anomalous-sidebar', '');
        this.sidebarWrapper.appendChild(this.sidebar);

        // Content: header (list button, page title, guide, dock, close) and the page panels.
        const content = panel('anomalous-content', '');
        const header = panel('anomalous-header', '');
        bindShellDrag(container, header);

        const leftGroup = document.createElement('div');
        leftGroup.className = 'anomalous-header-group anomalous-header-left';
        const centerGroup = document.createElement('div');
        centerGroup.className = 'anomalous-header-group anomalous-header-center';
        const rightGroup = document.createElement('div');
        rightGroup.className = 'anomalous-header-group anomalous-header-right';

        const listToggle = headerButton('anomalous-list-toggle', SIDEBAR_ICONS.LIST, t('sidebarToggle'));
        const pageTitle = document.createElement('span');
        pageTitle.className = 'anomalous-page-title';
        leftGroup.append(listToggle, pageTitle);

        const updateNoticeBtn = headerButton('anomalous-update-notice-btn', '', t('updateGuideNoticeTooltip'));
        updateNoticeBtn.classList.add('anomalous-update-notice-btn');
        const updateNoticeIcon = document.createElement('span');
        updateNoticeIcon.className = 'anomalous-update-notice-icon';
        updateNoticeIcon.setAttribute('aria-hidden', 'true');
        updateNoticeIcon.textContent = '!';
        updateNoticeBtn.appendChild(updateNoticeIcon);
        // On the audio pages "!" explains the audio studio; elsewhere it shows what's new.
        updateNoticeBtn.onclick = () => showUpdateGuide(this, {
            force: true,
            guide: getActiveDomain() === 'audio' ? AUDIO_USAGE_GUIDE : CURRENT_UPDATE_GUIDE,
        });

        const dockBtn = headerButton('anomalous-dock-btn', SIDEBAR_ICONS.DOCK, t('dockTitle'));
        dockBtn.onclick = () => {
            const docked = container.classList.toggle('anomalous-docked');
            localStorage.setItem('anomalous_docked', docked ? 'true' : 'false');
        };
        if (localStorage.getItem('anomalous_docked') === 'true') container.classList.add('anomalous-docked');

        const closeBtn = document.createElement('div');
        closeBtn.id = 'anomalous-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => this.close();

        rightGroup.append(updateNoticeBtn, dockBtn, closeBtn);
        header.append(leftGroup, centerGroup, rightGroup);

        this.grid = panel('anomalous-grid', '');
        this.detailPanel = panel('anomalous-detail');
        this.galleryPanel = panel('anomalous-gallery-panel', '');
        this.homePanel = panel('anomalous-home-panel');
        this.activityPanel = panel('anomalous-activity-panel');
        this.scanPanel = panel('anomalous-scan-panel');
        this.doctorPanel = panel('anomalous-doctor-panel');
        this.assistantPanel = panel('anomalous-assistant-panel');
        this.assistantPanel.style.flexDirection = 'column';
        this.assistantPanel.style.flex = '1';
        this.assistantPanel.style.overflowY = 'auto';
        this.assistantPanel.style.boxSizing = 'border-box';
        this.assistantPanelInitialized = false;
        this.audioStudioPanel = panel('anomalous-audio-studio-panel');
        this.audioStudioPanel.style.flex = '1';
        this.audioStudioPanel.style.height = '100%';
        this.audioStudioPanel.style.overflow = 'hidden';
        this.audioStudioPanel.style.position = 'relative';
        this.audioGalleryPanel = panel('anomalous-audio-gallery-panel');
        this.audioGalleryPanel.style.flex = '1';
        this.audioGalleryPanel.style.height = '100%';
        this.audioGalleryPanel.style.overflow = 'hidden';

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

        // Workspaces (recipes, notes, materials) cover the page but not the rail or header.
        this.nbPanel = document.createElement('div');
        this.nbPanel.className = 'anomalous-nb-modal';
        this.nbPanel.style.display = 'none';
        this.nbPanel.onclick = (e) => {
            if (e.target === this.nbPanel) this.closeWorkspace();
        };
        bindWorkspaceEscape(this);

        content.append(header, this.grid, this.detailPanel, this.galleryPanel, this.homePanel, this.activityPanel, this.scanPanel, this.doctorPanel,
            this.assistantPanel, this.audioStudioPanel, this.audioGalleryPanel);
        container.append(rail.root, this.sidebarWrapper, content, this.nbPanel);
        this.modal.appendChild(container);

        installShellNavigation(this, { container, rail, listToggle, title: pageTitle });
        watchCanvasChanges(this);
        watchWorkflowLoads(this);

        const isScanning = watchScans(this);
        let settingsHubControl = null;
        const toolboxControl = createToolbox(this, {
            container,
            toolboxIcon: SIDEBAR_ICONS.TOOLBOX,
            isScanning,
            getSettingsButton: () => settingsHubControl.button,
            onBeforeOpen: () => settingsHubControl?.close(),
        });
        settingsHubControl = createSettingsHub(this, {
            container,
            savedScale,
            savedBgOpacity,
            updateLangClass,
            toolboxBtn: toolboxControl.button,
            dockBtn,
            updateNoticeBtn,
            icons: SIDEBAR_ICONS,
            onBeforeOpen: () => toolboxControl.close(),
        });
        toolboxControl.mount();

        bindShellResize(container);
        document.body.appendChild(this.modal);
    }

export function renderSidebar() {
        if (getActiveDomain() === 'audio') {
            renderAudioSidebar(this);
            return;
        }
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

                const scope = this.modelScope;
                if (scope?.subfolder === path && scope.type === typeGroup.type && scope.path_idx === typeGroup.path_idx) {
                    item.classList.add('active');
                }

                item.onclick = (e) => {
                    if (e.target.classList.contains('anomalous-folder-toggle')) {
                        if (isExpanded) this.expandedFolders.delete(myId);
                        else this.expandedFolders.add(myId);
                        this.renderSidebar();
                        return;
                    }
                    this.modelScope = { type: typeGroup.type, path_idx: typeGroup.path_idx, subfolder: path };
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
            settleModelScope(this);

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
