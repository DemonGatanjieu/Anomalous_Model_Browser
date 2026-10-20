/**
 * ui_sidebar.js
 * The browser window (rail, list column, header, page panels) and the model folder list.
 */

import { markRemoteView } from './remote_view.js';
import { translate } from './locales.js';
import { showUpdateGuide } from './ui_update_guide.js';
import { AUDIO_USAGE_GUIDE, CURRENT_UPDATE_GUIDE } from './update_guide_data.js';
import { createSettingsHub } from './ui_settings_hub.js';
import { renderRailTools } from './ui_rail_tools.js';
import { getActiveDomain } from './ui_domain_switcher.js';
import { renderAudioSidebar } from './ui_audio_sidebar.js';
import { createGallerySearchBar } from './ui_gallery.js';
import { bindBrowserEscape } from './ui_browser_navigation.js';
import { createShellRail } from './ui_shell_rail.js';
import { installShellNavigation } from './ui_shell_nav.js';
import { bindShellDrag, bindShellMaximize, bindShellResize } from './ui_shell_frame.js';
import { watchScans } from './ui_scan_watch.js';
import { watchCanvasChanges } from './activity_canvas.js';
import { watchWorkflowLoads } from './ui_doctor_banner.js';
import { watchOpenedWorkflows } from './usage_notes.js';
import { settleModelScope } from './ui_model_types.js';
import { renderFolderColumn } from './ui_folder_list.js';
import { createModelSearch } from './ui_model_search.js';
import { attachModelDrop } from './ui_model_import.js';

const t = (key, params) => translate(key, params);

const SIDEBAR_ICONS = {
    DOCK: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>`,
    LIST: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>`,
    SETTINGS: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
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

        // Rail: pages, tools, settings. ui_rail_tools.js fills its tool slots below.
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
        if (localStorage.getItem('anomalous_docked') === 'true') container.classList.add('anomalous-docked');
        const maxBtn = headerButton('anomalous-max-btn', '', t('maximizeTitle'));
        const setMaximized = bindShellMaximize(container, header, maxBtn);
        dockBtn.onclick = () => {
            const docked = container.classList.toggle('anomalous-docked');
            localStorage.setItem('anomalous_docked', docked ? 'true' : 'false');
            if (docked) setMaximized(false);
        };

        const closeBtn = document.createElement('div');
        closeBtn.id = 'anomalous-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => this.close();

        rightGroup.append(updateNoticeBtn, maxBtn, dockBtn, closeBtn);
        centerGroup.append(createModelSearch(this));
        header.append(leftGroup, centerGroup, rightGroup);
        markRemoteView(container, leftGroup); // opened from another device: "view only"

        this.grid = panel('anomalous-grid', '');
        attachModelDrop(this, this.grid); // model files dropped on the models page are imported
        this.detailPanel = panel('anomalous-detail');
        this.galleryPanel = panel('anomalous-gallery-panel', '');
        this.homePanel = panel('anomalous-home-panel');
        this.activityPanel = panel('anomalous-activity-panel');
        this.aiPanel = panel('anomalous-ai-panel'); // the AI workbench (ui_ai_workbench.js)
        this.promptPanel = panel('anomalous-prompt-panel'); // Prompt Studio as a page (ui_prompt_composer.js)
        this.scanPanel = panel('anomalous-scan-panel');
        this.settingsPanel = panel('anomalous-settings-panel');
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
        this.scriptPanel = panel('anomalous-script-panel');
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
        bindBrowserEscape(this);

        content.append(header, this.grid, this.detailPanel, this.galleryPanel, this.homePanel, this.activityPanel, this.aiPanel, this.promptPanel, this.scanPanel, this.settingsPanel, this.doctorPanel,
            this.assistantPanel, this.audioStudioPanel, this.scriptPanel, this.audioGalleryPanel);
        container.append(rail.root, this.sidebarWrapper, content, this.nbPanel);
        // The list column steps aside while a workspace is open. Several modules open it by
        // setting its display, so the container gets a class for it; CSS matching the style
        // attribute inside :has() makes every inline-style write on the page recalc all
        // styles (issue #22, canvas at 2-3 fps).
        const syncWorkspaceOpen = () => container.classList.toggle('anomalous-workspace-open', this.nbPanel.style.display === 'flex');
        new MutationObserver(syncWorkspaceOpen).observe(this.nbPanel, { attributes: true, attributeFilter: ['style'] });
        this.modal.appendChild(container);

        installShellNavigation(this, { container, rail, listToggle, title: pageTitle });
        watchCanvasChanges(this);
        watchWorkflowLoads(this);
        watchOpenedWorkflows();

        const isScanning = watchScans(this);
        const settingsHubControl = createSettingsHub(this, {
            container,
            savedScale,
            savedBgOpacity,
            updateLangClass,
            dockBtn,
            maxBtn,
            updateNoticeBtn,
            icons: SIDEBAR_ICONS,
        });
        this.renderRailTools = () => renderRailTools(this, { isScanning, settingsButton: settingsHubControl.button });
        this.renderRailTools();

        bindShellResize(container);
        document.body.appendChild(this.modal);
    }

export function renderSidebar() {
        if (getActiveDomain() === 'audio') {
            renderAudioSidebar(this);
            return;
        }
        this.sidebar.replaceChildren(renderFolderColumn(this));
    }


export async function loadFolders() {
        try {
            const res = await fetch('/anomalous/folders');
            const data = await res.json();
            this.foldersData = data.folders || [];
            settleModelScope(this);
            this.renderSidebar();
            this.loadModels();
        } catch (e) { }
    }
