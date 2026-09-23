import { app } from '../../../scripts/app.js';
import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { stopGalleryAudio } from './ui_audio_gallery.js';
import { openAudioUploaderModal } from './ui_audio_uploader.js';
import { getActiveAudioFilter } from './ui_audio_sidebar.js';
import { comboValueForPath } from './audio_script.js';
import { bindMaterialDrag } from './material_drag.js';
import {
    openScriptDirector,
    closeScriptDirector,
    isScriptDirectorActive,
    setScriptDirectorHooks,
    stopScriptDirectorPreview,
    updateScriptDirectorVoices,
} from './ui_script_director.js';

/**
 * Audio & Voice Studio workspace: character voice cards, preview playback,
 * tag copying, canvas drop into TTS nodes, and toolbar entry points.
 */

const AUDIO_WIDGET_NAMES = ['sample', 'audio', 'prompt_audio'];
const WORKFLOW_TEMPLATE = 'arona';
const renderTokens = new WeakMap();

let globalAudioPlayer = null;
let currentPlayingBtn = null;
let currentPlayingBar = null;

const SVG = {
    PLAY: `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    PAUSE: `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
    MIC: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
    COPY: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
    CHECK: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    SEARCH: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    SCRIPT: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`,
    PLUS: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    WORKFLOW: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
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

function copySyntax(tag, btn) {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(tag).then(() => {
        setIconLabel(btn, SVG.CHECK, t('audioCopied'));
        btn.classList.add('is-copied');
        setTimeout(() => {
            setIconLabel(btn, SVG.COPY, tag);
            btn.classList.remove('is-copied');
        }, 1500);
    }).catch(() => {});
}

function getEmotionStyle(emotion) {
    const raw = String(emotion || '').toLowerCase();
    if (raw.includes('happy') || raw.includes('joy')) {
        return { color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.3)' };
    }
    if (raw.includes('sad') || raw.includes('cry')) {
        return { color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.3)' };
    }
    if (raw.includes('surpris') || raw.includes('shock')) {
        return { color: '#f472b6', bg: 'rgba(244, 114, 182, 0.12)', border: 'rgba(244, 114, 182, 0.3)' };
    }
    if (raw.includes('normal') || raw.includes('calm')) {
        return { color: '#34d399', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.3)' };
    }
    return { color: '#a78bfa', bg: 'rgba(167, 139, 250, 0.12)', border: 'rgba(167, 139, 250, 0.3)' };
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

function audioWidgetFor(node, slice) {
    const widget = node?.widgets?.find(w => AUDIO_WIDGET_NAMES.includes(w.name));
    const value = widget ? comboValueForPath(widget, slice.relative_path) : null;
    return value == null ? null : { widget, value };
}

/** Drag a voice onto a TTS node to use it as the node's sample (shared material drag: the modal hides meanwhile). */
function bindVoiceDrag(row, slice, owner) {
    bindMaterialDrag(row, owner || {}, {
        payload: () => ({ slice, dragHint: t('audioDragHint') }),
        accepts: node => Boolean(audioWidgetFor(node, slice)),
        drop: async node => {
            const target = audioWidgetFor(node, slice);
            if (!target) return;
            target.widget.value = target.value;
            target.widget.callback?.(target.value, app.canvas, node);
            node.setDirtyCanvas?.(true, true);
        },
    });
}

function renderSliceRow(slice, owner) {
    const row = document.createElement('div');
    row.className = 'anomalous-voice-slice-row';
    bindVoiceDrag(row, slice, owner);

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

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'anomalous-voice-copy-btn';
    copyBtn.title = slice.tag_usable ? t('audioCopyTag') : t('audioTagUnusable');
    copyBtn.classList.toggle('is-unusable', !slice.tag_usable);
    setIconLabel(copyBtn, SVG.COPY, slice.syntax_tag);

    copyBtn.onclick = (e) => {
        e.stopPropagation();
        copySyntax(slice.syntax_tag, copyBtn);
    };

    playBtn.onclick = (e) => {
        e.stopPropagation();
        playAudio(slice.audio_url, playBtn, eqBars);
    };

    row.append(playBtn, eqBars, emoTag, textSpan, copyBtn);
    return row;
}

function renderCharacterCard(group, owner) {
    const card = document.createElement('div');
    card.className = 'anomalous-character-voice-card';

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
    name.textContent = group.character;
    if (group.folder && group.folder !== 'F5-TTS') {
        const folder = document.createElement('span');
        folder.className = 'anomalous-character-voice-folder';
        folder.textContent = group.folder;
        name.append(' ', folder);
    }

    const sub = document.createElement('span');
    sub.className = 'anomalous-character-voice-hint';
    sub.textContent = t('audioDragHint');

    nameBox.append(name, sub);

    const countBadge = document.createElement('span');
    countBadge.className = 'anomalous-character-voice-count';
    countBadge.textContent = `${group.total_slices} ${t('audioVoicePresets')}`;

    titleGroup.append(avatar, nameBox);
    header.append(titleGroup, countBadge);
    card.appendChild(header);

    if (!group.has_main) {
        const warning = document.createElement('div');
        warning.className = 'anomalous-character-voice-warning';
        warning.textContent = t('audioMainMissing', { file: `${group.character}.wav` });
        card.appendChild(warning);
    }

    const sliceList = document.createElement('div');
    sliceList.className = 'anomalous-character-voice-slices';
    group.slices.forEach(slice => sliceList.appendChild(renderSliceRow(slice, owner)));

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

/** Templates store "F5-TTS/x.wav"; Windows combos list "F5-TTS\\x.wav". Adopt the node's own spelling. */
function alignLoadedAudioSamples() {
    for (const node of app.graph?._nodes || []) {
        for (const widget of node.widgets || []) {
            if (!AUDIO_WIDGET_NAMES.includes(widget.name) || typeof widget.value !== 'string') continue;
            const value = comboValueForPath(widget, widget.value);
            if (value != null && value !== widget.value) widget.value = value;
        }
    }
    app.graph?.setDirtyCanvas?.(true, true);
}

function createLoadWorkflowButton() {
    const btn = createToolButton(SVG.WORKFLOW, t('audioLoadAronaWorkflow'));
    btn.onclick = async () => {
        if (btn.disabled) return;
        if (!await anomalousConfirm(t('audioWorkflowConfirm'))) return;
        btn.disabled = true;
        try {
            const resp = await fetch(`/anomalous/audio_template_workflow?name=${WORKFLOW_TEMPLATE}`);
            const data = await resp.json().catch(() => ({}));
            if (resp.status === 404 && data.code === 'template_missing') {
                await anomalousAlert(t('audioWorkflowMissing', { file: `${WORKFLOW_TEMPLATE}_multivoice_workflow.json` }));
                return;
            }
            if (!resp.ok || !data.workflow) throw new Error(data.error || `HTTP ${resp.status}`);
            await app.loadGraphData(data.workflow);
            alignLoadedAudioSamples();
            setIconLabel(btn, SVG.CHECK, t('audioWorkflowLoaded'));
            setTimeout(() => setIconLabel(btn, SVG.WORKFLOW, t('audioLoadAronaWorkflow')), 2000);
        } catch (e) {
            await anomalousAlert(t('audioWorkflowFailed', { error: e.message }));
        } finally {
            btn.disabled = false;
        }
    };
    return btn;
}

function createAddVoiceButton(onVoiceAdded, defaultCharacter) {
    const btn = createToolButton(SVG.PLUS, t('audioAddVoice'));
    btn.onclick = () => openAudioUploaderModal({ defaultCharacter, onSaved: onVoiceAdded });
    return btn;
}

function createScriptDirectorButton(container, owner) {
    const btn = createToolButton(SVG.SCRIPT, t('scriptDirectorOpen'));
    btn.classList.toggle('active', isScriptDirectorActive());
    setScriptDirectorHooks({
        owner,
        onStateChange: open => btn.classList.toggle('active', open),
        onPreviewStart: () => {
            stopAudioStudioPlayback();
            stopGalleryAudio();
        },
    });
    btn.onclick = () => {
        if (isScriptDirectorActive()) closeScriptDirector();
        else openScriptDirector(container);
    };
    return btn;
}

function renderStudioToolbar({ onSearch, onVoiceAdded, container, owner, defaultCharacter }) {
    const toolbar = document.createElement('div');
    toolbar.className = 'anomalous-audio-toolbar';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'anomalous-audio-title-group';

    const iconBox = document.createElement('div');
    iconBox.className = 'anomalous-audio-icon-box';
    iconBox.innerHTML = SVG.MIC;

    const textGroup = document.createElement('div');
    textGroup.className = 'anomalous-audio-title-stack';

    const title = document.createElement('span');
    title.className = 'anomalous-audio-title-text';
    title.textContent = t('audioStudioTitle');

    const desc = document.createElement('span');
    desc.className = 'anomalous-audio-sub-text';
    desc.textContent = t('audioStudioSubtitle');

    textGroup.append(title, desc);
    titleGroup.append(iconBox, textGroup);

    const rightActions = document.createElement('div');
    rightActions.className = 'anomalous-audio-right-actions';

    const searchWrap = document.createElement('label');
    searchWrap.className = 'anomalous-audio-search';

    const searchIcon = document.createElement('span');
    searchIcon.innerHTML = SVG.SEARCH;

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = t('audioVoicePresets');
    searchInput.oninput = (e) => onSearch(e.target.value.trim().toLowerCase());

    searchWrap.append(searchIcon, searchInput);
    rightActions.append(
        createScriptDirectorButton(container, owner),
        createAddVoiceButton(onVoiceAdded, defaultCharacter),
        createLoadWorkflowButton(),
        searchWrap,
    );

    toolbar.append(titleGroup, rightActions);
    return toolbar;
}

function renderStatus(className, message) {
    const box = document.createElement('div');
    box.className = className;
    box.textContent = message;
    return box;
}

function renderEmptyGuide() {
    const emptyGuide = document.createElement('div');
    emptyGuide.className = 'anomalous-audio-empty';
    const icon = document.createElement('div');
    icon.className = 'anomalous-audio-empty-icon';
    icon.innerHTML = SVG.MIC;
    const title = document.createElement('div');
    title.className = 'anomalous-audio-empty-title';
    title.textContent = t('audioEmptyTitle');
    const desc = document.createElement('div');
    desc.className = 'anomalous-audio-empty-desc';
    desc.textContent = t('audioEmptyDesc');
    emptyGuide.append(icon, title, desc);
    return emptyGuide;
}

function resolveFilter(filter) {
    const active = filter || getActiveAudioFilter();
    return active?.type === 'group' && active.value ? active : null;
}

/**
 * Render the studio into `container`. Only the latest call for a container may
 * write to it, so fast filter clicks cannot stack duplicate content.
 * `owner` is the browser instance (its modal hides while dragging to the canvas).
 */
export async function renderAudioStudio(container, { filter = null, owner = null } = {}) {
    const token = {};
    renderTokens.set(container, token);
    const directorWasOpen = isScriptDirectorActive();
    stopAudioStudioPlayback();

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
        onVoiceAdded: () => renderAudioStudio(container, { filter, owner }),
        container,
        owner,
        defaultCharacter: characterFilter?.character || '',
    });
    studioWrapper.append(toolbar, renderStatus('anomalous-audio-status', t('audioLoading')));
    container.replaceChildren(studioWrapper);
    if (directorWasOpen) openScriptDirector(container);

    let characters;
    try {
        const resp = await fetch('/anomalous/audio_voices');
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
        characters = data.characters || [];
    } catch (e) {
        if (renderTokens.get(container) !== token) return;
        studioWrapper.lastChild.replaceWith(renderStatus('anomalous-audio-status is-error', t('audioLoadFailed', { error: e.message })));
        return;
    }
    if (renderTokens.get(container) !== token) return;
    updateScriptDirectorVoices(characters, characterFilter?.value || null);

    if (characterFilter) {
        characters = characters.filter(group => group.group === characterFilter.value);
    }

    if (characters.length === 0) {
        studioWrapper.lastChild.replaceWith(renderEmptyGuide());
        return;
    }
    characters.forEach(group => grid.appendChild(renderCharacterCard(group, owner)));
    studioWrapper.lastChild.replaceWith(grid);
}
