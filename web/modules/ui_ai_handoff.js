/**
 * Handing something in Anomalous to an AI: "✦ Hand to AI" on a model's page, on an output
 * image's inspector, on a combo card and on a saved workflow's page. The user says what they want (prefilled), Anomalous
 * starts a task with it (POST /anomalous/ai_tasks, `about` naming the model, image or combo, so
 * the AI gets their ids from begin_task) and shows the sentence to paste into the AI app:
 * Anomalous cannot wake an AI by itself. The task waits on the AI workbench until an AI takes it.
 * Pictures (the inspector's ✦, a gallery card's menu) can instead go to the task open now: the AI
 * gets the pictures themselves and what made them (POST /anomalous/ai_tasks/{id}/pictures).
 */

import { translate as t } from './locales.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { aiWindow, copyLine, openConnectGuide } from './ui_ai_connect.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

/** `leave()`: closes the window it was handed from (the image inspector) before going to the AI page. */
async function handToAi(owner, wish, about, leave = null) {
    const title = await anomalousPrompt(t('aiHandPrompt'), wish, t('aiHand'));
    if (title === null || title === undefined || !String(title).trim()) return;
    try {
        const response = await fetch('/anomalous/ai_tasks', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: String(title).trim(), about }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    } catch (error) {
        await anomalousAlert(error.message);
        return;
    }
    const body = el('div', 'anomalous-ai-handoff');
    body.append(el('p', 'anomalous-ai-handoff-text', t('aiHandMade')),
        copyLine(t('aiHandSentence', { task: String(title).trim() }), { code: false, label: t('aiConnectCopySentence') }));
    const actions = el('div', 'anomalous-ai-handoff-actions');
    const close = aiWindow(t('aiHand'), body);
    actions.append(button('anomalous-ai-link', t('aiHandWatch'), () => {
        close();
        leave?.();
        owner?.show?.();
        owner?.goTo?.('ai');
    }), button('anomalous-ai-link', t('aiHandNotConnected'), () => {
        close();
        openConnectGuide();
    }));
    body.append(actions);
}

/** A model on its page; `where` is {type, path_idx, subfolder} as the browser lists it. */
export function handModelToAi(owner, model, where) {
    const name = model.metadata?.custom_name || model.metadata?.name || model.filename;
    const folder = String(where.subfolder || '').replace(/^\/+|\/+$/g, '');
    const modelId = `${where.type}:${where.path_idx}:${folder ? `${folder}/` : ''}${model.filename}`;
    return handToAi(owner, t('aiHandModelWish', { name }), [{ type: 'model', model_id: modelId, label: name }]);
}

/** The task an AI is on now (the latest one not ended), or null. */
async function openTask() {
    try {
        const tasks = (await (await fetch('/anomalous/ai_tasks?limit=20')).json()).tasks || [];
        return tasks.find(task => !task.ended) || null;
    } catch (_) {
        return null;
    }
}

/** Hands output pictures `images` ("subfolder/name.png") to `task`'s AI, with the user's words if they want. */
async function sendPictures(owner, task, images, leave) {
    const text = await anomalousPrompt(t('aiPicturesWords'), '', t('aiPicturesSend', { count: images.length }), { multiline: true, rows: 3, maxLength: 1000 });
    if (text === null || text === undefined) return;
    try {
        const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}/pictures`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images, text: String(text).trim() }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    } catch (error) {
        await anomalousAlert(error.message);
        return;
    }
    showWorkbenchToast(t('aiPicturesSent', { count: images.length, task: task.title || t('aiUntitled') }));
    leave?.();
}

/** Output pictures to an AI: to the task open now (its AI gets the pictures themselves), or a new task about the first. */
export async function handPicturesToAi(owner, images, leave = null) {
    const task = await openTask();
    if (task) {
        const toTask = await anomalousConfirm(t('aiPicturesWhere', { task: task.title || t('aiUntitled'), count: images.length }), t('aiHand'),
            { okLabel: t('aiPicturesToTask'), noLabel: t('aiPicturesNewTask'), okClass: 'anomalous-btn-primary' });
        if (toTask === null) return;
        if (toTask) return sendPictures(owner, task, images, leave);
    }
    const name = images[0].split('/').pop();
    return handToAi(owner, t('aiHandImageWish', { name }), [{ type: 'image', image: images[0], label: name }], leave);
}

/** An output image in the inspector (item: {filename, subfolder, sourceImage}); `leave` closes the inspector. */
export function handImageToAi(owner, item, leave) {
    const source = item.sourceImage || { type: 'output', filename: item.filename, subfolder: item.subfolder || '' };
    if (source.type && source.type !== 'output') return anomalousAlert(t('aiHandOutputOnly'));
    return handPicturesToAi(owner, [[source.subfolder, source.filename].filter(Boolean).join('/')], leave);
}

/** A saved workflow (its page on the Workflows page). */
export function handWorkflowToAi(owner, name) {
    return handToAi(owner, t('aiHandWorkflowWish', { name }), [{ type: 'workflow', name, label: name }]);
}

/** A combo (its card on the Combos page). */
export function handComboToAi(owner, note) {
    return handToAi(owner, t('aiHandComboWish', { name: note.name }), [{ type: 'combo', name: note.name, label: note.name }]);
}
