import { t } from './interface_settings.js';

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
    CHECK: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
};

function stopCurrentAudio() {
    if (globalAudioPlayer) {
        globalAudioPlayer.pause();
        globalAudioPlayer.currentTime = 0;
        globalAudioPlayer = null;
    }
    if (currentPlayingBtn) {
        currentPlayingBtn.innerHTML = SVG.PLAY;
        currentPlayingBtn.style.color = '#94a3b8';
        currentPlayingBtn.style.borderColor = 'rgba(255,255,255,0.12)';
        currentPlayingBtn = null;
    }
    if (currentPlayingBar) {
        currentPlayingBar.style.display = 'none';
        currentPlayingBar = null;
    }
}

function playAudio(url, playBtn, eqBars) {
    if (currentPlayingBtn === playBtn) {
        stopCurrentAudio();
        return;
    }
    stopCurrentAudio();

    const audio = new Audio(url);
    globalAudioPlayer = audio;
    currentPlayingBtn = playBtn;
    currentPlayingBar = eqBars;

    playBtn.innerHTML = SVG.PAUSE;
    playBtn.style.color = '#38bdf8';
    playBtn.style.borderColor = 'rgba(56, 189, 248, 0.4)';
    if (eqBars) eqBars.style.display = 'inline-flex';

    audio.onended = () => stopCurrentAudio();
    audio.onerror = () => stopCurrentAudio();
    audio.play().catch(() => stopCurrentAudio());
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
        return { color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.25)' };
    }
    if (raw.includes('sad') || raw.includes('cry')) {
        return { color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.25)' };
    }
    if (raw.includes('surpris') || raw.includes('shock')) {
        return { color: '#f472b6', bg: 'rgba(244, 114, 182, 0.1)', border: 'rgba(244, 114, 182, 0.25)' };
    }
    if (raw.includes('normal') || raw.includes('calm')) {
        return { color: '#34d399', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.25)' };
    }
    return { color: '#a78bfa', bg: 'rgba(167, 139, 250, 0.1)', border: 'rgba(167, 139, 250, 0.25)' };
}

function renderEqIndicator() {
    const barWrap = document.createElement('span');
    barWrap.className = 'anomalous-audio-eq-bars';
    barWrap.style.display = 'none';
    barWrap.style.alignItems = 'flex-end';
    barWrap.style.gap = '2px';
    barWrap.style.height = '12px';
    barWrap.style.marginRight = '4px';

    for (let i = 0; i < 3; i++) {
        const bar = document.createElement('span');
        bar.style.width = '2px';
        bar.style.height = `${6 + (i % 2) * 6}px`;
        bar.style.background = '#38bdf8';
        bar.style.borderRadius = '1px';
        barWrap.appendChild(bar);
    }
    return barWrap;
}

function renderSliceRow(slice) {
    const row = document.createElement('div');
    row.className = 'anomalous-voice-slice-row';
    row.draggable = true;
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '6px 10px';
    row.style.borderRadius = '6px';
    row.style.background = 'rgba(255, 255, 255, 0.02)';
    row.style.border = '1px solid rgba(255, 255, 255, 0.05)';
    row.style.transition = 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)';
    row.style.cursor = 'grab';

    row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(255, 255, 255, 0.05)';
        row.style.borderColor = 'rgba(255, 255, 255, 0.12)';
    });
    row.addEventListener('mouseleave', () => {
        row.style.background = 'rgba(255, 255, 255, 0.02)';
        row.style.borderColor = 'rgba(255, 255, 255, 0.05)';
    });

    row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', slice.syntax_tag);
        e.dataTransfer.setData('application/json', JSON.stringify(slice));
    });

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.innerHTML = SVG.PLAY;
    playBtn.title = t('audioPlay');
    playBtn.style.display = 'inline-flex';
    playBtn.style.alignItems = 'center';
    playBtn.style.justifyContent = 'center';
    playBtn.style.width = '24px';
    playBtn.style.height = '24px';
    playBtn.style.borderRadius = '50%';
    playBtn.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    playBtn.style.background = 'rgba(255, 255, 255, 0.04)';
    playBtn.style.color = '#94a3b8';
    playBtn.style.cursor = 'pointer';
    playBtn.style.flexShrink = '0';
    playBtn.style.transition = 'all 0.15s ease';

    const eqBars = renderEqIndicator();

    const emoStyle = getEmotionStyle(slice.emotion);
    const emoTag = document.createElement('span');
    emoTag.textContent = slice.emotion.toUpperCase();
    emoTag.style.fontSize = '9px';
    emoTag.style.fontWeight = '700';
    emoTag.style.letterSpacing = '0.5px';
    emoTag.style.padding = '2px 5px';
    emoTag.style.borderRadius = '3px';
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
    copyBtn.style.padding = '2px 7px';
    copyBtn.style.borderRadius = '4px';
    copyBtn.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    copyBtn.style.background = 'rgba(0, 0, 0, 0.25)';
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
    card.style.background = 'rgba(22, 22, 27, 0.75)';
    card.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    card.style.borderRadius = '10px';
    card.style.padding = '14px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '10px';
    card.style.backdropFilter = 'blur(16px)';
    card.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';

    const titleGroup = document.createElement('div');
    titleGroup.style.display = 'flex';
    titleGroup.style.alignItems = 'center';
    titleGroup.style.gap = '8px';

    const avatar = document.createElement('div');
    avatar.style.width = '26px';
    avatar.style.height = '26px';
    avatar.style.borderRadius = '6px';
    avatar.style.background = charData.character.toLowerCase() === 'arona'
        ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.3), rgba(99, 102, 241, 0.3))'
        : 'rgba(255, 255, 255, 0.06)';
    avatar.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    avatar.style.display = 'flex';
    avatar.style.alignItems = 'center';
    avatar.style.justifyContent = 'center';
    avatar.style.color = charData.character.toLowerCase() === 'arona' ? '#38bdf8' : '#94a3b8';
    avatar.innerHTML = SVG.MIC;

    const name = document.createElement('span');
    name.style.fontSize = '13px';
    name.style.fontWeight = '600';
    name.style.letterSpacing = '0.3px';
    name.style.color = '#f1f5f9';
    name.textContent = charData.character;

    const countBadge = document.createElement('span');
    countBadge.style.fontSize = '10px';
    countBadge.style.padding = '2px 6px';
    countBadge.style.borderRadius = '10px';
    countBadge.style.background = 'rgba(255, 255, 255, 0.05)';
    countBadge.style.border = '1px solid rgba(255, 255, 255, 0.06)';
    countBadge.style.color = '#64748b';
    countBadge.textContent = `${charData.total_slices} ${t('audioVoicePresets')}`;

    titleGroup.appendChild(avatar);
    titleGroup.appendChild(name);
    header.appendChild(titleGroup);
    header.appendChild(countBadge);
    card.appendChild(header);

    const sliceList = document.createElement('div');
    sliceList.style.display = 'flex';
    sliceList.style.flexDirection = 'column';
    sliceList.style.gap = '5px';

    charData.slices.forEach(slice => {
        sliceList.appendChild(renderSliceRow(slice));
    });

    card.appendChild(sliceList);
    return card;
}

export async function renderAudioStudio(container) {
    stopCurrentAudio();
    container.innerHTML = '';

    const studioWrapper = document.createElement('div');
    studioWrapper.className = 'anomalous-audio-studio-wrapper';
    studioWrapper.style.padding = '16px';
    studioWrapper.style.height = '100%';
    studioWrapper.style.overflowY = 'auto';
    studioWrapper.style.boxSizing = 'border-box';

    // Toolbar Header
    const toolbar = document.createElement('div');
    toolbar.style.display = 'flex';
    toolbar.style.alignItems = 'center';
    toolbar.style.justifyContent = 'space-between';
    toolbar.style.marginBottom = '14px';
    toolbar.style.paddingBottom = '10px';
    toolbar.style.borderBottom = '1px solid rgba(255, 255, 255, 0.06)';

    const titleGroup = document.createElement('div');
    titleGroup.style.display = 'flex';
    titleGroup.style.alignItems = 'center';
    titleGroup.style.gap = '8px';

    const iconBox = document.createElement('span');
    iconBox.style.color = '#818cf8';
    iconBox.style.display = 'flex';
    iconBox.innerHTML = SVG.MIC;

    const title = document.createElement('span');
    title.style.fontSize = '14px';
    title.style.fontWeight = '600';
    title.style.color = '#f1f5f9';
    title.textContent = t('audioStudioTitle');

    const desc = document.createElement('span');
    desc.style.fontSize = '11px';
    desc.style.color = '#64748b';
    desc.textContent = t('audioStudioSubtitle');

    titleGroup.appendChild(iconBox);
    titleGroup.appendChild(title);
    titleGroup.appendChild(desc);
    toolbar.appendChild(titleGroup);
    studioWrapper.appendChild(toolbar);

    try {
        const resp = await fetch('/anomalous/audio_voices');
        const data = await resp.json();

        if (!data.characters || data.characters.length === 0) {
            const emptyGuide = document.createElement('div');
            emptyGuide.style.padding = '60px 20px';
            emptyGuide.style.textAlign = 'center';
            emptyGuide.style.color = '#64748b';
            emptyGuide.innerHTML = `
                <div style="font-size:28px;margin-bottom:8px;opacity:0.6;">🎙️</div>
                <div style="color:#cbd5e1;font-size:13px;font-weight:600;margin-bottom:4px;">${t('audioEmptyTitle')}</div>
                <div style="font-size:11px;max-width:380px;margin:0 auto;line-height:1.5;">${t('audioEmptyDesc')}</div>
            `;
            studioWrapper.appendChild(emptyGuide);
        } else {
            const grid = document.createElement('div');
            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(360px, 1fr))';
            grid.style.gap = '14px';

            data.characters.forEach(charData => {
                grid.appendChild(renderCharacterCard(charData));
            });
            studioWrapper.appendChild(grid);
        }
    } catch (e) {
        console.error('Failed to load audio voices:', e);
    }

    container.appendChild(studioWrapper);
}
