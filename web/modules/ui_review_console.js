/**
 * The review console (审查修改器): a panel for the plugin's author to look at what needs an AI, a theme, a
 * language or another kind of user, in a few seconds, with no AI, no token and nothing kept. No button leads
 * here: Ctrl+Shift+Alt+G or an address ending in #amb-review (browser_entry.js), or five quick clicks on the
 * version number (ui_version_manager.js), and only then is this module loaded.
 *
 * What it shows lives in this page's memory. The AI's canvas card rehearses review_scenarios.js tasks through
 * its own drawing (ui_ai_float.js setAiFloatPreview): a press on the card comes here and moves the task on
 * (applyPreviewAction), the server hears nothing. The rail shows another user's pins without keeping them
 * (ui_shell_rail.js previewPins); the Workflows page its drop veil by a class; Home the first-run card as a
 * new user meets it (ui_first_run.js previewFirstRun, never hidden for real). The blank sandbox
 * (review_sandbox.js) is AMB as a whole for a new user, with a pretend library and server in memory: the pages
 * work for real against it, and a shared workflow opens in a tab of its own. Theme and language are the
 * real switches: Reset and ×, and leaving or reloading the page while it is open, put them back as they were
 * when the console opened, and end all the rest.
 */

import { resolveLocale, translate as t } from './locales.js';
import { setLanguagePreview, setThemePreview, themePreference } from './interface_settings.js';
import { clearAiFloatPreview, isAiFloatPreviewing, setAiFloatPreview } from './ui_ai_float.js';
import { REVIEW_SCENARIOS, applyPreviewAction, buildPreviewTask, railPreset } from './review_scenarios.js';
import { openConnectGuide } from './ui_ai_connect.js';
import { openShareDialog } from './ui_share.js';
import { startSpotlightTour } from './ui_spotlight_tour.js';
import { openVersionPanel } from './ui_version_manager.js';
import { clearFirstRunPreview, firstRunPreviewMode, previewFirstRun } from './ui_first_run.js';
import { clearPageTipPreview, pageTipPreviewMode, previewPageTip } from './ui_page_tip.js';
import { LIBRARIES, NETWORKS } from './review_sandbox_data.js';
import {
    enterSandbox, exitSandbox, markSandboxWindow, openSharedWorkflow, resetSandboxProgress, sandboxState, setSandboxLibrary, setSandboxNetwork,
} from './review_sandbox.js';
import { WORKBENCH_SCENES } from './review_workbench_data.js';
import {
    enterWorkbenchRehearsal, exitWorkbenchRehearsal, refreshWorkbenchLocale, resetWorkbenchDemo,
    setWorkbenchProgress, workbenchRehearsalState,
} from './review_workbench.js';

const THEMES = ['auto', 'dark', 'light', 'abyssal'];
const LANGUAGES = [['zh', 'mainLanguageChinese'], ['en', 'mainLanguageEnglish']];
const PERSONAS = ['real', 'fresh', 'upgraded', 'full'];
const GROUPS = ['live', 'action', 'other'];
// The first-run card's preview: cycles centered welcome -> offline fallback -> scanning dock -> done missing-cover nudge -> off.
const FIRST_RUN_NEXT = {
    idle: 'offline_choice',
    offline_choice: 'running',
    running: 'done_missing_covers',
    done_missing_covers: null,
};
const FIRST_RUN_NOTES = {
    idle: 'reviewFirstRunIdle',
    offline_choice: 'reviewFirstRunOffline',
    running: 'reviewFirstRunRunning',
    done_missing_covers: 'reviewFirstRunDoneMissing',
};
// Page first-visit tips preview: cycles Models -> Gallery -> off in memory only.
const PAGE_TIP_NEXT = {
    models: 'gallery',
    gallery: null,
};
const PAGE_TIP_NOTES = {
    models: 'reviewPageTipModels',
    gallery: 'reviewPageTipGallery',
};
const MARGIN = 8;

const state = {
    root: null,
    getBrowser: () => null,
    scene: null,       // the rehearsal running (REVIEW_SCENARIOS id)
    task: null,        // its task as it stands now
    percent: 60,
    receipt: '',       // what was last pressed on the card
    closed: false,     // the card's × was pressed in this rehearsal
    persona: 'real',
    dropping: false,
    collapsed: false,
    pos: null,         // where it was dragged to (this visit only)
    stopDrag: null,
    status: null,
    said: null,
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, run, title = '') {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = run;
    if (title) node.title = title;
    return node;
}

function pill(label, on, run) {
    const node = button(`anomalous-review-pill${on ? ' is-on' : ''}`, label, run);
    node.setAttribute('aria-pressed', String(on));
    return node;
}

function row(labelKey, ...parts) {
    const line = el('div', 'anomalous-review-row');
    line.append(el('span', 'anomalous-review-label', t(labelKey)), ...parts);
    return line;
}

const browserOpen = () => Boolean(document.getElementById('anomalous-modal')?.classList.contains('visible'));

/** Where the card is now: on the canvas, in its desktop window, or not shown. */
function cardView() {
    if (window.documentPictureInPicture?.window?.document.getElementById('anomalous-ai-float')) return { shown: true, desktop: true };
    return { shown: Boolean(document.getElementById('anomalous-ai-float')), desktop: false };
}

// ---------------------------------------------------------------- the card's rehearsal

function statusText() {
    if (!state.task) return t('reviewStatusIdle');
    const view = cardView();
    if (view.desktop) return t('reviewStatusDesktop');
    if (view.shown) return t('reviewStatusShown');
    if (browserOpen()) return t('reviewStatusBrowser');
    if (state.closed) return t('reviewStatusDismissed');
    return t(state.task.chat_only ? 'reviewStatusQuiet' : 'reviewStatusHidden');
}

/** The two lines that follow the rehearsal, without drawing the console again (a slider keeps its grip). */
function renderLive() {
    if (state.status) state.status.textContent = statusText();
    if (state.said) {
        state.said.textContent = state.receipt;
        state.said.hidden = !state.receipt;
    }
}

function show(task, resetDismissal) {
    if (setAiFloatPreview(task, { onAction: act, onDismiss: cardClosed, resetDismissal }).shown) state.closed = false;
}

function play(id) {
    exitWorkbenchRehearsal();
    if (browserOpen()) state.getBrowser()?.close?.(); // the canvas and its card in view
    Object.assign(state, { scene: id, percent: 60, receipt: '', closed: false });
    state.task = buildPreviewTask(id, { locale: resolveLocale(), percent: state.percent });
    show(state.task, true);
    render();
}

/** A press on the card, or a control here: the task moves on as the server would have it. */
function act(action) {
    if (!state.task) return;
    const { task, receiptKey, receiptParams } = applyPreviewAction(state.task, action, { locale: resolveLocale() });
    state.task = task;
    if (receiptKey) state.receipt = t(receiptKey, receiptParams);
    show(task, false);
    renderLive();
}

function cardClosed() {
    state.closed = true;
    state.receipt = t('reviewDid_close');
    renderLive();
}

function endRehearsal() {
    clearAiFloatPreview();
    Object.assign(state, { scene: null, task: null, receipt: '', closed: false });
}

function rehearsalSection() {
    const box = el('section', 'anomalous-review-section');
    box.append(el('div', 'anomalous-review-heading', t('reviewCardTitle')));
    for (const group of GROUPS) {
        box.append(row(`reviewGroup_${group}`, ...REVIEW_SCENARIOS.filter(scene => scene.group === group)
            .map(scene => pill(t(scene.labelKey), scene.id === state.scene, () => play(scene.id)))));
    }
    if (state.task && isAiFloatPreviewing()) {
        const controls = el('div', 'anomalous-review-controls');
        if (state.scene === 'run') {
            const value = el('span', 'anomalous-review-value', `${state.percent}%`);
            const slider = el('input', 'anomalous-review-slider');
            Object.assign(slider, { type: 'range', min: '0', max: '100', step: '1', value: String(state.percent) });
            slider.setAttribute('aria-label', t('reviewProgress'));
            slider.oninput = () => {
                state.percent = Number(slider.value);
                value.textContent = `${state.percent}%`;
                act({ type: 'progress', percent: state.percent });
            };
            controls.append(el('span', 'anomalous-review-label', t('reviewProgress')), slider, value);
        }
        controls.append(button('anomalous-review-action', t('reviewInjectGate'), () => act({ type: 'inject_gate' })),
            button('anomalous-review-action is-quiet', t('reviewClear'), () => { endRehearsal(); render(); }));
        box.append(controls);
    }
    state.status = el('div', 'anomalous-review-status');
    state.said = el('div', 'anomalous-review-receipt');
    state.said.setAttribute('role', 'status');
    box.append(state.status, state.said);
    renderLive();
    return box;
}

function workbenchSection() {
    const { active, scene, percent } = workbenchRehearsalState();
    const box = el('section', 'anomalous-review-section');
    const presets = el('div', 'anomalous-review-row');
    presets.append(...WORKBENCH_SCENES.map(({ id, labelKey }) => pill(t(labelKey), scene === id, () => {
        endRehearsal();
        enterWorkbenchRehearsal(id, { getBrowser: state.getBrowser, onChange: render });
    })));
    box.append(el('div', 'anomalous-review-heading', t('reviewWbTitle')), presets);
    if (active) {
        const controls = el('div', 'anomalous-review-controls');
        if (scene === 'run') {
            const value = el('span', 'anomalous-review-value', `${percent}%`);
            const slider = el('input', 'anomalous-review-slider');
            Object.assign(slider, { type: 'range', min: '0', max: '100', step: '1', value: String(percent) });
            slider.setAttribute('aria-label', t('reviewProgress'));
            slider.oninput = () => {
                value.textContent = `${slider.value}%`;
                setWorkbenchProgress(Number(slider.value));
            };
            controls.append(el('span', 'anomalous-review-label', t('reviewProgress')), slider, value);
        }
        controls.append(button('anomalous-review-action', t('reviewWbReset'), resetWorkbenchDemo),
            button('anomalous-review-action is-quiet', t('reviewClear'), () => { exitWorkbenchRehearsal(); render(); }));
        box.append(controls);
    }
    box.append(el('div', 'anomalous-review-note', t(active ? 'reviewWbNoteActive' : 'reviewWbNoteIdle')));
    return box;
}

// ---------------------------------------------------------------- look, user, shortcuts

function showRail(mode) {
    state.getBrowser()?.rail?.previewPins(mode === 'real' ? null : railPreset(mode));
    state.persona = mode;
}

/** The rail as another user has it, kept nowhere; AMB's window opens to show it. */
function persona(mode) {
    const browser = state.getBrowser();
    if (!browser?.rail) return;
    showRail(mode);
    if (!browserOpen()) browser.show();
    render();
}

function setDrop(on) {
    state.dropping = on;
    state.getBrowser()?.recipeView?.classList.toggle('is-dropping', on);
}

/** The Workflows page's drop veil, without a file dragged; pressed again, gone. */
async function toggleDrop() {
    const browser = state.getBrowser();
    if (!browser) return;
    if (state.dropping) {
        setDrop(false);
        return void render();
    }
    browser.show({ page: 'recipes' });
    for (let tries = 0; tries < 30 && !browser.recipeView; tries++) await new Promise(done => setTimeout(done, 100));
    setDrop(true);
    render();
}

/** Home's first-run card: as a new user meets it, as Civitai not answering leaves it, then gone; nothing kept. */
function cycleFirstRun() {
    const mode = firstRunPreviewMode();
    const next = mode ? FIRST_RUN_NEXT[mode] : 'idle';
    const browser = state.getBrowser();
    if (next && browser) previewFirstRun(browser, next, render);
    else clearFirstRunPreview();
    render();
}

/** First-visit page tips on Models and Gallery: cycles Models -> Gallery -> off; nothing kept. */
function cyclePageTips() {
    const mode = pageTipPreviewMode();
    const next = mode ? PAGE_TIP_NEXT[mode] : 'models';
    const browser = state.getBrowser();
    if (next && browser) previewPageTip(browser, next, render);
    else clearPageTipPreview();
    render();
}

function lookSection() {
    const box = el('section', 'anomalous-review-section');
    box.append(el('div', 'anomalous-review-heading', t('reviewLookTitle')),
        row('reviewTheme', ...THEMES.map(value => pill(t(`reviewTheme_${value}`), themePreference() === value, () => {
            setThemePreview(value);
            render();
        }))),
        row('reviewLanguage', ...LANGUAGES.map(([value, key]) => pill(t(key), resolveLocale() === value, () => setLanguagePreview(value)))),
        row('reviewRail', ...PERSONAS.map(mode => pill(t(`reviewPersona_${mode}`), state.persona === mode, () => persona(mode)))),
        el('div', 'anomalous-review-note', t('reviewLookNote')));
    return box;
}

function shortcutSection() {
    const owner = () => state.getBrowser();
    const go = {
        connect: () => openConnectGuide(),
        workflows: () => owner()?.show({ page: 'recipes' }),
        drop: () => void toggleDrop(),
        firstRun: cycleFirstRun,
        pageTips: cyclePageTips,
        share: () => openShareDialog(owner()),
        tour: () => {
            const browser = owner();
            browser?.show();
            setTimeout(() => startSpotlightTour(browser), 300); // once the window is laid out
        },
        version: () => openVersionPanel(owner()),
    };
    const firstRun = firstRunPreviewMode();
    const pageTips = pageTipPreviewMode();
    const on = { drop: state.dropping, firstRun: Boolean(firstRun), pageTips: Boolean(pageTips) };
    const line = el('div', 'anomalous-review-row');
    line.append(...Object.entries(go).map(([id, run]) => pill(t(`reviewGo_${id}`), Boolean(on[id]), run)));
    const box = el('section', 'anomalous-review-section');
    box.append(el('div', 'anomalous-review-heading', t('reviewGoTitle')), line);
    if (firstRun) box.append(el('div', 'anomalous-review-note', t(FIRST_RUN_NOTES[firstRun])));
    if (pageTips) box.append(el('div', 'anomalous-review-note', t(PAGE_TIP_NOTES[pageTips])));
    return box;
}

// ---------------------------------------------------------------- the blank sandbox

/** In: a new user's AMB and rail, the pretend library; out: everything as it was. */
async function toggleSandbox() {
    if (sandboxState().on) {
        if (state.persona === 'fresh') showRail('real');
        return exitSandbox();
    }
    if (await enterSandbox(state.getBrowser, render)) showRail('fresh');
    render();
}

function sandboxSection() {
    const sandbox = sandboxState();
    const box = el('section', 'anomalous-review-section');
    const line = el('div', 'anomalous-review-row');
    const toggle = pill(t(sandbox.leaving ? 'reviewSandboxLeaving' : sandbox.on ? 'reviewSandboxExit' : 'reviewSandboxEnter'), sandbox.on, () => void toggleSandbox());
    toggle.disabled = sandbox.leaving;
    line.append(toggle);
    if (sandbox.on) line.append(el('span', 'anomalous-review-sandbox-badge', t('reviewSandboxBadge')));
    box.append(el('div', 'anomalous-review-heading', t('reviewSandboxTitle')), line);
    markSandboxWindow();
    if (!sandbox.on) {
        box.append(el('div', 'anomalous-review-note', t('reviewSandboxNote')));
        return box;
    }
    const actions = el('div', 'anomalous-review-controls');
    actions.append(
        button('anomalous-review-action', t(sandbox.shared ? 'reviewSandboxWorkflowAgain' : 'reviewSandboxWorkflow'), () => void openSharedWorkflow()),
        button('anomalous-review-action is-quiet', t('reviewSandboxReset'), () => void resetSandboxProgress()),
    );
    box.append(
        row('reviewSandboxLibrary', ...LIBRARIES.map(mode => pill(t(`reviewSandboxLibrary_${mode}`), sandbox.library === mode, () => void setSandboxLibrary(mode)))),
        row('reviewSandboxNetwork', ...NETWORKS.map(mode => pill(t(`reviewSandboxNetwork_${mode}`), sandbox.network === mode, () => setSandboxNetwork(mode)))),
        actions,
    );
    return box;
}

// ---------------------------------------------------------------- the panel

/** Everything back as it was when the console opened: no rehearsal, no sandbox, the real rail, no veil, the real
 * first-run card, the theme and language. */
function resetAll(unloading = false) {
    endRehearsal();
    void exitSandbox();
    exitWorkbenchRehearsal({ unloading });
    clearFirstRunPreview();
    clearPageTipPreview();
    if (state.persona !== 'real') showRail('real');
    if (state.dropping) setDrop(false);
    setThemePreview(null);
    setLanguagePreview(null, !unloading);
}

/** Kept inside the window, a margin from its edges; none: the corner the CSS gives. */
function place(pos = state.pos) {
    state.pos = pos;
    const root = state.root;
    if (!root || !pos) return;
    const left = Math.max(MARGIN, Math.min(pos.left, window.innerWidth - root.offsetWidth - MARGIN));
    const top = Math.max(MARGIN, Math.min(pos.top, window.innerHeight - root.offsetHeight - MARGIN));
    Object.assign(root.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, right: 'auto', bottom: 'auto' });
}

function startDrag(event) {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    const head = event.currentTarget;
    const box = state.root.getBoundingClientRect();
    const grab = { x: event.clientX - box.left, y: event.clientY - box.top };
    try { head.setPointerCapture(event.pointerId); } catch { /* moved by the events it still gets */ }
    const move = next => place({ left: next.clientX - grab.x, top: next.clientY - grab.y });
    const stop = () => {
        for (const [name, run] of ends) head.removeEventListener(name, run);
        state.stopDrag = null;
    };
    const ends = [['pointermove', move], ['pointerup', stop], ['pointercancel', stop], ['lostpointercapture', stop]];
    for (const [name, run] of ends) head.addEventListener(name, run);
    state.stopDrag = stop;
}

function headView() {
    const head = el('div', 'anomalous-review-head');
    head.title = t('reviewDrag');
    head.addEventListener('pointerdown', startDrag);
    const tools = el('div', 'anomalous-review-tools');
    tools.append(button('anomalous-review-reset', t('reviewReset'), () => { resetAll(); render(); }, t('reviewResetHint')),
        button('anomalous-review-icon', state.collapsed ? '+' : '−', () => { state.collapsed = !state.collapsed; render(); },
            t(state.collapsed ? 'reviewExpand' : 'reviewCollapse')),
        button('anomalous-review-icon', '×', closeReviewConsole, t('reviewClose')));
    head.append(el('span', 'anomalous-review-badge', t('reviewBadge')), tools);
    return head;
}

function render() {
    const root = state.root;
    if (!root) return;
    root.setAttribute('aria-label', t('reviewTitle'));
    root.classList.toggle('is-collapsed', state.collapsed);
    state.stopDrag?.();
    const parts = [headView()];
    if (state.collapsed) {
        state.status = state.said = null;
    } else {
        const body = el('div', 'anomalous-review-body');
        body.append(rehearsalSection(), workbenchSection(), lookSection(), shortcutSection(), sandboxSection());
        parts.push(body);
    }
    root.replaceChildren(...parts);
    place();
}

/** The language changed (here or anywhere): the console and the rehearsal's own words follow. */
function onLanguage() {
    if (state.scene) {
        state.task = buildPreviewTask(state.scene, { locale: resolveLocale(), percent: state.percent });
        state.receipt = '';
        show(state.task, true);
    }
    refreshWorkbenchLocale(resolveLocale());
    render();
}

const onResize = () => place();
const onPageHide = () => resetAll(true);

/** Opens the console (or brings it back unfolded); `getBrowser()` gives AMB's window when a section needs it. */
export function openReviewConsole(getBrowser) {
    if (getBrowser) state.getBrowser = getBrowser;
    if (state.root) {
        state.collapsed = false;
        return void render();
    }
    const root = el('div', 'anomalous-review-console');
    root.id = 'anomalous-review-console'; // an anomalous- id: keys typed here stay ours (ui_key_guard.js)
    root.setAttribute('role', 'region');
    root.addEventListener('keydown', (event) => {
        if (event.target.matches?.('input, textarea, select')) event.stopPropagation(); // not ComfyUI's shortcuts
    });
    root.addEventListener('pointerenter', renderLive); // the card may have moved meanwhile (AMB's window, the desktop)
    document.body.append(root);
    state.root = root;
    window.addEventListener('anomalous-language-change', onLanguage);
    window.addEventListener('resize', onResize);
    window.addEventListener('pagehide', onPageHide); // a reload with a switched theme or language keeps neither
    render();
}

/** Closes the console; everything it showed ends and the theme and language go back (resetAll). */
export function closeReviewConsole() {
    if (!state.root) return;
    resetAll();
    state.stopDrag?.();
    state.root.remove();
    Object.assign(state, { root: null, status: null, said: null, collapsed: false });
    window.removeEventListener('anomalous-language-change', onLanguage);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', onPageHide);
}

export function toggleReviewConsole(getBrowser) {
    if (state.root) closeReviewConsole();
    else openReviewConsole(getBrowser);
}
