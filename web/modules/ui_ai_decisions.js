/**
 * A task's key decisions (api/ai_decisions.py) in the AI workbench. On the timeline, the card of
 * one the AI recorded: what was decided, why, what was left out, who decided, and the steps it is
 * about. In the side column (ui_ai_side_views.js), the "Decisions" view: every decision of the
 * task in order, the user's own choices in Anomalous too (a panel answer, allowing a step,
 * materials, the canvas mode, a stop), each leading back to its step, with a quiet word when the
 * AI ran or changed the canvas since it last recorded one. Text only (textContent).
 */

import { translate as t } from './locales.js';
import { timeLabel } from './activity_log.js';
import { toolKey } from './ai_task_view.js';
import { icon } from './ui_ai_icons.js';
import { sideHead } from './ui_ai_side.js';

const BY = { user: 'aiDecisionByUser', ai: 'aiDecisionByAi', together: 'aiDecisionByTogether' };
const MARKS = { logged: 'pin', answer: 'question', gate: 'shield', toolbox: 'sparkle', canvas: 'copy', stop: 'stop' };

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** Brings the timeline's row of step `id` into view and marks it a moment (a narrow window shows the timeline first). */
export function showStepRow(id) {
    document.querySelector('.anomalous-ai.shows-stage .anomalous-ai-stage .anomalous-ai-tab')?.click();
    requestAnimationFrame(() => {
        const row = document.querySelector(`.anomalous-ai-timeline [data-step-ids~="${CSS.escape(id)}"]`);
        if (!row) return;
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row.classList.add('is-flash');
        setTimeout(() => row.classList.remove('is-flash'), 1600);
    });
}

function stepLink(id, numberOf, label) {
    const node = el('button', 'anomalous-ai-decision-link', label || t('aiDecisionStep', { number: numberOf?.(id) || '?' }));
    node.type = 'button';
    node.onclick = () => showStepRow(id);
    return node;
}

/** The card of a decision the AI recorded (`record`: ai_decisions.log's). */
export function decisionCard(record, numberOf = null) {
    const card = el('div', 'anomalous-ai-decision');
    const head = el('div', 'anomalous-ai-decision-head');
    head.append(icon('pin', 14), el('span', 'anomalous-ai-decision-title', record.title || ''));
    if (BY[record.by]) head.append(el('span', `anomalous-ai-decision-by is-${record.by}`, t(BY[record.by])));
    card.append(head, el('div', 'anomalous-ai-decision-text', record.decision || ''));
    if (record.reason) card.append(el('div', 'anomalous-ai-decision-why', t('aiDecisionWhy', { reason: record.reason })));
    if (record.rejected?.length) card.append(el('div', 'anomalous-ai-decision-not', t('aiDecisionRejected', { options: record.rejected.join('、') })));
    if (record.related?.length) {
        const links = el('div', 'anomalous-ai-decision-links');
        links.append(el('span', '', t('aiDecisionAbout')), ...record.related.map(id => stepLink(id, numberOf)));
        card.append(links);
    }
    return card;
}

/** One decision of the list, by its type: [title, words]. */
function described(item) {
    switch (item.type) {
    case 'logged': return [item.title, item.decision];
    case 'answer': return [item.question || t('aiDecisionAnswer'), item.skipped ? t('aiPanelSkipped') : item.timed_out ? t('aiPanelTookRecommended', { answer: item.answer }) : item.answer];
    case 'gate': return [t(toolKey(item.tool)), [t(item.allowed ? 'aiDecisionAllowed' : 'aiDecisionRefused'), item.text].filter(Boolean).join('：')];
    case 'toolbox': return [t('aiDecisionToolbox'), item.count ? t('aiDecisionToolboxText', { count: item.count, mode: t(`aiTbMode_${item.mode}`) }) : t('aiToolboxCleared')];
    case 'canvas': return [t('aiDecisionCanvas'), t(item.mode === 'new' ? 'aiCanvasChoseNew' : 'aiCanvasChoseCurrent')];
    case 'privacy': return [t('aiPrivacy'), t(item.on ? 'aiPrivacyChoseOn' : 'aiPrivacyChoseOff')];
    default: return [t('aiDecisionStop'), t('aiRunStoppedByYou')];
    }
}

/**
 * Every decision of `task` (the server's `decisions` and `decisions_gap`) into `pane`, oldest
 * first. `ctx`: {numberOf(stepId), close()}. Drawn again only when they changed.
 */
export function renderDecisionsView(pane, task, ctx) {
    const items = task.decisions || [];
    const key = JSON.stringify([task.id, items, task.decisions_gap]);
    if (pane.dataset.key === key) return;
    pane.dataset.key = key;
    const body = el('div', 'anomalous-ai-stage-body anomalous-ai-decisions');
    const gap = task.decisions_gap;
    if (gap && items.length) {
        const parts = [gap.runs ? t('aiDecisionGapRuns', { count: gap.runs }) : '', gap.canvas ? t('aiDecisionGapCanvas', { count: gap.canvas }) : ''].filter(Boolean);
        body.append(el('div', 'anomalous-ai-decisions-gap', t('aiDecisionGap', { what: parts.join('、') })));
    }
    if (!items.length) body.append(el('div', 'anomalous-ai-stage-empty anomalous-ai-decisions-none', t('aiDecisionsNone')));
    for (const item of items) {
        const row = el('div', `anomalous-ai-decisions-row is-${item.type}`);
        const mark = el('span', 'anomalous-ai-decisions-mark');
        mark.append(icon(MARKS[item.type] || 'pin', 14));
        const [title, words] = described(item);
        const text = el('div', 'anomalous-ai-decisions-text');
        const top = el('div', 'anomalous-ai-decisions-top');
        top.append(el('span', 'anomalous-ai-decisions-title', title || ''));
        const by = item.type === 'logged' ? item.by : 'user';
        if (BY[by]) top.append(el('span', `anomalous-ai-decision-by is-${by}`, t(BY[by])));
        text.append(top, el('div', 'anomalous-ai-decisions-words', words || ''));
        if (item.type === 'logged' && item.reason) text.append(el('div', 'anomalous-ai-decision-why', t('aiDecisionWhy', { reason: item.reason })));
        if (item.type === 'logged' && item.rejected?.length) text.append(el('div', 'anomalous-ai-decision-not', t('aiDecisionRejected', { options: item.rejected.join('、') })));
        const foot = el('div', 'anomalous-ai-decision-links');
        foot.append(el('span', '', timeLabel(item.at)), stepLink(item.step, ctx.numberOf));
        text.append(foot);
        row.append(mark, text);
        body.append(row);
    }
    pane.replaceChildren(sideHead(t('aiSideDecisions'), ctx.close), body);
}
