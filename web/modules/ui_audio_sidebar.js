import { t } from './interface_settings.js';

/**
 * Audio Sidebar Navigation Module
 * Renders structured category trees for voices, characters, and generated audio history.
 */

let activeFilter = { type: 'all', value: null };

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

function renderSidebarHeader(owner) {
    const topBar = document.createElement('div');
    topBar.style.display = 'flex';
    topBar.style.justifyContent = 'space-between';
    topBar.style.alignItems = 'center';
    topBar.style.padding = '12px 14px 10px 14px';
    topBar.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';

    const title = document.createElement('h3');
    title.style.color = '#f1f5f9';
    title.style.margin = '0';
    title.style.fontSize = '12px';
    title.style.fontWeight = '600';
    title.style.letterSpacing = '0.5px';
    title.style.display = 'inline-flex';
    title.style.alignItems = 'center';
    title.style.gap = '8px';
    title.innerHTML = `<span style="color:#818cf8;">${SIDEBAR_SVG.MIC}</span><span>${t('audioSidebarTitle')}</span>`;

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.innerHTML = SIDEBAR_SVG.REFRESH;
    refreshBtn.title = t('audioRefresh');
    refreshBtn.style.background = 'transparent';
    refreshBtn.style.border = 'none';
    refreshBtn.style.color = '#94a3b8';
    refreshBtn.style.cursor = 'pointer';
    refreshBtn.style.padding = '4px';
    refreshBtn.style.borderRadius = '4px';
    refreshBtn.style.display = 'inline-flex';
    refreshBtn.style.alignItems = 'center';
    refreshBtn.style.justifyContent = 'center';
    refreshBtn.onclick = () => renderAudioSidebar(owner);

    topBar.appendChild(title);
    topBar.appendChild(refreshBtn);
    return topBar;
}

function createNavItem(label, iconSvg, count, isSelected, onClick) {
    const item = document.createElement('div');
    item.className = `anomalous-audio-nav-item${isSelected ? ' active' : ''}`;

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '8px';
    left.innerHTML = `<span style="opacity:0.85;display:inline-flex;align-items:center;">${iconSvg}</span><span>${label}</span>`;

    item.appendChild(left);
    if (count !== undefined && count !== null) {
        const badge = document.createElement('span');
        badge.style.fontSize = '10px';
        badge.style.color = isSelected ? '#818cf8' : '#64748b';
        badge.style.background = isSelected ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)';
        badge.style.padding = '1px 6px';
        badge.style.borderRadius = '8px';
        badge.textContent = count;
        item.appendChild(badge);
    }

    item.onclick = onClick;
    return item;
}

function createSectionLabel(text) {
    const sec = document.createElement('div');
    sec.style.padding = '12px 14px 4px 14px';
    sec.style.fontSize = '10px';
    sec.style.fontWeight = '700';
    sec.style.letterSpacing = '1px';
    sec.style.textTransform = 'uppercase';
    sec.style.color = '#64748b';
    sec.textContent = text;
    return sec;
}

export async function renderAudioSidebar(owner) {
    if (!owner || !owner.sidebar) return;
    owner.sidebar.innerHTML = '';
    owner.sidebar.appendChild(renderSidebarHeader(owner));

    const listContainer = document.createElement('div');
    listContainer.style.overflowY = 'auto';
    listContainer.style.flex = '1';
    listContainer.style.padding = '6px 0';

    try {
        const resp = await fetch('/anomalous/audio_voices');
        const data = await resp.json();
        const chars = data.characters || [];

        // 1. All Voices Item
        const allItem = createNavItem(
            t('audioAllVoices'), SIDEBAR_SVG.ALL_VOICES, data.total_slices || 0,
            activeFilter.type === 'all',
            () => {
                activeFilter = { type: 'all', value: null };
                renderAudioSidebar(owner);
                owner.switchAudioTab?.('presets', activeFilter);
            }
        );
        listContainer.appendChild(allItem);

        // 2. Character Categories
        listContainer.appendChild(createSectionLabel(t('audioSectionCharacters')));
        chars.forEach(c => {
            const isSel = activeFilter.type === 'character' && activeFilter.value === c.character;
            const cItem = createNavItem(
                c.character, SIDEBAR_SVG.USER, c.total_slices, isSel,
                () => {
                    activeFilter = { type: 'character', value: c.character };
                    renderAudioSidebar(owner);
                    owner.switchAudioTab?.('presets', activeFilter);
                }
            );
            listContainer.appendChild(cItem);
        });

        // 3. Output History Entry
        listContainer.appendChild(createSectionLabel(t('audioSectionHistory')));
        const histItem = createNavItem(
            t('audioGalleryTab'), SIDEBAR_SVG.DISC, null,
            activeFilter.type === 'gallery',
            () => {
                activeFilter = { type: 'gallery', value: null };
                renderAudioSidebar(owner);
                owner.switchAudioTab?.('gallery', activeFilter);
            }
        );
        listContainer.appendChild(histItem);

    } catch (e) {
        console.error('Failed to render audio sidebar:', e);
    }

    owner.sidebar.appendChild(listContainer);
}
