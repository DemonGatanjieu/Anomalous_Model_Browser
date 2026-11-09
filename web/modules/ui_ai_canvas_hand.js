/**
 * Handing the canvas to an AI in one click: 「交给 AI…」 in a node's and the empty canvas's right-click menu
 * (canvas_menu.js) opens a small window with ready wishes for this canvas or this node, and the line to change.
 * It goes to the task an AI is on now as a message (POST /anomalous/ai_tasks/{id}/message), or starts a task about
 * this canvas (about {type: 'canvas', tab}: the AI's work starts from that tab, api/ai_task_canvas.py) and shows the
 * sentence to paste into the AI app (ui_ai_handoff.js startTask): Anomalous cannot wake an AI by itself. A node
 * showing saved pictures hands them over as the gallery does (handPicturesToAi). A run on this page that fails
 * offers 「让 AI 看看」 with ComfyUI's words for a moment (watchRunErrors).
 */

import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { translate as t } from './locales.js';
import { aiWindow } from './ui_ai_connect.js';
import { handPicturesToAi, openTask, startTask } from './ui_ai_handoff.js';
import { anomalousAlert } from './ui_dialog.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const CANVAS_WISHES = ['run', 'fix', 'explain', 'more'];
const NODE_WISHES = ['explain', 'tune'];
const ERROR_GAP_MS = 10000; // one offer for a run of failures

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, run) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = run;
    return node;
}

/** The tab open now: {path, name}. */
function frontTab() {
    const tab = app.extensionManager?.workflow?.activeWorkflow;
    return { path: String(tab?.path || ''), name: String(tab?.filename || tab?.path || '').replace(/\.json$/i, '') };
}

const nodeName = node => `#${node.id} ${node.title || node.type}`;

/** The saved pictures `node` shows ("subfolder/name"), for handPicturesToAi. */
const nodePictures = node => (node?.images || []).filter(item => item?.type === 'output' && item.filename)
    .map(item => [item.subfolder, item.filename].filter(Boolean).join('/'));

async function message(task, text) {
    const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}/message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
}

/**
 * The window: what is handed (the canvas, or `node` on it), ready wishes, the line (`given` first), and where it
 * goes: the task an AI is on now, or a new one. `getBrowser` gives AMB's window.
 */
export async function handCanvasToAi(getBrowser, node = null, given = '') {
    const tab = frontTab();
    const what = node ? t('aiCanvasOfNode', { node: nodeName(node) }) : t('aiCanvasOfCanvas', { name: tab.name });
    const task = await openTask();
    const body = el('div', 'anomalous-ai-canvas-hand');
    body.append(el('p', 'anomalous-ai-handoff-text', node ? t('aiCanvasLeadNode', { node: nodeName(node) }) : t('aiCanvasLead', { name: tab.name })));
    const line = el('textarea', 'anomalous-ai-canvas-line');
    line.rows = 3;
    line.maxLength = 1000;
    const wishes = el('div', 'anomalous-ai-canvas-wishes');
    for (const key of node ? NODE_WISHES : CANVAS_WISHES) {
        const words = t(node ? `aiNodeWish_${key}` : `aiCanvasWish_${key}`);
        wishes.append(button('anomalous-ai-canvas-wish', words, () => { line.value = words; line.focus(); }));
    }
    line.value = given || wishes.firstChild?.textContent || '';
    body.append(wishes, line);
    let close = () => {};
    const pictures = nodePictures(node);
    if (pictures.length) {
        body.append(button('anomalous-ai-link', t('aiNodePictures', { count: pictures.length }), () => {
            close();
            void handPicturesToAi(getBrowser(), pictures);
        }));
    }
    const say = () => String(line.value || '').trim();
    const actions = el('div', 'anomalous-ai-canvas-actions');
    if (task) {
        actions.append(button('anomalous-btn anomalous-btn-primary', t('aiCanvasToTask', { task: task.title || t('aiUntitled') }), async () => {
            if (!say()) return line.focus();
            try {
                await message(task, `${say()}${what}`);
            } catch (error) {
                return anomalousAlert(error.message);
            }
            close();
            showWorkbenchToast(t('aiCanvasSent', { task: task.title || t('aiUntitled') }));
        }));
    }
    actions.append(button(`anomalous-btn${task ? '' : ' anomalous-btn-primary'}`, task ? t('aiCanvasNewTask') : t('aiHand'), () => {
        if (!say()) return line.focus();
        close();
        void startTask(getBrowser(), `${say()}${what}`, tab.path ? [{ type: 'canvas', tab: tab.path, label: tab.name }] : []);
    }));
    body.append(actions);
    close = aiWindow(t('aiHand'), body);
    line.focus();
}

/** Offers 「让 AI 看看」 when a run fails on this page, with ComfyUI's words. */
export function watchRunErrors(getBrowser) {
    let last = 0;
    api.addEventListener('execution_error', ({ detail }) => {
        if (Date.now() - last < ERROR_GAP_MS) return;
        last = Date.now();
        const why = `${detail?.node_type ? `${detail.node_type}: ` : ''}${detail?.exception_message || ''}`.trim().slice(0, 300);
        showWorkbenchToast(t('aiRunFailed', { why: why.slice(0, 120) }), {
            label: t('aiRunFailedAsk'), run: () => void handCanvasToAi(getBrowser, null, t('aiCanvasWish_error', { why })),
        });
    });
}
