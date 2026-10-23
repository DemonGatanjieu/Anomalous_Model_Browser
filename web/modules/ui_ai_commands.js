/**
 * The "/" commands of the AI workbench's message box (ui_ai_mention.js). Most act at once and need
 * no AI (Anomalous cannot wake one): stop the task's run, undo its changes on the canvas, show a
 * view of the side column, start a new task, choose where the AI works on the canvas. A few fill
 * in words to send (run it again, explain, go on), to change before sending.
 * `ctx`: {task(), undo(), side(view), newTask(), changed()}.
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';

async function post(url, body) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(answer.error || answer.message || `HTTP ${response.status}`);
    return answer;
}

/** The commands for the task shown, each {id, name, hint, icon, run() | fill}. */
export function taskCommands(ctx) {
    const task = ctx.task();
    if (!task) return [];
    const base = `/anomalous/ai_tasks/${encodeURIComponent(task.id)}`;
    const running = (task.steps || []).filter(step => step.state === 'running' && step.prompt_ids?.length);
    const act = run => async () => {
        try {
            await run();
        } catch (error) {
            await anomalousAlert(error.message);
        }
        ctx.changed();
    };
    const commands = [
        running.length && { id: 'stop', icon: 'stop', run: act(async () => { for (const step of running) await post(`${base}/runs/${encodeURIComponent(step.id)}/stop`); }) },
        { id: 'undo', icon: 'undo', run: ctx.undo },
        { id: 'stage', icon: 'panel', run: () => ctx.side('stage') },
        { id: 'map', icon: 'nodes', run: () => ctx.side('map') },
        { id: 'toolbox', icon: 'sparkle', run: () => ctx.side('toolbox') },
        { id: 'tab', icon: 'copy', run: act(() => post(base, { canvas: 'new' })) },
        { id: 'canvas', icon: 'page', run: act(() => post(base, { canvas: 'current' })) },
        { id: 'new', icon: 'plus', run: ctx.newTask },
        { id: 'rerun', icon: 'pulse', fill: true },
        { id: 'explain', icon: 'chat', fill: true },
        { id: 'go', icon: 'arrowRight', fill: true },
    ].filter(Boolean);
    return commands.map(command => ({
        ...command, name: t(`aiCmd_${command.id}`), hint: t(`aiCmdHint_${command.id}`), fill: command.fill ? t(`aiCmdFill_${command.id}`) : null,
    }));
}
