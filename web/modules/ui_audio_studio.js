import { t } from './interface_settings.js';
import { stopGalleryAudio } from './ui_audio_gallery.js';
import { getActiveAudioFilter, renderAudioSidebar } from './ui_audio_sidebar.js';
import { bindVoiceDrag } from './audio_voice_drag.js';
import { TTS_ENGINE, invalidateEngineCache, isTtsInstalled, loadGptSovitsStatus, loadVoices } from './audio_engines.js';
import { openGptSovitsEditor } from './ui_audio_tts_editor.js';
import { openPronunciationEditor } from './ui_tts_pronunciation.js';
import { bindTtsFileDrop } from './ui_tts_file_drop.js';
import { openTtsImport } from './ui_tts_import.js';
import { stopScriptDirectorPreview } from './ui_script_director.js';
import { renderVoiceTabs } from './ui_voice_tabs.js';

/**
 * The Voices page's Characters view: GPT-SoVITS character cards (Anomalous_TTS, detected
 * at runtime), preview playback, tag copying, dropping a character onto a TTS node, the
 * editors, and each card's way to the Voice-over view (ui_script_page.js), where scripts
 * are written and generated.
 */

const renderTokens = new WeakMap();

let globalAudioPlayer = null;
let currentPlayingBtn = null;
let currentPlayingBar = null;

const SVG = {
    PLAY: `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    PAUSE: `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
    MIC: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
    COPY: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
    GRIP: `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="11" r="1.2"/><circle cx="7" cy="11" r="1.2"/></svg>`,
    CHECK: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    SEARCH: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    SCRIPT: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`,
    PLUS: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    PRONOUNCE: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h10v2"/><path d="M9 5v14"/><path d="M7 19h4"/><path d="M15 13h6"/><path d="M18 10v9"/></svg>`,
    EDIT: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    REFRESH: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>`,
};

/** Icon markup is static; any label goes through textContent. */
function setIconLabel(element, iconSvg, label) {
    element.innerHTML = iconSvg;
    if (label) {
        const span = document.createElement('span');
        span.textContent = label;
        element.append(span);
    }
}

export function stopAudioStudioPlayback() {
    if (globalAudioPlayer) {
        globalAudioPlayer.pause();
        globalAudioPlayer.removeAttribute('src');
        globalAudioPlayer = null;
    }
    if (currentPlayingBtn) {
        currentPlayingBtn.innerHTML = SVG.PLAY;
        currentPlayingBtn.classList.remove('is-playing');
        currentPlayingBtn = null;
    }
    if (currentPlayingBar) {
        currentPlayingBar.style.display = 'none';
        currentPlayingBar = null;
    }
}

function playAudio(url, playBtn, eqBars) {
    if (currentPlayingBtn === playBtn) {
        stopAudioStudioPlayback();
        return;
    }
    stopAudioStudioPlayback();
    stopGalleryAudio();
    stopScriptDirectorPreview();

    const audio = new Audio(url);
    globalAudioPlayer = audio;
    currentPlayingBtn = playBtn;
    currentPlayingBar = eqBars;

    playBtn.innerHTML = SVG.PAUSE;
    playBtn.classList.add('is-playing');
    if (eqBars) eqBars.style.display = 'inline-flex';

    const stopIfCurrent = () => { if (globalAudioPlayer === audio) stopAudioStudioPlayback(); };
    audio.onended = stopIfCurrent;
    audio.onerror = stopIfCurrent;
    audio.play().catch(stopIfCurrent);
}

function copySyntax(tag, btn, label) {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(tag).then(() => {
        setIconLabel(btn, SVG.CHECK, t('audioCopied'));
        btn.classList.add('is-copied');
        setTimeout(() => {
            setIconLabel(btn, SVG.COPY, label);
            btn.classList.remove('is-copied');
        }, 1500);
    }).catch(() => {});
}

function getEmotionStyle(emotion) {
    const raw = String(emotion || '').toLowerCase();
    if (raw.includes('happy') || raw.includes('joy')) {
        return { color: 'var(--amb-warn)', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.3)' };
    }
    if (raw.includes('sad') || raw.includes('cry')) {
        return { color: 'var(--amb-lt-blue, #60a5fa)', bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.3)' };
    }
    if (raw.includes('surpris') || raw.includes('shock')) {
        return { color: 'var(--amb-lt-pink, #f472b6)', bg: 'rgba(244, 114, 182, 0.12)', border: 'rgba(244, 114, 182, 0.3)' };
    }
    if (raw.includes('normal') || raw.includes('calm')) {
        return { color: 'var(--amb-ok)', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.3)' };
    }
    return { color: 'var(--amb-lt-violet, #a78bfa)', bg: 'rgba(167, 139, 250, 0.12)', border: 'rgba(167, 139, 250, 0.3)' };
}

function renderEqIndicator() {
    const barWrap = document.createElement('span');
    barWrap.className = 'anomalous-audio-eq-bars';
    barWrap.style.display = 'none';
    for (const index of [1, 2, 3]) {
        const bar = document.createElement('span');
        bar.className = `anomalous-eq-bar anomalous-eq-bar-${index}`;
        barWrap.appendChild(bar);
    }
    return barWrap;
}

function gripIcon() {
    const grip = document.createElement('span');
    grip.className = 'anomalous-voice-grip';
    grip.innerHTML = SVG.GRIP;
    return grip;
}

/** One reference clip of a character; `withTag`: the character has emotions, so its tags are worth copying. */
function renderSliceRow(slice, withTag) {
    const row = document.createElement('div');
    row.className = 'anomalous-voice-slice-row';
    row.dataset.sliceId = slice.id; // the sidebar plays a clip through its row
    row.title = slice.relative_path || '';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'anomalous-audio-play-btn';
    playBtn.innerHTML = SVG.PLAY;
    playBtn.title = t('audioPlay');

    const eqBars = renderEqIndicator();
    const emoStyle = getEmotionStyle(slice.emotion);

    const emoTag = document.createElement('span');
    emoTag.className = 'anomalous-voice-emotion-tag';
    emoTag.textContent = String(slice.emotion || '').toUpperCase();
    emoTag.style.color = emoStyle.color;
    emoTag.style.background = emoStyle.bg;
    emoTag.style.border = `1px solid ${emoStyle.border}`;

    const textSpan = document.createElement('div');
    textSpan.className = 'anomalous-voice-slice-text';
    textSpan.textContent = slice.text ? `“${slice.text}”` : slice.filename;
    textSpan.title = slice.synthesis_text && slice.synthesis_text !== slice.text
        ? `${slice.text}\n${slice.synthesis_text}`
        : (slice.text || slice.filename);

    playBtn.onclick = (e) => {
        e.stopPropagation();
        playAudio(slice.audio_url, playBtn, eqBars);
    };

    row.append(playBtn, eqBars, emoTag, textSpan);
    if (!withTag) return row; // only a main voice: speech text needs no tag

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'anomalous-voice-copy-btn';
    copyBtn.title = slice.is_main ? t('audioCopyMainHint') : t('audioCopyEmotionHint', { emotion: slice.emotion });
    const label = t('audioCopyTagLabel', { tag: slice.syntax_tag });
    setIconLabel(copyBtn, SVG.COPY, label);

    copyBtn.onclick = (e) => {
        e.stopPropagation();
        copySyntax(slice.syntax_tag, copyBtn, label);
    };
    row.append(copyBtn);
    return row;
}

function renderCharacterCard(group, owner, { onChanged, canImport = false } = {}) {
    const card = document.createElement('div');
    card.className = 'anomalous-character-voice-card';
    if (canImport && !group.error) card.dataset.ttsCharacter = group.character; // file drop target

    const header = document.createElement('div');
    header.className = 'anomalous-character-voice-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'anomalous-character-voice-title';

    const avatar = document.createElement('div');
    avatar.className = 'anomalous-character-voice-avatar';
    avatar.innerHTML = SVG.MIC;

    const nameBox = document.createElement('div');
    nameBox.className = 'anomalous-character-voice-names';

    const name = document.createElement('span');
    name.className = 'anomalous-character-voice-name';
    // GPT-SoVITS versions are named "角色/日配"; show the version as a quiet suffix.
    const cut = group.character.lastIndexOf('/');
    name.textContent = cut > 0 ? group.character.slice(0, cut) : group.character;
    if (cut > 0) {
        const version = document.createElement('span');
        version.className = 'anomalous-character-voice-folder';
        version.textContent = group.character.slice(cut + 1);
        name.append(' ', version);
    }
    name.title = group.character;

    const sub = document.createElement('span');
    sub.className = 'anomalous-character-voice-hint';
    sub.textContent = t('audioDragCardHint');
    sub.title = sub.textContent;

    nameBox.append(name, sub);

    const countBadge = document.createElement('span');
    countBadge.className = 'anomalous-character-voice-count';
    countBadge.textContent = t('audioVoiceClipCount', { count: group.total_slices });

    // Only a draggable header shows a grip; without a main voice there is nothing to drag.
    titleGroup.append(...(group.has_main ? [gripIcon()] : []), avatar, nameBox);
    const headerRight = document.createElement('div');
    headerRight.className = 'anomalous-character-voice-actions';
    if (group.has_main && owner?.openScript) {
        const voiceOver = createToolButton(SVG.SCRIPT, t('scriptDirectorUseCharacter'), 'is-compact is-accent');
        voiceOver.title = t('scriptDirectorUseCharacterHint', { character: group.character });
        voiceOver.onclick = () => owner.openScript(group.group);
        headerRight.append(voiceOver);
    }
    if (!group.raw.error) {
        const edit = createToolButton(SVG.EDIT, t('ttsEditorOpen'), 'is-compact');
        edit.onclick = () => openGptSovitsEditor(group, { onSaved: () => onChanged?.() });
        const pronounce = createToolButton(SVG.PRONOUNCE, t('ttsPronounceOpen'), 'is-compact');
        pronounce.onclick = () => openPronunciationEditor(group, { onSaved: () => onChanged?.() });
        headerRight.append(edit, pronounce);
        if (canImport) {
            const add = createToolButton(SVG.PLUS, t('ttsImportAddOpen'), 'is-compact');
            add.onclick = () => openTtsImport({ target: group.character, onDone: () => onChanged?.() });
            headerRight.append(add);
        }
    }
    headerRight.append(countBadge);
    header.append(titleGroup, headerRight);
    if (group.has_main) {
        header.classList.add('is-draggable');
        header.title = t('audioDragCharacterTitle', { character: group.character });
        bindVoiceDrag(header, group, owner);
    }
    card.appendChild(header);

    if (!group.has_main) {
        const warning = document.createElement('div');
        warning.className = 'anomalous-character-voice-warning';
        warning.textContent = group.error ? t('ttsCharacterError', { error: group.error }) : t('ttsMainMissing');
        card.appendChild(warning);
    }

    const sliceList = document.createElement('div');
    sliceList.className = 'anomalous-character-voice-slices';
    const withTags = group.slices.some(slice => !slice.is_main);
    group.slices.forEach(slice => sliceList.appendChild(renderSliceRow(slice, withTags)));

    card.appendChild(sliceList);
    return card;
}

// ---- Toolbar ----

function createToolButton(iconSvg, label, className = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `anomalous-audio-tool-btn ${className}`.trim();
    setIconLabel(btn, iconSvg, label);
    return btn;
}

function createRefreshButton(onRefresh) {
    const btn = createToolButton(SVG.REFRESH, t('audioRefresh'));
    btn.onclick = onRefresh;
    return btn;
}

function renderStudioToolbar({ onSearch, onRefresh, owner }) {
    const toolbar = document.createElement('div');
    toolbar.className = 'anomalous-audio-toolbar';

    const rightActions = document.createElement('div');
    rightActions.className = 'anomalous-audio-right-actions';

    const searchWrap = document.createElement('label');
    searchWrap.className = 'anomalous-audio-search';

    const searchIcon = document.createElement('span');
    searchIcon.innerHTML = SVG.SEARCH;

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = t('audioSearchCharacters');
    searchInput.oninput = (e) => onSearch(e.target.value.trim().toLowerCase());

    searchWrap.append(searchIcon, searchInput);
    rightActions.append(createRefreshButton(onRefresh), searchWrap);

    toolbar.append(renderVoiceTabs(owner, 'voices'), rightActions);
    return toolbar;
}

function renderStatus(className, message) {
    const box = document.createElement('div');
    box.className = className;
    box.textContent = message;
    return box;
}

/** Empty studio. With `onImport` it is the drop area with the import button. */
function renderEmptyGuide(onImport = null) {
    const emptyGuide = document.createElement('div');
    emptyGuide.className = `anomalous-audio-empty${onImport ? ' is-drop' : ''}`;
    const icon = document.createElement('div');
    icon.className = 'anomalous-audio-empty-icon';
    icon.innerHTML = SVG.MIC;
    const title = document.createElement('div');
    title.className = 'anomalous-audio-empty-title';
    title.textContent = t('ttsEmptyTitle');
    const desc = document.createElement('div');
    desc.className = 'anomalous-audio-empty-desc';
    desc.textContent = t('ttsEmptyDesc');
    emptyGuide.append(icon, title, desc);
    if (onImport) {
        const importBtn = document.createElement('button');
        importBtn.type = 'button';
        importBtn.className = 'anomalous-voice-modal-submit anomalous-audio-empty-action';
        importBtn.textContent = t('ttsImportOpen');
        importBtn.onclick = () => onImport();
        emptyGuide.append(importBtn);
    }
    return emptyGuide;
}

function resolveFilter(filter) {
    const active = filter || getActiveAudioFilter();
    return active?.type === 'group' && active.value ? active : null;
}

/** Shown instead of the cards (and the Voice-over page) when the Anomalous_TTS node pack is missing. */
export function renderInstallCard() {
    const card = document.createElement('div');
    card.className = 'anomalous-audio-install-card';
    const title = document.createElement('div');
    title.className = 'anomalous-audio-install-title';
    title.textContent = t('audioEngineInstallTitle', { engine: TTS_ENGINE.label, pack: TTS_ENGINE.pack });
    const desc = document.createElement('div');
    desc.className = 'anomalous-audio-install-desc';
    desc.textContent = t('audioEngineDesc');
    const how = document.createElement('div');
    how.className = 'anomalous-audio-install-how';
    how.textContent = t('audioEngineInstallHow', { search: TTS_ENGINE.managerSearch });
    const link = document.createElement('a');
    link.className = 'anomalous-audio-install-link';
    link.href = TTS_ENGINE.repoUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = t('audioEngineOpenRepo');
    card.append(title, desc, how, link);
    return card;
}

/**
 * Render the studio into `container`. Only the latest call for a container may
 * write to it, so fast filter clicks cannot stack duplicate content.
 * `owner` is the browser instance (its modal hides while dragging to the canvas).
 */
export async function renderAudioStudio(container, { filter = null, owner = null } = {}) {
    const token = {};
    renderTokens.set(container, token);
    stopAudioStudioPlayback();

    const installed = await isTtsInstalled();
    if (renderTokens.get(container) !== token) return;
    const rerender = () => renderAudioStudio(container, { filter, owner });

    const characterFilter = resolveFilter(filter);
    const studioWrapper = document.createElement('div');
    studioWrapper.className = 'anomalous-audio-studio-wrapper';

    const grid = document.createElement('div');
    grid.className = 'anomalous-voice-card-grid';

    const toolbar = renderStudioToolbar({
        onSearch: (searchTerm) => {
            grid.querySelectorAll('.anomalous-character-voice-card').forEach(card => {
                card.style.display = card.textContent.toLowerCase().includes(searchTerm) ? '' : 'none';
            });
        },
        onRefresh: () => { invalidateEngineCache({ rescan: true }); rerender(); if (owner) renderAudioSidebar(owner); },
        owner,
    });
    studioWrapper.append(toolbar, renderStatus('anomalous-audio-status', t('audioLoading')));
    container.replaceChildren(studioWrapper);

    if (!installed) {
        studioWrapper.lastChild.replaceWith(renderInstallCard());
        return;
    }
    // The setup status only exists for nodes with interface v3 (null otherwise).
    const [result, ttsStatus] = await Promise.all([loadVoices(), loadGptSovitsStatus().catch(() => null)]);
    if (renderTokens.get(container) !== token) return;
    if (result.error) {
        studioWrapper.lastChild.replaceWith(renderStatus('anomalous-audio-status is-error', t('audioLoadFailed', { error: result.error })));
        return;
    }
    let characters = result.groups;

    const onChanged = () => { rerender(); if (owner) renderAudioSidebar(owner); };
    const canImport = Boolean(ttsStatus) && ttsStatus.local !== false;
    let onImport = null;
    if (ttsStatus) {
        // After an import, redraw and point at the character so the next step (drag it) is obvious.
        const onDone = (character) => {
            if (owner) renderAudioSidebar(owner);
            rerender().then(() => {
                const card = [...container.querySelectorAll('[data-tts-character]')].find(c => c.dataset.ttsCharacter === character?.name);
                card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                card?.classList.add('is-just-added');
            });
        };
        onImport = (options = {}) => openTtsImport({ ...options, onDone });
        // Settings (storage, pretrained files, packages) live behind the sidebar's footer entry.
        const importBtn = createToolButton(SVG.PLUS, t('ttsImportOpenShort'));
        importBtn.dataset.tour = 'audio-import';
        importBtn.onclick = () => onImport();
        importBtn.disabled = !canImport;
        if (!canImport) importBtn.title = t('ttsSetupRemote');
        toolbar.querySelector('.anomalous-audio-right-actions')?.prepend(importBtn);
        if (canImport) bindTtsFileDrop(studioWrapper, (files, target) => onImport({ files, target }));
    }

    if (characterFilter) {
        characters = characters.filter(group => group.group === characterFilter.value);
    }

    if (characters.length === 0) {
        studioWrapper.lastChild.replaceWith(renderEmptyGuide(canImport ? onImport : null));
        return;
    }
    characters.forEach(group => grid.appendChild(renderCharacterCard(group, owner, { onChanged, canImport })));
    studioWrapper.lastChild.replaceWith(grid);
}
