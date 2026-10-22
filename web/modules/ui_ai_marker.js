/**
 * Marking a picture for the AI (api/ai_marks.py): a window over the page with the picture and four
 * simple tools - box, circle, arrow, pen - in three colours, each mark numbered with a note of what
 * to change there, plus a line for the whole picture. "Send to the AI" draws the marks onto the
 * picture (at most MAX_EDGE px), and sends that PNG with the marks (fractions of the picture) to
 * the task; the AI gets the notes and the marked picture with its next step. Also the timeline's
 * row for marks sent (marksStep). Every listener lives as long as the window and goes with it.
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { outputUrl } from './ai_task_view.js';

const TOOLS = [['box', '□'], ['circle', '○'], ['arrow', '↗'], ['pen', '✎']];
const COLORS = ['#ff4d4f', '#fadb14', '#36cfc9'];
const MAX_EDGE = 2048;
const MAX_MARKS = 20;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    if (title) {
        node.title = title;
        node.setAttribute('aria-label', title);
    }
    return node;
}

/** The box around a mark's points (fractions), the form the server keeps. */
function bounds(mark) {
    const xs = mark.points.map(point => point[0]);
    const ys = mark.points.map(point => point[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** One mark on a 2D context of `w` × `h` px, with its number. */
function paint(ctx, mark, number, w, h) {
    const line = Math.max(2, Math.round(Math.min(w, h) * 0.006));
    const [start, end] = [mark.points[0], mark.points.at(-1)];
    ctx.strokeStyle = mark.color;
    ctx.fillStyle = mark.color;
    ctx.lineWidth = line;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (mark.shape === 'box') {
        ctx.rect(start[0] * w, start[1] * h, (end[0] - start[0]) * w, (end[1] - start[1]) * h);
    } else if (mark.shape === 'circle') {
        ctx.ellipse((start[0] + end[0]) / 2 * w, (start[1] + end[1]) / 2 * h,
            Math.abs(end[0] - start[0]) / 2 * w, Math.abs(end[1] - start[1]) / 2 * h, 0, 0, Math.PI * 2);
    } else if (mark.shape === 'arrow') {
        const [x0, y0, x1, y1] = [start[0] * w, start[1] * h, end[0] * w, end[1] * h];
        const angle = Math.atan2(y1 - y0, x1 - x0);
        const head = line * 5;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - head * Math.cos(angle - 0.45), y1 - head * Math.sin(angle - 0.45));
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - head * Math.cos(angle + 0.45), y1 - head * Math.sin(angle + 0.45));
    } else {
        mark.points.forEach(([x, y], index) => (index ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
    }
    ctx.stroke();
    // The number, where the mark starts.
    const radius = line * 4;
    const cx = Math.min(w - radius, Math.max(radius, start[0] * w));
    const cy = Math.min(h - radius, Math.max(radius, start[1] * h));
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = `bold ${Math.round(radius * 1.2)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), cx, cy + 1);
}

/**
 * Opens the marker on output picture `image` ({filename, subfolder}) for task `taskId`;
 * `sent()` runs once the marks are with the task.
 */
export function openMarker(image, taskId, sent) {
    const marks = [];
    let tool = 'box';
    let color = COLORS[0];
    let drawing = null;

    const overlay = el('div', 'anomalous-ai-marker-overlay');
    const dialog = el('div', 'anomalous-ai-marker');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const head = el('div', 'anomalous-ai-marker-head');
    head.append(el('div', 'anomalous-ai-marker-title', t('aiMarkTitle')), button('anomalous-ai-connect-close', '×', () => close(), t('close')));

    const bar = el('div', 'anomalous-ai-marker-tools');
    const toolButtons = TOOLS.map(([id, glyph]) => {
        const pick = button(`anomalous-ai-marker-tool${id === tool ? ' is-on' : ''}`, `${glyph} ${t(`aiMarkTool_${id}`)}`, () => {
            tool = id;
            toolButtons.forEach(item => item.classList.toggle('is-on', item === pick));
        });
        return pick;
    });
    const colorButtons = COLORS.map((value) => {
        const swatch = button(`anomalous-ai-marker-color${value === color ? ' is-on' : ''}`, '', () => {
            color = value;
            colorButtons.forEach(item => item.classList.toggle('is-on', item === swatch));
        }, t('aiMarkColor'));
        swatch.style.background = value;
        return swatch;
    });
    bar.append(...toolButtons, el('span', 'anomalous-ai-marker-gap'), ...colorButtons, el('span', 'anomalous-ai-marker-gap'),
        button('anomalous-ai-marker-tool', `↶ ${t('aiMarkUndo')}`, () => { marks.pop(); redraw(); }),
        button('anomalous-ai-marker-tool', t('aiMarkClear'), () => { marks.length = 0; redraw(); }));

    const stage = el('div', 'anomalous-ai-marker-stage');
    const picture = el('img', 'anomalous-ai-marker-picture');
    picture.alt = image.filename;
    picture.src = outputUrl({ ...image, folder: 'output' });
    const canvas = el('canvas', 'anomalous-ai-marker-canvas');
    stage.append(picture, canvas);

    const side = el('div', 'anomalous-ai-marker-side');
    const list = el('ol', 'anomalous-ai-marker-list');
    const empty = el('div', 'anomalous-ai-marker-empty', t('aiMarkEmpty'));
    const whole = el('textarea', 'anomalous-ai-marker-whole');
    whole.placeholder = t('aiMarkWhole');
    whole.rows = 3;
    const send = button('anomalous-ai-marker-send', t('aiMarkSend'), () => void submit());
    side.append(empty, list, whole, send, el('div', 'anomalous-ai-marker-note', t('aiMarkNote')));

    const body = el('div', 'anomalous-ai-marker-body');
    const left = el('div', 'anomalous-ai-marker-left');
    left.append(bar, stage);
    body.append(left, side);
    dialog.append(head, body);
    overlay.append(dialog);

    const point = (event) => {
        const rect = canvas.getBoundingClientRect();
        return [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))];
    };

    function redraw() {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        [...marks, ...(drawing ? [drawing] : [])].forEach((mark, index) => paint(ctx, mark, index + 1, canvas.width, canvas.height));
        empty.hidden = marks.length > 0;
        // The notes, one per mark, kept as typed.
        while (list.children.length > marks.length) list.lastElementChild.remove();
        marks.forEach((mark, index) => {
            let row = list.children[index];
            if (!row) {
                row = el('li', 'anomalous-ai-marker-row');
                const note = el('input', 'anomalous-ai-marker-input');
                note.placeholder = t('aiMarkNotePlaceholder');
                note.addEventListener('input', () => { marks[[...list.children].indexOf(row)].note = note.value; });
                row.append(el('span', 'anomalous-ai-marker-badge'), el('span', 'anomalous-ai-marker-shape'), note,
                    button('anomalous-ai-marker-remove', '×', () => { marks.splice([...list.children].indexOf(row), 1); redraw(); }, t('aiMarkRemove')));
                list.append(row);
                requestAnimationFrame(() => note.focus());
            }
            const badge = row.querySelector('.anomalous-ai-marker-badge');
            badge.textContent = String(index + 1);
            badge.style.background = mark.color;
            row.querySelector('.anomalous-ai-marker-shape').textContent = t(`aiMarkTool_${mark.shape}`);
            row.querySelector('input').value = mark.note || '';
        });
    }

    const fit = () => {
        canvas.width = picture.clientWidth;
        canvas.height = picture.clientHeight;
        redraw();
    };
    picture.addEventListener('load', fit);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(picture);

    canvas.addEventListener('pointerdown', (event) => {
        if (marks.length >= MAX_MARKS) return;
        canvas.setPointerCapture(event.pointerId);
        drawing = { shape: tool, color, points: [point(event)], note: '' };
    });
    canvas.addEventListener('pointermove', (event) => {
        if (!drawing) return;
        if (drawing.shape === 'pen') drawing.points.push(point(event));
        else drawing.points[1] = point(event);
        redraw();
    });
    const finish = () => {
        if (!drawing) return;
        const box = bounds(drawing);
        // A click without a drag makes no mark.
        if (drawing.points.length > 1 && (box.w > 0.01 || box.h > 0.01)) marks.push(drawing);
        drawing = null;
        redraw();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    const onKey = (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA') {
            event.preventDefault();
            event.stopPropagation();
            marks.pop();
            redraw();
        }
    };
    window.addEventListener('keydown', onKey, true);

    function close() {
        observer?.disconnect();
        window.removeEventListener('keydown', onKey, true);
        overlay.remove();
    }

    /** The picture with the marks drawn on it, as a PNG data URL. */
    function composite() {
        const scale = Math.min(1, MAX_EDGE / Math.max(picture.naturalWidth, picture.naturalHeight));
        const out = document.createElement('canvas');
        out.width = Math.round(picture.naturalWidth * scale);
        out.height = Math.round(picture.naturalHeight * scale);
        const ctx = out.getContext('2d');
        ctx.drawImage(picture, 0, 0, out.width, out.height);
        marks.forEach((mark, index) => paint(ctx, mark, index + 1, out.width, out.height));
        return out.toDataURL('image/png');
    }

    async function submit() {
        if (!marks.length) {
            await anomalousAlert(t('aiMarkNeedOne'));
            return;
        }
        send.disabled = true;
        try {
            const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(taskId)}/marks`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: [image.subfolder, image.filename].filter(Boolean).join('/'), png: composite(), text: whole.value.trim(),
                    marks: marks.map(mark => ({ shape: mark.shape, note: (mark.note || '').trim(), ...bounds(mark) })),
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
        } catch (error) {
            send.disabled = false;
            await anomalousAlert(error.message);
            return;
        }
        close();
        sent?.();
    }

    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    document.body.append(overlay);
}

/** The timeline's row body for marks the user sent: the marked picture, the notes, whether the AI has them. */
export function marksStep(step, taskId, owner) {
    const box = el('div', 'anomalous-ai-marks-sent');
    const url = `/anomalous/ai_tasks/${encodeURIComponent(taskId)}/marks/${encodeURIComponent(step.marked)}`;
    const open = button('anomalous-ai-marks-sent-picture', '', () => owner?.showGalleryViewer?.(url, false), t('aiOpenPicture'));
    const picture = el('img');
    picture.src = url;
    picture.alt = step.image?.filename || '';
    picture.loading = 'lazy';
    open.append(picture);
    const notes = el('ol', 'anomalous-ai-marks-sent-notes');
    for (const mark of step.marks || []) notes.append(el('li', '', mark.note || t('aiMarkNoNote')));
    box.append(open, el('div', 'anomalous-ai-marks-sent-words'));
    const words = box.lastChild;
    if (step.note) words.append(el('div', 'anomalous-ai-user-text', step.note));
    words.append(notes, el('div', 'anomalous-ai-user-state', t(step.delivered ? 'aiMarksSeen' : 'aiMarksWaiting')));
    return box;
}
