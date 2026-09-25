import { app } from '../../../scripts/app.js';
import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { stopGalleryAudio } from './ui_audio_gallery.js';
import { openAudioUploaderModal } from './ui_audio_uploader.js';
import { getActiveAudioFilter, renderAudioSidebar, setActiveAudioFilter } from './ui_audio_sidebar.js';
import { AUDIO_NODE_TARGETS, alignedVoiceValue, planVoiceDrop } from './audio_node_targets.js';
import { AUDIO_ENGINES, detectEngines, engineById, engineTargetLabels, getStoredEngine, invalidateEngineCache, loadEngine, loadGptSovitsStatus, pickEngine, setStoredEngine } from './audio_engines.js';
import { openGptSovitsEditor } from './ui_audio_tts_editor.js';
import { renderTtsSetup } from './ui_tts_setup.js';
import { bindTtsFileDrop, openTtsImport } from './ui_tts_import.js';
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
 * Audio & Voice Studio workspace: engine switch (F5-TTS / GPT-SoVITS, detected at
 * runtime), character voice cards, preview playback, tag copying, canvas drop into
 * TTS nodes, and toolbar entry points.
 */

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
    GRIP: `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="11" r="1.2"/><circle cx="7" cy="11" r="1.2"/></svg>`,
    CHECK: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    SEARCH: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    SCRIPT: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`,
    PLUS: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    EDIT: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    REFRESH: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>`,
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

function itemEngine(item) {
    return (item.kind === 'character' ? item.group?.engine : item.slice?.engine) || 'f5';
}

function engineLabel(id) {
    return engineById(id)?.label || id;
}

function itemLabel(item) {
    if (item.kind === 'character') return item.group.character;
    return `${item.slice.character} · ${String(item.slice.emotion || '').toUpperCase()}`;
}

/** What the drop will do, shown while hovering an accepted node. */
function dropTargetHint(node, item) {
    const plan = planVoiceDrop(node, item);
    if (!plan.ok) return '';
    return item.kind === 'character'
        ? t('audioDropCharacterTarget', { node: plan.target.label, character: item.group.character })
        : t('audioDropClipTarget', { node: plan.target.label, clip: itemLabel(item) });
}

/** Why a hovered node is refused; every refusal names what to do instead. */
function dropRejectHint(node, item) {
    const plan = planVoiceDrop(node, item);
    if (plan.ok) return '';
    const params = {
        node: plan.target?.label || '',
        supported: AUDIO_NODE_TARGETS.filter(target => target.engine === itemEngine(item)).map(target => target.label).join(t('audioListSeparator')),
        voiceEngine: engineLabel(itemEngine(item)),
        character: item.kind === 'character' ? item.group.character : item.slice.character,
        emotion: item.kind === 'clip' && !item.slice.is_main ? `{${item.slice.emotion}}` : t('audioEmotionTagExample'),
        file: plan.path || '',
    };
    return t(`audioDropReject_${plan.reason}`, params);
}

/**
 * Drag a character (card header) or one clip (row) onto a canvas node. Which one a node
 * takes is decided by audio_node_targets.js; unlisted nodes are refused, never guessed.
 */
function bindVoiceDrag(element, item, owner) {
    bindMaterialDrag(element, owner || {}, {
        payload: () => ({
            ...item,
            dragHint: item.kind === 'character'
                ? t('audioDragCharacterHint', { character: item.group.character, node: engineLabel(itemEngine(item)) })
                : t('audioDragClipHint', { clip: itemLabel(item) }),
        }),
        accepts: node => planVoiceDrop(node, item).ok,
        targetHint: node => dropTargetHint(node, item),
        rejectHint: node => dropRejectHint(node, item),
        drop: async node => {
            const plan = planVoiceDrop(node, item);
            if (!plan.ok) return;
            plan.widget.value = plan.value;
            plan.widget.callback?.(plan.value, app.canvas, node);
            node.setDirtyCanvas?.(true, true);
        },
    });
}

function gripIcon() {
    const grip = document.createElement('span');
    grip.className = 'anomalous-voice-grip';
    grip.innerHTML = SVG.GRIP;
    return grip;
}

/** One clip. Only F5-TTS library clips (input folder) can be dragged, onto Load Audio. */
function renderSliceRow(slice, owner) {
    const row = document.createElement('div');
    row.className = 'anomalous-voice-slice-row';
    const draggable = (slice.engine || 'f5') === 'f5';
    row.classList.toggle('is-static', !draggable);
    if (draggable) {
        row.title = t('audioDragClipTitle');
        bindVoiceDrag(row, { kind: 'clip', slice }, owner);
    } else {
        row.title = slice.relative_path || '';
    }

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

    row.append(...(draggable ? [gripIcon()] : []), playBtn, eqBars, emoTag, textSpan, copyBtn);
    return row;
}

function renderCharacterCard(group, owner, { onChanged, canImport = false } = {}) {
    const isTts = group.engine === 'gpt_sovits';
    const card = document.createElement('div');
    card.className = 'anomalous-character-voice-card';
    if (isTts && canImport && !group.error) card.dataset.ttsCharacter = group.character; // file drop target

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
    const cut = isTts ? group.character.lastIndexOf('/') : -1;
    name.textContent = cut > 0 ? group.character.slice(0, cut) : group.character;
    const suffix = cut > 0 ? group.character.slice(cut + 1) : (!isTts && group.folder !== 'F5-TTS' ? group.folder : '');
    if (suffix) {
        const folder = document.createElement('span');
        folder.className = 'anomalous-character-voice-folder';
        folder.textContent = suffix;
        name.append(' ', folder);
    }
    name.title = group.character;

    const sub = document.createElement('span');
    sub.className = 'anomalous-character-voice-hint';
    sub.textContent = t(isTts ? 'audioDragCardHintGptSovits' : 'audioDragCardHint');
    sub.title = sub.textContent;

    nameBox.append(name, sub);

    const countBadge = document.createElement('span');
    countBadge.className = 'anomalous-character-voice-count';
    countBadge.textContent = `${group.total_slices} ${t('audioVoicePresets')}`;

    // Only a draggable header shows a grip; without a main voice there is nothing to drag.
    titleGroup.append(...(group.has_main ? [gripIcon()] : []), avatar, nameBox);
    const headerRight = document.createElement('div');
    headerRight.className = 'anomalous-character-voice-actions';
    if (isTts && group.raw && !group.raw.error) {
        const edit = createToolButton(SVG.EDIT, t('ttsEditorOpen'), 'is-compact');
        edit.onclick = () => openGptSovitsEditor(group, { onSaved: () => onChanged?.() });
        headerRight.append(edit);
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
        header.title = t(isTts ? 'audioDragCharacterTitleGptSovits' : 'audioDragCharacterTitle', { character: group.character });
        bindVoiceDrag(header, { kind: 'character', group }, owner);
    }
    card.appendChild(header);

    if (!group.has_main) {
        const warning = document.createElement('div');
        warning.className = 'anomalous-character-voice-warning';
        warning.textContent = isTts
            ? (group.error ? t('ttsCharacterError', { error: group.error }) : t('ttsMainMissing'))
            : t('audioMainMissing', { file: `${group.character}.wav` });
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
        const aligned = alignedVoiceValue(node);
        if (aligned) aligned.widget.value = aligned.value;
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

function createRefreshButton(onRefresh) {
    const btn = createToolButton(SVG.REFRESH, t('audioRefresh'));
    btn.onclick = onRefresh;
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

function renderStudioToolbar({ engine, onSearch, onVoiceAdded, onRefresh, container, owner, defaultCharacter }) {
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
    // F5-TTS voices are files Anomalous manages; GPT-SoVITS characters are model folders the node scans.
    const engineActions = engine === 'f5'
        ? [createAddVoiceButton(onVoiceAdded, defaultCharacter), createLoadWorkflowButton()]
        : [createRefreshButton(onRefresh)];
    rightActions.append(createScriptDirectorButton(container, owner), ...engineActions, searchWrap);

    toolbar.append(titleGroup, rightActions);
    return toolbar;
}

function renderStatus(className, message) {
    const box = document.createElement('div');
    box.className = className;
    box.textContent = message;
    return box;
}

function renderEmptyGuide(engine = 'f5') {
    const emptyGuide = document.createElement('div');
    emptyGuide.className = 'anomalous-audio-empty';
    const icon = document.createElement('div');
    icon.className = 'anomalous-audio-empty-icon';
    icon.innerHTML = SVG.MIC;
    const title = document.createElement('div');
    title.className = 'anomalous-audio-empty-title';
    title.textContent = t(engine === 'f5' ? 'audioEmptyTitle' : 'ttsEmptyTitle');
    const desc = document.createElement('div');
    desc.className = 'anomalous-audio-empty-desc';
    desc.textContent = t(engine === 'f5' ? 'audioEmptyDesc' : 'ttsEmptyDesc');
    emptyGuide.append(icon, title, desc);
    return emptyGuide;
}

function resolveFilter(filter) {
    const active = filter || getActiveAudioFilter();
    return active?.type === 'group' && active.value ? active : null;
}

/** Engine switch: every engine is listed; missing ones stay visible, marked "not installed". */
function renderEngineBar(activeId, statuses, onPick) {
    const bar = document.createElement('div');
    bar.className = 'anomalous-audio-engine-bar';
    const tabs = document.createElement('div');
    tabs.className = 'anomalous-audio-engine-tabs';
    tabs.setAttribute('role', 'tablist');
    for (const engine of AUDIO_ENGINES) {
        const installed = Boolean(statuses[engine.id]?.installed);
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'anomalous-audio-engine-tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(engine.id === activeId));
        tab.classList.toggle('active', engine.id === activeId);
        tab.classList.toggle('is-missing', !installed);
        tab.dataset.engine = engine.id;
        const label = document.createElement('span');
        label.textContent = engine.label;
        tab.append(label);
        if (!installed) {
            const badge = document.createElement('span');
            badge.className = 'anomalous-audio-engine-badge';
            badge.textContent = t('audioEngineMissing');
            tab.append(badge);
        }
        tab.onclick = () => { if (engine.id !== activeId) onPick(engine.id); };
        tabs.append(tab);
    }
    const targets = document.createElement('div');
    targets.className = 'anomalous-audio-engine-targets';
    targets.textContent = t('audioEngineWorksWith', { nodes: engineTargetLabels(activeId).join(' / ') });
    bar.append(tabs, targets);
    return bar;
}

/** Shown instead of (GPT-SoVITS) or above (F5-TTS library) the cards when the engine's node pack is missing. */
function renderInstallCard(engine, { compact = false } = {}) {
    const card = document.createElement('div');
    card.className = `anomalous-audio-install-card${compact ? ' is-compact' : ''}`;
    const title = document.createElement('div');
    title.className = 'anomalous-audio-install-title';
    title.textContent = t('audioEngineInstallTitle', { engine: engine.label, pack: engine.pack });
    const desc = document.createElement('div');
    desc.className = 'anomalous-audio-install-desc';
    desc.textContent = compact ? t('audioEngineLibraryOnly', { engine: engine.label }) : t(engine.descKey);
    const how = document.createElement('div');
    how.className = 'anomalous-audio-install-how';
    how.textContent = engine.repoUrl
        ? t('audioEngineInstallHow', { search: engine.managerSearch })
        : t('audioEngineNotPublished', { pack: engine.pack });
    card.append(title, desc, how);
    if (engine.repoUrl) {
        const link = document.createElement('a');
        link.className = 'anomalous-audio-install-link';
        link.href = engine.repoUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = t('audioEngineOpenRepo');
        card.append(link);
    }
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
    const directorWasOpen = isScriptDirectorActive();
    stopAudioStudioPlayback();

    const statuses = await detectEngines();
    if (renderTokens.get(container) !== token) return;
    const engineId = pickEngine(statuses);
    if (!getStoredEngine()) setStoredEngine(engineId);
    const engine = engineById(engineId);
    const rerender = () => renderAudioStudio(container, { filter, owner });

    const characterFilter = resolveFilter(filter);
    const studioWrapper = document.createElement('div');
    studioWrapper.className = 'anomalous-audio-studio-wrapper';
    studioWrapper.dataset.engine = engineId;

    const grid = document.createElement('div');
    grid.className = 'anomalous-voice-card-grid';

    const toolbar = renderStudioToolbar({
        engine: engineId,
        onSearch: (searchTerm) => {
            grid.querySelectorAll('.anomalous-character-voice-card').forEach(card => {
                card.style.display = card.textContent.toLowerCase().includes(searchTerm) ? '' : 'none';
            });
        },
        onVoiceAdded: () => { invalidateEngineCache(); rerender(); },
        onRefresh: () => { invalidateEngineCache({ rescan: true }); rerender(); if (owner) renderAudioSidebar(owner); },
        container,
        owner,
        defaultCharacter: characterFilter?.character || '',
    });
    const engineBar = renderEngineBar(engineId, statuses, (next) => {
        setStoredEngine(next);
        setActiveAudioFilter(null);
        if (owner) renderAudioSidebar(owner);
        renderAudioStudio(container, { owner });
    });
    studioWrapper.append(toolbar, engineBar, renderStatus('anomalous-audio-status', t('audioLoading')));
    container.replaceChildren(studioWrapper);
    if (directorWasOpen) openScriptDirector(container);

    const installed = Boolean(statuses[engineId]?.installed);
    if (!installed && engineId !== 'f5') {
        updateScriptDirectorVoices([], null, engineId);
        studioWrapper.lastChild.replaceWith(renderInstallCard(engine));
        return;
    }
    // The setup status only exists for GPT-SoVITS nodes with interface v3 (null otherwise).
    const statusRequest = engineId === 'gpt_sovits' ? loadGptSovitsStatus().catch(() => null) : null;
    const [result, ttsStatus] = await Promise.all([loadEngine(engineId), statusRequest]);
    if (renderTokens.get(container) !== token) return;
    if (result.error) {
        studioWrapper.lastChild.replaceWith(renderStatus('anomalous-audio-status is-error', t('audioLoadFailed', { error: result.error })));
        return;
    }
    let characters = result.groups;
    updateScriptDirectorVoices(characters, characterFilter?.value || null, engineId);
    if (!installed) studioWrapper.insertBefore(renderInstallCard(engine, { compact: true }), studioWrapper.lastChild);

    const onChanged = () => { rerender(); if (owner) renderAudioSidebar(owner); };
    const canImport = Boolean(ttsStatus) && ttsStatus.local !== false;
    if (ttsStatus) {
        const onImport = (options = {}) => openTtsImport({ ...options, onDone: onChanged });
        studioWrapper.insertBefore(renderTtsSetup(ttsStatus, { onChanged, onImport: () => onImport() }), studioWrapper.lastChild);
        if (canImport) bindTtsFileDrop(studioWrapper, (files, target) => onImport({ files, target }));
    }

    if (characterFilter) {
        characters = characters.filter(group => group.group === characterFilter.value);
    }

    if (characters.length === 0) {
        studioWrapper.lastChild.replaceWith(renderEmptyGuide(engineId));
        return;
    }
    characters.forEach(group => grid.appendChild(renderCharacterCard(group, owner, { onChanged, canImport })));
    studioWrapper.lastChild.replaceWith(grid);
}
