/**
 * "Stuck?" beside a task's facts in its head (ui_ai_workbench.js): a window that says what the
 * task waits for now (ai_stuck.js) with the one thing to do about it - the line to send the AI
 * where it is the AI's move - and when an AI app last called (GET /anomalous/ai_callers); under
 * it the three usual causes that Anomalous cannot see, each with its way out.
 */

import { translate as t } from './locales.js';
import { NEW_CHAT, callLines } from './ai_call_lines.js';
import { stuckReason } from './ai_stuck.js';
import { taskTitle } from './ai_task_title.js';
import { toolKey } from './ai_task_view.js';
import { aiWindow, copyLine, openConnectGuide } from './ui_ai_connect.js';
import { canHalt, haltTask } from './ui_ai_halt.js';

const SAYS = new Set(['ran', 'ranFailed', 'failed', 'ended', 'fresh', 'quiet']); // the AI's move: a line to send it

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(label, run) {
    const node = el('button', 'anomalous-ai-stuck-act', label);
    node.type = 'button';
    node.onclick = run;
    return node;
}

/** How long, in the page's words: seconds under two minutes, then minutes, then hours. */
function span(seconds) {
    if (seconds < 120) return t('aiStuckSeconds', { count: Math.round(seconds) });
    return seconds < 7200 ? t('aiStuckMinutes', { count: Math.round(seconds / 60) }) : t('aiStuckHours', { count: Math.round(seconds / 3600) });
}

function cause(title, words, act) {
    const row = el('div', 'anomalous-ai-stuck-cause');
    const text = el('div', 'anomalous-ai-stuck-cause-text');
    text.append(el('div', 'anomalous-ai-stuck-cause-title', title), el('div', 'anomalous-ai-stuck-cause-do', words));
    row.append(text, ...(act ? [act] : []));
    return row;
}

/** The window for `task`. `entries`: activity entries by id (a halt undoes by them); `refresh()` draws the page again. */
function openStuck(task, entries, refresh) {
    const body = el('div', 'anomalous-ai-stuck');
    const reason = stuckReason(task);
    const values = { what: reason.tool ? t(toolKey(reason.tool)) : '', count: reason.count, span: span(reason.seconds || 0) };
    const now = el('section', `anomalous-ai-stuck-now is-${reason.why}`);
    const what = t(`aiStuckIs_${reason.why}`, values) + (Number.isFinite(reason.percent) ? ` ${reason.percent}%` : '');
    now.append(el('div', 'anomalous-ai-stuck-label', t('aiStuckNow')), el('div', 'anomalous-ai-stuck-what', what),
        el('p', 'anomalous-ai-stuck-do', t(`aiStuckDo_${reason.why}`, values)));
    const line = SAYS.has(reason.why) && (callLines(task)?.lines[0] || (reason.why === 'ended' && NEW_CHAT));
    if (line) now.append(copyLine(t(line, { task: taskTitle(task) }), { code: false, label: t('aiConnectCopySentence') }));
    if (reason.why === 'unstarted') now.append(button(t('aiConnect'), () => openConnectGuide()));
    const last = el('div', 'anomalous-ai-stuck-last');
    now.append(last);
    void fetch('/anomalous/ai_callers').then(response => response.json()).then(({ last: app }) => {
        last.textContent = app ? t('aiStuckLast', { client: app.client, span: span(Math.max(0, Date.now() / 1000 - app.at)) }) : t('aiStuckNever');
    }).catch(() => {});
    const more = el('section', 'anomalous-ai-stuck-more');
    more.append(el('div', 'anomalous-ai-stuck-label', t('aiStuckOther')),
        cause(t('aiStuckAppAsks'), t('aiStuckAppAsksDo')),
        cause(t('aiStuckNoTools'), t('aiStuckNoToolsDo'), button(t('aiConnect'), () => openConnectGuide())),
        canHalt(task) ? cause(t('aiStuckMess'), t('aiStuckMessDo'), button(t('aiHalt'), () => { close(); void haltTask(task, entries, refresh); }))
            : cause(t('aiStuckPage'), t('aiStuckPageDo'), button(t('aiExecutionRefresh'), () => { close(); refresh(); })));
    body.append(now, more);
    const close = aiWindow(t('aiStuckTitle'), body);
}

/** The link in the head of `task`. */
export function stuckLink(task, entries, refresh) {
    const link = el('button', 'anomalous-ai-link anomalous-ai-stuck-link', t('aiStuck'));
    link.type = 'button';
    link.onclick = () => openStuck(task, entries, refresh);
    return link;
}
