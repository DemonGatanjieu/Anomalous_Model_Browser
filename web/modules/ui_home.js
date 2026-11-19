/**
 * The home page: first what to hand the AI (ui_ai_starters.js, drawn into a slot once read), the
 * first-run setup above it while nothing is scanned (ui_first_run.js); under it "Do it yourself", one
 * small card per task (its icon and name; what it does on hover), each opening its page (the saves card
 * starts the canvas's saves, ui_snapshot_bar.js); then the first steps (set up, scan, the tour, what's new).
 * Rendered again on each visit, so text follows the language.
 */

import { translate as t } from './locales.js';
import { PAGE_ICONS } from './ui_shell_rail.js';
import { TOOL_ICONS } from './tool_registry.js';
import { startSpotlightTour } from './ui_spotlight_tour.js';
import { showUpdateGuide } from './ui_update_guide.js';
import { renderRecentActivity } from './ui_activity.js';
import { renderRecentAiTasks } from './ui_ai_workbench.js';
import { copyDiagnostics, openRepoPage } from './feedback.js';
import { openFeedbackDialog } from './ui_feedback_dialog.js';
import { renderFirstRun, showFirstRun } from './ui_first_run.js';
import { renderAiStarters } from './ui_ai_starters.js';
import { savesFromHome } from './ui_snapshot_bar.js';

// One card per task: where it goes and its text (`homeCard<Name>Title` / `…Body`).
const CARDS = Object.freeze([
    { name: 'Models', icon: PAGE_ICONS.models, open: owner => owner.goTo('models') },
    { name: 'Doctor', icon: TOOL_ICONS.DOCTOR, open: owner => owner.openDoctorPage() },
    { name: 'Voices', icon: PAGE_ICONS.script, open: owner => owner.goTo('script') },
    { name: 'Gallery', icon: PAGE_ICONS.gallery, open: owner => owner.goTo('gallery') },
    { name: 'Recipes', icon: PAGE_ICONS.recipes, open: owner => owner.goTo('recipes') },
    { name: 'Combos', icon: PAGE_ICONS.combos, open: owner => owner.goTo('combos') },
    { name: 'Prompts', icon: PAGE_ICONS.prompts, open: owner => owner.goTo('prompts') },
    { name: 'Saves', icon: PAGE_ICONS.saves, open: owner => void savesFromHome(owner) },
]);

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

/** "Found a problem, or have an idea?": a report or a suggestion on GitHub, or the environment to paste elsewhere. */
function feedbackBand(owner) {
    const band = el('section', 'anomalous-home-feedback');
    const copy = el('div', 'anomalous-home-feedback-copy');
    copy.append(el('span', 'anomalous-home-feedback-title', t('feedbackTitle')), el('span', 'anomalous-home-feedback-lead', t('feedbackLead')));
    const actions = el('div', 'anomalous-home-feedback-actions');
    const copyBtn = button('anomalous-home-feedback-btn', t('feedbackCopy'), async () => {
        copyBtn.textContent = t(await copyDiagnostics(owner) ? 'feedbackCopied' : 'feedbackCopyFailed');
        setTimeout(() => { copyBtn.textContent = t('feedbackCopy'); }, 1600);
    });
    copyBtn.title = t('feedbackCopyHint');
    actions.append(
        button('anomalous-home-feedback-btn is-primary', t('feedbackReport'), () => openFeedbackDialog(owner, 'bug')),
        button('anomalous-home-feedback-btn', t('feedbackSuggest'), () => openFeedbackDialog(owner, 'idea')),
        copyBtn,
    );
    const star = button('anomalous-home-feedback-btn', t('starButton'), openRepoPage);
    star.title = t('starHint');
    actions.append(star);
    band.append(copy, actions);
    return band;
}

export function renderHome(owner, panel) {
    const page = el('div', 'anomalous-home');
    page.append(el('h1', 'anomalous-home-title', t('homeTitle')), el('p', 'anomalous-home-lead', t('homeLead')));

    // The AI section comes back later; the slot keeps its place (and the first-run card's) above the cards.
    const slot = el('div', 'anomalous-home-ai-slot');
    const self = el('h2', 'anomalous-home-section-title', t('homeSelfTitle'));
    const grid = el('div', 'anomalous-home-cards');
    for (const card of CARDS) {
        const node = button('anomalous-home-card', '', () => card.open(owner));
        node.dataset.card = card.name.toLowerCase();
        const icon = el('span', 'anomalous-home-card-icon');
        icon.innerHTML = card.icon; // static markup only
        node.title = t(`homeCard${card.name}Body`);
        node.append(icon, el('span', 'anomalous-home-card-title', t(`homeCard${card.name}Title`)));
        grid.appendChild(node);
    }

    const start = el('div', 'anomalous-home-start');
    start.append(el('span', 'anomalous-home-start-label', t('homeStartLabel')),
        button('anomalous-home-link', t('homeStartSetup'), () => void showFirstRun(owner, page, slot)),
        button('anomalous-home-link', t('homeStartScan'), () => owner.openScanPage()),
        button('anomalous-home-link', t('homeStartTour'), () => startSpotlightTour(owner)),
        button('anomalous-home-link', t('homeStartNews'), () => showUpdateGuide(owner, { force: true })));

    page.append(slot, self, grid, start, feedbackBand(owner));
    panel.replaceChildren(page);
    void renderFirstRun(owner, page, slot);
    renderAiStarters(owner, slot);
    renderRecentActivity(owner, page);
    renderRecentAiTasks(owner, page);
}
