/** The review console owns the session; AMB's normal AI page owns all its rendering. */
import { resolveLocale } from './locales.js';
import { clearTaskCache } from './ai_task_cache.js';
import { dropPreviewFloatTask } from './ui_ai_float.js';
import { dropPreviewPanelDrafts } from './ui_ai_panel.js';
import { setAiTourSuppressed } from './ui_ai_tour.js';
import { setTaskListRehearsal } from './ui_ai_task_list.js';
import { holdRehearsalDialogs } from './ui_dialog.js';
import { createViewScope } from './ui_lifecycle.js';
import { holdWorkbenchStorage } from './review_sandbox.js';
import { jsonResponse, ownAnomalousUrl, registerReviewFetch, unregisterReviewFetch } from './review_fetch.js';
import {
    answerWorkbenchRequest, createWorkbenchStore, handlesWorkbenchRequest, setWorkbenchLocale,
    setWorkbenchRunPercent, setWorkbenchScene, workbenchTaskIdForScene,
} from './review_workbench_data.js';

const DEFAULT_PERCENT = 60;
let session = null;
let stageFrame = null;
let progressFrame = null;

export const workbenchRehearsalState = () => ({
    active: Boolean(session), scene: session?.store.scene ?? null, percent: session?.store.percent ?? DEFAULT_PERCENT,
});

async function readBody(request, init) {
    try {
        if (typeof init?.body === 'string') return JSON.parse(init.body);
        if (init?.body == null && request) return await request.clone().json();
    } catch { /* a request without JSON carries no rehearsal fields */ }
    return null;
}

function handleFetch(input, init) {
    const url = ownAnomalousUrl(input);
    const request = input instanceof Request ? input : null;
    const method = (init?.method || request?.method || 'GET').toUpperCase();
    if (!url || !handlesWorkbenchRequest(url.pathname)) return null;
    const store = session.store; // a slow Request body must never write into a newer session
    const signal = init?.signal || request?.signal;
    const answer = (body) => {
        signal?.throwIfAborted();
        const response = answerWorkbenchRequest(store, { method, path: url.pathname, query: url.searchParams, body });
        return jsonResponse(response.body, response.status);
    };
    return method === 'GET' ? answer(null) : readBody(request, init).then(answer);
}

const onAiPage = browser => browser?.modal?.classList.contains('visible') && browser.currentShellPage?.() === 'ai';

function renewDialogScope() {
    session.dialogs?.dispose();
    session.dialogs = createViewScope();
    const { getBrowser } = session;
    holdRehearsalDialogs(session.dialogs, () => getBrowser?.()?.currentShellPage?.() === 'ai');
}

function openStage(browser, tries = 24) {
    cancelAnimationFrame(stageFrame);
    stageFrame = requestAnimationFrame(() => {
        stageFrame = null;
        if (session?.store.scene !== 'stage' || !onAiPage(browser)) return;
        const page = browser.aiPanel.querySelector('.anomalous-ai');
        if (page?.classList.contains('has-stage')) return;
        const open = page?.querySelector('.anomalous-ai-panel-line[data-panel-id="blueprint-panel"] .anomalous-ai-side-open');
        if (open) open.click();
        else if (tries > 0) openStage(browser, tries - 1);
    });
}

function reopen(browser) {
    if (!browser) return;
    browser.openAiTask(workbenchTaskIdForScene(session.store.scene));
    if (session.store.scene === 'stage') openStage(browser);
}

export function enterWorkbenchRehearsal(scene, { getBrowser, onChange, percent } = {}) {
    if (session) {
        if (scene === 'welcome') dropPreviewPanelDrafts();
        setWorkbenchScene(session.store, scene);
        if (percent !== undefined) setWorkbenchRunPercent(session.store, percent);
    } else {
        session = { store: createWorkbenchStore({ scene, locale: resolveLocale(), percent }), getBrowser, onChange };
        holdWorkbenchStorage(true);
        setTaskListRehearsal(true);
        setAiTourSuppressed(true);
        registerReviewFetch('workbench', 10, handleFetch);
    }
    renewDialogScope();
    clearTaskCache();
    reopen(session.getBrowser?.());
    session.onChange?.();
}

export function setWorkbenchProgress(percent) {
    if (session?.store.scene !== 'run') return;
    setWorkbenchRunPercent(session.store, percent);
    if (progressFrame !== null) return;
    progressFrame = requestAnimationFrame(() => {
        progressFrame = null;
        const browser = session?.getBrowser?.();
        if (session?.store.scene !== 'run' || !onAiPage(browser)) return;
        clearTaskCache();
        browser.show({ page: 'ai' });
    });
}

export function resetWorkbenchDemo() {
    if (!session) return;
    session.store = createWorkbenchStore({ scene: session.store.scene, locale: resolveLocale(), percent: DEFAULT_PERCENT });
    renewDialogScope();
    dropPreviewPanelDrafts();
    clearTaskCache();
    dropPreviewFloatTask();
    reopen(session.getBrowser?.());
    session.onChange?.();
}

export function refreshWorkbenchLocale(locale) {
    if (!session) return;
    setWorkbenchLocale(session.store, locale);
    clearTaskCache();
    const browser = session.getBrowser?.();
    if (onAiPage(browser)) reopen(browser);
}

export function exitWorkbenchRehearsal({ unloading = false } = {}) {
    if (!session) return;
    const { getBrowser, dialogs } = session;
    dialogs.dispose();
    session = null;
    cancelAnimationFrame(stageFrame);
    cancelAnimationFrame(progressFrame);
    stageFrame = progressFrame = null;
    unregisterReviewFetch('workbench');
    setAiTourSuppressed(false);
    clearTaskCache();
    dropPreviewPanelDrafts();
    try {
        setTaskListRehearsal(false);
        dropPreviewFloatTask();
        const browser = getBrowser?.();
        if (!unloading && browser?.currentShellPage?.() === 'ai') {
            const shown = onAiPage(browser);
            browser.openAiTask(null);
            if (!shown) browser.close();
        }
    } finally {
        holdWorkbenchStorage(false);
    }
}
