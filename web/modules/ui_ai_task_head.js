/**
 * A task's head on the AI page (ui_ai_workbench.js), kept to what is used while the AI works: the title
 * and where it stands, then the privacy settings (ui_ai_privacy.js; a ⓘ beside them when the task's AI
 * app reads the disk by itself), "Pause" (ui_ai_halt.js: the AI stops, nothing is taken back), how a run
 * goes while one does (ui_ai_status.js), and ⋯ for the rest (ui_ai_task_menu.js): where the AI works on
 * the canvas (ui_ai_task_canvas.js), stopping and taking its changes back, undoing them, "Stuck?"
 * (ui_ai_stuck.js), and what is done to a task now and then; while it goes on, a button that floats it
 * over the canvas (ui_ai_float.js). Under the title, the task's facts, the copy of the canvas to look
 * at, and the tasks it goes on from (ui_ai_task_links.js).
 */

import { resolveLocale, translate as t } from './locales.js';
import { dayLabel, timeLabel } from './activity_log.js';
import { taskStatus } from './ai_task_status.js';
import { taskTitle } from './ai_task_title.js';
import { taskCounts } from './ai_task_view.js';
import { floatAiTask } from './ui_ai_float.js';
import { canHalt, haltTask, pauseTool } from './ui_ai_halt.js';
import { iconButton } from './ui_ai_icons.js';
import { privacyButton } from './ui_ai_privacy.js';
import { executionStatus } from './ui_ai_status.js';
import { openStuck } from './ui_ai_stuck.js';
import { canvasModeItems, copyLink } from './ui_ai_task_canvas.js';
import { taskLinks } from './ui_ai_task_links.js';
import { stateIcon } from './ui_ai_task_list.js';
import { taskMenu } from './ui_ai_task_menu.js';

const RUNNING = ['submitting', 'queued', 'running'];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function stateChip(status) {
    const chip = el('span', `anomalous-ai-state is-${status}`);
    chip.append(stateIcon(status, 12), el('span', '', t(`aiState_${status}`)));
    return chip;
}

/** The ⋯'s items only the head has: the canvas the AI works on, taking its changes back, "Stuck?". */
function headItems(task, ctx) {
    return [
        ...canvasModeItems(task, ctx.refresh),
        ...(canHalt(task) ? [{ label: t('aiHalt'), title: t('aiHaltHint'), run: () => void haltTask(task, ctx.entries, ctx.refresh) }] : []),
        ...(ctx.canUndoAll ? [{ label: t('aiUndoAll'), run: ctx.undoAll }] : []),
        { label: t('aiStuck'), title: t('aiStuckHint'), run: () => openStuck(task, ctx.entries, ctx.refresh) },
    ];
}

/** "Float over canvas": AMB's window goes and the card on the canvas follows the task (ui_ai_float.js); while it goes on. */
function pipTool(task, ctx) {
    if (task.ended || !ctx.showCanvas) return [];
    return [iconButton('anomalous-ai-tool is-icon anomalous-ai-pip', 'pip', t('aiTaskPip'), () => floatAiTask(task, ctx.showCanvas), { iconOnly: true })];
}

/**
 * Draws the head of `task` into `header`. `ctx`: { summary (its row in the list), status (taskState),
 * entries, refresh(), back() (to the list in a narrow window), showCanvas(), tabs() (the side column's
 * tabs, drawn first), actions (ui_ai_task_menu.js menuActions), canUndoAll, undoAll(), open(id) }.
 */
export function drawTaskHead(header, task, ctx) {
    const run = taskStatus(task);
    const key = JSON.stringify([resolveLocale(), new Date().toDateString(), ctx.tabsKey || '', ctx.status, ctx.summary,
        ctx.canUndoAll, task.id, task.title, task.title_from, task.ended, task.stale_tools, task.client, task.started,
        (task.steps || []).length, task.canvas_mode, task.canvas, task.links, task.private, task.privacy_models,
        task.reads_disk, task.pause, run.run?.id, run.state, RUNNING.includes(run.state) ? run.run?.progress?.percent : null,
        Object.keys(task.sealed || {}).length]);
    if (header.dataset.headKey === key) return;
    header.dataset.headKey = key;
    const titleLine = el('div', 'anomalous-ai-task-title-line');
    const name = el('div', 'anomalous-ai-task-name');
    const back = el('button', 'anomalous-ai-back', `‹ ${t('aiAllTasks')}`);
    back.type = 'button';
    back.onclick = ctx.back;
    const title = el('h2', 'anomalous-ai-task-title', taskTitle(task));
    title.title = title.textContent;
    name.append(back, title, stateChip(ctx.status));
    const tools = el('div', 'anomalous-ai-task-tools');
    if (run.run && RUNNING.includes(run.state)) tools.append(executionStatus(task, ctx.refresh));
    tools.append(privacyButton(task, ctx.refresh), ...pauseTool(task, ctx.refresh), ...pipTool(task, ctx), taskMenu(task, { ...ctx.actions, extra: headItems(task, ctx) }));
    titleLine.append(name, tools);
    const meta = [task.client, `${dayLabel(task.started)} ${timeLabel(task.started)}`, t('aiStepCount', { count: (task.steps || []).length }),
        ...taskCounts(ctx.summary).map(item => t(item.key, item.values))].filter(Boolean);
    const said = el('div', 'anomalous-ai-task-meta', meta.join(' · '));
    said.title = said.textContent;
    const sub = el('div', 'anomalous-ai-task-sub');
    sub.append(said, ...copyLink(task, ctx.showCanvas), taskLinks(task, { open: ctx.open, changed: ctx.refresh }));
    header.replaceChildren(ctx.tabs(), titleLine, sub,
        ...(task.stale_tools ? [el('div', 'anomalous-ai-task-stale', t('aiStaleTools'))] : [])); // mcp_directory.stale
}
