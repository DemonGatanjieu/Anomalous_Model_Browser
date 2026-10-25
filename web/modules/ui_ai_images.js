/**
 * The pictures an AI task made, in the timeline, the results strip and the stage's panels, with
 * the gallery's own tools: on each picture, shown when the pointer is over it, the image
 * inspector, the comparison with the canvas and the Keep menu; and a tick in its corner. Two
 * ticked pictures (from any step or task) are compared with ui_param_compare.js from the bar at
 * the foot of the page (compareBar); a third tick replaces the oldest. On the AI page a fourth tool
 * marks the picture for the AI (setMarker: the workbench opens ui_ai_marker.js for its task).
 */
import { translate as t } from './locales.js';
import { isVideo, outputPicture, outputUrl, pictureKey, picturePreview, uniquePictures } from './ai_task_view.js';
import { openParamCompare } from './ui_param_compare.js';
import { showImageWorkbench } from './ui_gallery_detail.js';
import { openKeepMenu } from './ui_keep_menu.js';
import { icon } from './ui_ai_icons.js';

const ticked = new Map(); // picture key → output picture, oldest first
const listeners = new Set();
let marker = null; // (image) => marks it for the AI; set while the AI page shows a task

export function setMarker(open) {
    marker = open;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, run, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = run;
    if (title) {
        node.title = title;
        node.setAttribute('aria-label', title);
    }
    return node;
}

function ticksChanged() {
    document.querySelectorAll('.anomalous-ai-tick').forEach((tick) => {
        const on = ticked.has(tick.dataset.key);
        tick.classList.toggle('is-on', on);
        tick.setAttribute('aria-pressed', String(on));
    });
    listeners.forEach(listener => listener());
}

function toggleTick(image) {
    const key = pictureKey(image);
    if (ticked.has(key)) ticked.delete(key);
    else {
        ticked.set(key, outputPicture(image));
        if (ticked.size > 2) ticked.delete(ticked.keys().next().value);
    }
    ticksChanged();
}

/**
 * The tick and the tools over a picture: `holder` is the element around its picture (made
 * position: relative by the class). Videos and files outside the output folder get neither.
 */
export function decoratePicture(holder, image, owner) {
    const source = outputPicture(image);
    if (!source) return holder;
    holder.classList.add('anomalous-ai-pic');
    const key = pictureKey(image);
    const tick = button(`anomalous-ai-tick${ticked.has(key) ? ' is-on' : ''}`, '✓', (event) => {
        event.stopPropagation();
        toggleTick(image);
    }, t('aiTickCompare'));
    tick.dataset.key = key;
    tick.setAttribute('aria-pressed', String(ticked.has(key)));
    const tools = el('div', 'anomalous-ai-pic-tools');
    const inspect = button('anomalous-ai-pic-tool', 'ⓘ', () => { void showImageWorkbench(owner, source, outputUrl(image)); }, t('aiImageDetails'));
    const keep = button('anomalous-ai-pic-tool', '☆', event => { void openKeepMenu(owner, event.currentTarget, source); }, t('aiKeepImage'));
    inspect.disabled = keep.disabled = !owner;
    tools.append(inspect, button('anomalous-ai-pic-tool', '⇄', () => openParamCompare({ image: source }, { canvas: true }), t('compareWithCanvas')), keep);
    if (marker) tools.append(button('anomalous-ai-pic-tool is-mark', '✎', () => marker(source), t('aiMarkTitle')));
    holder.append(tick, tools);
    return holder;
}

/** The bar at the foot of the AI page while pictures are ticked: compare the two, or let go. */
export function compareBar() {
    const bar = el('div', 'anomalous-ai-compare-bar');
    const text = el('span', 'anomalous-ai-compare-text');
    const compare = button('anomalous-ai-compare-go', t('aiCompareParams'), () => {
        const [a, b] = [...ticked.values()];
        if (a && b) openParamCompare({ image: a }, { image: b });
    });
    const clear = button('anomalous-ai-compare-clear', '×', () => {
        ticked.clear();
        ticksChanged();
    }, t('aiTickClear'));
    bar.append(text, compare, clear);
    const update = () => {
        bar.hidden = ticked.size === 0;
        text.textContent = ticked.size === 2 ? t('aiTickedTwo') : t('aiTickedOne');
        compare.hidden = ticked.size !== 2;
    };
    listeners.add(update);
    update();
    return bar;
}

/**
 * Output picture `image` in `img`: its 512 px thumbnail first (quick to load and to draw, so a task
 * opens without waiting for its pictures), then the file itself if the picture shows larger than
 * the thumbnail can be sharp. Other pictures (not in the output folder) as they are.
 */
export function showPicture(img, image) {
    const thumbnail = picturePreview(image);
    const full = outputUrl(image);
    img.decoding = 'async';
    if (thumbnail !== full) {
        img.addEventListener('load', () => {
            if (img.clientWidth * (window.devicePixelRatio || 1) > img.naturalWidth * 1.1) img.src = full; // the thumbnail stays until it is in
        }, { once: true });
    }
    img.src = thumbnail;
}

/** A picture that is no longer in the output folder (deleted or moved): said so, nothing to open. */
export function gonePicture(image) {
    const box = el('div', 'anomalous-ai-gone');
    box.title = t('aiPictureGoneHint', { name: [image.subfolder, image.filename].filter(Boolean).join('/') });
    box.append(icon('image', 22), el('span', 'anomalous-ai-gone-words', t('aiPictureGone')));
    return box;
}

export function imageCard(image, owner, { compact = false } = {}) {
    const card = el('figure', `anomalous-ai-image-card${compact ? ' is-compact' : ''}${image.gone ? ' is-gone' : ''}`);
    if (image.gone) {
        card.append(gonePicture(image));
        if (!compact) card.append(el('figcaption', 'anomalous-ai-image-caption', image.filename));
        return card;
    }
    const open = button('anomalous-ai-image-preview', '', () => owner?.showGalleryViewer?.(outputUrl(image), isVideo(image)),
        `${t('aiOpenPicture')} · ${image.filename}`);
    const media = el(isVideo(image) ? 'video' : 'img', '');
    if (isVideo(image)) {
        media.src = outputUrl(image);
        media.preload = 'none';
        media.muted = true;
    } else {
        media.loading = 'lazy';
        showPicture(media, image);
        media.alt = image.filename;
        media.onerror = () => { // deleted while the page was open
            card.classList.add('is-gone');
            card.querySelector('.anomalous-ai-image-frame')?.replaceWith(gonePicture(image));
        };
    }
    open.append(media);
    if (isVideo(image)) open.append(el('span', 'anomalous-ai-video-label', t('aiVideoResult')));
    const frame = el('div', 'anomalous-ai-image-frame');
    frame.append(open);
    card.append(decoratePicture(frame, image, owner));
    if (!compact) {
        const caption = el('figcaption', 'anomalous-ai-image-caption', image.filename);
        caption.title = [image.subfolder, image.filename].filter(Boolean).join('/');
        card.append(caption);
    }
    return card;
}

/** Bounded initial DOM; more results are drawn only when requested. */
export function imageResults(images, owner, { compact = false } = {}) {
    const items = uniquePictures(images);
    const box = el('div', `anomalous-ai-image-results${compact ? ' is-compact' : ''}`);
    const grid = el('div', 'anomalous-ai-image-grid');
    const more = button('anomalous-ai-action', t('aiMoreResults'), draw);
    let shown = 0;
    function draw() {
        grid.append(...items.slice(shown, shown + 12).map(image => imageCard(image, owner, { compact })));
        shown += 12;
        more.hidden = shown >= items.length;
    }
    draw();
    box.append(grid, more);
    return box;
}
