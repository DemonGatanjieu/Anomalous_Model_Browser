import { t } from './interface_settings.js';

/**
 * Audio & Voice Studio Workspace
 * Provides character voice presets browsing, inline waveform listening,
 * syntax copying, and canvas drag-and-drop.
 */

let globalAudioPlayer = null;
let currentPlayingBtn = null;
let currentPlayingWave = null;

function stopCurrentAudio() {
    if (globalAudioPlayer) {
        globalAudioPlayer.pause();
        globalAudioPlayer.currentTime = 0;
        globalAudioPlayer = null;
    }
    if (currentPlayingBtn) {
        currentPlayingBtn.innerHTML = '▶';
        currentPlayingBtn.classList.remove('is-playing');
        currentPlayingBtn = null;
    }
    if (currentPlayingWave) {
        currentPlayingWave.classList.remove('is-playing');
        currentPlayingWave = null;
    }
}

function playAudio(url, playBtn, waveElem) {
    if (currentPlayingBtn === playBtn) {
        stopCurrentAudio();
        return;
    }
    stopCurrentAudio();

    const audio = new Audio(url);
    globalAudioPlayer = audio;
    currentPlayingBtn = playBtn;
    currentPlayingWave = waveElem;

    playBtn.innerHTML = '⏸';
    playBtn.classList.add('is-playing');
    if (waveElem) waveElem.classList.add('is-playing');

    audio.onended = () => {
        stopCurrentAudio();
    };
    audio.onerror = () => {
        stopCurrentAudio();
    };
    audio.play().catch(() => {
        stopCurrentAudio();
    });
}

function copySyntax(tag, btn) {
    navigator.clipboard.writeText(tag).then(() => {
        const original = btn.innerHTML;
        btn.innerHTML = '✓ ' + t('audioCopied');
        btn.style.borderColor = '#10b981';
        btn.style.color = '#10b981';
        setTimeout(() => {
            btn.innerHTML = original;
            btn.style.borderColor = '';
            btn.style.color = '';
        }, 1500);
    });
}

function getEmotionColor(emotion) {
    const map = {
        happy: '#f59e0b',
        sad: '#3b82f6',
        surprised: '#ec4899',
        normal: '#10b981',
        deep: '#8b5cf6',
        chipmunk: '#06b6d4'
    };
    return map[emotion] || '#a855f7';
}

function renderSliceRow(slice) {
    const row = document.createElement('div');
    row.className = 'anomalous-voice-slice-row';
    row.draggable = true;
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    row.style.padding = '8px 12px';
    row.style.borderRadius = '8px';
    row.style.background = 'rgba(255, 255, 255, 0.03)';
    row.style.border = '1px solid rgba(255, 255, 255, 0.06)';
    row.style.transition = 'all 0.15s ease';
    row.style.cursor = 'grab';

    row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(255, 255, 255, 0.07)';
        row.style.borderColor = 'rgba(255, 255, 255, 0.15)';
    });
    row.addEventListener('mouseleave', () => {
        row.style.background = 'rgba(255, 255, 255, 0.03)';
        row.style.borderColor = 'rgba(255, 255, 255, 0.06)';
    });

    row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', slice.syntax_tag);
        e.dataTransfer.setData('application/json', JSON.stringify({
            type: 'anomalous_audio_preset',
            filename: slice.filename,
            text: slice.text,
            character: slice.character,
            emotion: slice.emotion
        }));
    });

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.innerHTML = '▶';
    playBtn.title = t('audioPlay');
    playBtn.style.width = '28px';
    playBtn.style.height = '28px';
    playBtn.style.borderRadius = '50%';
    playBtn.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    playBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    playBtn.style.color = '#fff';
    playBtn.style.fontSize = '12px';
    playBtn.style.cursor = 'pointer';
    playBtn.style.display = 'flex';
    playBtn.style.alignItems = 'center';
    playBtn.style.justifyContent = 'center';
    playBtn.style.flexShrink = '0';

    const emoBadge = document.createElement('span');
    emoBadge.textContent = slice.emotion;
    emoBadge.style.fontSize = '10px';
    emoBadge.style.fontWeight = 'bold';
    emoBadge.style.padding = '2px 6px';
    emoBadge.style.borderRadius = '4px';
    emoBadge.style.textTransform = 'uppercase';
    emoBadge.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
    emoBadge.style.color = getEmotionColor(slice.emotion);
    emoBadge.style.border = `1px solid ${getEmotionColor(slice.emotion)}44`;

    const textSpan = document.createElement('div');
    textSpan.style.flex = '1';
    textSpan.style.fontSize = '12px';
    textSpan.style.color = '#e2e8f0';
    textSpan.style.whiteSpace = 'nowrap';
    textSpan.style.overflow = 'hidden';
    textSpan.style.textOverflow = 'ellipsis';
    textSpan.textContent = slice.text || slice.filename;
    textSpan.title = slice.text || slice.filename;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.innerHTML = '📋 ' + slice.syntax_tag;
    copyBtn.title = t('audioCopyTag');
    copyBtn.style.padding = '3px 8px';
    copyBtn.style.borderRadius = '6px';
    copyBtn.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    copyBtn.style.background = 'rgba(255, 255, 255, 0.05)';
    copyBtn.style.color = '#cbd5e1';
    copyBtn.style.fontSize = '11px';
    copyBtn.style.cursor = 'pointer';
    copyBtn.style.flexShrink = '0';
    copyBtn.onclick = (e) => {
        e.stopPropagation();
        copySyntax(slice.syntax_tag, copyBtn);
    };

    playBtn.onclick = (e) => {
        e.stopPropagation();
        playAudio(slice.audio_url, playBtn, row);
    };

    row.appendChild(playBtn);
    row.appendChild(emoBadge);
    row.appendChild(textSpan);
    row.appendChild(copyBtn);
    return row;
}

function renderCharacterCard(charData) {
    const card = document.createElement('div');
    card.className = 'anomalous-character-voice-card';
    card.style.background = 'rgba(30, 30, 40, 0.6)';
    card.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    card.style.borderRadius = '12px';
    card.style.padding = '16px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '12px';
    card.style.backdropFilter = 'blur(10px)';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';

    const titleGroup = document.createElement('div');
    titleGroup.style.display = 'flex';
    titleGroup.style.alignItems = 'center';
    titleGroup.style.gap = '8px';

    const avatar = document.createElement('div');
    avatar.style.width = '32px';
    avatar.style.height = '32px';
    avatar.style.borderRadius = '50%';
    avatar.style.background = 'linear-gradient(135deg, #a855f7, #6366f1)';
    avatar.style.display = 'flex';
    avatar.style.alignItems = 'center';
    avatar.style.justifyContent = 'center';
    avatar.style.fontSize = '16px';
    avatar.innerHTML = '🎙️';

    const name = document.createElement('h3');
    name.style.margin = '0';
    name.style.fontSize = '15px';
    name.style.color = '#f8fafc';
    name.textContent = charData.character;

    const countBadge = document.createElement('span');
    countBadge.style.fontSize = '11px';
    countBadge.style.padding = '2px 8px';
    countBadge.style.borderRadius = '10px';
    countBadge.style.background = 'rgba(255, 255, 255, 0.08)';
    countBadge.style.color = '#94a3b8';
    countBadge.textContent = `${charData.total_slices} ${t('audioVoicePresets')}`;

    titleGroup.appendChild(avatar);
    titleGroup.appendChild(name);
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

export async function renderAudioStudio(container) {
    stopCurrentAudio();
    container.innerHTML = '';

    const studioWrapper = document.createElement('div');
    studioWrapper.className = 'anomalous-audio-studio-wrapper';
    studioWrapper.style.padding = '20px';
    studioWrapper.style.height = '100%';
    studioWrapper.style.overflowY = 'auto';
    studioWrapper.style.boxSizing = 'border-box';

    const banner = document.createElement('div');
    banner.style.marginBottom = '20px';

    const title = document.createElement('h2');
    title.style.margin = '0 0 6px 0';
    title.style.fontSize = '18px';
    title.style.color = '#f1f5f9';
    title.innerHTML = `🎙️ ${t('audioStudioTitle')}`;

    const subtitle = document.createElement('p');
    subtitle.style.margin = '0';
    subtitle.style.fontSize = '12px';
    subtitle.style.color = '#94a3b8';
    subtitle.textContent = t('audioStudioSubtitle');

    banner.appendChild(title);
    banner.appendChild(subtitle);
    studioWrapper.appendChild(banner);

    try {
        const resp = await fetch('/anomalous/audio_voices');
        const data = await resp.json();

        if (!data.characters || data.characters.length === 0) {
            const emptyGuide = document.createElement('div');
            emptyGuide.style.padding = '40px 20px';
            emptyGuide.style.textAlign = 'center';
            emptyGuide.style.color = '#94a3b8';
            emptyGuide.innerHTML = `
                <div style="font-size:32px;margin-bottom:12px;">🎵</div>
                <h4 style="color:#e2e8f0;margin:0 0 8px 0;">${t('audioEmptyTitle')}</h4>
                <p style="font-size:12px;max-width:400px;margin:0 auto;">${t('audioEmptyDesc')}</p>
            `;
            studioWrapper.appendChild(emptyGuide);
        } else {
            const grid = document.createElement('div');
            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(360px, 1fr))';
            grid.style.gap = '16px';

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
