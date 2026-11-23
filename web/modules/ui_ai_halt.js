/**
 * "Pause" in a task's head (ui_ai_task_head.js) and on the canvas card (ui_ai_float.js): the AI stops and nothing is taken back; it hears so
 * before it can act again and the task waits until the user writes (POST .../halt {take_back: false}).
 * "Stop and take back" in its ⋯: one way out of a task that goes wrong. The server stops its runs, says no where a step waits for an OK and tells the AI, which
 * gets the halt before it can act again (POST /anomalous/ai_tasks/{id}/halt, api/ai_run_control.py).
 * The page then closes the copy Anomalous made for the task (mcp_task_tab.js closeCopy; the user's
 * own workflow was never changed) or, where the AI worked on another tab, undoes what of its
 * changes still can be (ui_ai_chain.js). The pictures made stay. The task stands halted until the
 * user writes to it again (ai_task_status.js haltOf).
 */

import { translate as t } from './locales.js';
import { haltOf } from './ai_task_status.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { iconButton } from './ui_ai_icons.js';
import { undoableCount, undoNow } from './ui_ai_chain.js';
import { closeCopy, copyOpen } from './mcp_task_tab.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const NAME = 24; // a copy is named after its task: the start of a long name says which

const short = name => (name.length > NAME ? `${name.slice(0, NAME)}…` : name);

/** Whether `task` has something to halt: an AI worked on it, it has not ended, no halt stands. */
export function canHalt(task) {
    return Boolean(task) && !task.ended && (task.steps || []).some(step => step.kind !== 'user') && !haltOf(task);
}

/** Says what a halt of `task` does, and on a yes does it. `entries`: activity entries by id; `changed()` afterwards. */
export async function haltTask(task, entries, changed) {
    const tab = task.canvas?.tab;
    const copy = tab?.made && copyOpen(tab.path) ? tab : null;
    const undoable = copy ? 0 : undoableCount(task.steps, entries);
    const running = (task.steps || []).some(step => step.tool === 'run_workflow' && step.state === 'running');
    const lines = [t('aiHaltAsk'), running && t('aiHaltStops'),
        copy ? t('aiHaltCloses', { name: short(copy.name) }) : undoable && t('aiHaltUndoes', { count: undoable }),
        t('aiHaltTells'), t('aiHaltKeeps')].filter(Boolean);
    if (!await anomalousConfirm(lines.join('\n'), t('aiHalt'), { okLabel: t('aiHalt') })) return;
    try {
        const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}/halt`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ drop_tab: Boolean(copy) }),
        });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText);
    } catch (error) {
        await anomalousAlert(error.message);
        return;
    }
    let done = '';
    if (copy) {
        const handed = (task.about || []).find(item => item?.type === 'canvas')?.tab;
        done = t(await closeCopy(copy.path, handed) ? 'aiHaltDoneClosed' : 'aiHaltDoneOpen', { name: short(copy.name) });
    } else {
        const undone = undoNow(task.steps, entries);
        if (undone) done = t('aiHaltDoneUndone', { count: undone });
    }
    showWorkbenchToast(t('aiHaltDone') + done);
    changed();
}

/** Pauses `task`: the AI stops, nothing is taken back; `changed()` afterwards. */
export async function pauseTask(task, changed) {
    try {
        const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}/halt`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ take_back: false }),
        });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText);
    } catch (error) {
        await anomalousAlert(error.message);
        return;
    }
    showWorkbenchToast(t('aiPausedDone'));
    changed();
}

/** The head's "Pause" for `task`, as a list: none when there is nothing to stop. */
export function pauseTool(task, changed) {
    if (!canHalt(task)) return [];
    return [iconButton('anomalous-ai-tool is-icon anomalous-ai-pause', 'pause', t('aiPause'), () => void pauseTask(task, changed),
        { iconOnly: true, title: `${t('aiPause')} · ${t('aiPauseHint')}` })];
}
