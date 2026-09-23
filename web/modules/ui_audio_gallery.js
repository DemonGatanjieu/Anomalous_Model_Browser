import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';

/**
 * Audio Gallery: generated audio history with playback, seeking, download,
 * deletion and paging.
 */

const PAGE_SIZE = 50;
const renderTokens = new WeakMap();

let activeAudio = null;
let activePlayBtn = null;
let activeProgressFill = null;
let activeTimeLabel = null;

const SVG = {
    PLAY: `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    PAUSE: `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
    DOWNLOAD: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    TRASH: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    AUDIO_WAVE: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v4"/><path d="M6 7v10"/><path d="M10 4v16"/><path d="M14 8v8"/><path d="M18 5v14"/><path d="M22 10v4"/></svg>`,
    REFRESH: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>`,
};

export function stopGalleryAudio() {
    if (activeAudio) {
        activeAudio.pause();
        activeAudio.removeAttribute('src');
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
    if (!sec || !Number.isFinite(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
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

    const isCurrent = () => activeAudio === audio;
    audio.onloadedmetadata = () => {
        if (isCurrent()) timeEl.textContent = `00:00 / ${formatDuration(audio.duration)}`;
    };
    audio.ontimeupdate = () => {
        if (!isCurrent() || !audio.duration) return;
        fillEl.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
        timeEl.textContent = `${formatDuration(audio.currentTime)} / ${formatDuration(audio.duration)}`;
    };
    audio.onended = () => { if (isCurrent()) stopGalleryAudio(); };
    audio.onerror = () => { if (isCurrent()) stopGalleryAudio(); };
    audio.play().catch(() => { if (isCurrent()) stopGalleryAudio(); });
}

async function requestDeleteTrack(item, rowEl, onDeleted) {
    if (!await anomalousConfirm(`${t('audioDeleteConfirm')}\n${item.filename}`)) return;

    let error = null;
    try {
        const resp = await fetch('/anomalous/delete_audio_gallery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: item.filename, subfolder: item.subfolder }),
        });
        const res = await resp.json().catch(() => ({}));
        if (!resp.ok || !res.success) error = res.error || `HTTP ${resp.status}`;
    } catch (e) {
        error = e.message;
    }
    if (error) {
        await anomalousAlert(t('audioDeleteFailed', { error }));
        return;
    }
    if (activePlayBtn && rowEl.contains(activePlayBtn)) stopGalleryAudio();
    rowEl.classList.add('is-removing');
    setTimeout(() => {
        rowEl.remove();
        onDeleted?.();
    }, 200);
}

function createTrackRow(item, onDeleted) {
    const row = document.createElement('div');
    row.className = 'anomalous-audio-track-item';
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', item.audio_url);
        e.dataTransfer.setData('application/json', JSON.stringify(item));
    });

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'anomalous-audio-play-btn';
    playBtn.innerHTML = SVG.PLAY;
    playBtn.title = t('audioPlay');

    const infoCol = document.createElement('div');
    infoCol.className = 'anomalous-track-info';

    const nameEl = document.createElement('span');
    nameEl.className = 'anomalous-track-name';
    nameEl.textContent = item.filename;
    nameEl.title = item.filename;

    const subMeta = document.createElement('div');
    subMeta.className = 'anomalous-track-meta';
    if (item.subfolder) {
        const folderTag = document.createElement('span');
        folderTag.className = 'anomalous-track-folder';
        folderTag.textContent = item.subfolder;
        subMeta.appendChild(folderTag);
    }
    const sizeSpan = document.createElement('span');
    sizeSpan.textContent = formatBytes(item.size_bytes);
    const dateSpan = document.createElement('span');
    dateSpan.textContent = formatDate(item.mtime);
    subMeta.append(sizeSpan, dateSpan);
    infoCol.append(nameEl, subMeta);

    const progressTrack = document.createElement('div');
    progressTrack.className = 'anomalous-track-progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'anomalous-track-progress-fill';
    progressTrack.appendChild(progressFill);
    progressTrack.onclick = (e) => {
        if (!activeAudio || activePlayBtn !== playBtn || !activeAudio.duration) return;
        const rect = progressTrack.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        activeAudio.currentTime = ratio * activeAudio.duration;
    };

    const timeLabel = document.createElement('span');
    timeLabel.className = 'anomalous-track-time';
    timeLabel.textContent = '--:--';

    playBtn.onclick = (e) => {
        e.stopPropagation();
        startPlayback(item.audio_url, playBtn, progressFill, timeLabel);
    };

    const actionGroup = document.createElement('div');
    actionGroup.className = 'anomalous-track-actions';

    const dlBtn = document.createElement('a');
    dlBtn.href = item.audio_url;
    dlBtn.download = item.filename;
    dlBtn.className = 'anomalous-audio-play-btn';
    dlBtn.innerHTML = SVG.DOWNLOAD;
    dlBtn.title = t('audioDownload');

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'anomalous-audio-play-btn anomalous-track-delete';
    delBtn.innerHTML = SVG.TRASH;
    delBtn.title = t('audioDelete');
    delBtn.onclick = (e) => {
        e.stopPropagation();
        requestDeleteTrack(item, row, onDeleted);
    };

    actionGroup.append(dlBtn, delBtn);
    row.append(playBtn, infoCol, progressTrack, timeLabel, actionGroup);
    return row;
}

function renderGalleryToolbar(onRefresh) {
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

    left.append(iconBox, titleText, subText);

    const right = document.createElement('div');
    right.className = 'anomalous-audio-right-actions';

    const countBadge = document.createElement('span');
    countBadge.className = 'anomalous-track-count';

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'anomalous-audio-play-btn';
    refreshBtn.innerHTML = SVG.REFRESH;
    refreshBtn.title = t('audioRefresh');
    refreshBtn.setAttribute('aria-label', t('audioRefresh'));
    refreshBtn.onclick = onRefresh;

    right.append(countBadge, refreshBtn);
    bar.append(left, right);
    return { bar, countBadge };
}

function renderMessage(className, message) {
    const box = document.createElement('div');
    box.className = className;
    box.textContent = message;
    return box;
}

async function fetchGalleryPage(page) {
    const resp = await fetch(`/anomalous/audio_gallery?page=${page}&limit=${PAGE_SIZE}`);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
}

/** Only the latest render for a container may write into it. */
export async function renderAudioGallery(container) {
    const token = {};
    renderTokens.set(container, token);
    const isCurrent = () => renderTokens.get(container) === token;
    stopGalleryAudio();

    const wrapper = document.createElement('div');
    wrapper.className = 'anomalous-audio-gallery-wrapper';
    const { bar, countBadge } = renderGalleryToolbar(() => renderAudioGallery(container));
    const status = renderMessage('anomalous-audio-status', t('audioLoading'));
    wrapper.append(bar, status);
    container.replaceChildren(wrapper);

    const trackList = document.createElement('div');
    trackList.className = 'anomalous-track-list';
    const loadMore = document.createElement('button');
    loadMore.type = 'button';
    loadMore.className = 'anomalous-audio-tool-btn anomalous-track-load-more';
    loadMore.textContent = t('audioLoadMore');

    let page = 0;
    let shown = 0;
    let total = 0;
    const updateCount = () => { countBadge.textContent = t('audioTrackCount', { shown, total }); };
    const onDeleted = () => {
        shown = Math.max(0, shown - 1);
        total = Math.max(0, total - 1);
        updateCount();
    };

    const loadNextPage = async () => {
        loadMore.disabled = true;
        let data;
        try {
            data = await fetchGalleryPage(page + 1);
        } catch (e) {
            if (!isCurrent()) return;
            if (page === 0) status.replaceWith(renderMessage('anomalous-audio-status is-error', t('audioLoadFailed', { error: e.message })));
            else await anomalousAlert(t('audioLoadFailed', { error: e.message }));
            loadMore.disabled = false;
            return;
        }
        if (!isCurrent()) return;
        page = data.page;
        total = data.total;
        const audios = data.audios || [];
        audios.forEach(item => trackList.appendChild(createTrackRow(item, onDeleted)));
        shown += audios.length;
        updateCount();

        if (page === 1) {
            status.replaceWith(total === 0
                ? renderMessage('anomalous-audio-empty', t('audioGalleryEmpty'))
                : trackList);
        }
        loadMore.disabled = false;
        if (data.has_more) {
            if (!loadMore.isConnected) wrapper.appendChild(loadMore);
        } else {
            loadMore.remove();
        }
    };
    loadMore.onclick = loadNextPage;
    await loadNextPage();
}
