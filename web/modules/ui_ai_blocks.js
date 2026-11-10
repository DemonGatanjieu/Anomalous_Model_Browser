/**
 * The side column's Ways view (做法, ui_ai_side_views.js): the ready-made blocks Anomalous builds for
 * the AI (api/reference_blocks.py, a data file a block). First the ones that can run here, by use, a short
 * row each: its name, a line of what it does, a switch the user turns it off with, so the AI is not offered
 * it, and a button that picks it for this task alone (the AI is told, and add_nodes builds it for that use).
 * A row opens for the rest: all its words, where it came from, how it was tried (the card, a run's time)
 * and the models it recommends (api/block_models.json), each here or a button downloading it, link and
 * SHA256 from the list. Then the skills (api/ai_skills.py): advice the AI fetches for a kind of job, each
 * with its switch too; for a private task only the private task's skill, as that is all its AI gets. Last,
 * folded, the blocks that lack a node pack or a model, each saying what (a pack opens ComfyUI-Manager's
 * list searched for it). GET /anomalous/ai_blocks, POST {name, on} or {skill, on}.
 * Read ahead when the page shows a task, so the view opens with it; read again quietly each time the view
 * comes up, and drawn anew only when something changed, so it stays as it was left (where it was scrolled
 * to); the rows and the fold left open are kept across a redraw.
 */

import { resolveLocale, translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { sideHead } from './ui_ai_side.js';
import { openManager } from './ui_pack_usage.js';
import { downloadFrom } from './model_download.js';
import { formatSize } from './file_size.js';

let reading = null; // the list being read
let shown = null; // { blocks, jobs } last read, or { error }
let redrawView = null; // draws the view again, once it was shown
const opened = new Set(); // the rows left open: a block's name, a skill's as "skill:<name>"
let missingOpen = false; // whether the fold of blocks lacking something was left open

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

/** Reads the list unless that is under way; the view is drawn anew if it changed. A failed read keeps a list that shows. */
function read() {
    if (reading) return;
    reading = ask().then((data) => {
        const changed = JSON.stringify(data) !== JSON.stringify(shown);
        shown = data;
        return changed;
    }, (error) => {
        if (shown?.blocks) return false;
        shown = { error: error.message };
        return true;
    }).then((changed) => {
        reading = null;
        if (changed) redrawView?.();
    });
}

/** Reads the list before the view is opened, once. */
export function readBlocksAhead() {
    if (!shown) read();
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

/** How the block was tried: the card, and a whole run's time for each model and size. */
function tested(block) {
    const record = block.tested || {};
    const runs = (record.runs || []).filter(run => run.seconds).map(run => t('aiBlocksRun', run));
    return runs.length ? el('div', 'anomalous-ai-block-source', t('aiBlocksTested', { gpu: record.gpu, vram: record.vram_gb, runs: runs.join(' · ') })) : null;
}

/** The models the block recommends: each one here, or a button that downloads it (its link and SHA256 from the list). */
function recommended(block, owner) {
    if (!block.recommended?.length) return null;
    const box = el('div', 'anomalous-ai-block-models');
    box.append(el('span', 'anomalous-ai-block-source', t('aiBlocksModels')));
    for (const model of block.recommended) {
        const about = t('aiBlocksModelAbout', { license: model.license, folder: [model.folder, model.subfolder].filter(Boolean).join('/'), base: model.base || '—' });
        if (model.installed) {
            const here = el('span', 'anomalous-ai-block-model is-here', `✓ ${model.title}`);
            here.title = about;
            box.append(here);
            continue;
        }
        const get = el('button', 'anomalous-ai-block-model', t('aiBlocksDownload', { name: model.title, size: formatSize(model.size) }));
        get.type = 'button';
        get.title = about;
        get.onclick = async () => {
            get.disabled = true;
            try {
                await downloadFrom(owner, { url: model.sources[0].url, hash: model.sha256, type: model.folder, folder: model.subfolder, name: model.file });
                get.textContent = t('aiBlocksDownloading', { name: model.title });
            } catch (error) {
                get.disabled = false;
                get.textContent = t('aiBlocksDownloadFailed', { name: model.title, error: error.message });
            }
        };
        box.append(get);
    }
    return box;
}

/** The switch that turns `item` on or off for the AI; `key`: {name} for a block, {skill} for a skill. */
function onSwitch(item, key, redraw) {
    const toggle = el('input', 'anomalous-ai-block-switch');
    toggle.type = 'checkbox';
    toggle.setAttribute('role', 'switch');
    toggle.checked = item.on;
    toggle.title = t(item.on ? 'aiBlocksOnHint' : 'aiBlocksOffHint');
    toggle.setAttribute('aria-label', t('aiBlocksSwitch', { name: words(item.title) }));
    toggle.onchange = async () => {
        toggle.disabled = true;
        try {
            shown = await ask({ ...key, on: toggle.checked });
        } catch (error) {
            toggle.checked = !toggle.checked;
            shown = { ...shown, note: error.message };
        }
        redraw();
    };
    return toggle;
}

/** The button that picks `block` for task `task` or takes it back; `changed()` after (the task is read again, and the view with it). */
function useButton(block, task, changed) {
    const using = (task.toolbox?.ways || []).includes(block.name);
    const node = el('button', `anomalous-ai-block-use${using ? ' is-on' : ''}`, t(using ? 'aiBlocksUsing' : 'aiBlocksUse'));
    node.type = 'button';
    node.title = t(using ? 'aiBlocksUsingHint' : 'aiBlocksUseHint');
    node.setAttribute('aria-pressed', String(using));
    node.onclick = async () => {
        node.disabled = true;
        const answer = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}/way`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: block.name, on: !using }),
        }).catch(error => ({ statusText: error.message }));
        if (!answer.ok) await anomalousAlert(answer.statusText);
        node.disabled = false;
        changed();
    };
    return node;
}

/**
 * A row: the title with a button that opens it, a line of `about` (all of it once open), then `rest`
 * (nodes shown only while it is open) and `always` (shown either way); `key` keeps it open across a redraw.
 */
function row(item, key, { classes = '', headExtra = [], rest = [], always = [], toggle }) {
    const node = el('div', `anomalous-ai-block${item.on ? '' : ' is-off'}${classes}${opened.has(key) ? ' is-open' : ''}`);
    const body = el('div', 'anomalous-ai-block-body');
    const head = el('div', 'anomalous-ai-block-head');
    const open = el('button', 'anomalous-ai-block-open', '▸');
    open.type = 'button';
    open.title = t('aiBlocksDetails');
    open.setAttribute('aria-label', `${t('aiBlocksDetails')}: ${words(item.title)}`);
    open.setAttribute('aria-expanded', String(opened.has(key)));
    open.onclick = () => {
        const now = !opened.has(key);
        if (now) opened.add(key);
        else opened.delete(key);
        node.classList.toggle('is-open', now);
        open.setAttribute('aria-expanded', String(now));
    };
    head.append(open, el('span', 'anomalous-ai-block-title', words(item.title)), ...headExtra);
    const more = el('div', 'anomalous-ai-block-more');
    more.append(...rest);
    body.append(head, el('div', 'anomalous-ai-block-about', words(item.about)), ...always, more);
    node.append(body, toggle);
    return node;
}

function blockRow(block, ctx, redraw, task) {
    // Where it came from, how it was tried, its models: shown once the row is opened.
    const rest = [];
    if (block.better_with?.length) rest.push(el('div', 'anomalous-ai-block-source', t('aiBlocksBetterWith', { names: block.better_with.join(', ') })));
    if (words(block.source)) rest.push(el('div', 'anomalous-ai-block-source', t('aiBlocksSource', { source: words(block.source) })));
    rest.push(...[tested(block), recommended(block, ctx.owner)].filter(Boolean));
    return row(block, block.name, {
        classes: block.usable ? '' : ' is-missing',
        headExtra: block.usable && block.on && !task.ended ? [useButton(block, task, ctx.changed)] : [],
        rest,
        always: block.usable ? [] : [lacks(block, ctx.owner)],
        toggle: onSwitch(block, { name: block.name }, redraw),
    });
}

/** The skills of the task's kind (`private`): a title, what it advises, its switch. */
function skillsGroup(skills, redraw, isPrivate) {
    const group = el('div', 'anomalous-ai-blocks-group');
    group.append(el('div', 'anomalous-ai-blocks-job', t('aiSkillsHeading')),
        el('div', 'anomalous-ai-blocks-note', t(isPrivate ? 'aiSkillsNotePrivate' : 'aiSkillsNote')));
    for (const skill of skills.filter(item => Boolean(item.private_only) === isPrivate)) {
        group.append(row(skill, `skill:${skill.name}`, { toggle: onSwitch(skill, { skill: skill.name }, redraw) }));
    }
    return group;
}

/** The blocks that lack a pack or a model, folded: each says what it lacks. */
function missingFold(blocks, ctx, redraw, task) {
    const fold = el('details', 'anomalous-ai-blocks-missing');
    fold.open = missingOpen;
    fold.ontoggle = () => { missingOpen = fold.open; };
    fold.append(el('summary', '', t('aiBlocksMissingFold', { count: blocks.length })), ...blocks.map(block => blockRow(block, ctx, redraw, task)));
    return fold;
}

function listBox(ctx, redraw, task) {
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
    const jobs = [...new Set([...shown.jobs, ...shown.blocks.map(block => block.job)])];
    const inOrder = jobs.flatMap(job => shown.blocks.filter(block => block.job === job));
    for (const job of jobs) {
        const blocks = inOrder.filter(block => block.job === job && block.usable);
        if (!blocks.length) continue;
        const group = el('div', 'anomalous-ai-blocks-group');
        group.append(el('div', 'anomalous-ai-blocks-job', t(`aiBlocksJob_${job}`)), ...blocks.map(block => blockRow(block, ctx, redraw, task)));
        body.append(group);
    }
    if (shown.skills?.length) body.append(skillsGroup(shown.skills, redraw, task.private === true));
    const missing = inOrder.filter(block => !block.usable);
    if (missing.length) body.append(missingFold(missing, ctx, redraw, task));
    return body;
}

/**
 * The view into `pane`; `ctx`: {close, owner, changed}. `fresh`: the view was just opened, so the list is read
 * again; `draw`: what is in `pane` is not this view's yet; `task`: the task shown (a private one has its own skills).
 */
export function renderBlocksView(pane, ctx, { fresh, draw, task }) {
    redrawView = () => {
        const top = pane.querySelector('.anomalous-ai-blocks')?.scrollTop || 0;
        pane.replaceChildren(sideHead(t('aiSideBlocks'), ctx.close), listBox(ctx, redrawView, task));
        const list = pane.querySelector('.anomalous-ai-blocks');
        if (list) list.scrollTop = top;
    };
    if (fresh || !shown) read();
    if (draw) redrawView();
}
