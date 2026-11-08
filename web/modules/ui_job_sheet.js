/**
 * The job sheet's card on the canvas (任务单): many runs of this canvas one after another. Opened from the
 * canvas's right-click menu (canvas_menu.js), it takes pasted prompts, a line each (or blocks parted by an
 * empty line), how many runs each gets, the seconds to rest between pictures and whether every prompt gets
 * the same seeds; no prompt runs the canvas as it is. Start keeps the canvas as it is then and the sheet runs
 * on this page (job_sheet_run.js). While it goes, from here or from the AI (run_workflow(sheet=…)), the card
 * shows where it stands, the newest pictures, pause / go on and stop, folded to a handle if wanted; a sheet
 * whose page is gone can go on from here. Ended, it can be changed and run again. What was typed is kept in
 * localStorage for this viewer. The server's words are api/job_sheets.py.
 */

import { api } from '../../../scripts/api.js';
import { app } from '../../../scripts/app.js';
import { MAX_COUNT, MAX_PAUSE, MAX_ROWS, MAX_TOTAL, bounded, jobAt, promptsOf, rowsOf, totalOf } from './job_sheet_plan.js';
import { askSheet, clearSheet, jobSheet, onJobSheet, startSheet, watchJobSheet } from './job_sheet_run.js';
import { translate as t } from './locales.js';
import { PAGE } from './mcp_bridge.js';
import { settle } from './ui_dom.js';

const DRAFT_KEY = 'anomalous_job_sheet_draft';
const SHOWN_PICTURES = 4;
const WHAT_CHARS = 60;

let card = null;
let editing = false; // the form is open
let folded = false;
let problems = [];
let checking = false;
let shownId = ''; // the sheet the card showed going: a new one unfolds it; an older one that ended is not shown
let ticker = null;
let browser = () => null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, run, title = '') {
    const node = el('button', className, label);
    node.type = 'button';
    node.title = title;
    node.onclick = run;
    return node;
}

function readDraft() {
    try {
        return { text: '', blocks: false, count: 1, pause: 0, same: false, ...JSON.parse(globalThis.localStorage?.getItem(DRAFT_KEY) || '{}') };
    } catch {
        return { text: '', blocks: false, count: 1, pause: 0, same: false };
    }
}

function keepDraft(draft) {
    try {
        globalThis.localStorage?.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch { /* kept for this page only */ }
}

const going = sheet => sheet && !['done', 'stopped'].includes(sheet.state);

/** The card, in the canvas's panel like the saves bar. */
function mount() {
    if (!card) {
        card = el('div', 'anomalous-job-sheet');
        card.id = 'anomalous-job-sheet';
        card.setAttribute('role', 'region');
    }
    card.setAttribute('aria-label', t('jobSheetTitle'));
    const home = document.querySelector('.graph-canvas-panel') || document.body;
    if (card.parentElement !== home) home.append(card);
    return card;
}

function head(extra = [], close = null) {
    const row = el('div', 'anomalous-job-sheet-head');
    row.append(el('span', 'anomalous-job-sheet-title', t('jobSheetTitle')), ...extra);
    if (close) row.append(close);
    return row;
}

/** The form: what to run, how often, how far apart. */
function form() {
    const draft = readDraft();
    const box = el('textarea', 'anomalous-job-sheet-text');
    box.value = draft.text;
    box.placeholder = t('jobSheetPlaceholder');
    box.rows = 6;
    const blocks = labeled('checkbox', t('jobSheetBlocks'), draft.blocks);
    const count = labeled('number', t('jobSheetCountLabel'), draft.count, 1, MAX_COUNT);
    const pause = labeled('number', t('jobSheetPauseLabel'), draft.pause, 0, MAX_PAUSE);
    const same = labeled('checkbox', t('jobSheetSameSeeds'), draft.same);
    const sum = el('div', 'anomalous-job-sheet-sum');
    const said = el('div', 'anomalous-job-sheet-problems');
    const start = button('anomalous-job-sheet-start', checking ? t('jobSheetChecking') : t('jobSheetStart'), () => void begin());
    start.disabled = checking;
    const read = () => {
        const now = { text: box.value, blocks: blocks.input.checked, count: bounded(count.input.value, 1, MAX_COUNT, 1),
            pause: bounded(pause.input.value, 0, MAX_PAUSE, 0), same: same.input.checked };
        keepDraft(now);
        return now;
    };
    const plan = () => {
        const now = read();
        const prompts = promptsOf(now.text, now.blocks);
        const rows = rowsOf(prompts, now.count);
        const total = totalOf(rows);
        sum.textContent = prompts.length ? t('jobSheetSum', { rows: prompts.length, count: now.count, total }) : t('jobSheetSumPlain', { count: now.count });
        const over = prompts.length > MAX_ROWS ? t('jobSheetTooManyRows', { most: MAX_ROWS }) : total > MAX_TOTAL ? t('jobSheetTooMany', { most: MAX_TOTAL, total }) : '';
        sum.classList.toggle('is-bad', Boolean(over));
        if (over) sum.textContent += ` · ${over}`;
        start.disabled = checking || Boolean(over);
        return { now, rows };
    };
    async function begin() {
        const { now, rows } = plan();
        checking = true;
        problems = [];
        draw();
        try {
            const root = app.rootGraph || app.graph;
            await startSheet({ rows, pause: now.pause, same_seeds: now.same, title: app.extensionManager?.workflow?.activeWorkflow?.filename || '' }, root.serialize());
            editing = false;
            folded = false;
        } catch (error) {
            problems = (error.problems || [t('jobSheetFailedStart', { why: String(error.message || error).slice(0, 300) })]).slice(0, 6);
        } finally {
            checking = false;
            draw();
        }
    }
    for (const input of [box, blocks.input, count.input, pause.input, same.input]) input.oninput = () => void plan();
    plan();
    said.textContent = problems.map(line => (line === 'no seed' ? t('jobSheetNoSeed') : line.replace(/^(\d+): /, (_, row) => `${t('jobSheetProblem', { row })}`))).join('\n');
    const close = button('anomalous-job-sheet-icon', '×', () => { editing = false; problems = []; draw(); }, t('jobSheetClose'));
    const knobs = el('div', 'anomalous-job-sheet-knobs');
    knobs.append(count.label, pause.label);
    const foot = el('div', 'anomalous-job-sheet-actions');
    foot.append(sum, start);
    return [head([], close), el('div', 'anomalous-job-sheet-lead', t('jobSheetLead')), box, blocks.label, knobs, same.label, foot, said,
        el('div', 'anomalous-job-sheet-foot', t('jobSheetFoot'))];
}

function labeled(type, words, value, min, max) {
    const label = el('label', `anomalous-job-sheet-field is-${type}`);
    const input = el('input');
    input.type = type;
    if (type === 'checkbox') input.checked = Boolean(value);
    else Object.assign(input, { min, max, step: 1, value: String(value) });
    if (type === 'checkbox') label.append(input, el('span', '', words));
    else label.append(el('span', '', words), input);
    return { label, input };
}

/** What one row says, short: its prompt, else its settings. */
function rowWords(row) {
    if (row.prompt) return row.prompt.length > WHAT_CHARS ? `${row.prompt.slice(0, WHAT_CHARS)}…` : row.prompt;
    const flat = Object.entries(row.values || {}).flatMap(([key, value]) => (value && typeof value === 'object'
        ? Object.entries(value).map(([name, item]) => `#${key} ${name} ${item}`) : [`${key} ${value}`]));
    return flat.join(' · ') || t('jobSheetAsIs');
}

/** Where a going sheet stands, in one line. */
function nowLine(sheet, mine, resting) {
    if (sheet.stale && !mine) return t('jobSheetStale', { done: sheet.done, total: sheet.total });
    if (sheet.state === 'paused') {
        const why = sheet.note === 'interrupted' ? t('jobSheetInterrupted') : sheet.note;
        return why ? t('jobSheetPausedWhy', { why }) : t('jobSheetPaused');
    }
    if (resting > 0) return t('jobSheetResting', { seconds: Math.ceil(resting / 1000) });
    const job = jobAt(sheet.rows, sheet.now ?? sheet.at);
    if (!job) return '';
    const row = sheet.rows[job.row];
    if (sheet.rows.length === 1 && !row.prompt && !row.values) return t('jobSheetNowPlain', { round: job.round + 1, count: row.count });
    return t('jobSheetNow', { row: job.row + 1, rows: sheet.rows.length, round: job.round + 1, count: row.count, what: rowWords(row) });
}

function pictures(sheet) {
    const strip = el('div', 'anomalous-job-sheet-pictures');
    for (const item of (sheet.last || []).slice(-SHOWN_PICTURES)) {
        const picture = el('img', 'anomalous-job-sheet-picture');
        const query = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder || '', type: item.folder || 'output' });
        picture.src = api.apiURL(`/view?${query}`);
        picture.alt = item.filename;
        picture.loading = 'lazy';
        picture.dataset.key = item.filename;
        strip.append(picture);
    }
    return strip;
}

/** A going or ended sheet. */
function status(sheet, mine, resting) {
    const live = going(sheet);
    const who = [sheet.by === 'ai' ? t('jobSheetByAi') : '', sheet.title].filter(Boolean).join(' · ');
    const fold = button('anomalous-job-sheet-icon', '⌄', () => { folded = true; draw(); }, t('jobSheetFold'));
    const close = button('anomalous-job-sheet-icon', '×', () => void clearSheet().then(draw), t('jobSheetClose'));
    const bar = el('div', 'anomalous-job-sheet-progress');
    const fill = el('span');
    fill.style.width = `${Math.round((sheet.done / Math.max(1, sheet.total)) * 100)}%`;
    bar.append(fill);
    const counts = [t('jobSheetDone', { done: sheet.done, total: sheet.total }), t('jobSheetPictures', { count: sheet.pictures })];
    if (sheet.failed) counts.push(t('jobSheetFailed', { count: sheet.failed }));
    const line = el('div', 'anomalous-job-sheet-now', live ? nowLine(sheet, mine, resting) : (sheet.state === 'done' ? t('jobSheetFinished') : t('jobSheetStopped')));
    line.classList.toggle('is-bad', live && sheet.state === 'paused' && Boolean(sheet.note));
    const actions = el('div', 'anomalous-job-sheet-actions');
    if (live && sheet.stale && !mine) actions.append(button('anomalous-job-sheet-start', t('jobSheetTakeOver'), () => void askSheet('go')));
    else if (live && sheet.state === 'paused') actions.append(button('anomalous-job-sheet-start', t('jobSheetGo'), () => void askSheet('go')));
    else if (live) actions.append(button('anomalous-job-sheet-button', t('jobSheetPause'), () => void askSheet('pause'), t('jobSheetPauseHint')));
    if (live) actions.append(button('anomalous-job-sheet-button', t('jobSheetStop'), () => void askSheet('stop'), t('jobSheetStopHint')));
    else actions.append(button('anomalous-job-sheet-start', t('jobSheetAgain'), () => again(sheet)));
    if (sheet.pictures) actions.append(button('anomalous-job-sheet-button', t('jobSheetLook'), () => look()));
    return [head([el('span', 'anomalous-job-sheet-who', who)], live ? fold : close), bar,
        el('div', 'anomalous-job-sheet-counts', counts.join(' · ')), line, pictures(sheet), actions];
}

/** The ended sheet's prompts back in the form, to change and run again on the canvas as it is now. */
function again(sheet) {
    const prompts = sheet.rows.filter(row => row.prompt).map(row => row.prompt);
    const blocks = prompts.some(prompt => prompt.includes('\n'));
    keepDraft({ ...readDraft(), text: prompts.join(blocks ? '\n\n' : '\n'), blocks, count: sheet.rows[0]?.count || 1, pause: sheet.pause, same: sheet.same_seeds });
    void clearSheet().catch(() => {}).then(() => openJobSheet());
}

function look() {
    const owner = browser();
    owner?.show({ page: 'gallery' });
}

/** Draws the card as things stand: the form, a sheet, its handle, or nothing. */
function draw() {
    const { sheet, mine, resting } = jobSheet();
    if (sheet && sheet.id !== shownId && going(sheet)) {
        shownId = sheet.id;
        folded = false;
        editing = false;
    }
    clearTimeout(ticker);
    ticker = resting > 0 ? setTimeout(draw, 1000) : null; // the pause's countdown
    if (editing && !going(sheet)) {
        const box = mount();
        box.classList.remove('is-folded');
        // The form keeps what is typed: it is made again only when it was not on the card.
        if (!box.dataset.form || checking !== (box.dataset.checking === '1')) {
            box.replaceChildren(...form());
            box.dataset.form = '1';
            box.dataset.checking = checking ? '1' : '0';
        }
        return;
    }
    if (!sheet || (!going(sheet) && sheet.id !== shownId)) {
        card?.remove();
        return;
    }
    const box = mount();
    if (box.dataset.form) box.replaceChildren(); // the form's parts are no part of a sheet's
    delete box.dataset.form;
    box.classList.toggle('is-folded', folded);
    if (folded) {
        const label = `${t('jobSheetTitle')} ${sheet.done}/${sheet.total}${sheet.state === 'paused' ? ` · ${t('jobSheetPaused')}` : ''} ⌃`;
        return void settle(box, [button('anomalous-job-sheet-unfold', label, () => { folded = false; draw(); }, t('jobSheetUnfold'))]);
    }
    settle(box, status(sheet, mine, resting));
}

/** Opens the card: the form, or the sheet going now. */
export function openJobSheet() {
    const { sheet } = jobSheet();
    editing = !going(sheet);
    folded = false;
    if (card) delete card.dataset.form;
    draw();
}

/** Follows the sheet on this page; `getBrowser` gives AMB's window (for its gallery). */
export function watchJobSheetCard(getBrowser) {
    browser = getBrowser;
    onJobSheet(draw);
    window.addEventListener('anomalous-language-change', () => {
        if (card) delete card.dataset.form;
        draw();
    });
    void watchJobSheet(PAGE);
}
