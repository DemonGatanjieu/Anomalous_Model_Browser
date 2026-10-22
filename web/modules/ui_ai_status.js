/** Compact toolbar icon-button + fixed-position popover for confirmed task execution status. */
import { translate as t } from './locales.js';
import { taskStatus } from './ai_task_status.js';
import { icon } from './ui_ai_icons.js';
import { runProgress } from './ui_ai_results.js';

let openTaskId = null;
let boundGlobal = false;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function closeOpenPopover() {
    openTaskId = null;
    const wrap = document.querySelector('.anomalous-ai-execution.is-open');
    if (wrap) {
        wrap.classList.remove('is-open');
        wrap.querySelector('.anomalous-ai-status-popover')?.remove();
    }
}

function positionPopover(card, anchor) {
    if (!anchor?.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const host = anchor.closest('.anomalous-ai-task') || anchor.closest('.anomalous-ai') || document.body;
    const bounds = host.getBoundingClientRect();
    const width = Math.min(300, Math.max(220, window.innerWidth - 24));
    card.style.width = `${width}px`;
    const minLeft = Math.max(12, bounds.left + 10);
    const maxLeft = Math.max(minLeft, Math.min(window.innerWidth - width - 12, bounds.right - width - 10));
    let left = rect.right - width;
    if (left < minLeft) left = Math.min(Math.max(rect.left, minLeft), maxLeft);
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    const top = Math.min(rect.bottom + 6, window.innerHeight - 220);
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(Math.max(12, top))}px`;
}

function bindGlobalListeners() {
    if (boundGlobal || typeof document === 'undefined') return;
    boundGlobal = true;
    document.addEventListener('pointerdown', (event) => {
        if (!openTaskId) return;
        const wrap = document.querySelector('.anomalous-ai-execution.is-open');
        if (wrap && !wrap.contains(event.target)) closeOpenPopover();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && openTaskId) closeOpenPopover();
    });
    window.addEventListener('resize', () => {
        const wrap = document.querySelector('.anomalous-ai-execution.is-open');
        const btn = wrap?.querySelector('.anomalous-ai-status-btn');
        const card = wrap?.querySelector('.anomalous-ai-status-popover');
        if (btn && card) positionPopover(card, btn);
    });
    document.addEventListener('scroll', (event) => {
        if (!openTaskId) return;
        const wrap = document.querySelector('.anomalous-ai-execution.is-open');
        if (wrap && event.target instanceof Node && event.target.contains(wrap)) {
            const btn = wrap.querySelector('.anomalous-ai-status-btn');
            const card = wrap.querySelector('.anomalous-ai-status-popover');
            if (btn && card) positionPopover(card, btn);
        }
    }, true);
}

function activeLabel(status) {
    if (status.state === 'running' && Number.isFinite(status.run?.progress?.percent)) {
        return `${status.run.progress.percent}%`;
    }
    if (status.state === 'queued' || status.state === 'submitting') {
        return t(`aiExecution_${status.state}`);
    }
    return '';
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
    bindGlobalListeners();
    const status = taskStatus(task);
    const isOpen = openTaskId === task.id;
    const label = activeLabel(status);
    const wrap = el('div', `anomalous-ai-execution is-${status.state}${isOpen ? ' is-open' : ''}`);
    const btn = el('button', `anomalous-ai-tool anomalous-ai-status-btn is-${status.state}${label ? '' : ' is-icon'}`);
    btn.type = 'button';
    const fullTitle = `${t('aiExecution')}: ${t(`aiExecution_${status.state}`)}`;
    btn.title = fullTitle;
    btn.setAttribute('aria-label', fullTitle);
    btn.append(
        icon('pulse', 15),
        el('span', `anomalous-ai-status-dot is-${status.state}`),
    );
    if (label) btn.append(el('span', 'anomalous-ai-status-text', label));

    const openPopover = () => {
        wrap.querySelector('.anomalous-ai-status-popover')?.remove();
        const card = buildPopover(task, status, refresh);
        wrap.append(card);
        requestAnimationFrame(() => positionPopover(card, btn));
    };

    btn.onclick = (event) => {
        event.stopPropagation();
        if (openTaskId === task.id) {
            closeOpenPopover();
        } else {
            openTaskId = task.id;
            wrap.classList.add('is-open');
            openPopover();
        }
    };
    wrap.append(btn);
    if (isOpen) openPopover();
    return wrap;
}
