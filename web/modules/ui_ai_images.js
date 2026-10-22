/** AI results use the gallery's real inspector, keep menu and parameter comparison. */
import { translate as t } from './locales.js';
import { isVideo, outputPicture, outputUrl, pictureKey, picturePreview, uniquePictures } from './ai_task_view.js';
import { openParamCompare } from './ui_param_compare.js';
import { showImageWorkbench } from './ui_gallery_detail.js';
import { openKeepMenu } from './ui_keep_menu.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(label, run) {
    const node = el('button', 'anomalous-ai-action', label);
    node.type = 'button';
    node.onclick = run;
    return node;
}

/** Kept in the task view, not on the browser owner: unrelated gallery selections stay intact. */
export function imageComparison(images, selection = {}) {
    const candidates = uniquePictures(images).filter(outputPicture);
    if (candidates.length < 2) return null;
    const keys = candidates.map(pictureKey);
    if (!keys.includes(selection.a)) selection.a = keys[0];
    if (!keys.includes(selection.b)) selection.b = keys.at(-1);
    const box = el('div', 'anomalous-ai-comparison');
    const heading = el('div', 'anomalous-ai-comparison-title', t('aiCompareImages'));
    const fields = el('div', 'anomalous-ai-comparison-fields');
    const compare = button(t('aiCompareParams'), () => {
        const a = candidates.find(image => pictureKey(image) === selection.a);
        const b = candidates.find(image => pictureKey(image) === selection.b);
        if (a && b && selection.a !== selection.b) openParamCompare({ image: outputPicture(a) }, { image: outputPicture(b) });
    });
    const update = () => { compare.disabled = selection.a === selection.b; };
    for (const side of ['a', 'b']) {
        const label = el('label', 'anomalous-ai-comparison-side');
        label.append(el('span', '', side.toUpperCase()));
        const select = el('select', 'anomalous-ai-comparison-select');
        for (const [index, image] of candidates.entries()) {
            const name = [image.subfolder, image.filename].filter(Boolean).join('/');
            const option = el('option', '', `${index + 1} · ${name}`);
            option.value = pictureKey(image);
            select.append(option);
        }
        select.value = selection[side];
        select.onchange = () => { selection[side] = select.value; update(); };
        label.append(select);
        fields.append(label);
    }
    update();
    box.append(heading, fields, compare);
    return box;
}

/** Also used below the AI's panel pictures, so their actions have the same meaning. */
export function imageActions(image, owner) {
    const source = outputPicture(image);
    if (!source) return null;
    const actions = el('div', 'anomalous-ai-image-actions');
    const inspect = button(t('aiImageDetails'), () => { void showImageWorkbench(owner, source, outputUrl(image)); });
    const keep = button(t('aiKeepImage'), event => { void openKeepMenu(owner, event.currentTarget, source); });
    inspect.disabled = keep.disabled = !owner;
    actions.append(inspect, button(t('compareWithCanvas'), () => openParamCompare({ image: source }, { canvas: true })), keep);
    return actions;
}

export function imageCard(image, owner, { compact = false } = {}) {
    const card = el('figure', `anomalous-ai-image-card${compact ? ' is-compact' : ''}`);
    const open = button(t('aiOpenPicture'), () => owner?.showGalleryViewer?.(outputUrl(image), isVideo(image)));
    open.className = 'anomalous-ai-image-preview';
    open.setAttribute('aria-label', `${t('aiOpenPicture')} · ${image.filename}`);
    const media = el(isVideo(image) ? 'video' : 'img', '');
    if (isVideo(image)) {
        media.src = outputUrl(image);
        media.preload = 'none';
        media.muted = true;
    } else {
        media.src = picturePreview(image);
        media.loading = 'lazy';
        media.alt = image.filename;
    }
    open.replaceChildren(media);
    if (isVideo(image)) open.append(el('span', 'anomalous-ai-video-label', t('aiVideoResult')));
    card.append(open);
    const caption = el('figcaption', 'anomalous-ai-image-caption', image.filename);
    caption.title = [image.subfolder, image.filename].filter(Boolean).join('/');
    card.append(caption);
    if (!compact) {
        const actions = imageActions(image, owner);
        if (actions) card.append(actions);
    }
    return card;
}

/** Bounded initial DOM; more results are drawn only when requested. */
export function imageResults(images, owner, { compact = false } = {}) {
    const items = uniquePictures(images);
    const box = el('div', `anomalous-ai-image-results${compact ? ' is-compact' : ''}`);
    const grid = el('div', 'anomalous-ai-image-grid');
    const more = button(t('aiMoreResults'), draw);
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
