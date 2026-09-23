import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { parseTaggedSpeech } from './audio_script.js';

/**
 * Audio Gallery: generated audio in ComfyUI's output folder, shown with the
 * speech and voice recorded in each file; unsaved previews from the temp folder
 * can be copied into output/audio. Playback, seeking, search, paging,
 * download and deletion.
 */

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 300;
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
    COPY: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
    SAVE: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
    AUDIO_WAVE: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v4"/><path d="M6 7v10"/><path d="M10 4v16"/><path d="M14 8v8"/><path d="M18 5v14"/><path d="M22 10v4"/></svg>`,
    REFRESH: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>`,
    SEARCH: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
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

// ---------- formatting ----------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function iconButton(className, svg, title, onClick) {
    const btn = el('button', `anomalous-audio-play-btn ${className}`.trim());
    btn.type = 'button';
    btn.innerHTML = svg;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.onclick = (e) => {
        e.stopPropagation();
        onClick(btn);
    };
    return btn;
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

function voiceName(samplePath) {
    const file = String(samplePath || '').split('/').pop() || '';
    return file.replace(/\.[^.]+$/, '');
}

// ---------- playback ----------

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

// ---------- actions ----------

async function postJson(url, body) {
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
}

async function requestDeleteTrack(item, rowEl, onDeleted) {
    if (!await anomalousConfirm(`${t('audioDeleteConfirm')}\n${item.filename}`)) return;
    try {
        await postJson('/anomalous/delete_audio_gallery', { filename: item.filename, subfolder: item.subfolder });
    } catch (e) {
        await anomalousAlert(t('audioDeleteFailed', { error: e.message }));
        return;
    }
    if (activePlayBtn && rowEl.contains(activePlayBtn)) stopGalleryAudio();
    rowEl.classList.add('is-removing');
    setTimeout(() => {
        rowEl.remove();
        onDeleted?.();
    }, 200);
}

async function copySpeech(speech, btn) {
    if (!navigator.clipboard?.writeText) return;
    try {
        await navigator.clipboard.writeText(speech);
    } catch (_) {
        return;
    }
    btn.classList.add('is-done');
    btn.title = t('audioSpeechCopied');
    setTimeout(() => {
        btn.classList.remove('is-done');
        btn.title = t('audioCopySpeech');
    }, 1500);
}

// ---------- rows ----------

/** Title line, emotion chips and an expandable per-segment script for audio with recorded speech. */
function renderSpeech(generation) {
    const segments = parseTaggedSpeech(generation.speech);
    const box = el('div', 'anomalous-track-speech');

    const chips = el('span', 'anomalous-track-emotions');
    const emotions = [...new Set(segments.map(segment => segment.emotion))];
    if (emotions.length > 1 || emotions[0] !== 'main') {
        for (const emotion of emotions) {
            chips.appendChild(el('span', `anomalous-track-emotion${emotion === 'main' ? ' is-main' : ''}`, emotion === 'main' ? t('scriptDirectorMainEmotion') : emotion));
        }
    }

    const summary = el('button', 'anomalous-track-speech-summary', segments.map(segment => segment.text).join(' '));
    summary.type = 'button';
    summary.title = t('audioExpandSpeech');

    const full = el('div', 'anomalous-track-speech-full');
    full.hidden = true;
    for (const segment of segments) {
        const line = el('div', 'anomalous-track-speech-line');
        line.append(el('span', `anomalous-track-emotion${segment.emotion === 'main' ? ' is-main' : ''}`, segment.emotion === 'main' ? t('scriptDirectorMainEmotion') : segment.emotion), el('span', '', segment.text));
        full.appendChild(line);
    }
    summary.onclick = () => {
        full.hidden = !full.hidden;
        box.classList.toggle('is-expanded', !full.hidden);
    };

    box.append(chips, summary, full);
    return box;
}

function createTrackRow(item, { mode, onDeleted, onSaved }) {
    const generation = item.generation || null;
    const row = el('div', 'anomalous-audio-track-item');
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', generation?.speech || item.audio_url);
    });

    const main = el('div', 'anomalous-track-main');
    const playBtn = iconButton('', SVG.PLAY, t('audioPlay'), () => startPlayback(item.audio_url, playBtn, progressFill, timeLabel));

    const infoCol = el('div', 'anomalous-track-info');
    const meta = el('div', 'anomalous-track-meta');
    if (item.subfolder) meta.appendChild(el('span', 'anomalous-track-folder', item.subfolder));
    const metaParts = [];
    if (generation) metaParts.push(item.filename);
    if (generation?.sample) metaParts.push(t('audioVoiceLabel', { name: voiceName(generation.sample) }));
    if (generation?.seed !== null && generation?.seed !== undefined) metaParts.push(t('audioSeedLabel', { seed: generation.seed }));
    metaParts.push(formatBytes(item.size_bytes), formatDate(item.mtime));
    metaParts.forEach(part => meta.appendChild(el('span', '', part)));
    if (!generation) {
        const nameEl = el('span', 'anomalous-track-name', item.filename);
        nameEl.title = item.filename;
        infoCol.appendChild(nameEl);
    }
    infoCol.appendChild(meta);

    const progressTrack = el('div', 'anomalous-track-progress-bar');
    const progressFill = el('div', 'anomalous-track-progress-fill');
    progressTrack.appendChild(progressFill);
    progressTrack.onclick = (e) => {
        if (!activeAudio || activePlayBtn !== playBtn || !activeAudio.duration) return;
        const rect = progressTrack.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        activeAudio.currentTime = ratio * activeAudio.duration;
    };
    const timeLabel = el('span', 'anomalous-track-time', '--:--');

    const actions = el('div', 'anomalous-track-actions');
    if (generation) actions.appendChild(iconButton('', SVG.COPY, t('audioCopySpeech'), btn => copySpeech(generation.speech, btn)));
    if (mode === 'preview') {
        const saveBtn = el('button', 'anomalous-audio-tool-btn anomalous-track-save', t('audioSavePreview'));
        saveBtn.type = 'button';
        saveBtn.onclick = async (e) => {
            e.stopPropagation();
            saveBtn.disabled = true;
            try {
                const data = await postJson('/anomalous/save_audio_preview', { filename: item.filename, subfolder: item.subfolder });
                saveBtn.textContent = t('audioPreviewSaved');
                row.classList.add('is-saved');
                onSaved?.(data.audio);
            } catch (err) {
                saveBtn.disabled = false;
                await anomalousAlert(t('audioSaveFailed', { error: err.message }));
            }
        };
        actions.appendChild(saveBtn);
    } else {
        const dlBtn = el('a', 'anomalous-audio-play-btn');
        dlBtn.href = item.audio_url;
        dlBtn.download = item.filename;
        dlBtn.innerHTML = SVG.DOWNLOAD;
        dlBtn.title = t('audioDownload');
        actions.append(dlBtn, iconButton('anomalous-track-delete', SVG.TRASH, t('audioDelete'), () => requestDeleteTrack(item, row, onDeleted)));
    }

    main.append(playBtn, infoCol, progressTrack, timeLabel, actions);
    row.appendChild(main);
    if (generation) row.appendChild(renderSpeech(generation));
    return row;
}

// ---------- sections ----------

function renderGalleryToolbar({ onRefresh, onSearch }) {
    const bar = el('div', 'anomalous-audio-toolbar');

    const left = el('div', 'anomalous-audio-title-group');
    const iconBox = el('div', 'anomalous-audio-icon-box');
    iconBox.innerHTML = SVG.AUDIO_WAVE;
    const textGroup = el('div', 'anomalous-audio-title-stack');
    textGroup.append(el('span', 'anomalous-audio-title-text', t('audioGalleryTitle')), el('span', 'anomalous-audio-sub-text', t('audioGallerySubtitle')));
    left.append(iconBox, textGroup);

    const right = el('div', 'anomalous-audio-right-actions');
    const search = el('label', 'anomalous-audio-search');
    const searchIcon = el('span');
    searchIcon.innerHTML = SVG.SEARCH;
    const input = el('input');
    input.type = 'search';
    input.placeholder = t('audioGallerySearch');
    let timer = null;
    input.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(() => onSearch(input.value.trim()), SEARCH_DELAY_MS);
    };
    search.append(searchIcon, input);

    const countBadge = el('span', 'anomalous-track-count');
    right.append(search, countBadge, iconButton('', SVG.REFRESH, t('audioRefresh'), onRefresh));
    bar.append(left, right);
    return { bar, countBadge };
}

async function fetchJson(url) {
    const resp = await fetch(url);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
}

/** Unsaved previews from ComfyUI's temp folder; hidden when there are none. */
async function renderPreviewSection(section, isCurrent, onSaved) {
    let data;
    try {
        data = await fetchJson('/anomalous/audio_previews');
    } catch (_) {
        return;
    }
    if (!isCurrent() || !data.audios?.length) return;
    const details = el('details', 'anomalous-track-previews');
    const summary = el('summary', 'anomalous-track-previews-summary');
    summary.append(
        el('span', 'anomalous-track-previews-title', `${t('audioPreviewsTitle')} · ${data.audios.length}`),
        el('span', 'anomalous-track-previews-hint', t('audioPreviewsHint')),
    );
    const list = el('div', 'anomalous-track-list');
    data.audios.forEach(item => list.appendChild(createTrackRow(item, { mode: 'preview', onSaved })));
    details.append(summary, list);
    section.replaceChildren(details);
}

/** Only the latest render for a container may write into it. */
export async function renderAudioGallery(container) {
    const token = {};
    renderTokens.set(container, token);
    const isCurrent = () => renderTokens.get(container) === token;
    stopGalleryAudio();

    const wrapper = el('div', 'anomalous-audio-gallery-wrapper');
    const previewSection = el('div', 'anomalous-track-preview-section');
    const listSection = el('div', 'anomalous-track-list-section');
    let loadList = () => {};
    const { bar, countBadge } = renderGalleryToolbar({
        onRefresh: () => renderAudioGallery(container),
        onSearch: query => loadList(query),
    });
    wrapper.append(bar, previewSection, listSection);
    container.replaceChildren(wrapper);

    let listToken = null;
    let lastQuery = '';
    loadList = async (query = '') => {
        lastQuery = query;
        const current = {};
        listToken = current;
        const isCurrentList = () => isCurrent() && listToken === current;
        stopGalleryAudio();

        const status = renderMessage('anomalous-audio-status', t('audioLoading'));
        const trackList = el('div', 'anomalous-track-list');
        const loadMore = el('button', 'anomalous-audio-tool-btn anomalous-track-load-more', t('audioLoadMore'));
        loadMore.type = 'button';
        listSection.replaceChildren(status);

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
                data = await fetchJson(`/anomalous/audio_gallery?page=${page + 1}&limit=${PAGE_SIZE}&q=${encodeURIComponent(query)}`);
            } catch (e) {
                if (!isCurrentList()) return;
                if (page === 0) status.replaceWith(renderMessage('anomalous-audio-status is-error', t('audioLoadFailed', { error: e.message })));
                else await anomalousAlert(t('audioLoadFailed', { error: e.message }));
                loadMore.disabled = false;
                return;
            }
            if (!isCurrentList()) return;
            page = data.page;
            total = data.total;
            const audios = data.audios || [];
            audios.forEach(item => trackList.appendChild(createTrackRow(item, { mode: 'output', onDeleted })));
            shown += audios.length;
            updateCount();

            if (page === 1) {
                const empty = query ? t('audioNoMatches') : t('audioGalleryEmpty');
                status.replaceWith(total === 0 ? renderMessage('anomalous-audio-empty', empty) : trackList);
            }
            loadMore.disabled = false;
            if (data.has_more) {
                if (!loadMore.isConnected) listSection.appendChild(loadMore);
            } else {
                loadMore.remove();
            }
        };
        loadMore.onclick = loadNextPage;
        await loadNextPage();
    };

    await Promise.all([
        renderPreviewSection(previewSection, isCurrent, () => loadList(lastQuery)),
        loadList(''),
    ]);
}

function renderMessage(className, message) {
    return el('div', className, message);
}
