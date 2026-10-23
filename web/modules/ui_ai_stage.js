/**
 * The AI's stage blocks, drawn by Anomalous (ui_ai_panel.js uses them): marks on a picture
 * (circles or boxes with a label; the label zooms there), the slider (two pictures over each
 * other, a line to drag), picks (pictures with a reason, "Take this one", "Put on the canvas"
 * and drag onto the canvas) and the diagram (boxes and arrows laid out by ai_stage_layout.js; a
 * box naming a canvas node finds it). The AI sends data only: every element and line here is
 * made by this file, text through textContent, numbers through style.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { anomalousConfirm } from './ui_dialog.js';
import { arrowEnds, diagramBoxes, markBox } from './ai_stage_layout.js';
import { isVideo, outputPicture, outputUrl } from './ai_task_view.js';
import { decoratePicture, gonePicture } from './ui_ai_images.js';
import { openParamCompare } from './ui_param_compare.js';

const SVG = 'http://www.w3.org/2000/svg';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, onClick, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

const list = value => (Array.isArray(value) ? value : []);

function media(item) {
    if (item.gone) return gonePicture(item);
    const node = el(isVideo(item) ? 'video' : 'img');
    node.src = outputUrl(item);
    if (node.tagName === 'IMG') {
        node.loading = 'lazy';
        node.alt = item.caption || item.label || item.filename;
    } else {
        node.muted = true;
        node.preload = 'metadata';
    }
    return node;
}

/**
 * The marks over a picture: each shape carries its number; the labels are listed under the
 * picture (in `legendHost`), where a click zooms the picture there (again: back).
 */
export function addMarks(frame, picture, marks, legendHost) {
    if (!list(marks).length) return;
    frame.classList.add('has-marks');
    const layer = el('div', 'anomalous-ai-marks');
    const legend = el('div', 'anomalous-ai-mark-legend');
    let zoomed = null;
    const zoom = (index) => {
        const again = zoomed === index;
        zoomed = again ? null : index;
        picture.style.transformOrigin = `${marks[index].x * 100}% ${marks[index].y * 100}%`;
        picture.style.transform = again ? '' : 'scale(2.4)';
        frame.classList.toggle('is-zoomed', !again);
        legend.querySelectorAll('.anomalous-ai-mark-label').forEach((node, at) => node.classList.toggle('is-on', !again && at === index));
    };
    marks.forEach((mark, index) => {
        const box = markBox(mark);
        const color = mark.color || 'red';
        const shape = el('span', `anomalous-ai-mark is-${color}${box.round ? ' is-round' : ''}`);
        shape.style.left = `${box.left}%`;
        shape.style.top = `${box.top}%`;
        shape.style.width = `${box.width}%`;
        if (box.height !== null) shape.style.height = `${box.height}%`;
        shape.append(el('span', 'anomalous-ai-mark-number', index + 1));
        layer.append(shape);
        const label = button(`anomalous-ai-mark-label is-${color}`, '', (event) => {
            event.stopPropagation();
            zoom(index);
        }, t('aiMarkZoom'));
        label.append(el('span', 'anomalous-ai-mark-number', index + 1), el('span', '', mark.label || t('aiMarkPlace')));
        legend.append(label);
    });
    frame.append(layer);
    (legendHost || frame.parentNode)?.append(legend);
}

/** Before and after over each other; the line between them follows the pointer or the slider. */
export function slider(block) {
    const box = el('div', 'anomalous-ai-slider');
    const stage = el('div', 'anomalous-ai-slider-stage');
    const before = media(block.before);
    const after = media(block.after);
    after.classList.add('anomalous-ai-slider-after');
    const line = el('span', 'anomalous-ai-slider-line');
    line.append(el('span', 'anomalous-ai-slider-knob', '⇔'));
    const range = el('input', 'anomalous-ai-slider-range');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.value = '50';
    range.setAttribute('aria-label', t('aiSliderHint'));
    const set = (value) => {
        after.style.clipPath = `inset(0 0 0 ${value}%)`;
        line.style.left = `${value}%`;
    };
    range.addEventListener('input', () => set(Number(range.value)));
    range.addEventListener('keydown', event => event.stopPropagation());
    set(50);
    stage.append(before, after, line, range);
    if (block.before_label) stage.append(el('span', 'anomalous-ai-slider-tag is-before', block.before_label));
    if (block.after_label) stage.append(el('span', 'anomalous-ai-slider-tag is-after', block.after_label));
    box.append(stage);
    // Before and after are two output pictures: their saved settings side by side, as in the gallery.
    const [was, now] = [outputPicture(block.before), outputPicture(block.after)];
    if (was && now) {
        box.append(button('anomalous-ai-link anomalous-ai-slider-compare', t('aiCompareParams'),
            () => openParamCompare({ image: was }, { image: now })));
    }
    return box;
}

/** The ComfyUI workflow saved in an output picture, opened as when the picture is dropped on ComfyUI. */
async function putOnCanvas(item, owner) {
    if (!await anomalousConfirm(t('aiPickCanvasConfirm', { name: item.label || item.filename }), t('aiPickCanvas'))) return;
    const response = await fetch(outputUrl(item));
    const blob = await response.blob();
    const file = new File([blob], item.filename, { type: blob.type || 'image/png' });
    owner?.close?.();
    await app.handleFile?.(file);
}

/**
 * Pictures to choose from. `ctx.answers` / `ctx.send(ids)` / `ctx.closed`: as for choices.
 */
export function picks(block, ctx) {
    const box = el('div', 'anomalous-ai-picks');
    if (block.question) box.append(el('div', 'anomalous-ai-panel-question', block.question));
    const answer = ctx.answers[block.id];
    const chosen = new Set(answer?.choice || []);
    const grid = el('div', 'anomalous-ai-picks-grid');
    const note = el('div', 'anomalous-ai-panel-error');
    const confirm = button('anomalous-ai-panel-send', t('aiPanelSend'), () => {
        void ctx.send([...grid.querySelectorAll('.anomalous-ai-pick.is-picked')].map(card => card.dataset.id), note);
    });
    confirm.disabled = true;
    for (const item of list(block.items)) {
        const card = el('div', `anomalous-ai-pick${chosen.has(item.id) ? ' is-picked' : ''}${item.recommended ? ' is-recommended' : ''}`);
        card.dataset.id = item.id;
        const frame = button('anomalous-ai-pick-picture', '', () => ctx.openPicture(outputUrl(item), isVideo(item)), t('aiOpenPicture'));
        const picture = media(item);
        picture.draggable = true;
        picture.addEventListener('dragstart', (event) => {
            const url = new URL(outputUrl(item), window.location.href).href;
            event.dataTransfer.setData('text/uri-list', url);
            event.dataTransfer.setData('text/plain', url);
        });
        frame.append(picture);
        if (item.recommended) frame.append(el('span', 'anomalous-ai-pick-badge', t('aiPickRecommended')));
        const holder = el('div', 'anomalous-ai-pick-frame');
        holder.append(frame);
        card.append(decoratePicture(holder, item, ctx.owner));
        addMarks(frame, picture, item.marks, card);
        if (item.label) card.append(el('div', 'anomalous-ai-pick-label', item.label));
        if (item.reason) card.append(el('div', 'anomalous-ai-pick-reason', item.reason));
        const actions = el('div', 'anomalous-ai-pick-actions');
        const take = button('anomalous-ai-pick-take', chosen.has(item.id) ? `✓ ${t('aiPickTaken')}` : t('aiPickTake'), () => {
            if (!block.multiple) return void ctx.send([item.id], note);
            card.classList.toggle('is-picked');
            confirm.disabled = !grid.querySelector('.anomalous-ai-pick.is-picked');
        });
        take.disabled = Boolean(answer) || ctx.closed;
        actions.append(take, button('anomalous-ai-link', t('aiPickCanvas'), () => putOnCanvas(item, ctx.owner), t('aiPickCanvasHint')));
        card.append(actions);
        grid.append(card);
    }
    box.append(grid);
    if (block.multiple && !answer && !ctx.closed) box.append(confirm);
    box.append(note);
    return box;
}

/** Boxes and arrows; the layout is ai_stage_layout.js's, every line is drawn here. */
export function diagram(block, ctx) {
    const direction = block.direction === 'down' ? 'down' : 'right';
    const nodes = list(block.nodes);
    const edges = list(block.edges);
    const { boxes, width, height } = diagramBoxes(nodes, edges, direction);
    const wrap = el('div', 'anomalous-ai-diagram-wrap');
    const stage = el('div', 'anomalous-ai-diagram');
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    const lines = document.createElementNS(SVG, 'svg');
    lines.setAttribute('class', 'anomalous-ai-diagram-lines');
    lines.setAttribute('width', String(width));
    lines.setAttribute('height', String(height));
    const defs = document.createElementNS(SVG, 'defs');
    const marker = document.createElementNS(SVG, 'marker');
    const markerId = `anomalous-ai-arrow-${Math.random().toString(36).slice(2, 8)}`;
    for (const [key, value] of Object.entries({ id: markerId, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' })) marker.setAttribute(key, value);
    const tip = document.createElementNS(SVG, 'path');
    tip.setAttribute('d', 'M0 0 L10 5 L0 10 z');
    marker.append(tip);
    defs.append(marker);
    lines.append(defs);
    for (const edge of edges) {
        const a = boxes.get(edge.from);
        const b = boxes.get(edge.to);
        if (!a || !b) continue;
        const { x1, y1, x2, y2 } = arrowEnds(a, b, direction);
        const path = document.createElementNS(SVG, 'path');
        const bend = direction === 'down' ? `C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}` : `C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;
        path.setAttribute('d', `M${x1} ${y1} ${bend}`);
        path.setAttribute('marker-end', `url(#${markerId})`);
        lines.append(path);
        if (edge.label) {
            const label = el('span', 'anomalous-ai-diagram-edge', edge.label);
            label.style.left = `${(x1 + x2) / 2}px`;
            label.style.top = `${(y1 + y2) / 2}px`;
            stage.append(label);
        }
    }
    stage.prepend(lines);
    for (const node of nodes) {
        const place = boxes.get(node.id);
        const findable = Boolean(node.node_id);
        const box = findable
            ? button(`anomalous-ai-diagram-box is-findable${node.color ? ` is-${node.color}` : ''}`, '', () => ctx.locateNode(node.node_id), t('aiDiagramFind'))
            : el('div', `anomalous-ai-diagram-box${node.color ? ` is-${node.color}` : ''}`);
        box.style.left = `${place.x}px`;
        box.style.top = `${place.y}px`;
        box.style.width = `${place.w}px`;
        box.style.height = `${place.h}px`;
        box.append(el('span', 'anomalous-ai-diagram-label', `${node.label}${findable ? ' ◎' : ''}`));
        if (node.detail) box.append(el('span', 'anomalous-ai-diagram-detail', node.detail));
        stage.append(box);
    }
    wrap.append(stage);
    return wrap;
}
