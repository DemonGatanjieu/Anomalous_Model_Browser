/**
 * The AI workbench page: what AI apps did through Anomalous's MCP endpoint (api/ai_tasks.py).
 * The tasks on the left, newest first; on the right one task: its title and counts, what it
 * made (pictures, models, combos, sounds) as a strip on top, then its steps as a timeline,
 * reads folded into one row, each step with what it made and where that leads (the picture
 * in the viewer, the model's page, the combo, the canvas change found or undone). A task the
 * AI is still working on grows by itself ("anomalous.ai_task" events) and says so at the foot.
 * In a narrow window the list and the task take turns. The rules are in ai_task_view.js.
 * Also the home page's "What the AI did lately" and the rail entry's dot for news.
 */

import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { translate as t } from './locales.js';
import { dayLabel, fetchActivity, timeLabel } from './activity_log.js';
import { changeNodeId } from './activity_diff.js';
import { canUndo, undoEntry } from './canvas_undo.js';
import { anomalousConfirm, anomalousPrompt, copyText } from './ui_dialog.js';
import { openListedModel } from './ui_scan_lists.js';
import { listCombos } from './image_keep.js';
import {
    audioResult, duration, groupSteps, isVideo, lookTools, outputUrl, stepDetail, taskCounts, taskResults, taskState, toolKey,
} from './ai_task_view.js';

const NARROW_PX = 720;
const RECENT_COUNT = 3;
const STRIP_MAX = 24;

const state = {
    owner: null,
    panel: null,
    page: null,
    tasks: [],
    selected: null,   // task id shown
    pinned: false,    // the user picked it: a new task of the AI does not take its place
    task: null,       // its full record
    entries: new Map(),// activity entries of its canvas steps, for undo and locate
    narrowView: 'list',
    refreshTimer: null,
    player: null,
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

const say = item => (item ? t(item.key, item.values) : '');
const visible = () => Boolean(state.panel?.isConnected && state.panel.style.display !== 'none');

async function getJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function postTask(id, body) {
    const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
}

const fetchTasks = (limit = 100) => getJson(`/anomalous/ai_tasks?limit=${limit}`).then(data => data.tasks || []);
const fetchTask = id => getJson(`/anomalous/ai_tasks/${encodeURIComponent(id)}`).then(data => data.task || null);

// ---------------------------------------------------------------- the list

function taskRow(summary) {
    const status = taskState(summary);
    const row = button(`anomalous-ai-task-row is-${status}${summary.id === state.selected ? ' is-current' : ''}`, '', () => {
        // Picking the newest task follows the AI again; an older one stays put.
        state.pinned = summary.id !== state.tasks[0]?.id;
        void select(summary.id);
    });
    const top = el('div', 'anomalous-ai-task-row-top');
    top.append(el('span', 'anomalous-ai-task-row-title', summary.title || t('aiUntitled')));
    if (status === 'live') top.append(el('span', 'anomalous-ai-live-dot'));
    const meta = [summary.client, `${dayLabel(summary.updated)} ${timeLabel(summary.updated)}`, t('aiStepCount', { count: summary.steps })];
    row.append(top, el('div', 'anomalous-ai-task-row-meta', meta.join(' · ')));
    const counts = taskCounts(summary);
    if (counts.length) row.append(el('div', 'anomalous-ai-task-row-counts', counts.map(say).join(' · ')));
    return row;
}

function renderList(box) {
    const head = el('div', 'anomalous-ai-tasks-head');
    head.append(el('span', 'anomalous-ai-tasks-title', t('aiTasks')), el('span', 'anomalous-ai-tasks-count', t('aiTaskCount', { count: state.tasks.length })));
    const list = el('div', 'anomalous-ai-tasks-list');
    list.append(...state.tasks.map(taskRow));
    box.replaceChildren(head, list);
}

// ---------------------------------------------------------------- results

function picture(result, className = 'anomalous-ai-thumb') {
    const url = outputUrl(result);
    const thumb = button(className, '', () => state.owner?.showGalleryViewer?.(url, isVideo(result)), t('aiOpenPicture'));
    if (isVideo(result)) {
        const video = el('video');
        video.src = url;
        video.muted = true;
        video.preload = 'metadata';
        thumb.append(video);
    } else {
        const image = el('img');
        image.loading = 'lazy';
        image.src = url;
        image.alt = result.filename;
        thumb.append(image);
    }
    return thumb;
}

function playButton(result) {
    const play = button('anomalous-ai-play', '▶', () => {
        const url = outputUrl(audioResult(result));
        if (state.player?.dataset?.url === url && !state.player.paused) {
            state.player.pause();
            return;
        }
        state.player?.pause();
        state.player = new Audio(url);
        state.player.dataset.url = url;
        state.player.play().catch(() => {});
    }, t('audioPlay'));
    return play;
}

async function openModel(result) {
    const owner = state.owner;
    if (!owner || !result.rel) return;
    await openListedModel(owner, { type: result.folder, path_idx: result.path_idx, rel: result.rel, filename: result.name || result.rel }, () => owner.goTo('ai'));
}

async function openComboNamed(name) {
    const owner = state.owner;
    const note = (await listCombos().catch(() => [])).find(item => item.data?.name === name || item.name === name);
    if (note) await owner.openCombo(note);
    else await owner.showNotebooks();
}

function locate(entry, note) {
    const change = (entry?.detail?.changes || []).find(item => item.kind !== 'removed' && changeNodeId(item) !== null);
    const id = change ? changeNodeId(change) : null;
    const graph = app.canvas?.graph || app.graph;
    const node = id === null ? null : graph?.getNodeById?.(Number(id)) ?? graph?.getNodeById?.(id);
    if (!node) {
        note.textContent = t('activityLocateMissing');
        return;
    }
    state.owner?.close?.();
    app.canvas.selectNode?.(node);
    app.canvas.centerOnNode?.(node);
    app.canvas.setDirty?.(true, true);
}

/** The links under a step: what it made and where that leads. */
function resultLinks(step) {
    const box = el('div', 'anomalous-ai-results');
    const pictures = (step.results || []).filter(result => result.type === 'image');
    if (pictures.length) {
        const strip = el('div', 'anomalous-ai-step-pictures');
        strip.append(...pictures.map(result => picture(result)));
        box.append(strip);
    }
    const links = el('div', 'anomalous-ai-links');
    const note = el('span', 'anomalous-ai-link-note');
    for (const result of step.results || []) {
        if (result.type === 'model') {
            const chip = button('anomalous-ai-chip is-model', result.name || result.model_id, () => openModel(result), t('aiOpenModel'));
            chip.disabled = !result.rel;
            links.append(chip);
        } else if (result.type === 'combo') {
            links.append(button('anomalous-ai-chip is-combo', result.name, () => openComboNamed(result.name), t('aiOpenCombo')));
        } else if (result.type === 'audio') {
            const chip = el('span', 'anomalous-ai-chip is-audio');
            chip.append(playButton(result), el('span', '', result.file.split('/').pop()));
            links.append(chip);
        } else if (result.type === 'canvas') {
            const entry = state.entries.get(result.activity);
            if (entry) {
                links.append(button('anomalous-ai-link', t('activityLocate'), () => locate(entry, note)));
                if (canUndo(app, entry)) {
                    const undo = button('anomalous-ai-link', t('activityUndo'), () => {
                        let done = t('activityUndone');
                        try { undoEntry(app, entry); } catch (_) { done = t('activityUndoGone'); }
                        undo.replaceWith(el('span', 'anomalous-ai-link-done', done));
                    });
                    links.append(undo);
                }
            }
        } else if (result.type === 'scan') {
            links.append(button('anomalous-ai-link', t('aiOpenScan'), () => state.owner?.openScanPage?.()));
        }
    }
    if (pictures.length) links.append(button('anomalous-ai-link', t('aiOpenGallery'), () => state.owner?.goTo('gallery')));
    if (links.childNodes.length) box.append(links, note);
    return box.childNodes.length ? box : null;
}

// ---------------------------------------------------------------- one task

function stepRow(step) {
    const row = el('div', `anomalous-ai-step is-${step.kind}${step.ok ? '' : ' is-failed'}`);
    row.append(el('span', 'anomalous-ai-step-dot'));
    const body = el('div', 'anomalous-ai-step-body');
    const line = el('div', 'anomalous-ai-step-line');
    line.append(el('span', 'anomalous-ai-kind', t(`aiKind_${step.kind}`)), el('span', 'anomalous-ai-step-title', t(toolKey(step.tool))));
    const detail = stepDetail(step);
    if (detail) {
        const text = el('span', 'anomalous-ai-step-detail', detail);
        text.title = detail;
        line.append(text);
    }
    body.append(line);
    if (step.text) body.append(el('div', 'anomalous-ai-note-text', step.text));
    if (step.error) body.append(el('div', 'anomalous-ai-step-error', step.error));
    if (step.state === 'running') body.append(el('div', 'anomalous-ai-step-running', t('aiRunRunning')));
    const links = resultLinks(step);
    if (links) body.append(links);
    const when = el('div', 'anomalous-ai-step-when');
    when.append(el('span', '', timeLabel(step.at)));
    const took = duration(step.ms);
    if (took) when.append(el('span', '', say(took)));
    row.append(body, when);
    return row;
}

function looksRow(steps) {
    const row = el('div', 'anomalous-ai-step is-look is-folded');
    row.append(el('span', 'anomalous-ai-step-dot'));
    const body = el('div', 'anomalous-ai-step-body');
    const tools = lookTools(steps).map(({ tool, count }) => (count > 1 ? `${t(toolKey(tool))} ×${count}` : t(toolKey(tool))));
    const head = button('anomalous-ai-looks', `${t('aiLooks', { count: steps.length })}：${tools.join('、')}`, () => {
        details.hidden = !details.hidden;
        head.setAttribute('aria-expanded', String(!details.hidden));
    });
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

function strip(task) {
    const made = taskResults(task);
    if (!made.image.length && !made.model.length && !made.combo.length && !made.audio.length) return null;
    const box = el('div', 'anomalous-ai-made');
    box.append(el('div', 'anomalous-ai-made-title', t('aiMade')));
    if (made.image.length) {
        const row = el('div', 'anomalous-ai-made-pictures');
        row.append(...made.image.slice(-STRIP_MAX).reverse().map(result => picture(result, 'anomalous-ai-made-picture')));
        box.append(row);
    }
    const chips = el('div', 'anomalous-ai-links');
    const seen = new Set();
    for (const result of [...made.model, ...made.combo]) {
        const key = `${result.type}:${result.model_id || result.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        chips.append(result.type === 'model'
            ? button('anomalous-ai-chip is-model', result.name || result.model_id, () => openModel(result), t('aiOpenModel'))
            : button('anomalous-ai-chip is-combo', result.name, () => openComboNamed(result.name), t('aiOpenCombo')));
    }
    for (const result of made.audio) {
        const chip = el('span', 'anomalous-ai-chip is-audio');
        chip.append(playButton(result), el('span', '', result.file.split('/').pop()));
        chips.append(chip);
    }
    if (chips.childNodes.length) box.append(chips);
    return box;
}

async function undoAll(task) {
    const entries = taskResults(task).canvas.map(result => state.entries.get(result.activity)).filter(Boolean).reverse();
    const undoable = entries.filter(entry => canUndo(app, entry));
    if (!undoable.length || !await anomalousConfirm(t('aiUndoAllConfirm', { count: undoable.length }), t('aiUndoAll'))) return;
    for (const entry of entries) {
        if (!canUndo(app, entry)) break; // a later change of the user's is in the way: stop there
        try { undoEntry(app, entry); } catch (_) { break; }
    }
    renderTask();
}

function renderTask() {
    const box = state.page?.querySelector('.anomalous-ai-task');
    if (!box) return;
    const task = state.task;
    if (!task) {
        box.replaceChildren(el('div', 'anomalous-ai-empty-task', state.tasks.length ? t('aiPickTask') : ''));
        return;
    }
    const keepBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const keepTop = box.scrollTop;
    const summary = state.tasks.find(item => item.id === task.id) || {};
    const status = taskState(summary);
    const header = el('div', 'anomalous-ai-task-head');
    const titleLine = el('div', 'anomalous-ai-task-title-line');
    titleLine.append(button('anomalous-ai-back', `‹ ${t('aiAllTasks')}`, () => { state.narrowView = 'list'; layout(); }),
        el('h2', 'anomalous-ai-task-title', task.title || t('aiUntitled')),
        el('span', `anomalous-ai-state is-${status}`, t(`aiState_${status}`)));
    const tools = el('div', 'anomalous-ai-task-tools');
    tools.append(button('anomalous-ai-link', t('aiRename'), async () => {
        const title = await anomalousPrompt(t('aiRenamePrompt'), task.title || '', t('aiRename'));
        if (title === null || title === undefined) return;
        await postTask(task.id, { title }).catch(error => alert(error.message));
        await refresh();
    }));
    if (taskResults(task).canvas.some(result => state.entries.has(result.activity) && canUndo(app, state.entries.get(result.activity)))) {
        tools.append(button('anomalous-ai-link', t('aiUndoAll'), () => undoAll(task)));
    }
    tools.append(button('anomalous-ai-link is-danger', t('aiRemove'), async () => {
        if (!await anomalousConfirm(t('aiRemoveConfirm'), t('aiRemove'))) return;
        await postTask(task.id, { remove: true }).catch(error => alert(error.message));
        state.selected = null;
        state.task = null;
        state.narrowView = 'list';
        await refresh();
    }));
    titleLine.append(tools);
    const meta = [task.client, `${dayLabel(task.started)} ${timeLabel(task.started)}`, t('aiStepCount', { count: (task.steps || []).length }),
        ...taskCounts(summary).map(say)];
    header.append(titleLine, el('div', 'anomalous-ai-task-meta', meta.join(' · ')));

    const timeline = el('div', 'anomalous-ai-timeline');
    for (const item of groupSteps(task.steps)) timeline.append(item.type === 'looks' ? looksRow(item.steps) : stepRow(item.step));
    if (!(task.steps || []).length) timeline.append(el('div', 'anomalous-ai-empty-task', t('aiNoSteps')));
    const parts = [header];
    const made = strip(task);
    if (made) parts.push(made);
    parts.push(timeline);
    if (status === 'live') parts.push(el('div', 'anomalous-ai-working', (task.steps || []).some(step => step.state === 'running') ? t('aiRunRunning') : t('aiWorking')));
    box.replaceChildren(...parts);
    box.scrollTop = keepBottom && status === 'live' ? box.scrollHeight : keepTop;
}

async function loadEntries(task) {
    const wanted = new Set(taskResults(task).canvas.map(result => result.activity));
    if (!wanted.size || [...wanted].every(id => state.entries.has(id))) return;
    const entries = await fetchActivity({ limit: 500, source: 'canvas' }).catch(() => []);
    for (const entry of entries) if (wanted.has(entry.id)) state.entries.set(entry.id, entry);
}

async function select(id) {
    state.selected = id;
    state.narrowView = 'task';
    state.page?.querySelectorAll('.anomalous-ai-task-row').forEach(row => row.classList.remove('is-current'));
    renderList(state.page.querySelector('.anomalous-ai-tasks'));
    layout();
    const task = await fetchTask(id).catch(() => null);
    if (state.selected !== id) return;
    state.task = task;
    if (task) await loadEntries(task);
    if (state.selected === id) renderTask();
}

// ---------------------------------------------------------------- the page

function layout() {
    const page = state.page;
    if (!page) return;
    const narrow = page.clientWidth > 0 && page.clientWidth < NARROW_PX;
    page.classList.toggle('is-narrow', narrow);
    page.classList.toggle('shows-task', narrow && state.narrowView === 'task' && Boolean(state.selected));
}

function emptyPage() {
    const box = el('div', 'anomalous-ai-welcome');
    const address = `${location.origin}/anomalous/mcp`;
    const line = el('div', 'anomalous-ai-address');
    const code = el('code', '', address);
    line.append(code, button('anomalous-ai-link', t('aiCopyAddress'), async (event) => {
        await copyText(address);
        event.target.textContent = t('aiCopied');
    }));
    box.append(el('h2', 'anomalous-ai-welcome-title', t('aiWelcomeTitle')), el('p', 'anomalous-ai-welcome-body', t('aiWelcomeBody')), line,
        el('p', 'anomalous-ai-welcome-hint', t('aiWelcomeHint')));
    return box;
}

async function refresh() {
    if (!state.page) return;
    const tasks = await fetchTasks().catch(() => null);
    if (!tasks || !state.page) return;
    state.tasks = tasks;
    if (!tasks.length) {
        state.page.replaceChildren(emptyPage());
        state.page.classList.add('is-empty');
        return;
    }
    if (state.page.classList.contains('is-empty') || !state.page.querySelector('.anomalous-ai-tasks')) {
        state.page.classList.remove('is-empty');
        state.page.replaceChildren(el('aside', 'anomalous-ai-tasks'), el('section', 'anomalous-ai-task'));
    }
    // The newest task while the AI works on it, unless the user picked another one.
    const follow = !state.pinned && tasks[0].live && tasks[0].id !== state.selected;
    if (follow || !tasks.some(task => task.id === state.selected)) {
        state.selected = tasks[0].id;
        state.pinned = false;
        state.task = null;
    }
    renderList(state.page.querySelector('.anomalous-ai-tasks'));
    const task = await fetchTask(state.selected).catch(() => null);
    state.task = task;
    if (task) await loadEntries(task);
    renderTask();
    layout();
}

/** The whole page into `panel`. */
export function renderAiWorkbench(owner, panel) {
    state.owner = owner;
    state.panel = panel;
    if (!state.page || state.page.parentNode !== panel) {
        state.page = el('div', 'anomalous-ai');
        panel.replaceChildren(state.page);
        if (typeof ResizeObserver === 'function') new ResizeObserver(layout).observe(state.page);
    }
    owner.railNews?.('ai', false);
    void refresh();
}

/** Once: the server's "anomalous.ai_task" event refreshes the page, the home list and the rail's dot. */
export function watchAiTasks(owner) {
    state.owner = owner;
    api.addEventListener('anomalous.ai_task', () => {
        clearTimeout(state.refreshTimer);
        state.refreshTimer = setTimeout(() => {
            const onPage = owner.modal?.classList.contains('visible') && owner.currentShellPage?.() === 'ai' && visible();
            if (onPage) void refresh();
            else owner.railNews?.('ai', true);
            if (owner.currentShellPage?.() === 'home') owner.onActivityRecorded?.();
        }, 300);
    });
}

/** The home page's short list: the last few tasks, with what they made. Nothing when there are none. */
export function renderRecentAiTasks(owner, container) {
    fetchTasks(RECENT_COUNT).then((tasks) => {
        if (!tasks.length || !container.isConnected) return;
        const section = el('section', 'anomalous-home-recent anomalous-ai-recent');
        const head = el('div', 'anomalous-home-recent-head');
        head.append(el('span', 'anomalous-home-recent-title', t('aiRecent')), button('anomalous-home-link', t('activityViewAll'), () => owner.goTo('ai')));
        const list = el('div', 'anomalous-ai-recent-list');
        for (const summary of tasks) {
            const row = button(`anomalous-ai-recent-row is-${taskState(summary)}`, '', () => {
                state.selected = summary.id;
                state.pinned = summary.id !== tasks[0].id;
                owner.goTo('ai');
            });
            if (summary.cover) {
                const image = el('img', 'anomalous-ai-recent-cover');
                image.loading = 'lazy';
                image.src = outputUrl(summary.cover);
                image.alt = '';
                row.append(image);
            }
            const text = el('span', 'anomalous-ai-recent-text');
            text.append(el('span', 'anomalous-ai-recent-title', summary.title || t('aiUntitled')),
                el('span', 'anomalous-ai-recent-meta', [summary.client, timeLabel(summary.updated), ...taskCounts(summary).map(say)].join(' · ')));
            row.append(text);
            list.append(row);
        }
        section.append(head, list);
        const recent = container.querySelector('.anomalous-home-recent');
        if (recent) recent.before(section);
        else container.append(section);
    }).catch(() => { /* the home page works without it */ });
}
