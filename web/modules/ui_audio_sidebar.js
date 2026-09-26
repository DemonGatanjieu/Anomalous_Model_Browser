import { t } from './interface_settings.js';
import { engineById, getStoredEngine, invalidateEngineCache, loadEngine, loadGptSovitsStatus } from './audio_engines.js';
import { bindVoiceDrag } from './audio_voice_drag.js';
import { bindTtsFileDrop } from './ui_tts_file_drop.js';
import { openTtsImport } from './ui_tts_import.js';
import { openTtsSetup, setupAttention } from './ui_tts_setup.js';

/**
 * Audio sidebar: All Voices, the active engine's characters (GPT-SoVITS grouped by
 * language, F5-TTS by folder; each group folds, each character unfolds into its
 * clips), the generated-audio history, and for GPT-SoVITS a settings entry at the
 * bottom. Owns the active audio filter. Characters drag onto canvas nodes like the
 * studio cards; files dropped on a GPT-SoVITS character open the import form for it.
 */

let activeFilter = { type: 'all', value: null };
const renderTokens = new WeakMap();
const expanded = new Set(); // characters unfolded into their clips, this session only

const COLLAPSED_KEY = 'anomalous_audio_sidebar_collapsed';
const SEARCH_FROM = 6; // the search box shows once there are this many characters
const LANGUAGE_ORDER = ['zh', 'ja', 'en'];

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
    REFRESH: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>`,
    CHEVRON: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`,
    PLAY: `<svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    SEARCH: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    SETTINGS: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>`,
};

function filterKey(filter) {
    return `${filter?.type || 'all'}:${filter?.value || ''}`;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function icon(svg, className) {
    const node = el('span', className);
    node.innerHTML = svg; // static markup only
    return node;
}

function storedCollapsed() {
    try {
        const keys = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]');
        return new Set(Array.isArray(keys) ? keys : []);
    } catch (_) { return new Set(); }
}

function storeCollapsed(keys) {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...keys])); } catch (_) { /* convenience only */ }
}

/** Re-mark the selected entry without refetching the voice list. */
export function syncAudioSidebarSelection(owner) {
    const key = filterKey(activeFilter);
    owner?.sidebar?.querySelectorAll('.anomalous-audio-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.filterKey === key);
    });
}

/** Redraw the studio for the current filter (unless the history is open) and the sidebar. */
function redraw(owner, { sidebarOnly = false } = {}) {
    if (!sidebarOnly && activeFilter.type !== 'gallery') owner.switchAudioTab?.('presets', activeFilter);
    renderAudioSidebar(owner);
}

function renderSidebarHeader(owner) {
    const topBar = el('div', 'anomalous-audio-sidebar-header');
    const title = el('h3', 'anomalous-audio-sidebar-title');
    title.append(icon(SIDEBAR_SVG.MIC, 'anomalous-audio-sidebar-title-icon'), el('span', '', t('audioSidebarTitle')));

    const refreshBtn = el('button', 'anomalous-audio-sidebar-refresh');
    refreshBtn.type = 'button';
    refreshBtn.innerHTML = SIDEBAR_SVG.REFRESH;
    refreshBtn.title = t('audioRefresh');
    refreshBtn.setAttribute('aria-label', t('audioRefresh'));
    refreshBtn.onclick = () => {
        invalidateEngineCache({ rescan: true });
        redraw(owner);
    };

    topBar.append(title, refreshBtn);
    return topBar;
}

function createNavItem(owner, { label, iconSvg, count, filter, tab }) {
    const item = el('button', 'anomalous-audio-nav-item');
    item.type = 'button';
    item.dataset.filterKey = filterKey(filter);
    item.classList.toggle('active', item.dataset.filterKey === filterKey(activeFilter));

    const left = el('span', 'anomalous-audio-nav-label');
    left.append(icon(iconSvg, 'anomalous-audio-nav-icon'), el('span', 'anomalous-audio-nav-text', label));
    item.appendChild(left);

    if (count !== undefined && count !== null) item.appendChild(el('span', 'anomalous-audio-nav-count', String(count)));

    item.onclick = () => {
        activeFilter = filter;
        syncAudioSidebarSelection(owner);
        owner.switchAudioTab?.(tab, filter);
    };
    return item;
}

function createSectionLabel(text) {
    return el('div', 'anomalous-audio-nav-section', text);
}

/** GPT-SoVITS characters group by language, F5-TTS voices by folder (root first). */
function bucketOf(group) {
    if (group.engine === 'gpt_sovits') {
        const lang = group.language || '';
        const known = LANGUAGE_ORDER.indexOf(lang);
        return {
            key: `gpt_sovits:${lang}`,
            sort: !lang ? 99 : known >= 0 ? known : 50,
            label: !lang ? t('audioSidebarLanguageUnknown') : known >= 0 ? t(`ttsNeededFor_${lang}`) : lang.toUpperCase(),
        };
    }
    const folder = group.folder || 'F5-TTS';
    return { key: `f5:${folder}`, sort: folder === 'F5-TTS' ? 0 : 1, label: folder };
}

function bucketsOf(groups) {
    const buckets = new Map();
    for (const group of groups) {
        const bucket = bucketOf(group);
        if (!buckets.has(bucket.key)) buckets.set(bucket.key, { ...bucket, groups: [] });
        buckets.get(bucket.key).groups.push(group);
    }
    return [...buckets.values()].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
}

/** Why a character needs a look (read error, no main voice), or ''. */
function problemOf(group) {
    if (group.error) return t('ttsCharacterError', { error: group.error });
    if (group.has_main) return '';
    return group.engine === 'gpt_sovits' ? t('ttsMainMissing') : t('audioMainMissing', { file: `${group.character}.wav` });
}

function matches(group, term) {
    if (!term) return true;
    const words = [group.character, ...(group.aliases || []), ...group.slices.map(slice => slice.emotion)];
    return words.some(word => String(word || '').toLowerCase().includes(term));
}

/**
 * Play a clip through its row in the studio (same player, same stop rules), switching
 * the studio to the character first when the row is not on screen.
 */
async function playClip(owner, group, slice) {
    const selector = `[data-slice-id="${CSS.escape(slice.id)}"] .anomalous-audio-play-btn`;
    const visible = () => {
        const btn = owner.audioStudioPanel?.querySelector(selector);
        return btn && btn.offsetParent !== null ? btn : null;
    };
    let btn = visible();
    if (!btn) {
        activeFilter = { type: 'group', value: group.group, character: group.character };
        syncAudioSidebarSelection(owner);
        owner.switchAudioTab?.('presets', activeFilter);
        const until = performance.now() + 4000;
        while (!(btn = visible()) && performance.now() < until) await new Promise(requestAnimationFrame);
    }
    if (!btn) return;
    btn.closest('.anomalous-voice-slice-row')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    btn.click();
}

function renderClipRow(owner, group, slice) {
    const row = el('button', 'anomalous-audio-nav-clip');
    row.type = 'button';
    row.title = slice.text || slice.filename || '';
    const tag = slice.is_main ? t('audioSidebarMainClip') : `{${slice.emotion}}`;
    row.append(icon(SIDEBAR_SVG.PLAY, 'anomalous-audio-nav-clip-play'), el('span', 'anomalous-audio-nav-clip-tag', tag),
        el('span', 'anomalous-audio-nav-clip-text', slice.text || slice.filename || ''));
    row.onclick = () => playClip(owner, group, slice);
    // F5-TTS clips are files in the input folder and drag onto Load Audio, as in the studio.
    if ((slice.engine || 'f5') === 'f5') bindVoiceDrag(row, { kind: 'clip', slice }, owner);
    return row;
}

function renderCharacter(owner, group, { canImport, forceOpen }) {
    const wrap = el('div', 'anomalous-audio-nav-character');
    const filter = { type: 'group', value: group.group, character: group.character };
    const item = createNavItem(owner, { label: group.character, iconSvg: SIDEBAR_SVG.USER, count: group.total_slices, filter, tab: 'presets' });
    const open = forceOpen || expanded.has(group.group);

    const toggle = el('span', `anomalous-audio-nav-chevron${open ? ' is-open' : ''}`);
    toggle.innerHTML = SIDEBAR_SVG.CHEVRON;
    toggle.setAttribute('role', 'button');
    toggle.title = t(open ? 'audioSidebarHideClips' : 'audioSidebarShowClips');
    toggle.onclick = (e) => {
        e.stopPropagation();
        if (expanded.has(group.group)) expanded.delete(group.group);
        else expanded.add(group.group);
        wrap.replaceWith(renderCharacter(owner, group, { canImport, forceOpen: false }));
    };
    toggle.hidden = !group.slices.length;
    item.prepend(toggle);

    const problem = problemOf(group);
    if (problem) {
        const dot = el('span', 'anomalous-audio-nav-problem');
        dot.title = problem;
        item.querySelector('.anomalous-audio-nav-label').append(dot);
    }
    if (group.has_main && !group.error) {
        item.title = t(group.engine === 'gpt_sovits' ? 'audioDragCharacterTitleGptSovits' : 'audioDragCharacterTitle', { character: group.character });
        bindVoiceDrag(item, { kind: 'character', group }, owner);
    }
    if (group.engine === 'gpt_sovits' && canImport && !group.error) wrap.dataset.ttsCharacter = group.character; // file drop target

    wrap.append(item);
    if (open) {
        const clips = el('div', 'anomalous-audio-nav-clips');
        for (const slice of group.slices) clips.append(renderClipRow(owner, group, slice));
        wrap.append(clips);
    }
    return wrap;
}

function renderBucket(owner, bucket, { collapsed, canImport, term }) {
    const box = el('div', 'anomalous-audio-nav-bucket');
    const isCollapsed = !term && collapsed.has(bucket.key);
    const head = el('button', `anomalous-audio-nav-bucket-head${isCollapsed ? ' is-collapsed' : ''}`);
    head.type = 'button';
    head.append(icon(SIDEBAR_SVG.CHEVRON, 'anomalous-audio-nav-chevron is-open'), el('span', 'anomalous-audio-nav-bucket-label', bucket.label),
        el('span', 'anomalous-audio-nav-bucket-count', String(bucket.groups.length)));
    head.onclick = () => {
        const keys = storedCollapsed();
        if (keys.has(bucket.key)) keys.delete(bucket.key);
        else keys.add(bucket.key);
        storeCollapsed(keys);
        box.replaceWith(renderBucket(owner, bucket, { collapsed: keys, canImport, term }));
    };
    box.append(head);
    if (!isCollapsed) {
        for (const group of bucket.groups) box.append(renderCharacter(owner, group, { canImport, forceOpen: false }));
    }
    return box;
}

function renderCharacters(owner, container, groups, { canImport, term }) {
    const shown = groups.filter(group => matches(group, term));
    const buckets = bucketsOf(shown);
    const collapsed = storedCollapsed();
    if (!shown.length && term) {
        container.append(el('div', 'anomalous-audio-nav-empty', t('audioSidebarNoMatch')));
    } else if (buckets.length > 1) {
        for (const bucket of buckets) container.append(renderBucket(owner, bucket, { collapsed, canImport, term }));
    } else {
        for (const group of shown) container.append(renderCharacter(owner, group, { canImport, forceOpen: false }));
    }
}

/** Bottom entry for GPT-SoVITS settings; the dot says when something wants a look. */
function renderSettingsEntry(owner, status, languages) {
    const attention = setupAttention(status, languages);
    const entry = el('button', `anomalous-audio-sidebar-settings${attention.level ? ` is-${attention.level}` : ''}`);
    entry.type = 'button';
    entry.title = attention.title;
    const label = el('span', 'anomalous-audio-nav-label');
    label.append(icon(SIDEBAR_SVG.SETTINGS, 'anomalous-audio-nav-icon'), el('span', 'anomalous-audio-nav-text', t('ttsSetupTitle')));
    if (attention.level) label.append(el('span', 'anomalous-audio-sidebar-settings-dot'));
    entry.append(label);
    if (attention.busy) entry.append(el('span', 'anomalous-audio-sidebar-settings-busy', attention.busy));
    entry.onclick = () => openTtsSetup({ languages, onChanged: (options) => redraw(owner, options) });
    return entry;
}

export async function renderAudioSidebar(owner) {
    if (!owner?.sidebar) return;
    const token = {};
    renderTokens.set(owner.sidebar, token);

    const listContainer = el('div', 'anomalous-audio-nav-list');
    owner.sidebar.replaceChildren(renderSidebarHeader(owner), listContainer);

    const engineId = engineById(getStoredEngine()) ? getStoredEngine() : 'f5';
    const statusRequest = engineId === 'gpt_sovits' ? loadGptSovitsStatus().catch(() => null) : null;
    const [result, status] = await Promise.all([loadEngine(engineId), statusRequest]);
    if (renderTokens.get(owner.sidebar) !== token) return;
    if (result.error) {
        const error = createSectionLabel(t('audioLoadFailed', { error: result.error }));
        error.classList.add('is-error');
        listContainer.appendChild(error);
        return;
    }

    const groups = result.groups;
    const canImport = Boolean(status) && status.local !== false;
    const totalSlices = groups.reduce((sum, group) => sum + (group.total_slices || 0), 0);
    if (activeFilter.type === 'group' && !groups.some(group => group.group === activeFilter.value)) {
        activeFilter = { type: 'all', value: null };
    }

    if (groups.length >= SEARCH_FROM) {
        const search = el('label', 'anomalous-audio-sidebar-search');
        const input = el('input');
        input.type = 'search';
        input.placeholder = t('audioSidebarSearch');
        search.append(icon(SIDEBAR_SVG.SEARCH, ''), input);
        owner.sidebar.insertBefore(search, listContainer);
        const characters = el('div', 'anomalous-audio-nav-characters');
        input.oninput = () => {
            characters.replaceChildren();
            renderCharacters(owner, characters, groups, { canImport, term: input.value.trim().toLowerCase() });
        };
        listContainer.append(allVoices(owner, totalSlices), createSectionLabel(t('audioSectionCharactersOf', { engine: engineById(engineId).label })), characters);
        renderCharacters(owner, characters, groups, { canImport, term: '' });
    } else {
        listContainer.append(allVoices(owner, totalSlices), createSectionLabel(t('audioSectionCharactersOf', { engine: engineById(engineId).label })));
        renderCharacters(owner, listContainer, groups, { canImport, term: '' });
    }

    listContainer.appendChild(createSectionLabel(t('audioSectionHistory')));
    listContainer.appendChild(createNavItem(owner, {
        label: t('audioGalleryTab'), iconSvg: SIDEBAR_SVG.DISC, count: null,
        filter: { type: 'gallery', value: null }, tab: 'gallery',
    }));

    if (status) {
        const languages = groups.map(group => group.language);
        owner.sidebar.append(renderSettingsEntry(owner, status, languages));
        if (canImport) {
            bindTtsFileDrop(listContainer, (files, target) => openTtsImport({ files, target, onDone: () => redraw(owner) }));
        }
    }
}

function allVoices(owner, count) {
    return createNavItem(owner, {
        label: t('audioAllVoices'), iconSvg: SIDEBAR_SVG.ALL_VOICES, count,
        filter: { type: 'all', value: null }, tab: 'presets',
    });
}
