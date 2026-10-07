/**
 * Page navigation for the shell: `owner.goTo(page)` for the rail, the home cards and the
 * domain switch; which page shows its list column (and whether that list is open); the
 * page title in the header; the page reopened next time; the number keys 1-9 to the rail's
 * pages while the browser is open (shell_open_rules.js).
 *
 * Pages: home, models, gallery, voices, script, audio-gallery (base pages); recipes, combos
 * (workspaces over the base page, closed with `closeWorkspace()`); prompts opens Prompt
 * Studio beside the canvas (the browser folds away and comes back when it closes); doctor, assistant
 * scan, settings (tool pages, entered through `owner.enterToolPage`).
 */

import { translate as t } from './locales.js';
import { getActiveDomain, setActiveDomain } from './ui_domain_switcher.js';
import { renderHome } from './ui_home.js';
import { renderActivityPage } from './ui_activity.js';
import { RAIL_PAGES } from './ui_shell_rail.js';
import { railPageForKey } from './shell_open_rules.js';

const LAST_PAGE_KEY = 'anomalous_last_page';
const REMEMBERED = new Set(['home', 'activity', 'models', 'gallery', 'voices', 'script', 'audio-gallery']);
const AUDIO_PAGES = new Set(['voices', 'script', 'audio-gallery']);
// The audio tab (browser.switchAudioTab) of each audio page.
const AUDIO_TABS = { voices: 'presets', script: 'script', 'audio-gallery': 'gallery' };
// Voice-over is a view of the Voices page: same rail entry, same list column.
const RAIL_OF = { script: 'voices' };
const railOf = page => RAIL_OF[page] || page;
// Pages with a list column, and where each remembers whether you closed it.
const LIST_KEYS = {
    models: 'anomalous_user_sidebar_closed',
    voices: 'anomalous_audio_list_closed',
    script: 'anomalous_audio_list_closed',
    'audio-gallery': 'anomalous_audio_list_closed',
};
const TITLE_KEYS = {
    home: 'shellHome', activity: 'activityTitle', models: 'shellTitleModels', gallery: 'gallery', recipes: 'recipeTitle',
    combos: 'shellCombos', voices: 'shellVoices', script: 'shellVoices', 'audio-gallery': 'shellAudioGallery',
    doctor: 'sidebarDoctor', assistant: 'sidebarAssistant', scan: 'scanPageTitle', settings: 'sidebarSettings',
};
// Below this width the list covers the page instead of sitting beside it, and starts closed.
const NARROW_PX = 760;

const read = (key) => {
    try { return localStorage.getItem(key); } catch (_) { return null; }
};
const write = (key, value) => {
    try { localStorage.setItem(key, value); } catch (_) { /* a per-viewer convenience only */ }
};

/** The page to open first: the last one used, else home. */
export function startPage() {
    const saved = read(LAST_PAGE_KEY);
    return REMEMBERED.has(saved) ? saved : 'home';
}

/**
 * Wires navigation onto `owner`. `rail`: from createShellRail; `listToggle`: the header's
 * list button; `title`: the header's page title element.
 */
export function installShellNavigation(owner, { container, rail, listToggle, title }) {
    let current = null;
    let lastVoiceView = 'voices'; // the rail's Voices entry reopens the view used last
    const narrow = () => container.clientWidth > 0 && container.clientWidth < NARROW_PX;

    const setTitle = (page) => {
        title.textContent = page ? t(TITLE_KEYS[page]) : '';
        container.dataset.page = page || ''; // what the header shows per page (the models search)
    };

    const applyList = (page) => {
        const key = LIST_KEYS[page];
        listToggle.disabled = !key;
        container.classList.toggle('anomalous-sidebar-closed', !key || narrow() || read(key) === 'true');
    };

    // Narrow window: the open list is a drawer over the page. Picking an entry, pressing the
    // dimmed page or Esc closes it, without changing what the page remembers.
    const drawerOpen = () => narrow() && !container.classList.contains('anomalous-sidebar-closed');
    const closeDrawer = () => container.classList.add('anomalous-sidebar-closed');
    const scrim = document.createElement('div');
    scrim.className = 'anomalous-list-scrim';
    scrim.onclick = closeDrawer;
    container.insertBefore(scrim, owner.sidebarWrapper.nextSibling);
    owner.sidebarWrapper.addEventListener('click', (e) => {
        if (!drawerOpen() || e.target.classList.contains('anomalous-folder-toggle')) return;
        if (e.target.closest('.anomalous-folder-item, .anomalous-audio-nav-item')) closeDrawer();
    });
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !drawerOpen() || !owner.modal?.classList.contains('visible')) return;
        if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        closeDrawer();
    });

    // 1-9: the rail's pages from the top, while the browser is open and no dialog is over it.
    // ComfyUI binds no plain digits; a number typed into a box stays in the box.
    const dialogOpen = () => [...document.querySelectorAll('[aria-modal="true"], [role="dialog"]')]
        .some(node => node.getClientRects().length > 0);
    window.addEventListener('keydown', (e) => {
        if (!owner.modal?.classList.contains('visible')) return;
        const page = railPageForKey(e, RAIL_PAGES);
        if (!page || dialogOpen()) return;
        e.preventDefault();
        owner.goTo(page);
    });

    const toggleList = () => {
        if (listToggle.disabled) return;
        const closed = !container.classList.contains('anomalous-sidebar-closed');
        container.classList.toggle('anomalous-sidebar-closed', closed);
        if (!narrow() && LIST_KEYS[current]) write(LIST_KEYS[current], String(closed));
    };
    listToggle.onclick = toggleList;

    // Crossing the narrow width re-decides the list: closed when narrow, as remembered when wide.
    let wasNarrow = null;
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => {
            const now = narrow();
            container.classList.toggle('anomalous-shell-narrow', now);
            if (now !== wasNarrow && current) applyList(current);
            wasNarrow = now;
        }).observe(container);
    }

    // The side the list column was last drawn for. The stored side survives a reload, so it
    // cannot tell whether the list was drawn yet (opening straight onto an audio page left it empty).
    let listDomain = null;

    /** Switches the domain the list column and the "!" guide follow; loads the model list once. */
    const useDomain = (domain) => {
        if (getActiveDomain() !== domain) setActiveDomain(domain);
        const changed = listDomain !== domain;
        listDomain = domain;
        if (domain === 'audio') {
            if (changed) owner.renderSidebar();
            return;
        }
        if (!owner.foldersData) owner.loadFolders();
        else if (changed) {
            owner.renderSidebar();
            owner.loadModels();
        }
    };

    const enter = (page) => {
        current = page;
        if (railOf(page) === 'voices') lastVoiceView = page;
        if (REMEMBERED.has(page)) write(LAST_PAGE_KEY, page);
        rail.setActive(railOf(page));
        setTitle(page);
    };

    const showModels = () => {
        owner.grid.style.display = 'grid';
        if (owner.detailPanel.innerHTML !== '') {
            owner.stopMediaInContainer(owner.detailPanel);
            owner.detailPanel.innerHTML = '';
            owner.currentDetailModel = null;
            owner.historyStack = [];
        }
    };

    const showGallery = () => {
        owner.gallerySelectModel = null;
        owner.galleryPanel.classList.remove('is-cover-selecting');
        const selectBanner = document.getElementById('anomalous-gallery-select-banner');
        if (selectBanner) selectBanner.style.display = 'none';
        owner.galleryPanel.style.display = 'flex';
        void owner.refreshGalleryImages();
    };

    /** The recipe workspace over the current page; closing it comes back here. */
    const openRecipes = () => {
        owner.recipeSelectedTags = new Set();
        if (typeof owner.recipeModelReturn !== 'function') {
            owner.workspaceReturnState = Object.fromEntries([
                ['grid', owner.grid], ['detail', owner.detailPanel], ['gallery', owner.galleryPanel],
                ['doctor', owner.doctorPanel], ['assistant', owner.assistantPanel], ['home', owner.homePanel],
                ['activity', owner.activityPanel], ['scan', owner.scanPanel], ['settings', owner.settingsPanel],
                ['audioStudio', owner.audioStudioPanel], ['script', owner.scriptPanel], ['audioGallery', owner.audioGalleryPanel],
            ].filter(([, panel]) => panel).map(([key, panel]) => [key, panel.style.display || 'none']));
        } else if (!owner.workspaceReturnState) {
            owner.workspaceReturnState = { grid: 'grid' };
        }
        owner.hideAllPanels();
        owner.nbPanel.style.display = 'flex';
        owner.showRecipes();
    };

    owner.goTo = (page, { fromRail = false } = {}) => {
        const inWorkspace = owner.nbPanel?.style.display === 'flex';
        // The rail entry of the page you are on opens or closes its list; from a model's
        // detail it goes back to the grid instead.
        const atRoot = page !== 'models' || owner.grid.style.display !== 'none';
        if (fromRail && railOf(page) === railOf(current) && !inWorkspace && atRoot && LIST_KEYS[page]) {
            toggleList();
            return;
        }
        if (fromRail && page === 'voices') page = lastVoiceView;
        if (page === 'prompts') {
            void owner.openPromptStudio();
            return;
        }
        if (page === 'recipes' || page === 'combos') {
            // Workspaces belong to the image side: from an audio page they open over the models.
            if (AUDIO_PAGES.has(current)) owner.goTo('models');
            rail.setActive(page);
            setTitle(page);
            if (page === 'recipes') openRecipes();
            else void owner.showNotebooks();
            return;
        }
        if (inWorkspace) owner.closeWorkspace();
        enter(page);
        if (AUDIO_PAGES.has(page)) {
            useDomain('audio');
            applyList(page);
            owner.switchAudioTab(AUDIO_TABS[page]);
            return;
        }
        useDomain('visual');
        owner.hideAllPanels();
        applyList(page);
        if (page === 'home') {
            owner.homePanel.style.display = 'flex';
            renderHome(owner, owner.homePanel);
        } else if (page === 'activity') {
            owner.activityPanel.style.display = 'flex';
            renderActivityPage(owner, owner.activityPanel);
        } else if (page === 'gallery') {
            showGallery();
        } else {
            showModels();
        }
    };

    /** Scan, doctor and assistant: image-side pages without a rail entry, opened from the tools. */
    owner.enterToolPage = (page) => {
        if (owner.nbPanel?.style.display === 'flex') owner.closeWorkspace();
        useDomain('visual');
        current = page;
        rail.setActive(null);
        setTitle(page);
        applyList(page);
        if (page === 'assistant') container.classList.add('anomalous-sidebar-closed');
    };

    // A workspace opened another way (a combo from elsewhere) marks the rail and title.
    owner.markWorkspace = (page) => {
        rail.setActive(page);
        setTitle(page);
    };

    // Other modules mark tabs through these; they map onto the rail now.
    owner.setActiveHeaderTab = (button) => rail.setActive(button?.dataset?.page ?? null);
    owner.updateHeaderTabs = () => {};

    // Closing a workspace goes back to the page under it.
    const closeWorkspace = owner.closeWorkspace;
    owner.closeWorkspace = function (...args) {
        const result = closeWorkspace.apply(this, args);
        rail.setActive(REMEMBERED.has(current) ? railOf(current) : null);
        setTitle(current);
        return result;
    };

    owner.refreshShellLanguage = () => {
        rail.refreshLanguage();
        setTitle(current);
        listToggle.setAttribute('aria-label', t('sidebarToggle'));
        listToggle.dataset.tooltip = t('sidebarToggle');
        owner.onActivityRecorded();
    };

    // A new entry shows at once on the pages that list entries.
    owner.onActivityRecorded = () => {
        if (current === 'home' && owner.homePanel.style.display !== 'none') renderHome(owner, owner.homePanel);
        if (current === 'activity' && owner.activityPanel.style.display !== 'none') renderActivityPage(owner, owner.activityPanel);
    };

    owner.currentShellPage = () => current;
    // Pages reached another way (the audio list's own entries) still mark the rail and title.
    owner.markShellPage = enter;
}
