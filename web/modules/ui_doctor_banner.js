/**
 * The bar over the canvas when the open workflow uses models this computer does not have:
 * how many, how many are here under another name or folder (put in with one press), and
 * a way to Model Doctor's page for the rest. Each opened workflow is checked
 * (model_check.js, without reloading ComfyUI's model lists); the doctor page updates the
 * bar after its own checks. Closing it hides it for that workflow until the page reloads.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { checkWorkflowModels, fixWorkflowModels, isProblem } from './model_check.js';

const HIDE_AFTER_FIX_MS = 6000;
const closed = new Set();
let bar = null;
let checkRun = 0;
let hideTimer = 0;

const workflowKey = () => {
    const workflow = app.extensionManager?.workflow?.activeWorkflow;
    return String(workflow?.key || workflow?.path || workflow?.filename || '');
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

function hide() {
    clearTimeout(hideTimer);
    bar?.remove();
    bar = null;
}

/** Shows, updates or hides the bar for the entries of a check; `putIn` = just put in that many. */
export function updateDoctorBanner(owner, entries, putIn = 0) {
    const key = workflowKey();
    const problems = entries.filter(isProblem);
    const fixable = problems.filter(entry => entry.state === 'fixable');
    if (closed.has(key) || (!problems.length && !putIn)) {
        hide();
        return;
    }
    clearTimeout(hideTimer);
    bar = bar || el('div', 'anomalous-doctor-banner');
    bar.setAttribute('role', 'status');
    const lines = [];
    if (putIn) lines.push(t('doctorBannerPutIn', { count: putIn }));
    if (problems.length) lines.push(t(putIn ? 'doctorBannerStill' : 'doctorBannerMissing', { count: problems.length }));
    if (fixable.length) lines.push(t('doctorBannerFixable', { count: fixable.length }));
    const copy = el('span', 'anomalous-doctor-banner-text', lines.join(' '));
    const actions = el('span', 'anomalous-doctor-banner-actions');
    if (fixable.length) {
        actions.append(button('anomalous-doctor-banner-btn is-main', t('doctorPutInAll', { count: fixable.length }), async () => {
            const count = fixWorkflowModels(fixable);
            updateDoctorBanner(owner, await checkWorkflowModels(), count);
        }));
    }
    if (problems.length) {
        actions.append(button('anomalous-doctor-banner-btn', t('doctorBannerShow'), () => {
            owner.show();
            owner.openDoctorPage();
        }));
    }
    const close = button('anomalous-doctor-banner-close', '✕', () => {
        closed.add(key);
        hide();
    });
    close.setAttribute('aria-label', t('doctorBannerClose'));
    bar.replaceChildren(el('span', 'anomalous-doctor-banner-icon', '🩺'), copy, actions, close);
    if (!bar.isConnected) document.body.append(bar);
    if (!problems.length) hideTimer = setTimeout(hide, HIDE_AFTER_FIX_MS);
}

async function checkOpenWorkflow(owner) {
    const run = ++checkRun;
    const entries = await checkWorkflowModels();
    if (run === checkRun) updateDoctorBanner(owner, entries);
}

/** Checks every workflow ComfyUI opens (the one restored at startup too). */
export function watchWorkflowLoads(owner) {
    const load = app.loadGraphData;
    if (typeof load !== 'function') return;
    app.loadGraphData = async function (...args) {
        hide();
        const result = await load.apply(this, args);
        checkOpenWorkflow(owner).catch(error => console.warn('[AMB] Doctor: checking the opened workflow failed.', error));
        return result;
    };
}
