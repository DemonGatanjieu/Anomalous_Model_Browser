/**
 * Image workbench header, stage zoom, and filmstrip rendering.
 */

import { translate } from './locales.js';
import { text } from './ui_dom.js';
import { fileBaseName } from './material_inspector.js';

const t = (key, params) => translate(key, params);

/**
 * Preload adjacent images for smooth instant transitions
 */
export function preloadAdjacentImages(items, currentIndex) {
    const indices = [currentIndex - 1, currentIndex + 1];
    for (const idx of indices) {
        if (idx >= 0 && idx < items.length) {
            const url = items[idx]?.url;
            if (url) {
                const img = new Image();
                img.src = url;
            }
        }
    }
}

/**
 * Build Workbench Header
 */
export function buildWorkbenchHeader(item, index, total, onNavigate, context = {}) {
    const { workbench, onDismiss } = context;
    const header = document.createElement('div');
    header.className = 'anomalous-workbench-header';

    // Left info
    const leftWrap = document.createElement('div');
    leftWrap.className = 'anomalous-workbench-header-left';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'anomalous-workbench-back-btn';
    backBtn.innerHTML = '‹';
    backBtn.title = `${t('close') || '关闭'} (Esc)`;
    backBtn.onclick = () => onDismiss?.();
    leftWrap.appendChild(backBtn);

    const titleBox = document.createElement('div');
    titleBox.className = 'anomalous-workbench-title-box';

    const filenameEl = document.createElement('span');
    filenameEl.className = 'anomalous-workbench-title-filename';
    filenameEl.textContent = fileBaseName(item.filename) || 'Image';
    filenameEl.title = item.filename || '';
    titleBox.appendChild(filenameEl);

    const metaTags = document.createElement('div');
    metaTags.className = 'anomalous-workbench-title-tags';
    if (item.subfolder) {
        const folderTag = text(metaTags, 'span', item.subfolder, 'anomalous-workbench-tag');
        folderTag.title = item.subfolder;
    }
    const ext = (item.filename || '').split('.').pop()?.toUpperCase();
    if (ext) text(metaTags, 'span', ext, 'anomalous-workbench-tag is-ext');
    titleBox.appendChild(metaTags);

    leftWrap.appendChild(titleBox);
    header.appendChild(leftWrap);

    // Center image counter & quick switcher
    const centerWrap = document.createElement('div');
    centerWrap.className = 'anomalous-workbench-header-center';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'anomalous-workbench-nav-btn';
    prevBtn.innerHTML = '‹';
    prevBtn.title = t('workbenchPrev') || '上一张 (←)';
    prevBtn.disabled = index <= 0;
    prevBtn.onclick = () => onNavigate(index - 1);

    const counter = document.createElement('span');
    counter.className = 'anomalous-workbench-counter';
    counter.textContent = `${index + 1} / ${total}`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'anomalous-workbench-nav-btn';
    nextBtn.innerHTML = '›';
    nextBtn.title = t('workbenchNext') || '下一张 (→)';
    nextBtn.disabled = index >= total - 1;
    nextBtn.onclick = () => onNavigate(index + 1);

    centerWrap.append(prevBtn, counter, nextBtn);
    header.appendChild(centerWrap);

    // Right Action Buttons
    const rightWrap = document.createElement('div');
    rightWrap.className = 'anomalous-workbench-header-right';

    // Toggle Filmstrip button
    const filmstripToggle = document.createElement('button');
    filmstripToggle.type = 'button';
    filmstripToggle.className = workbench?.isFilmstripVisible
        ? 'anomalous-workbench-tool-btn is-active'
        : 'anomalous-workbench-tool-btn';
    filmstripToggle.innerHTML = '🎞️';
    filmstripToggle.title = t('workbenchFilmstrip') || (window.anomalous_browser_lang === 'zh' ? '侧栏缩略图' : 'Thumbnail Rail');
    filmstripToggle.onclick = () => {
        if (!workbench) return;
        workbench.isFilmstripVisible = !workbench.isFilmstripVisible;
        filmstripToggle.classList.toggle('is-active', workbench.isFilmstripVisible);
        if (workbench.filmstripEl) workbench.filmstripEl.classList.toggle('is-hidden', !workbench.isFilmstripVisible);
    };
    rightWrap.appendChild(filmstripToggle);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'anomalous-workbench-close-btn';
    closeBtn.innerHTML = '×';
    closeBtn.title = `${t('close') || '关闭'} (Esc)`;
    closeBtn.onclick = () => onDismiss?.();
    rightWrap.appendChild(closeBtn);

    header.appendChild(rightWrap);
    return header;
}

/**
 * Setup pan & zoom interactions on the stage image
 */
export function setupStagePanZoom(stage, img) {
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let startX = 0, startY = 0;

    const applyTransform = () => {
        img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        img.style.cursor = scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default';
    };

    const resetTransform = () => {
        scale = 1;
        translateX = 0;
        translateY = 0;
        applyTransform();
    };

    stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        const newScale = Math.min(Math.max(0.2, scale + delta), 8);
        scale = newScale;
        if (scale <= 1) { translateX = 0; translateY = 0; }
        applyTransform();
    }, { passive: false });

    img.addEventListener('mousedown', (e) => {
        if (scale <= 1) return;
        e.preventDefault();
        isDragging = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        applyTransform();
    });

    const onMouseMove = (e) => {
        if (!isDragging) return;
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        applyTransform();
    };

    const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        applyTransform();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // Double click to toggle 1:1 vs fit
    stage.addEventListener('dblclick', (e) => {
        if (e.target !== img) return;
        if (scale === 1) {
            scale = 2;
            translateX = 0;
            translateY = 0;
        } else {
            resetTransform();
        }
        applyTransform();
    });

    return {
        reset: resetTransform,
        zoomIn: () => { scale = Math.min(8, scale + 0.3); applyTransform(); },
        zoomOut: () => { scale = Math.max(0.2, scale - 0.3); applyTransform(); },
        cleanup: () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        }
    };
}

/**
 * Build Left Vertical Filmstrip Rail
 */
export function buildFilmstripRail(items, currentIndex, onNavigate, workbench = null) {
    const rail = document.createElement('div');
    rail.className = 'anomalous-workbench-filmstrip';
    if (workbench && workbench.isFilmstripVisible === false) {
        rail.classList.add('is-hidden');
    }

    const track = document.createElement('div');
    track.className = 'anomalous-workbench-filmstrip-track';

    items.forEach((item, idx) => {
        const thumbWrap = document.createElement('div');
        thumbWrap.className = idx === currentIndex
            ? 'anomalous-workbench-filmstrip-thumb is-active'
            : 'anomalous-workbench-filmstrip-thumb';
        thumbWrap.title = `${idx + 1}. ${fileBaseName(item.filename)}`;

        const thumbImg = document.createElement('img');
        thumbImg.src = item.url;
        thumbImg.loading = 'lazy';
        thumbImg.alt = '';
        thumbWrap.appendChild(thumbImg);

        const badge = document.createElement('span');
        badge.className = 'anomalous-workbench-thumb-index';
        badge.textContent = String(idx + 1);
        thumbWrap.appendChild(badge);

        thumbWrap.onclick = (e) => {
            e.stopPropagation();
            if (idx !== currentIndex) onNavigate(idx);
        };

        track.appendChild(thumbWrap);

        // Auto-center active thumbnail vertically
        if (idx === currentIndex) {
            requestAnimationFrame(() => {
                setTimeout(() => {
                    thumbWrap.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
                }, 40);
            });
        }
    });

    rail.appendChild(track);
    return rail;
}
