/**
 * The large view of a picture or video (the gallery's, the AI pages', the image workbench's
 * stage): wheel to zoom, drag to move, Esc or a click beside it to close. An output picture is
 * shown through /anomalous/output_preview (shownUrl), which gives the picture itself or, for a
 * very large one (a 4x upscale of hundreds of megapixels), a 4096 px copy; then a note says so
 * and opens the original in a browser tab when the user wants it.
 */

import { translate as t } from './locales.js';
import { formatSize } from './file_size.js';

/** Where a picture address is shown from: an output picture's (`/view?…&type=output`) through output_preview, others as they are. */
export function shownUrl(src) {
    const url = new URL(src, window.location.href);
    if (url.pathname !== '/view' || (url.searchParams.get('type') || 'output') !== 'output') return src;
    return `/anomalous/output_preview?${new URLSearchParams({ filename: url.searchParams.get('filename') || '', subfolder: url.searchParams.get('subfolder') || '' })}`;
}

/** The viewer's note for a large picture shown smaller (`original`: its own address), or nothing. */
async function noteLarge(note, original, shown) {
    note.hidden = true;
    if (shown === original) return;
    const info = await fetch(`${shown}&info=1`).then(response => (response.ok ? response.json() : null)).catch(() => null);
    if (!info?.preview || note.dataset.src !== original) return; // another picture came meanwhile
    note.replaceChildren(Object.assign(document.createElement('span'), {
        textContent: t('galleryViewerPreview', { size: info.width ? `${info.width} × ${info.height}` : '', bytes: formatSize(info.bytes) }),
    }));
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = t('galleryViewerOriginal');
    open.title = t('galleryViewerOriginalTip');
    open.onclick = () => window.open(original, '_blank', 'noopener');
    note.append(open);
    note.hidden = false;
}

export function showGalleryViewer(src, isVideo = false) {
    let viewer = document.getElementById('anomalous-gallery-viewer');
    if (!viewer) {
        viewer = document.createElement('dialog');
        viewer.id = 'anomalous-gallery-viewer';
        viewer.className = 'anomalous-gallery-viewer';

        const closeBtn = document.createElement('div');
        closeBtn.className = 'anomalous-gallery-viewer-close';
        closeBtn.innerHTML = '&times;';

        const img = document.createElement('img');
        img.id = 'anomalous-gallery-viewer-img';

        const video = document.createElement('video');
        video.id = 'anomalous-gallery-viewer-video';
        video.controls = true;
        video.autoplay = true;
        video.loop = true;
        video.style.display = 'none';
        // Double-click: full screen and back. Some Chrome builds already do this for a video
        // with controls; the check afterwards keeps it from toggling twice.
        video.addEventListener('dblclick', () => {
            const before = Boolean(document.fullscreenElement);
            setTimeout(() => {
                if (Boolean(document.fullscreenElement) !== before) return;
                if (before) document.exitFullscreen?.().catch(() => {});
                else video.requestFullscreen?.().catch(() => {});
            }, 200);
        });

        const note = document.createElement('div');
        note.className = 'anomalous-gallery-viewer-note';
        note.hidden = true;

        viewer.appendChild(img);
        viewer.appendChild(video);
        viewer.appendChild(closeBtn);
        viewer.appendChild(note);

        let scale = 1;
        let translateX = 0;
        let translateY = 0;
        let isDragging = false;
        let startX = 0, startY = 0;

        const resetTransform = () => {
            scale = 1; translateX = 0; translateY = 0;
            img.style.transform = `translate(0px, 0px) scale(1)`;
            img.style.cursor = 'grab';
        };
        viewer.stopVideo = () => {
            video.pause();
            video.style.display = 'none';
            video.removeAttribute('src');
            video.load(); // drops the file, so its sound cannot go on
        };

        // However it closes (the ×, a click beside the picture, Esc), the video stops at once.
        // The dialog's 'close' event comes later (half a second, seen), when another video
        // may already play in it: it only catches a close nothing else saw.
        const stop = () => {
            resetTransform();
            viewer.stopVideo();
        };
        const closeViewer = () => {
            stop();
            viewer.close();
        };
        viewer.addEventListener('cancel', stop); // Esc
        viewer.addEventListener('close', () => {
            if (!viewer.open) stop();
        });
        closeBtn.onclick = closeViewer;
        viewer.onclick = (e) => {
            if (e.target === viewer) closeViewer();
        };

        viewer.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = 0.1;
            if (e.deltaY < 0) scale += zoomFactor;
            else scale = Math.max(0.1, scale - zoomFactor);
            img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        });

        img.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isDragging = true;
            startX = e.clientX - translateX;
            startY = e.clientY - translateY;
            img.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            translateX = e.clientX - startX;
            translateY = e.clientY - startY;
            img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
            img.style.cursor = 'grab';
        });

        document.body.appendChild(viewer);
    }

    const img = document.getElementById('anomalous-gallery-viewer-img');
    const video = document.getElementById('anomalous-gallery-viewer-video');
    const note = viewer.querySelector('.anomalous-gallery-viewer-note');
    note.dataset.src = src;
    note.hidden = true;

    if (isVideo) {
        img.style.display = 'none';
        video.style.display = 'block';
        video.src = src;
        video.play().catch(() => {});
    } else {
        viewer.stopVideo();
        img.style.display = 'block';
        img.src = shownUrl(src);
        void noteLarge(note, src, img.getAttribute('src'));
        img.style.transform = `translate(0px, 0px) scale(1)`;
        img.style.cursor = 'grab';
    }

    if (!viewer.open) viewer.showModal();
}
