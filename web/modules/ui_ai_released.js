/**
 * The pictures the user let the AI of a private task see (api/ai_release.py): parts of a picture they boxed
 * in the marker and a stand-in picture. Their thumbnails (on the marks' timeline row, on the stand-in's, and
 * listed in the privacy overview so nothing released goes unseen), the stand-in's timeline row, and the
 * request that makes a stand-in (POST /anomalous/ai_tasks/{id}/standin: the task's last workflow with a
 * harmless prompt, run on this ComfyUI).
 */

import { translate as t } from './locales.js';
import { deliveryState } from './ui_ai_delivery.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

const fileUrl = (taskId, file) => `/anomalous/ai_tasks/${encodeURIComponent(taskId)}/marks/${encodeURIComponent(file)}`;

/** Every picture released in `task`, oldest first: [{file, kind}]. */
export function releasedOf(task) {
    return (task?.steps || []).flatMap(step => step.released || []);
}

/** A row of thumbnails of released pictures `items` ({file, kind}); a press shows one large. */
export function releasedThumbs(taskId, items, owner) {
    const row = el('div', 'anomalous-ai-released');
    for (const item of items) {
        const open = el('button', 'anomalous-ai-released-thumb');
        open.type = 'button';
        open.title = t(item.kind === 'standin' ? 'aiReleasedStandin' : 'aiReleasedPart');
        open.onclick = () => owner?.showGalleryViewer?.(fileUrl(taskId, item.file), false);
        const picture = el('img');
        picture.src = fileUrl(taskId, item.file);
        picture.alt = '';
        picture.loading = 'lazy';
        open.append(picture);
        row.append(open);
    }
    return row;
}

/** The timeline's row body for a stand-in the user released: the picture, what it is, whether the AI has it. */
export function standinStep(step, taskId, owner) {
    const box = el('div', 'anomalous-ai-standin-step');
    box.append(releasedThumbs(taskId, step.released || [], owner), el('div', 'anomalous-ai-user-text', t('aiStandinStepWords')), deliveryState(step));
    return box;
}

const STANDIN_ERRORS = new Set(['no_picture', 'reads_picture', 'no_prompt', 'unreachable', 'refused', 'failed', 'busy']);

/** Asks this ComfyUI for a stand-in of `task`'s last picture; resolves when it is a step (why not, in words, otherwise). */
export async function requestStandin(task) {
    const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}/standin`, { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(STANDIN_ERRORS.has(data.code) ? t(`aiStandinError_${data.code}`) : (data.error || `HTTP ${response.status}`));
    return data.step;
}
