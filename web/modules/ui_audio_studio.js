import { app } from '../../../scripts/app.js';
import { t } from './interface_settings.js';
import { stopGalleryAudio } from './ui_audio_gallery.js';
import { openAudioUploaderModal } from './ui_audio_uploader.js';

/**
 * Audio & Voice Studio Workspace
 * Professional, dark-themed DAW/Studio aesthetic for character voice presets.
 */

let globalAudioPlayer = null;
let currentPlayingBtn = null;
let currentPlayingBar = null;

const SVG = {
    PLAY: `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    PAUSE: `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
    MIC: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
    COPY: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
    CHECK: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    SEARCH: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`
};

export function stopAudioStudioPlayback() {
    if (globalAudioPlayer) {
        globalAudioPlayer.pause();
        globalAudioPlayer.currentTime = 0;
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
    if (typeof stopGalleryAudio === 'function') stopGalleryAudio();

    const freshUrl = url.includes('?') ? `${url}&_t=${Date.now()}` : `${url}?_t=${Date.now()}`;
    const audio = new Audio(freshUrl);
    globalAudioPlayer = audio;
    currentPlayingBtn = playBtn;
    currentPlayingBar = eqBars;

    playBtn.innerHTML = SVG.PAUSE;
    playBtn.classList.add('is-playing');
    if (eqBars) eqBars.style.display = 'inline-flex';

    audio.onended = () => stopAudioStudioPlayback();
    audio.onerror = () => stopAudioStudioPlayback();
    audio.play().catch(() => stopAudioStudioPlayback());
}

function copySyntax(tag, btn) {
    navigator.clipboard.writeText(tag).then(() => {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `${SVG.CHECK} <span>${t('audioCopied')}</span>`;
        btn.style.color = '#34d399';
        btn.style.borderColor = 'rgba(52, 211, 153, 0.4)';
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.style.color = '';
            btn.style.borderColor = '';
        }, 1500);
    });
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
    barWrap.style.alignItems = 'flex-end';
    barWrap.style.gap = '2px';
    barWrap.style.height = '14px';
    barWrap.style.marginRight = '2px';

    const b1 = document.createElement('span');
    b1.className = 'anomalous-eq-bar-1';
    b1.style.width = '2px';
    b1.style.background = '#38bdf8';
    b1.style.borderRadius = '1px';

    const b2 = document.createElement('span');
    b2.className = 'anomalous-eq-bar-2';
    b2.style.width = '2px';
    b2.style.background = '#818cf8';
    b2.style.borderRadius = '1px';

    const b3 = document.createElement('span');
    b3.className = 'anomalous-eq-bar-3';
    b3.style.width = '2px';
    b3.style.background = '#38bdf8';
    b3.style.borderRadius = '1px';

    barWrap.appendChild(b1);
    barWrap.appendChild(b2);
    barWrap.appendChild(b3);
    return barWrap;
}

function renderSliceRow(slice) {
    const row = document.createElement('div');
    row.className = 'anomalous-voice-slice-row';
    row.draggable = true;

    row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', slice.syntax_tag);
        e.dataTransfer.setData('application/json', JSON.stringify(slice));
        window.__anomalous_active_audio_slice = slice;
        setupCanvasAudioDrop();
    });
    row.addEventListener('dragend', () => {
        window.__anomalous_active_audio_slice = null;
    });

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'anomalous-audio-play-btn';
    playBtn.innerHTML = SVG.PLAY;
    playBtn.title = t('audioPlay');

    const eqBars = renderEqIndicator();
    const emoStyle = getEmotionStyle(slice.emotion);

    const emoTag = document.createElement('span');
    emoTag.textContent = slice.emotion.toUpperCase();
    emoTag.style.fontSize = '9px';
    emoTag.style.fontWeight = '700';
    emoTag.style.letterSpacing = '0.5px';
    emoTag.style.padding = '2px 6px';
    emoTag.style.borderRadius = '4px';
    emoTag.style.color = emoStyle.color;
    emoTag.style.background = emoStyle.bg;
    emoTag.style.border = `1px solid ${emoStyle.border}`;
    emoTag.style.flexShrink = '0';

    const textSpan = document.createElement('div');
    textSpan.style.flex = '1';
    textSpan.style.fontSize = '12px';
    textSpan.style.color = '#cbd5e1';
    textSpan.style.whiteSpace = 'nowrap';
    textSpan.style.overflow = 'hidden';
    textSpan.style.textOverflow = 'ellipsis';
    textSpan.textContent = slice.text ? `“${slice.text}”` : slice.filename;
    textSpan.title = slice.text || slice.filename;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.innerHTML = `${SVG.COPY} <span>${slice.syntax_tag}</span>`;
    copyBtn.title = t('audioCopyTag');
    copyBtn.style.display = 'inline-flex';
    copyBtn.style.alignItems = 'center';
    copyBtn.style.gap = '4px';
    copyBtn.style.padding = '2px 8px';
    copyBtn.style.borderRadius = '4px';
    copyBtn.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    copyBtn.style.background = 'rgba(0, 0, 0, 0.3)';
    copyBtn.style.color = '#94a3b8';
    copyBtn.style.fontSize = '11px';
    copyBtn.style.fontFamily = 'monospace';
    copyBtn.style.cursor = 'pointer';
    copyBtn.style.flexShrink = '0';
    copyBtn.style.transition = 'all 0.15s ease';

    copyBtn.onclick = (e) => {
        e.stopPropagation();
        copySyntax(slice.syntax_tag, copyBtn);
    };

    playBtn.onclick = (e) => {
        e.stopPropagation();
        playAudio(slice.audio_url, playBtn, eqBars);
    };

    row.appendChild(playBtn);
    row.appendChild(eqBars);
    row.appendChild(emoTag);
    row.appendChild(textSpan);
    row.appendChild(copyBtn);
    return row;
}

function renderCharacterCard(charData) {
    const card = document.createElement('div');
    card.className = 'anomalous-character-voice-card';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';

    const titleGroup = document.createElement('div');
    titleGroup.style.display = 'flex';
    titleGroup.style.alignItems = 'center';
    titleGroup.style.gap = '10px';

    const isArona = charData.character.toLowerCase() === 'arona';
    const avatar = document.createElement('div');
    avatar.style.width = '32px';
    avatar.style.height = '32px';
    avatar.style.borderRadius = '8px';
    avatar.style.background = isArona
        ? 'linear-gradient(135deg, rgba(14, 165, 233, 0.35), rgba(99, 102, 241, 0.35))'
        : 'rgba(255, 255, 255, 0.06)';
    avatar.style.border = isArona ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)';
    avatar.style.boxShadow = isArona ? '0 0 12px rgba(14, 165, 233, 0.25)' : 'none';
    avatar.style.display = 'flex';
    avatar.style.alignItems = 'center';
    avatar.style.justifyContent = 'center';
    avatar.style.color = isArona ? '#38bdf8' : '#94a3b8';
    avatar.innerHTML = SVG.MIC;

    const nameBox = document.createElement('div');
    nameBox.style.display = 'flex';
    nameBox.style.flexDirection = 'column';

    const name = document.createElement('span');
    name.style.fontSize = '14px';
    name.style.fontWeight = '600';
    name.style.color = '#f8fafc';
    name.textContent = charData.character;

    const sub = document.createElement('span');
    sub.style.fontSize = '11px';
    sub.style.color = '#64748b';
    sub.textContent = t('audioDragHint');

    nameBox.appendChild(name);
    nameBox.appendChild(sub);

    const countBadge = document.createElement('span');
    countBadge.style.fontSize = '11px';
    countBadge.style.padding = '3px 8px';
    countBadge.style.borderRadius = '12px';
    countBadge.style.background = 'rgba(255, 255, 255, 0.05)';
    countBadge.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    countBadge.style.color = '#94a3b8';
    countBadge.textContent = `${charData.total_slices} ${t('audioVoicePresets')}`;

    titleGroup.appendChild(avatar);
    titleGroup.appendChild(nameBox);
    header.appendChild(titleGroup);
    header.appendChild(countBadge);
    card.appendChild(header);

    const sliceList = document.createElement('div');
    sliceList.style.display = 'flex';
    sliceList.style.flexDirection = 'column';
    sliceList.style.gap = '6px';

    charData.slices.forEach(slice => {
        sliceList.appendChild(renderSliceRow(slice));
    });

    card.appendChild(sliceList);
    return card;
}

function setupCanvasAudioDrop() {
    if (window.__anomalous_canvas_audio_drop_bound) return;
    window.__anomalous_canvas_audio_drop_bound = true;

    window.addEventListener('drop', (e) => {
        const slice = window.__anomalous_active_audio_slice;
        if (!slice || !app?.graph || !app?.canvas) return;

        const surface = app.canvas.canvas;
        if (!surface) return;
        const rect = surface.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;

        let pos = null;
        if (app.canvas.convertEventToCanvasOffset) pos = app.canvas.convertEventToCanvasOffset(e);
        else if (app.canvas.adjustMouseEvent) { app.canvas.adjustMouseEvent(e); pos = [e.canvasX, e.canvasY]; }
        if (!pos) return;

        const node = app.graph.getNodeOnPos?.(pos[0], pos[1]);
        if (!node) return;

        const sampleWidget = node.widgets?.find(w => w.name === 'sample' || w.name === 'audio' || w.name === 'prompt_audio');
        if (sampleWidget) {
            sampleWidget.value = `F5-TTS/${slice.filename}`;
            node.setDirtyCanvas(true, true);
        }
    }, true);
}

function createLoadWorkflowButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'anomalous-audio-load-wf-btn';
    btn.innerHTML = `<span>⚡</span> <span>${t('audioLoadAronaWorkflow')}</span>`;
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '6px';
    btn.style.padding = '5px 12px';
    btn.style.borderRadius = '8px';
    btn.style.border = '1px solid rgba(129, 140, 248, 0.4)';
    btn.style.background = 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(56, 189, 248, 0.2))';
    btn.style.color = '#e0e7ff';
    btn.style.fontSize = '12px';
    btn.style.fontWeight = '500';
    btn.style.cursor = 'pointer';
    btn.style.transition = 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
    btn.style.boxShadow = '0 2px 10px rgba(99, 102, 241, 0.2)';

    btn.onmouseenter = () => {
        btn.style.background = 'linear-gradient(135deg, rgba(99, 102, 241, 0.4), rgba(56, 189, 248, 0.35))';
        btn.style.borderColor = 'rgba(129, 140, 248, 0.7)';
        btn.style.transform = 'translateY(-1px)';
    };
    btn.onmouseleave = () => {
        btn.style.background = 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(56, 189, 248, 0.2))';
        btn.style.borderColor = 'rgba(129, 140, 248, 0.4)';
        btn.style.transform = 'translateY(0)';
    };

    btn.onclick = async () => {
        try {
            btn.style.opacity = '0.6';
            const resp = await fetch('/anomalous/audio_template_workflow?name=arona');
            const data = await resp.json();
            if (data.workflow && app.loadGraphData) {
                await app.loadGraphData(data.workflow);
                btn.innerHTML = `<span>✅</span> <span>${t('audioWorkflowLoaded')}</span>`;
                setTimeout(() => {
                    btn.innerHTML = `<span>⚡</span> <span>${t('audioLoadAronaWorkflow')}</span>`;
                    btn.style.opacity = '1';
                }, 2000);
            }
        } catch (e) {
            console.error('Failed to load Arona workflow:', e);
            btn.style.opacity = '1';
        }
    };
    return btn;
}

function createAddVoiceButton(onVoiceAdded) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'anomalous-audio-add-voice-btn';
    btn.innerHTML = `<span>➕</span> <span>${t('audioAddVoice')}</span>`;
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '6px';
    btn.style.padding = '5px 12px';
    btn.style.borderRadius = '8px';
    btn.style.border = '1px solid rgba(52, 211, 153, 0.4)';
    btn.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(52, 211, 153, 0.15))';
    btn.style.color = '#a7f3d0';
    btn.style.fontSize = '12px';
    btn.style.fontWeight = '500';
    btn.style.cursor = 'pointer';
    btn.style.transition = 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
    btn.style.boxShadow = '0 2px 10px rgba(16, 185, 129, 0.15)';

    btn.onmouseenter = () => {
        btn.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.35), rgba(52, 211, 153, 0.3))';
        btn.style.borderColor = 'rgba(52, 211, 153, 0.7)';
        btn.style.transform = 'translateY(-1px)';
    };
    btn.onmouseleave = () => {
        btn.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(52, 211, 153, 0.15))';
        btn.style.borderColor = 'rgba(52, 211, 153, 0.4)';
        btn.style.transform = 'translateY(0)';
    };

    btn.onclick = () => {
        openAudioUploaderModal({
            onSaved: (slice) => {
                if (typeof onVoiceAdded === 'function') {
                    onVoiceAdded(slice);
                }
            }
        });
    };
    return btn;
}

function renderStudioToolbar(onSearch, onVoiceAdded) {
    const toolbar = document.createElement('div');
    toolbar.className = 'anomalous-audio-toolbar';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'anomalous-audio-title-group';

    const iconBox = document.createElement('div');
    iconBox.className = 'anomalous-audio-icon-box';
    iconBox.innerHTML = SVG.MIC;

    const textGroup = document.createElement('div');
    textGroup.style.display = 'flex';
    textGroup.style.flexDirection = 'column';

    const title = document.createElement('span');
    title.className = 'anomalous-audio-title-text';
    title.textContent = t('audioStudioTitle');

    const desc = document.createElement('span');
    desc.className = 'anomalous-audio-sub-text';
    desc.style.marginLeft = '0';
    desc.textContent = t('audioStudioSubtitle');

    textGroup.appendChild(title);
    textGroup.appendChild(desc);

    titleGroup.appendChild(iconBox);
    titleGroup.appendChild(textGroup);

    const rightActions = document.createElement('div');
    rightActions.style.display = 'flex';
    rightActions.style.alignItems = 'center';
    rightActions.style.gap = '10px';

    const searchWrap = document.createElement('div');
    searchWrap.style.display = 'flex';
    searchWrap.style.alignItems = 'center';
    searchWrap.style.gap = '6px';
    searchWrap.style.background = 'rgba(0, 0, 0, 0.25)';
    searchWrap.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    searchWrap.style.borderRadius = '8px';
    searchWrap.style.padding = '4px 10px';

    const searchIcon = document.createElement('span');
    searchIcon.style.color = '#64748b';
    searchIcon.innerHTML = SVG.SEARCH;

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = t('audioVoicePresets');
    searchInput.style.background = 'transparent';
    searchInput.style.border = 'none';
    searchInput.style.outline = 'none';
    searchInput.style.color = '#f1f5f9';
    searchInput.style.fontSize = '12px';
    searchInput.style.width = '140px';
    searchInput.oninput = (e) => onSearch(e.target.value.toLowerCase());

    searchWrap.appendChild(searchIcon);
    searchWrap.appendChild(searchInput);

    const addVoiceBtn = createAddVoiceButton(onVoiceAdded);
    const loadWfBtn = createLoadWorkflowButton();
    rightActions.appendChild(addVoiceBtn);
    rightActions.appendChild(loadWfBtn);
    rightActions.appendChild(searchWrap);

    toolbar.appendChild(titleGroup);
    toolbar.appendChild(rightActions);
    return toolbar;
}

export async function renderAudioStudio(container, filter = null) {
    stopAudioStudioPlayback();
    container.innerHTML = '';

    const studioWrapper = document.createElement('div');
    studioWrapper.className = 'anomalous-audio-studio-wrapper';

    try {
        const resp = await fetch('/anomalous/audio_voices');
        const data = await resp.json();
        let characters = data.characters || [];

        // Apply character filter if selected from sidebar
        if (filter && filter.type === 'character' && filter.value) {
            characters = characters.filter(c => c.character.toLowerCase() === filter.value.toLowerCase());
        }

        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(380px, 1fr))';
        grid.style.gap = '16px';

        const toolbar = renderStudioToolbar((searchTerm) => {
            const cards = grid.querySelectorAll('.anomalous-character-voice-card');
            cards.forEach(card => {
                const text = card.textContent.toLowerCase();
                card.style.display = text.includes(searchTerm) ? 'flex' : 'none';
            });
        }, () => {
            renderAudioStudio(container, filter);
        });
        studioWrapper.appendChild(toolbar);

        if (characters.length === 0) {
            const emptyGuide = document.createElement('div');
            emptyGuide.style.padding = '70px 20px';
            emptyGuide.style.textAlign = 'center';
            emptyGuide.style.color = '#64748b';
            emptyGuide.innerHTML = `
                <div style="font-size:32px;margin-bottom:12px;opacity:0.6;">🎙️</div>
                <div style="color:#cbd5e1;font-size:14px;font-weight:600;margin-bottom:6px;">${t('audioEmptyTitle')}</div>
                <div style="font-size:12px;max-width:420px;margin:0 auto;line-height:1.6;">${t('audioEmptyDesc')}</div>
            `;
            studioWrapper.appendChild(emptyGuide);
        } else {
            characters.forEach(charData => {
                grid.appendChild(renderCharacterCard(charData));
            });
            studioWrapper.appendChild(grid);
        }
    } catch (e) {
        console.error('Failed to load audio voices:', e);
    }

    container.appendChild(studioWrapper);
}
