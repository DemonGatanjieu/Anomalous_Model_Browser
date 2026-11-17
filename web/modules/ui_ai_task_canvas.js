/**
 * Where the AI works on the canvas for a task (api/ai_task_canvas.py): a copy (Anomalous copies the open
 * workflow into a tab of the task's own before the AI's first change) or the open canvas. The two are picked
 * in the ⋯ of the task's head (ui_ai_task_head.js), each saying what it means; once the task has its copy,
 * a link under the title brings that tab to the front and shows the canvas (mcp_task_tab.js).
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { icon } from './ui_ai_icons.js';
import { showTab } from './mcp_task_tab.js';

const MODES = ['new', 'current'];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

async function setMode(task, mode) {
    const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canvas: mode }),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText);
}

/** The ⋯'s items for `task`: a heading and the two ways, the one in use ticked; `changed()` after a new one is set. */
export function canvasModeItems(task, changed) {
    const mode = task.canvas_mode === 'current' ? 'current' : 'new';
    return [{ heading: t('aiCanvasMenuHeading') }, ...MODES.map(choice => ({
        label: t(`aiCanvasPick_${choice}`), title: t(`aiCanvasPickWhy_${choice}`), checked: choice === mode,
        run: async () => {
            if (choice === mode) return;
            try {
                await setMode(task, choice);
            } catch (error) {
                await anomalousAlert(error.message);
                return;
            }
            changed();
        },
    }))];
}

/** The link under the title to the copy the task works on, as a list: none until it has one. `showCanvas()` reveals the canvas. */
export function copyLink(task, showCanvas) {
    const tab = task.canvas?.tab;
    if (task.canvas_mode === 'current' || !tab?.path) return [];
    const go = el('button', 'anomalous-ai-link anomalous-ai-canvas-tab');
    go.type = 'button';
    go.title = t('aiCanvasGo', { name: tab.name });
    go.append(icon('copy', 13), el('span', '', t('aiCanvasGoShort')));
    go.onclick = async () => {
        if (await showTab(tab.path)) showCanvas();
        else await anomalousAlert(t('aiCanvasGone', { name: tab.name }));
    };
    return [go];
}
