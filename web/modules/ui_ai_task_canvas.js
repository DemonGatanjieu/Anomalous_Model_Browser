/**
 * Where the AI works on the canvas for a task (api/ai_task_canvas.py), in the task's header: a
 * tab of the task's own (Anomalous copies the open workflow there before the AI's first change)
 * or the open canvas, switched with a click; and, once the task has its tab, a chip that brings
 * that tab to the front and shows the canvas (mcp_task_tab.js).
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { icon } from './ui_ai_icons.js';
import { showTab } from './mcp_task_tab.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** The header's canvas controls for `task`; `changed()` after the mode changed, `showCanvas()` reveals the canvas. */
export function canvasControls(task, changed, showCanvas) {
    const box = el('div', 'anomalous-ai-canvas');
    const mode = task.canvas_mode === 'current' ? 'current' : 'new';
    const toggle = el('button', `anomalous-ai-tool anomalous-ai-canvas-mode is-${mode}`);
    toggle.type = 'button';
    toggle.title = t(`aiCanvasHint_${mode}`);
    toggle.append(icon(mode === 'new' ? 'copy' : 'page', 15), el('span', '', t(`aiCanvas_${mode}`)));
    toggle.onclick = async () => {
        toggle.disabled = true;
        try {
            const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canvas: mode === 'new' ? 'current' : 'new' }),
            });
            if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText);
        } catch (error) {
            toggle.disabled = false;
            await anomalousAlert(error.message);
            return;
        }
        changed();
    };
    box.append(toggle);
    const tab = task.canvas?.tab;
    if (mode === 'new' && tab?.path) {
        const go = el('button', 'anomalous-ai-canvas-tab');
        go.type = 'button';
        go.title = t('aiCanvasGo', { name: tab.name });
        go.append(el('span', 'anomalous-ai-canvas-tab-name', tab.name));
        go.onclick = async () => {
            if (await showTab(tab.path)) showCanvas();
            else await anomalousAlert(t('aiCanvasGone', { name: tab.name }));
        };
        box.append(go);
    }
    return box;
}
