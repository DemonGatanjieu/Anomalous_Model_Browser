/** Compact toolbar button + popover for confirmed task execution status (inspired by Claude's status popover). */
import { translate as t } from './locales.js';
import { taskStatus } from './ai_task_status.js';
import { icon } from './ui_ai_icons.js';
import { runProgress } from './ui_ai_results.js';

let openTaskId = null;
let boundOutside = false;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function bindOutsideClose() {
    if (boundOutside || typeof document === 'undefined') return;
    boundOutside = true;
    document.addEventListener('pointerdown', (event) => {
        if (!openTaskId) return;
        const wrap = document.querySelector('.anomalous-ai-execution.is-open');
        if (wrap && !wrap.contains(event.target)) {
            openTaskId = null;
            wrap.classList.remove('is-open');
            wrap.querySelector('.anomalous-ai-status-popover')?.remove();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !openTaskId) return;
        const wrap = document.querySelector('.anomalous-ai-execution.is-open');
        if (wrap) {
            openTaskId = null;
            wrap.classList.remove('is-open');
            wrap.querySelector('.anomalous-ai-status-popover')?.remove();
        }
    });
}

function buttonLabel(status) {
    if (status.state === 'running' && Number.isFinite(status.run?.progress?.percent)) {
        return `${t('aiExecution_running')} ${status.run.progress.percent}%`;
    }
    if (status.state === 'queued' || status.state === 'submitting') {
        return t(`aiExecution_${status.state}`);
    }
    return t('aiExecution');
}

function buildPopover(task, status, refresh) {
    const card = el('section', `anomalous-ai-status-popover is-${status.state}`);
    card.setAttribute('aria-label', t('aiExecution'));
    const top = el('div', 'anomalous-ai-execution-top');
    top.append(
        el('span', 'anomalous-ai-execution-label', t('aiExecution')),
        el('strong', `anomalous-ai-execution-badge is-${status.state}`, t(`aiExecution_${status.state}`)),
    );
    const check = el('button', 'anomalous-ai-link', t('aiExecutionRefresh'));
    check.type = 'button';
    check.onclick = async (event) => {
        event.stopPropagation();
        check.disabled = true;
        try { await refresh(); } finally { check.disabled = false; }
    };
    top.append(check);
    card.append(top);

    if (status.run) {
        const run = status.run;
        if (run.state === 'running') card.append(runProgress(run.progress || { state: 'submitting' }));
        const count = (run.prompt_ids || []).length;
        const pictures = (run.results || []).filter(item => item.type === 'image').length;
        const rows = el('div', 'anomalous-ai-execution-rows');
        const addRow = (dotClass, label) => {
            const row = el('div', 'anomalous-ai-execution-row');
            row.append(el('span', `anomalous-ai-status-dot ${dotClass}`), el('span', '', label));
            rows.append(row);
        };
        addRow('is-time', t('aiExecutionTime', { seconds: status.seconds }));
        if (count) addRow('is-batch', t('aiExecutionBatch', { count }));
        if (pictures) addRow('is-done', t('aiCountImages', { count: pictures }));
        card.append(rows);
        if (run.error) card.append(el('div', 'anomalous-ai-execution-error', run.error));
        if (run.state === 'done' && !task.ended) card.append(el('div', 'anomalous-ai-execution-hint', t('aiExecutionReview')));
    } else {
        card.append(el('p', 'anomalous-ai-execution-hint', status.active
            ? t('aiExecutionTool', { tool: status.active.tool })
            : t(status.state === 'untracked' ? 'aiExecutionUntracked' : status.state === 'ended' ? 'aiExecutionEnded' : 'aiExecutionWaiting')));
    }
    if (!task.ended) card.append(el('div', 'anomalous-ai-execution-contact', t('aiExecutionContact', { seconds: status.age })));
    return card;
}

export function executionStatus(task, refresh) {
    bindOutsideClose();
    const status = taskStatus(task);
    const isOpen = openTaskId === task.id;
    const wrap = el('div', `anomalous-ai-execution is-${status.state}${isOpen ? ' is-open' : ''}`);
    const btn = el('button', `anomalous-ai-tool anomalous-ai-status-btn is-${status.state}`);
    btn.type = 'button';
    btn.title = `${t('aiExecution')}: ${t(`aiExecution_${status.state}`)}`;
    btn.append(
        el('span', `anomalous-ai-status-dot is-${status.state}`),
        icon('pulse', 15),
        el('span', '', buttonLabel(status)),
    );
    btn.onclick = (event) => {
        event.stopPropagation();
        if (openTaskId === task.id) {
            openTaskId = null;
            wrap.classList.remove('is-open');
            wrap.querySelector('.anomalous-ai-status-popover')?.remove();
        } else {
            openTaskId = task.id;
            wrap.classList.add('is-open');
            wrap.querySelector('.anomalous-ai-status-popover')?.remove();
            wrap.append(buildPopover(task, status, refresh));
        }
    };
    wrap.append(btn);
    if (isOpen) wrap.append(buildPopover(task, status, refresh));
    return wrap;
}
