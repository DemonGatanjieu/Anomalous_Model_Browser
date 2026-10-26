/**
 * The side column's Ways view (做法, ui_ai_side_views.js): the ready-made blocks Anomalous builds for
 * the AI (api/reference_blocks.py, a data file a block), by job: what each does and where it came
 * from, in the user's language; greyed with what it lacks when a node pack or a model is missing
 * (a pack opens ComfyUI-Manager's list searched for it); and a switch the user turns a block off
 * with, so the AI is not offered it. GET /anomalous/ai_blocks, POST {name, on}. Drawn when shown,
 * the list read again each time the view is opened.
 */

import { resolveLocale, translate as t } from './locales.js';
import { sideHead } from './ui_ai_side.js';
import { openManager } from './ui_pack_usage.js';

let reading = null; // the list being read
let shown = null; // { blocks, jobs } last read, or { error }

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

const words = value => (resolveLocale() === 'zh' ? value?.zh : value?.en) || value?.en || value?.zh || '';

async function ask(body) {
    const answer = await fetch('/anomalous/ai_blocks', body ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : undefined);
    const data = await answer.json().catch(() => ({}));
    if (!answer.ok) throw new Error(data.error || answer.statusText);
    return data;
}

/** What the block lacks, a line each: its packs (each a way into the Manager) and its models. */
function lacks(block, owner) {
    const box = el('div', 'anomalous-ai-block-lacks');
    for (const pack of block.packs.filter(item => !item.installed)) {
        const node = el('button', 'anomalous-ai-block-lack is-pack', t('aiBlocksNeedsPack', { name: pack.name }));
        node.type = 'button';
        node.title = t('aiBlocksFindPack');
        node.onclick = () => void openManager(owner, { name: pack.name });
        box.append(node);
    }
    for (const model of block.models) {
        box.append(el('span', 'anomalous-ai-block-lack', t(`aiBlocksNeeds_${model.kind}`, { what: t(`aiBlocksWhat_${model.what || 'none'}`) })));
    }
    return box;
}

function blockRow(block, owner, redraw) {
    const row = el('div', `anomalous-ai-block${block.usable ? '' : ' is-missing'}${block.on ? '' : ' is-off'}`);
    const body = el('div', 'anomalous-ai-block-body');
    const head = el('div', 'anomalous-ai-block-head');
    head.append(el('span', 'anomalous-ai-block-title', words(block.title)),
        el('span', `anomalous-ai-block-state${block.usable ? ' is-ready' : ''}`, t(block.usable ? 'aiBlocksReady' : 'aiBlocksMissing')));
    body.append(head, el('div', 'anomalous-ai-block-about', words(block.about)));
    if (!block.usable) body.append(lacks(block, owner));
    if (block.better_with?.length) body.append(el('div', 'anomalous-ai-block-source', t('aiBlocksBetterWith', { names: block.better_with.join(', ') })));
    if (words(block.source)) body.append(el('div', 'anomalous-ai-block-source', t('aiBlocksSource', { source: words(block.source) })));
    const toggle = el('input', 'anomalous-ai-block-switch');
    toggle.type = 'checkbox';
    toggle.setAttribute('role', 'switch');
    toggle.checked = block.on;
    toggle.title = t(block.on ? 'aiBlocksOnHint' : 'aiBlocksOffHint');
    toggle.setAttribute('aria-label', t('aiBlocksSwitch', { name: words(block.title) }));
    toggle.onchange = async () => {
        toggle.disabled = true;
        try {
            shown = await ask({ name: block.name, on: toggle.checked });
        } catch (error) {
            toggle.checked = !toggle.checked;
            shown = { ...shown, note: error.message };
        }
        redraw();
    };
    row.append(body, toggle);
    return row;
}

function listBox(owner, redraw) {
    const body = el('div', 'anomalous-ai-stage-body anomalous-ai-blocks');
    if (!shown) {
        body.append(el('div', 'anomalous-ai-stage-empty', t('aiBlocksReading')));
        return body;
    }
    if (shown.error) {
        body.append(el('div', 'anomalous-ai-stage-empty', t('aiBlocksUnread', { error: shown.error })));
        return body;
    }
    const offered = shown.blocks.filter(block => block.usable && block.on).length;
    body.append(el('div', 'anomalous-ai-blocks-note', t('aiBlocksNote', { count: offered, total: shown.blocks.length })));
    if (shown.note) body.append(el('div', 'anomalous-ai-blocks-note is-error', shown.note));
    for (const job of [...shown.jobs, ...new Set(shown.blocks.map(block => block.job))]) {
        const blocks = shown.blocks.filter(block => block.job === job);
        if (!blocks.length || body.querySelector(`[data-job="${CSS.escape(job)}"]`)) continue;
        const group = el('div', 'anomalous-ai-blocks-group');
        group.dataset.job = job;
        group.append(el('div', 'anomalous-ai-blocks-job', t(`aiBlocksJob_${job}`)), ...blocks.map(block => blockRow(block, owner, redraw)));
        body.append(group);
    }
    return body;
}

/** The view into `pane`; `ctx`: {close, owner}. `fresh`: the view was just opened, so the list is read again. */
export function renderBlocksView(pane, ctx, fresh = false) {
    const redraw = () => pane.replaceChildren(sideHead(t('aiSideBlocks'), ctx.close), listBox(ctx.owner, redraw));
    if ((fresh || !shown) && !reading) {
        reading = ask().then(data => { shown = data; }, error => { shown = { error: error.message }; })
            .finally(() => { reading = null; redraw(); });
    }
    redraw();
}
