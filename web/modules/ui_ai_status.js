/** The always-visible task execution summary; facts come from the same run step as the timeline. */
import { translate as t } from './locales.js';
import { taskStatus } from './ai_task_status.js';
import { runProgress } from './ui_ai_results.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function executionStatus(task, refresh) {
    const status = taskStatus(task);
    const box = el('section', `anomalous-ai-execution is-${status.state}`);
    box.setAttribute('aria-label', t('aiExecution'));
    const top = el('div', 'anomalous-ai-execution-top');
    top.append(el('span', 'anomalous-ai-execution-label', t('aiExecution')),
        el('strong', '', t(`aiExecution_${status.state}`)));
    const check = el('button', 'anomalous-ai-link', t('aiExecutionRefresh'));
    check.type = 'button';
    check.onclick = async () => { check.disabled = true; try { await refresh(); } finally { check.disabled = false; } };
    top.append(check);
    box.append(top);
    if (status.run) {
        const run = status.run;
        if (run.state === 'running') box.append(runProgress(run.progress || { state: 'submitting' }));
        const count = (run.prompt_ids || []).length;
        const pictures = (run.results || []).filter(item => item.type === 'image').length;
        const words = [t('aiExecutionTime', { seconds: status.seconds })];
        if (count) words.push(t('aiExecutionBatch', { count }));
        if (pictures) words.push(t('aiCountImages', { count: pictures }));
        box.append(el('div', 'anomalous-ai-execution-meta', words.join(' · ')));
        if (run.error) box.append(el('div', 'anomalous-ai-execution-error', run.error));
        if (run.state === 'done' && !task.ended) box.append(el('div', 'anomalous-ai-execution-hint', t('aiExecutionReview')));
    } else {
        box.append(el('p', 'anomalous-ai-execution-hint', status.active
            ? t('aiExecutionTool', { tool: status.active.tool })
            : t(status.state === 'untracked' ? 'aiExecutionUntracked' : status.state === 'ended' ? 'aiExecutionEnded' : 'aiExecutionWaiting')));
    }
    if (!task.ended) box.append(el('div', 'anomalous-ai-execution-contact', t('aiExecutionContact', { seconds: status.age })));
    return box;
}
