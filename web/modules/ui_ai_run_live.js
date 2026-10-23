/**
 * A run the AI started, while it goes (api/ai_task_runs.py, api/ai_run_watch.py): runProgress
 * draws where it stands (queued, the node and its steps, the percent), the time left and per
 * step, the graphics card's memory, the console's own note and last lines (what the console
 * window shows), and a stop button (api/ai_run_control.py); estimateBox the size each sampler
 * works at and the warnings for a run too big for the card. Used on the run's step in the
 * timeline (ui_ai_results.js) and in the run-status card (ui_ai_status.js); progressWords is the
 * line the message box's strip shows too (ui_ai_now.js).
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { icon } from './ui_ai_icons.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** "1:05" / "12 s" for `seconds`. */
export function clock(seconds) {
    const whole = Math.max(0, Math.round(seconds));
    if (whole < 60) return t('aiRunSeconds', { seconds: whole });
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const rest = String(whole % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** "3.9 / 12 GB" free of all. */
export function memory(vram) {
    const gb = mb => (mb / 1024).toFixed(mb >= 10240 ? 0 : 1);
    return t('aiRunVram', { free: gb(vram.free_mb), total: gb(vram.total_mb) });
}

/** The stop button of run step `stepId` in task `taskId`; `stopped()` after the server took it.
 * `stopping`: the run was stopped already and ends when its node does (ComfyUI stops between nodes). */
export function stopButton(taskId, stepId, stopped = () => {}, compact = false, stopping = false) {
    const node = el('button', `anomalous-ai-run-stop${compact ? ' is-compact' : ''}${stopping ? ' is-busy' : ''}`);
    node.type = 'button';
    node.title = t(stopping ? 'aiRunStoppingHint' : 'aiRunStopHint');
    node.disabled = stopping;
    node.append(icon('stop', compact ? 13 : 14));
    if (!compact) node.append(el('span', '', t(stopping ? 'aiRunStopping' : 'aiRunStop')));
    node.onclick = async (event) => {
        event.stopPropagation();
        node.disabled = true;
        node.classList.add('is-busy');
        try {
            const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(stepId)}/stop`, { method: 'POST' });
            const answer = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(answer.error || response.statusText);
            node.replaceChildren(icon('stop', compact ? 13 : 14), ...(compact ? [] : [el('span', '', t('aiRunStopping'))]));
            stopped();
        } catch (error) {
            node.disabled = false;
            node.classList.remove('is-busy');
            await anomalousAlert(error.message);
        }
    };
    return node;
}

/** Where a run stands in words, and how far it is (0…1, or null while that is not known). */
export function progressWords(progress) {
    if (progress.state === 'submitting') return { words: t('aiExecution_submitting'), share: null };
    if (progress.state === 'queued') return { words: t('aiRunQueued', { ahead: progress.ahead }), share: null };
    const parts = [];
    if (progress.prompts > 1) parts.push(t('aiRunPrompt', { at: progress.prompt, count: progress.prompts }));
    if (progress.node) parts.push(progress.max > 1 ? `${progress.node} ${progress.value}/${progress.max}` : progress.node);
    if (progress.nodes) parts.push(t('aiRunNodes', { done: progress.nodes_done, count: progress.nodes }));
    let share = null;
    if (Number.isFinite(progress.percent)) share = progress.percent / 100;
    else if (progress.max > 1) share = progress.value / progress.max;
    else if (progress.nodes) share = progress.nodes_done / progress.nodes;
    return { words: parts.join(' · ') || t('aiRunRunning'), share: share === null ? null : Math.min(1, Math.max(0, share)) };
}

/** Where a run stands; with `stop` ({task, step, stopped}) a stop button beside the bar. */
export function runProgress(progress, stop = null) {
    const box = el('div', 'anomalous-ai-run-progress');
    const { words, share } = progressWords(progress);
    const line = el('div', 'anomalous-ai-run-line');
    line.append(el('span', 'anomalous-ai-run-words', words));
    if (share !== null) line.append(el('b', 'anomalous-ai-run-percent', `${Math.round(share * 100)}%`));
    const bar = el('div', `anomalous-ai-run-bar${share === null ? ' is-waiting' : ''}`);
    const fill = el('span', 'anomalous-ai-run-fill');
    if (share !== null) fill.style.width = `${Math.round(share * 100)}%`;
    bar.append(fill);
    const row = el('div', 'anomalous-ai-run-row');
    row.append(bar);
    if (stop?.task && stop?.step) row.append(stopButton(stop.task, stop.step, stop.stopped, false, Boolean(progress.stopping)));
    box.append(line, row);

    const facts = el('div', 'anomalous-ai-run-facts');
    const fact = (name, text, title) => {
        const item = el('span', 'anomalous-ai-run-fact');
        item.append(icon(name, 13), el('span', '', text));
        if (title) item.title = title;
        facts.append(item);
    };
    if (Number.isFinite(progress.left)) fact('clock', t('aiRunLeft', { time: clock(progress.left) }), t('aiRunLeftHint'));
    if (Number.isFinite(progress.rate)) fact('pulse', t('aiRunRate', { seconds: progress.rate }));
    if (progress.vram?.total_mb) fact('chip', memory(progress.vram), t('aiRunVramHint'));
    if (facts.childNodes.length) box.append(facts);

    const lines = progress.console || [];
    if (progress.note || lines.length) {
        const say = el('details', 'anomalous-ai-run-console');
        const head = el('summary', 'anomalous-ai-run-console-head');
        head.append(icon('terminal', 13), el('span', 'anomalous-ai-run-console-last', progress.note || lines.at(-1)));
        head.title = t('aiRunConsoleHint');
        say.append(head);
        if (lines.length) say.append(el('pre', 'anomalous-ai-run-console-lines', lines.join('\n')));
        box.append(say);
    }
    return box;
}

/** The size each sampler of a run works at, and what is too big for the card; null when nothing to say. */
export function estimateBox(estimate) {
    const warnings = estimate?.warnings || [];
    const samplers = estimate?.samplers || [];
    if (!warnings.length && !samplers.length) return null;
    const box = el('div', `anomalous-ai-estimate${warnings.length ? ' is-warn' : ''}`);
    for (const warning of warnings) {
        const item = el('div', 'anomalous-ai-estimate-warning');
        item.append(icon('alert', 15), el('span', '', t(`aiRunWarn_${warning.kind}`, {
            title: warning.title, width: warning.width, height: warning.height, steps: warning.steps ?? '?',
            megapixels: warning.megapixels ?? '', comfort: estimate.comfort_mp ?? '',
        })));
        box.append(item);
    }
    if (samplers.length) {
        box.append(el('div', 'anomalous-ai-estimate-sizes', t('aiRunSizes', {
            sizes: samplers.map(item => `${item.title} ${item.width}×${item.height}${item.batch > 1 ? ` ×${item.batch}` : ''}${item.steps ? ` · ${t('aiRunSteps', { steps: item.steps })}` : ''}`).join('; '),
        })));
    }
    return box;
}
