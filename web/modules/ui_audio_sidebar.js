import { t } from './interface_settings.js';
import { engineById, getStoredEngine, invalidateEngineCache, loadEngine } from './audio_engines.js';

/**
 * Audio sidebar: All Voices, one entry per voice group of the active engine
 * (F5-TTS voices or GPT-SoVITS characters), and the generated-audio history.
 * Owns the active audio filter.
 */

let activeFilter = { type: 'all', value: null };
const renderTokens = new WeakMap();

export function getActiveAudioFilter() {
    return activeFilter;
}

export function setActiveAudioFilter(filter) {
    activeFilter = filter || { type: 'all', value: null };
}

const SIDEBAR_SVG = {
    MIC: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
    ALL_VOICES: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    USER: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    DISC: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`,
    REFRESH: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>`
};

function filterKey(filter) {
    return `${filter?.type || 'all'}:${filter?.value || ''}`;
}

/** Re-mark the selected entry without refetching the voice list. */
export function syncAudioSidebarSelection(owner) {
    const key = filterKey(activeFilter);
    owner?.sidebar?.querySelectorAll('.anomalous-audio-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.filterKey === key);
    });
}

function renderSidebarHeader(owner) {
    const topBar = document.createElement('div');
    topBar.className = 'anomalous-audio-sidebar-header';

    const title = document.createElement('h3');
    title.className = 'anomalous-audio-sidebar-title';
    const icon = document.createElement('span');
    icon.className = 'anomalous-audio-sidebar-title-icon';
    icon.innerHTML = SIDEBAR_SVG.MIC;
    const label = document.createElement('span');
    label.textContent = t('audioSidebarTitle');
    title.append(icon, label);

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'anomalous-audio-sidebar-refresh';
    refreshBtn.innerHTML = SIDEBAR_SVG.REFRESH;
    refreshBtn.title = t('audioRefresh');
    refreshBtn.setAttribute('aria-label', t('audioRefresh'));
    refreshBtn.onclick = () => {
        invalidateEngineCache({ rescan: true });
        renderAudioSidebar(owner);
        if (activeFilter.type !== 'gallery') owner.switchAudioTab?.('presets', activeFilter);
    };

    topBar.append(title, refreshBtn);
    return topBar;
}

function createNavItem(owner, { label, iconSvg, count, filter, tab }) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'anomalous-audio-nav-item';
    item.dataset.filterKey = filterKey(filter);
    item.classList.toggle('active', item.dataset.filterKey === filterKey(activeFilter));

    const left = document.createElement('span');
    left.className = 'anomalous-audio-nav-label';
    const icon = document.createElement('span');
    icon.className = 'anomalous-audio-nav-icon';
    icon.innerHTML = iconSvg;
    const text = document.createElement('span');
    text.textContent = label;
    left.append(icon, text);
    item.appendChild(left);

    if (count !== undefined && count !== null) {
        const badge = document.createElement('span');
        badge.className = 'anomalous-audio-nav-count';
        badge.textContent = String(count);
        item.appendChild(badge);
    }

    item.onclick = () => {
        activeFilter = filter;
        syncAudioSidebarSelection(owner);
        owner.switchAudioTab?.(tab, filter);
    };
    return item;
}

function createSectionLabel(text) {
    const sec = document.createElement('div');
    sec.className = 'anomalous-audio-nav-section';
    sec.textContent = text;
    return sec;
}

export async function renderAudioSidebar(owner) {
    if (!owner?.sidebar) return;
    const token = {};
    renderTokens.set(owner.sidebar, token);

    const listContainer = document.createElement('div');
    listContainer.className = 'anomalous-audio-nav-list';
    owner.sidebar.replaceChildren(renderSidebarHeader(owner), listContainer);

    const engineId = engineById(getStoredEngine()) ? getStoredEngine() : 'f5';
    const result = await loadEngine(engineId);
    if (renderTokens.get(owner.sidebar) !== token) return;
    if (result.error) {
        const error = createSectionLabel(t('audioLoadFailed', { error: result.error }));
        error.classList.add('is-error');
        listContainer.appendChild(error);
        return;
    }

    const groups = result.groups;
    const totalSlices = groups.reduce((sum, group) => sum + (group.total_slices || 0), 0);
    if (activeFilter.type === 'group' && !groups.some(group => group.group === activeFilter.value)) {
        activeFilter = { type: 'all', value: null };
    }

    listContainer.appendChild(createNavItem(owner, {
        label: t('audioAllVoices'), iconSvg: SIDEBAR_SVG.ALL_VOICES, count: totalSlices,
        filter: { type: 'all', value: null }, tab: 'presets',
    }));

    listContainer.appendChild(createSectionLabel(t('audioSectionCharactersOf', { engine: engineById(engineId).label })));
    for (const group of groups) {
        const showFolder = group.engine === 'f5' && group.folder && group.folder !== 'F5-TTS';
        const label = showFolder ? `${group.character} · ${group.folder}` : group.character;
        listContainer.appendChild(createNavItem(owner, {
            label, iconSvg: SIDEBAR_SVG.USER, count: group.total_slices,
            filter: { type: 'group', value: group.group, character: group.character }, tab: 'presets',
        }));
    }

    listContainer.appendChild(createSectionLabel(t('audioSectionHistory')));
    listContainer.appendChild(createNavItem(owner, {
        label: t('audioGalleryTab'), iconSvg: SIDEBAR_SVG.DISC, count: null,
        filter: { type: 'gallery', value: null }, tab: 'gallery',
    }));
}
