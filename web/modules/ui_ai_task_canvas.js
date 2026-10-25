/**
 * Where the AI works on the canvas for a task (api/ai_task_canvas.py), in the task's header: a
 * copy (Anomalous copies the open workflow into a tab of the task's own before the AI's first
 * change) or the open canvas. The chip says which ("AI edits a copy ▾") and opens the two to pick
 * from, each with what it means (Esc or a press elsewhere closes it); once the task has its copy,
 * "Show the copy" brings that tab to the front and shows the canvas (mcp_task_tab.js).
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { icon } from './ui_ai_icons.js';
import { showTab } from './mcp_task_tab.js';

const MODES = ['new', 'current'];

// The header is drawn anew as the task changes: the list open for a task opens again with it.
let openFor = null; // the id of the task whose list is open
let dropOpen = null; // takes that list and its listeners away

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

function closeMenu() {
    openFor = null;
    dropOpen?.();
}

/** The two ways to pick from, under the chip `anchor` in `box`; `changed()` after a new one is set. */
function modeMenu(box, anchor, task, mode, changed, focus = true) {
    dropOpen?.();
    const menu = el('div', 'anomalous-ai-canvas-menu');
    menu.dataset.anomalousEscape = '1'; // Esc closes this list, not the browser
    menu.setAttribute('role', 'menu');
    for (const choice of MODES) {
        const item = el('button', `anomalous-ai-canvas-choice${choice === mode ? ' is-on' : ''}`);
        item.type = 'button';
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(choice === mode));
        const words = el('span', 'anomalous-ai-canvas-choice-words');
        words.append(el('span', 'anomalous-ai-canvas-choice-name', t(`aiCanvasPick_${choice}`)), el('span', 'anomalous-ai-canvas-choice-why', t(`aiCanvasPickWhy_${choice}`)));
        item.append(icon(choice === mode ? 'check' : '', 15), words);
        item.onclick = async () => {
            closeMenu();
            if (choice === mode) return;
            anchor.disabled = true;
            try {
                await setMode(task, choice);
            } catch (error) {
                anchor.disabled = false;
                await anomalousAlert(error.message);
                return;
            }
            changed();
        };
        menu.append(item);
    }
    function drop() {
        menu.remove();
        anchor.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', escape);
        if (dropOpen === drop) dropOpen = null;
    }
    const outside = (event) => { if (!menu.contains(event.target) && !anchor.contains(event.target)) closeMenu(); };
    const escape = (event) => { if (event.key === 'Escape') setTimeout(closeMenu); }; // after the browser's Esc saw the mark
    box.append(menu);
    anchor.setAttribute('aria-expanded', 'true');
    if (focus) menu.querySelector('.is-on')?.focus({ preventScroll: true });
    setTimeout(() => { if (dropOpen === drop) document.addEventListener('pointerdown', outside, true); });
    document.addEventListener('keydown', escape);
    dropOpen = drop;
    openFor = task.id;
}

/** The header's canvas controls for `task`; `changed()` after the mode changed, `showCanvas()` reveals the canvas. */
export function canvasControls(task, changed, showCanvas) {
    const box = el('div', 'anomalous-ai-canvas');
    const mode = task.canvas_mode === 'current' ? 'current' : 'new';
    const chip = el('button', `anomalous-ai-tool anomalous-ai-canvas-mode is-${mode}`);
    chip.type = 'button';
    chip.title = t(`aiCanvasHint_${mode}`);
    chip.setAttribute('aria-haspopup', 'menu');
    chip.setAttribute('aria-expanded', 'false');
    chip.append(icon(mode === 'new' ? 'copy' : 'page', 15), el('span', '', t(`aiCanvas_${mode}`)), icon('chevronDown', 13));
    chip.onclick = () => (openFor === task.id && dropOpen ? closeMenu() : modeMenu(box, chip, task, mode, changed));
    box.append(chip);
    const tab = task.canvas?.tab;
    if (mode === 'new' && tab?.path) {
        const go = el('button', 'anomalous-ai-canvas-tab');
        go.type = 'button';
        go.title = t('aiCanvasGo', { name: tab.name });
        go.append(icon('arrowRight', 13), el('span', 'anomalous-ai-canvas-tab-name', t('aiCanvasGoShort')));
        go.onclick = async () => {
            if (await showTab(tab.path)) showCanvas();
            else await anomalousAlert(t('aiCanvasGone', { name: tab.name }));
        };
        box.append(go);
    }
    if (openFor === task.id) modeMenu(box, chip, task, mode, changed, false);
    else if (openFor) closeMenu(); // another task is shown now
    return box;
}
