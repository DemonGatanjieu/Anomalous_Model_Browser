/**
 * The folded rows of the AI workbench's timeline (ai_task_view.js groupSteps says which): reads
 * that follow each other as one line ("looked things up 5 times: …") opening to a line each, and a
 * chain of the AI's work (reads, canvas changes, decisions) as one row: how many steps, what they
 * did as chips, the last one while the AI is at it, and undo for its canvas changes. A chain opens
 * to its steps as the timeline draws them; which chains are open is kept while the page lives, so
 * the AI's next steps, which draw the row again, do not shut one.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { timeLabel } from './activity_log.js';
import { canUndo, undoEntry } from './canvas_undo.js';
import { anomalousConfirm } from './ui_dialog.js';
import { iconButton } from './ui_ai_icons.js';
import { chainTools, foldLooks, lookTools, stepDetail, toolKey } from './ai_task_view.js';

const opened = new Set(); // the first step of each chain the user opened

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const counted = (tool, count) => (count > 1 ? `${t(toolKey(tool))} ×${count}` : t(toolKey(tool)));

/** A row of reads that follow each other; `number` is its place in the timeline. */
export function looksRow(steps, number) {
    const row = el('div', 'anomalous-ai-step is-look is-folded');
    row.dataset.stepIds = steps.map(step => step.id).join(' ');
    row.append(el('span', 'anomalous-ai-step-dot', number));
    const body = el('div', 'anomalous-ai-step-body');
    const tools = lookTools(steps).map(({ tool, count }) => counted(tool, count));
    const head = el('button', 'anomalous-ai-looks', `${t('aiLooks', { count: steps.length })}：${tools.join('、')}`);
    head.type = 'button';
    head.onclick = () => {
        details.hidden = !details.hidden;
        head.setAttribute('aria-expanded', String(!details.hidden));
    };
    head.setAttribute('aria-expanded', 'false');
    const details = el('div', 'anomalous-ai-looks-details');
    details.hidden = true;
    for (const step of steps) {
        const detail = stepDetail(step);
        const found = Number.isFinite(step.count) ? t('aiFound', { count: step.count }) : '';
        details.append(el('div', 'anomalous-ai-look', [timeLabel(step.at), t(toolKey(step.tool)), detail, found].filter(Boolean).join(' · ')));
    }
    body.append(head, details);
    row.append(body, el('div', 'anomalous-ai-step-when', timeLabel(steps[0].at)));
    return row;
}

/** The activity entries of the canvas changes `steps` made, newest first (`entries`: id -> entry). */
function changesOf(steps, entries) {
    return steps.flatMap(step => (step.results || []).filter(result => result.type === 'canvas'))
        .map(result => entries.get(result.activity)).filter(Boolean).reverse();
}

/**
 * Undoes the canvas changes `steps` made, newest first, once the user agrees (`ask`: the locale
 * key of the question); stops at a later change of theirs in the way. Whether it undid any.
 */
export async function undoChanges(steps, entries, label, ask) {
    const changes = changesOf(steps, entries);
    const undoable = changes.filter(entry => canUndo(app, entry));
    if (!undoable.length || !await anomalousConfirm(t(ask, { count: undoable.length }), label)) return false;
    for (const entry of changes) {
        if (!canUndo(app, entry)) break;
        try { undoEntry(app, entry); } catch (_) { break; }
    }
    return true;
}

/**
 * A chain of the AI's work as one row. `ctx`: {entries (activity id -> entry), stepRow(step,
 * number) for its steps when open, changed() after an undo, live (the AI may still add to it)}.
 * `row.reveal()` opens it (a jump to one of its steps).
 */
export function chainRow(steps, number, ctx) {
    const row = el('div', 'anomalous-ai-step is-chain is-folded');
    row.dataset.stepIds = steps.map(step => step.id).join(' ');
    row.append(el('span', 'anomalous-ai-step-dot', number));
    const body = el('div', 'anomalous-ai-step-body');
    const head = el('div', 'anomalous-ai-chain-head');
    const open = el('button', 'anomalous-ai-looks anomalous-ai-chain-open');
    open.type = 'button';
    open.append(el('span', 'anomalous-ai-chain-title', t('aiChain', { count: steps.length })));
    if (ctx.live) open.append(el('span', 'anomalous-ai-chain-last', t('aiChainLast', { what: t(toolKey(steps.at(-1).tool)) })));
    head.append(open);
    if (changesOf(steps, ctx.entries).some(entry => canUndo(app, entry))) {
        head.append(iconButton('anomalous-ai-chain-undo', 'undo', t('aiChainUndo'), async () => {
            if (await undoChanges(steps, ctx.entries, t('aiChainUndo'), 'aiChainUndoConfirm')) ctx.changed();
        }));
    }
    const chips = el('div', 'anomalous-ai-chain-chips');
    for (const { tool, kind, count } of chainTools(steps)) {
        chips.append(el('span', `anomalous-ai-chain-chip is-${kind}`, tool === 'look' ? t('aiLooks', { count }) : counted(tool, count)));
    }
    const inside = el('div', 'anomalous-ai-chain-steps');
    const key = steps[0].id;
    const show = (on) => {
        inside.hidden = !on;
        open.setAttribute('aria-expanded', String(on));
        if (on && !inside.childNodes.length) {
            inside.append(...foldLooks(steps).map((item, at) => (item.type === 'looks' ? looksRow(item.steps, at + 1) : ctx.stepRow(item.step, at + 1))));
        }
    };
    open.onclick = () => {
        const on = inside.hidden;
        if (on) opened.add(key);
        else opened.delete(key);
        show(on);
    };
    row.reveal = () => {
        opened.add(key);
        show(true);
    };
    show(opened.has(key));
    body.append(head, chips, inside);
    const [first, last] = [timeLabel(steps[0].at), timeLabel(steps.at(-1).at)];
    row.append(body, el('div', 'anomalous-ai-step-when', first === last ? first : `${first}–${last}`));
    return row;
}
