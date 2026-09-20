import { t } from './interface_settings.js';

/**
 * Audio Gallery Module (Output History & Management)
 * Sleek, DAW-inspired player and track management for ComfyUI generated audio.
 */

let activeAudio = null;
let activePlayBtn = null;
let activeProgressFill = null;
let activeTimeLabel = null;
let progressUpdateTimer = null;

const SVG = {
    PLAY: `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    PAUSE: `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
    DOWNLOAD: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    TRASH: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    VAULT: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>`,
    AUDIO_WAVE: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v4"/><path d="M6 7v10"/><path d="M10 4v16"/><path d="M14 8v8"/><path d="M18 5v14"/><path d="M22 10v4"/></svg>`
};

export function stopGalleryAudio() {
    if (progressUpdateTimer) {
        clearInterval(progressUpdateTimer);
        progressUpdateTimer = null;
    }
    if (activeAudio) {
        activeAudio.pause();
        activeAudio = null;
    }
    if (activePlayBtn) {
        activePlayBtn.innerHTML = SVG.PLAY;
        activePlayBtn.classList.remove('is-playing');
        activePlayBtn = null;
    }
    if (activeProgressFill) {
        activeProgressFill.style.width = '0%';
        activeProgressFill = null;
    }
    if (activeTimeLabel) {
        activeTimeLabel.textContent = '--:--';
        activeTimeLabel = null;
    }
}

function formatDuration(sec) {
    if (!sec || isNaN(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(timestampSec) {
    if (!timestampSec) return '';
    const d = new Date(timestampSec * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function startPlayback(url, playBtn, fillEl, timeEl) {
    if (activePlayBtn === playBtn) {
        stopGalleryAudio();
        return;
    }
    stopGalleryAudio();

    const audio = new Audio(url);
    activeAudio = audio;
    activePlayBtn = playBtn;
    activeProgressFill = fillEl;
    activeTimeLabel = timeEl;

    playBtn.innerHTML = SVG.PAUSE;
    playBtn.classList.add('is-playing');

    audio.onloadedmetadata = () => {
        if (timeEl) timeEl.textContent = `00:00 / ${formatDuration(audio.duration)}`;
    };

    progressUpdateTimer = setInterval(() => {
        if (!activeAudio || !activeAudio.duration) return;
        const pct = (activeAudio.currentTime / activeAudio.duration) * 100;
        if (activeProgressFill) activeProgressFill.style.width = `${pct}%`;
        if (activeTimeLabel) {
            activeTimeLabel.textContent = `${formatDuration(activeAudio.currentTime)} / ${formatDuration(activeAudio.duration)}`;
        }
    }, 100);

    audio.onended = () => stopGalleryAudio();
    audio.onerror = () => stopGalleryAudio();
    audio.play().catch(() => stopGalleryAudio());
}

async function requestDeleteTrack(item, rowEl, onDeleted) {
    const ok = window.confirm(`${t('audioDeleteConfirm')}\n${item.filename}`);
    if (!ok) return;

    try {
        const resp = await fetch('/anomalous/delete_audio_gallery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: item.filename, subfolder: item.subfolder })
        });
        const res = await resp.json();
        if (res.success) {
            if (activeAudio && activeAudio.src.includes(item.filename)) {
                stopGalleryAudio();
            }
            rowEl.style.opacity = '0';
            rowEl.style.transform = 'translateX(20px)';
            setTimeout(() => {
                rowEl.remove();
                if (typeof onDeleted === 'function') onDeleted();
            }, 200);
        } else {
            alert('Failed to delete: ' + (res.error || 'Unknown error'));
        }
    } catch (e) {
        alert('Network error while deleting audio');
    }
}

function createTrackRow(item, onDeleted) {
    const row = document.createElement('div');
    row.className = 'anomalous-audio-track-item';
    row.draggable = true;

    row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', item.audio_url);
        e.dataTransfer.setData('application/json', JSON.stringify(item));
    });

    // Play/Pause button
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'anomalous-audio-play-btn';
    playBtn.innerHTML = SVG.PLAY;

    // Track Meta & Name
    const infoCol = document.createElement('div');
    infoCol.style.display = 'flex';
    infoCol.style.flexDirection = 'column';
    infoCol.style.gap = '2px';
    infoCol.style.minWidth = '220px';
    infoCol.style.maxWidth = '320px';

    const nameEl = document.createElement('span');
    nameEl.style.fontSize = '13px';
    nameEl.style.fontWeight = '500';
    nameEl.style.color = '#f1f5f9';
    nameEl.style.whiteSpace = 'nowrap';
    nameEl.style.overflow = 'hidden';
    nameEl.style.textOverflow = 'ellipsis';
    nameEl.textContent = item.filename;
    nameEl.title = item.filename;

    const subMeta = document.createElement('div');
    subMeta.style.display = 'flex';
    subMeta.style.alignItems = 'center';
    subMeta.style.gap = '8px';
    subMeta.style.fontSize = '11px';
    subMeta.style.color = '#64748b';

    if (item.subfolder) {
        const folderTag = document.createElement('span');
        folderTag.style.background = 'rgba(99, 102, 241, 0.12)';
        folderTag.style.color = '#818cf8';
        folderTag.style.padding = '1px 5px';
        folderTag.style.borderRadius = '3px';
        folderTag.textContent = item.subfolder;
        subMeta.appendChild(folderTag);
    }
    const sizeSpan = document.createElement('span');
    sizeSpan.textContent = formatBytes(item.size_bytes);
    const dateSpan = document.createElement('span');
    dateSpan.textContent = formatDate(item.mtime);
    subMeta.appendChild(sizeSpan);
    subMeta.appendChild(dateSpan);

    infoCol.appendChild(nameEl);
    infoCol.appendChild(subMeta);

    // Progress bar
    const progressTrack = document.createElement('div');
    progressTrack.className = 'anomalous-track-progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'anomalous-track-progress-fill';
    progressTrack.appendChild(progressFill);

    progressTrack.onclick = (e) => {
        if (!activeAudio || activePlayBtn !== playBtn) return;
        const rect = progressTrack.getBoundingClientRect();
        const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (activeAudio.duration) {
            activeAudio.currentTime = clickRatio * activeAudio.duration;
        }
    };

    // Time Label
    const timeLabel = document.createElement('span');
    timeLabel.style.fontSize = '11px';
    timeLabel.style.color = '#94a3b8';
    timeLabel.style.fontFamily = 'monospace';
    timeLabel.style.minWidth = '90px';
    timeLabel.style.textAlign = 'right';
    timeLabel.textContent = '--:--';

    playBtn.onclick = (e) => {
        e.stopPropagation();
        startPlayback(item.audio_url, playBtn, progressFill, timeLabel);
    };

    // Actions
    const actionGroup = document.createElement('div');
    actionGroup.style.display = 'flex';
    actionGroup.style.alignItems = 'center';
    actionGroup.style.gap = '6px';

    const dlBtn = document.createElement('a');
    dlBtn.href = item.audio_url;
    dlBtn.download = item.filename;
    dlBtn.className = 'anomalous-audio-play-btn';
    dlBtn.innerHTML = SVG.DOWNLOAD;
    dlBtn.title = t('audioDownload');
    dlBtn.style.textDecoration = 'none';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'anomalous-audio-play-btn';
    delBtn.innerHTML = SVG.TRASH;
    delBtn.title = t('audioDelete');
    delBtn.onmouseenter = () => { delBtn.style.color = '#f87171'; delBtn.style.borderColor = 'rgba(248, 113, 113, 0.4)'; };
    delBtn.onmouseleave = () => { delBtn.style.color = ''; delBtn.style.borderColor = ''; };
    delBtn.onclick = (e) => {
        e.stopPropagation();
        requestDeleteTrack(item, row, onDeleted);
    };

    actionGroup.appendChild(dlBtn);
    actionGroup.appendChild(delBtn);

    row.appendChild(playBtn);
    row.appendChild(infoCol);
    row.appendChild(progressTrack);
    row.appendChild(timeLabel);
    row.appendChild(actionGroup);
    return row;
}

function renderGalleryToolbar(totalCount, onRefresh) {
    const bar = document.createElement('div');
    bar.className = 'anomalous-audio-toolbar';

    const left = document.createElement('div');
    left.className = 'anomalous-audio-title-group';

    const iconBox = document.createElement('div');
    iconBox.className = 'anomalous-audio-icon-box';
    iconBox.innerHTML = SVG.AUDIO_WAVE;

    const titleText = document.createElement('span');
    titleText.className = 'anomalous-audio-title-text';
    titleText.textContent = t('audioGalleryTitle');

    const subText = document.createElement('span');
    subText.className = 'anomalous-audio-sub-text';
    subText.textContent = t('audioGallerySubtitle');

    left.appendChild(iconBox);
    left.appendChild(titleText);
    left.appendChild(subText);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '10px';

    const countBadge = document.createElement('span');
    countBadge.style.fontSize = '11px';
    countBadge.style.color = '#94a3b8';
    countBadge.style.background = 'rgba(255, 255, 255, 0.05)';
    countBadge.style.padding = '3px 8px';
    countBadge.style.borderRadius = '12px';
    countBadge.textContent = `${totalCount} tracks`;

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'anomalous-audio-play-btn';
    refreshBtn.innerHTML = '🔄';
    refreshBtn.title = t('audioRefresh');
    refreshBtn.onclick = onRefresh;

    right.appendChild(countBadge);
    right.appendChild(refreshBtn);

    bar.appendChild(left);
    bar.appendChild(right);
    return bar;
}

export async function renderAudioGallery(container) {
    stopGalleryAudio();
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'anomalous-audio-gallery-wrapper';

    try {
        const resp = await fetch('/anomalous/audio_gallery?page=1&limit=100');
        const data = await resp.json();
        const audios = data.audios || [];

        const toolbar = renderGalleryToolbar(audios.length, () => renderAudioGallery(container));
        wrapper.appendChild(toolbar);

        if (audios.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.style.padding = '80px 20px';
            emptyEl.style.textAlign = 'center';
            emptyEl.style.color = '#64748b';
            emptyEl.innerHTML = `
                <div style="font-size:32px;margin-bottom:12px;opacity:0.6;">🎵</div>
                <div style="color:#cbd5e1;font-size:14px;font-weight:600;margin-bottom:6px;">${t('audioGalleryEmpty')}</div>
                <div style="font-size:12px;max-width:400px;margin:0 auto;line-height:1.6;">${t('audioStudioSubtitle')}</div>
            `;
            wrapper.appendChild(emptyEl);
        } else {
            const trackList = document.createElement('div');
            trackList.style.display = 'flex';
            trackList.style.flexDirection = 'column';
            trackList.style.gap = '8px';

            audios.forEach(item => {
                const row = createTrackRow(item, () => {
                    const badge = toolbar.querySelector('span');
                    if (badge) {
                        const cur = parseInt(badge.textContent) || 0;
                        badge.textContent = `${Math.max(0, cur - 1)} tracks`;
                    }
                });
                trackList.appendChild(row);
            });
            wrapper.appendChild(trackList);
        }
    } catch (e) {
        console.error('Failed to load audio gallery:', e);
    }

    container.appendChild(wrapper);
}
