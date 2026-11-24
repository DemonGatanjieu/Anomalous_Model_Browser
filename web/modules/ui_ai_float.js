/**
 * The AI's card over the canvas (画布悬浮挂牌): while AMB's window is shut and an AI works on a task, a
 * small card at the top of the canvas, in its panel like the saves bar and the job sheet's card, so the
 * user watches the nodes change. Its head: the task's dot and name, "message the AI", Pause
 * (ui_ai_halt.js), fold into a line, the full workbench, and × (the card goes, the AI goes on). Under
 * it the tag (ui_ai_float_parts.js): what goes on, the first open question, the line to the AI.
 * Where the browser can, one button puts it in a desktop window on top of every app, and back
 * (ui_ai_float_pip.js); there it is drawn the same and the window's own frame moves it. The review
 * console (ui_review_console.js) rehearses it on made-up tasks (setAiFloatPreview): what is pressed then
 * goes to the console, never to the server, and nothing is kept in the browser.
 * Dragged by its head (kept in this browser), put back at the top by a double-click on it. When it
 * shows and which task it follows: ai_float_state.js. It never opens AMB's window by itself:
 * `getBrowser()` only when the user asks for the workbench, whose opening hides the card
 * (setAiFloatBrowserOpen, browser.js); its closing brings the card back for a task at work. The page's
 * "anomalous.ai_task" event drives it: steps are read again (one read for a burst), a run's progress
 * only moves its bar.
 */

import { api } from '../../../scripts/api.js';
import { resolveLocale, translate as t } from './locales.js';
import { taskTitle } from './ai_task_title.js';
import { fetchTasks, readTask } from './ai_task_cache.js';
import { canHalt, pauseTask } from './ui_ai_halt.js';
import { hasDraft, hidePanelToast } from './ui_ai_panel.js';
import { askView, brief, floatTool, lineKey, lineView, sayView } from './ui_ai_float_parts.js';
import { closeDesktopPip, focusOpenerWindow, isDesktopPipOpen, openDesktopPip, supportsDesktopPip } from './ui_ai_float_pip.js';
import {
    attentionKeys, clampFloatPosition, dismissFloat, floatState, floatTone, floatWakeIn, hasNewAttention, isTaskActive,
    liftDismissal, parseFloatPosition, pickFloatAsk, pickTracked, shouldAutoShowOnBoot, shouldShowFloat,
} from './ai_float_state.js';

const POS_KEY = 'anomalous_ai_float_pos';
const FOLD_KEY = 'anomalous_ai_float_folded';
const READ_MS = 250; // steps come in bursts: one read for them

const state = {
    browser: () => null,
    task: null,        // the task followed, as last read
    pinned: null,      // the task the user put on the canvas from the workbench
    dismissed: null,   // the user's × (ai_float_state.js dismissFloat)
    watching: null,    // the task the card showed while it went on: its end shows once
    keys: { id: null, list: [] }, // what waited on the user at the last draw: something new unfolds the card
    browserOpen: false,
    heard: false,      // an AI task event came since the page loaded: AMB's closing looks again
    folded: false,
    pos: null,         // where the user dragged it in the canvas, or null: the top middle
    sayOpen: false,
    says: new Map(),   // task id -> the line to the AI half typed
    pending: new Set(),
    readTimer: 0,
    wakeTimer: 0,
    drawOnClose: false,
    stopDrag: null,
    resize: null,
    preview: null,     // the review console's rehearsal: { task, onAction, onDismiss }
    real: null,        // what the rehearsal set aside, put back when it ends
};
let card = null;

function stored(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function store(key, value) {
    if (state.preview) return; // a rehearsal keeps nothing
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch { /* this viewer's convenience */ }
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

// ---------------------------------------------------------------- the card in the canvas

function mount() {
    if (!card) {
        card = el('div', 'anomalous-ai-float');
        card.id = 'anomalous-ai-float'; // an anomalous- id: Ctrl+Enter typed here is not ComfyUI's run (ui_key_guard.js)
        card.setAttribute('role', 'region');
        card.addEventListener('keydown', (event) => {
            if (event.target.matches?.('input, textarea')) event.stopPropagation(); // typing here is not the canvas's shortcuts
        });
        card.addEventListener('pointerdown', startDrag);
        card.addEventListener('dblclick', (event) => { // held by the drag, the card itself is its target: what is under the pointer says
            if (isDesktopPipOpen()) return;
            const spot = document.elementFromPoint(event.clientX, event.clientY);
            if (!spot?.closest('.anomalous-ai-float-head') || spot.closest('button, input')) return;
            state.pos = null;
            store(POS_KEY, null);
            place();
        });
    }
    card.setAttribute('aria-label', t('aiFloatLabel'));
    if (isDesktopPipOpen()) return; // in its desktop window, where the window's frame places it
    const home = document.querySelector('.graph-canvas-panel') || document.body;
    if (card.parentElement !== home) home.append(card);
    if (!state.resize && typeof ResizeObserver === 'function') {
        state.resize = new ResizeObserver(() => place()); // the canvas resized, or the card grew: still inside
        state.resize.observe(home);
        state.resize.observe(card);
    }
}

function hide() {
    clearTimeout(state.wakeTimer);
    state.stopDrag?.();
    state.resize?.disconnect();
    state.resize = null;
    if (isDesktopPipOpen()) closeDesktopPip({ suppressReturn: true }); // no empty desktop window left behind
    card?.remove();
}

/** The dragged place, kept inside the canvas; none: the top middle (the CSS). */
function place() {
    if (!card?.isConnected || isDesktopPipOpen()) return;
    card.classList.toggle('has-pos', Boolean(state.pos));
    if (!state.pos) {
        card.style.left = '';
        card.style.top = '';
        return;
    }
    const host = card.parentElement;
    const at = clampFloatPosition(state.pos, { width: host.clientWidth, height: host.clientHeight }, { width: card.offsetWidth, height: card.offsetHeight });
    card.style.left = `${at.left}px`;
    card.style.top = `${at.top}px`;
}

function startDrag(event) {
    if (isDesktopPipOpen() || event.button !== 0 || !event.target.closest('.anomalous-ai-float-head') || event.target.closest('button, input')) return;
    event.preventDefault();
    const host = card.parentElement.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const grab = { x: event.clientX - box.left, y: event.clientY - box.top };
    const select = document.body.style.userSelect;
    let moved = false;
    document.body.style.userSelect = 'none';
    card.classList.add('is-dragging');
    const move = (next) => {
        moved = true;
        state.pos = { left: next.clientX - host.left - grab.x, top: next.clientY - host.top - grab.y };
        place();
    };
    // The card holds the pointer while it is dragged: the canvas under it swallows a release that is not ours.
    let target = card;
    try { card.setPointerCapture(event.pointerId); } catch { target = window; }
    const stop = () => {
        for (const [name, run] of ends) target.removeEventListener(name, run);
        document.body.style.userSelect = select;
        card?.classList.remove('is-dragging');
        state.stopDrag = null;
        if (!moved || !card) return;
        state.pos = { left: parseFloat(card.style.left) || 0, top: parseFloat(card.style.top) || 0 }; // where it stands, inside
        store(POS_KEY, JSON.stringify(state.pos));
    };
    const ends = [['pointermove', move], ['pointerup', stop], ['pointercancel', stop], ['lostpointercapture', stop]];
    for (const [name, run] of ends) target.addEventListener(name, run);
    state.stopDrag = stop;
}

// ---------------------------------------------------------------- drawing it

/** The task the card shows: the rehearsal's while one runs, else the one followed. */
const shownTask = () => state.preview?.task || state.task;

/** In a rehearsal, what a press on the card does goes to the console (never to the server); null outside one. */
const rehearsal = () => (state.preview ? action => state.preview?.onAction?.(action) : null);

function headView(task) {
    const head = el('div', 'anomalous-ai-float-head');
    head.title = t('aiFloatDrag');
    const name = el('span', 'anomalous-ai-float-title', taskTitle(task));
    name.title = taskTitle(task);
    const tools = el('div', 'anomalous-ai-float-tools');
    if (!state.folded && !task.ended) {
        const say = floatTool('chat', t('aiFloatSay'), () => toggleSay(), { extra: ' is-say' });
        say.setAttribute('aria-expanded', String(state.sayOpen));
        tools.append(say);
    }
    if (!state.folded && canHalt(task)) {
        const act = rehearsal();
        const pause = act ? () => act({ type: 'pause' }) : () => void pauseTask(task, () => readAgain(task.id));
        tools.append(floatTool('pause', t('aiPause'), pause, { title: `${t('aiPause')} · ${t('aiPauseHint')}` }));
    }
    const desktop = isDesktopPipOpen();
    if (supportsDesktopPip()) {
        tools.append(desktop ? floatTool('pip', t('aiFloatDock'), () => closeDesktopPip())
            : floatTool('popout', t('aiFloatPopout'), () => void popOut()));
    }
    if (!desktop) tools.append(floatTool(state.folded ? 'chevronDown' : 'chevronUp', t(state.folded ? 'aiFloatUnfold' : 'aiFloatFold'), () => setFolded(!state.folded)));
    tools.append(floatTool('expand', t('aiFloatOpen'), () => openWorkbench(task)));
    if (!state.folded) tools.append(floatTool('close', t('aiFloatClose'), dismiss));
    head.append(el('span', 'anomalous-ai-float-dot'), name, el('span', 'anomalous-ai-float-brief'), tools);
    return head;
}

/** The head's message button is lit while the line is open or holds words. */
function markSaying(task) {
    card?.querySelector('.anomalous-ai-float-btn.is-say')?.classList.toggle('is-on', state.sayOpen || state.says.has(task.id));
}

/** Puts `make()` into `holder` when `key` changed; returns what is there. */
function settle(holder, key, make) {
    if (holder.dataset.key !== key) {
        holder.dataset.key = key;
        holder.replaceChildren(...[make()].filter(Boolean));
    }
    return holder.firstElementChild;
}

function render(task, view) {
    mount();
    card.classList.toggle('is-folded', state.folded);
    let head = card.querySelector(':scope > .anomalous-ai-float-head');
    const desktop = isDesktopPipOpen();
    const headKey = JSON.stringify([resolveLocale(), task.id, taskTitle(task), state.folded, Boolean(task.ended), canHalt(task), state.sayOpen, desktop]);
    if (desktop) card.ownerDocument.title = taskTitle(task); // the desktop window's name follows the task and the language
    if (!head || head.dataset.key !== headKey) {
        const fresh = headView(task);
        fresh.dataset.key = headKey;
        if (head) head.replaceWith(fresh);
        else card.prepend(fresh);
        head = fresh;
    }
    head.querySelector('.anomalous-ai-float-dot').className = `anomalous-ai-float-dot is-${floatTone(task)}`;
    head.querySelector('.anomalous-ai-float-brief').textContent = state.folded ? `· ${brief(view)}` : '';
    markSaying(task);
    let tag = card.querySelector(':scope > .anomalous-ai-float-tag');
    if (!tag) {
        tag = el('div', 'anomalous-ai-float-tag');
        tag.append(el('div', 'anomalous-ai-float-now'), el('div', 'anomalous-ai-float-asks'), el('div', 'anomalous-ai-float-sayer'));
        card.append(tag);
    }
    tag.hidden = state.folded;
    if (!state.folded) {
        const [now, asks, sayer] = tag.children;
        const act = rehearsal();
        const ctx = { open: () => openWorkbench(task), refresh: act ? draw : () => readAgain(task.id), closeSay: () => toggleSay(false),
            says: state.says, saying: () => markSaying(task), previewAction: act };
        settle(now, lineKey(task, view), () => lineView(task, view, ctx))?.update?.(view.step);
        const ask = pickFloatAsk(task, (step, block) => hasDraft(task.id, step.id, block.id));
        settle(asks, ask ? JSON.stringify([resolveLocale(), task.id, ask.step.id, ask.block, ask.inline, ask.more]) : '', () => ask && askView(task, ask, ctx)); // the block: its words too
        const saying = state.sayOpen && !task.ended;
        settle(sayer, saying ? JSON.stringify([resolveLocale(), task.id]) : '', () => saying && sayView(task, ctx));
    }
    place();
}

// ---------------------------------------------------------------- when it shows

function draw() {
    clearTimeout(state.wakeTimer);
    const task = shownTask();
    state.dismissed = liftDismissal(state.dismissed, task);
    const show = shouldShowFloat({ task, browserOpen: state.browserOpen, pinnedTaskId: state.pinned, dismissed: state.dismissed, watching: state.watching });
    if (!show) return void hide();
    if (!task.ended && !task.chat_only) state.watching = task.id; // one in an AI app's chat goes with its gate
    if (state.folded && hasNewAttention(state.keys.id === task.id ? state.keys.list : [], task)) setFolded(false, false); // something new to decide: in reach
    state.keys = { id: task.id, list: attentionKeys(task) };
    if (task.ended) state.sayOpen = false;
    hidePanelToast(); // a toast left from AMB's window on another page: the card says it now
    render(task, floatState(task));
    const wake = floatWakeIn(task);
    if (wake) state.wakeTimer = setTimeout(draw, wake * 1000);
}

function readAgain(id) {
    readTask(id).then((task) => {
        if (!task) return;
        state.task = pickTracked(state.task, task, { pinnedTaskId: state.pinned });
        draw();
    }).catch(() => { /* the next event reads it again */ });
}

function setFolded(folded, redraw = true) {
    state.folded = folded;
    store(FOLD_KEY, folded ? '1' : '0');
    if (redraw) draw();
}

function toggleSay(open = !state.sayOpen) {
    state.sayOpen = open;
    draw();
    if (open) card?.querySelector('.anomalous-ai-float-say .anomalous-ai-float-field')?.focus();
}

/** ×: the card goes until the task asks something new; the AI goes on. */
function dismiss() {
    state.dismissed = dismissFloat(shownTask());
    state.pinned = null;
    state.watching = null;
    state.sayOpen = false;
    hide();
    state.preview?.onDismiss?.();
}

/** The card in a desktop window over every app (from the click: the browser asks for one), unfolded so the tag shows. */
async function popOut() {
    if (state.folded) setFolded(false);
    state.stopDrag?.();
    state.resize?.disconnect(); // the window's frame sizes it now
    state.resize = null;
    await openDesktopPip(card, { title: taskTitle(shownTask()), onReturn: draw });
    draw(); // in its window, or still on the canvas when the browser gave none
}

/** The full workbench on this task (AMB's window opens on the AI page; the card steps back), in ComfyUI's own window. */
function openWorkbench(task) {
    if (isDesktopPipOpen()) {
        closeDesktopPip({ suppressReturn: true });
        focusOpenerWindow();
    }
    if (state.preview) { // a rehearsal's task is not on the server: the AI page alone
        state.browser?.()?.show?.({ page: 'ai' });
        state.preview?.onAction?.({ type: 'open_workbench' });
        return;
    }
    state.browser?.()?.openAiTask?.(task.id);
}

function heard(event) {
    const detail = event?.detail || {};
    if (!detail.id) return;
    state.heard = true;
    if (state.preview) return; // a rehearsal holds the card: the real task is read again when it ends
    if (detail.progress) {
        const step = state.task?.id === detail.id && (state.task.steps || []).find(item => item.id === detail.progress.step);
        if (!step) return;
        step.progress = detail.progress;
        if (card?.isConnected) draw();
        return;
    }
    if (state.browserOpen) return; // the window shows it; its closing looks again
    state.pending.add(detail.id);
    clearTimeout(state.readTimer);
    state.readTimer = setTimeout(() => {
        const ids = [...state.pending];
        state.pending.clear();
        ids.forEach(id => readAgain(id));
    }, READ_MS);
}

/** AMB's window closed: the task put on the canvas, the one followed, or the newest at work. */
async function lookAgain() {
    if (state.preview) return;
    const [newest] = await fetchTasks(1).catch(() => []);
    const ids = new Set([state.pinned, state.task?.id, shouldAutoShowOnBoot(newest) ? newest.id : null].filter(Boolean));
    for (const id of ids) {
        const task = await readTask(id).catch(() => null);
        if (state.browserOpen || state.preview) return;
        if (task) state.task = pickTracked(state.task, task, { pinnedTaskId: state.pinned });
    }
    draw();
}

/** The page loaded: the card only for a newest task at work or asking now; never one that ended. */
async function boot() {
    const [newest] = await fetchTasks(1).catch(() => []);
    if (!shouldAutoShowOnBoot(newest)) return;
    const task = await readTask(newest.id).catch(() => null);
    // ComfyUI draws its canvas's panel after the plugins start: the card waits for it (15 s at most).
    for (let tries = 0; tries < 60 && !document.querySelector('.graph-canvas-panel'); tries++) await new Promise(done => setTimeout(done, 250));
    if (!task || state.task || state.preview || !isTaskActive(task)) return;
    state.task = task;
    draw();
}

/** Once, from browser_entry.js: `getBrowser()` gives AMB's window, asked for only when the user wants the workbench. */
export function watchAiFloat(getBrowser) {
    state.browser = getBrowser;
    state.folded = stored(FOLD_KEY) === '1';
    state.pos = parseFloatPosition(stored(POS_KEY));
    api.addEventListener('anomalous.ai_task', heard);
    window.addEventListener('anomalous-language-change', () => { if (card?.isConnected) draw(); });
    void boot();
}

/** The workbench's "float over canvas" on `task`: the card follows it, unfolded, and `closeBrowser()` gives it the canvas. */
export function floatAiTask(task, closeBrowser) {
    if (!task) return;
    state.task = task;
    state.pinned = task.id;
    state.dismissed = null;
    state.watching = task.ended ? null : task.id;
    setFolded(false, false);
    state.drawOnClose = true;
    closeBrowser?.();
}

/** AMB's window opened (the card steps back) or closed (it comes back for a task at work); browser.js. */
export function setAiFloatBrowserOpen(open) {
    state.browserOpen = Boolean(open);
    if (state.browserOpen) {
        state.watching = null; // the window shows the task now: an end seen there is not said again
        hide();
        return;
    }
    if (state.preview) return void draw(); // the rehearsal comes back
    if (state.drawOnClose) {
        state.drawOnClose = false;
        draw();
    }
    if (state.task || state.pinned || state.heard) void lookAgain();
}

/**
 * The review console's rehearsal (ui_review_console.js): the card shows `task` (review_scenarios.js) as it
 * would a real one, but a press on it goes to `onAction(action)` and its × to `onDismiss()`, never to the
 * server, and nothing it does is kept in the browser. `resetDismissal`: a new rehearsal starts afresh (no
 * ×, nothing put on the canvas, followed unless it is in an AI app's own chat); false while one goes on.
 * Returns { shown, desktop }: whether the card shows, and whether in the desktop window.
 */
export function setAiFloatPreview(task, { onAction = null, onDismiss = null, resetDismissal = true } = {}) {
    if (!state.real) {
        const { dismissed, pinned, watching, keys, folded, pos } = state;
        state.real = { dismissed, pinned, watching, keys, folded, pos };
    }
    state.preview = { task, onAction, onDismiss };
    if (resetDismissal) Object.assign(state, { dismissed: null, pinned: null, watching: task.chat_only ? null : task.id });
    draw();
    return { shown: Boolean(card?.isConnected), desktop: isDesktopPipOpen() };
}

/** The rehearsal ends: its card goes, with the desktop window, and the real task's card comes back as it was. */
export function clearAiFloatPreview() {
    if (!state.preview) return;
    state.preview = null;
    hide();
    for (const id of [...state.says.keys()]) if (id.startsWith('preview_')) state.says.delete(id);
    Object.assign(state, state.real, { sayOpen: false });
    state.real = null;
    if (state.task || state.pinned || state.heard) void lookAgain();
}

export const isAiFloatPreviewing = () => Boolean(state.preview);
