/**
 * The home page: first the four everyday tasks, large, each with its picture and line (finding a model, with
 * "+ Import models" beside it; model files dropped anywhere on Home are imported too, ui_sidebar.js),
 * the first-run setup above them while nothing is scanned (ui_first_run.js); then the other tools, one
 * small card each (its icon and name; what it does on hover; "Run my preset" opens its sheet,
 * ui_ai_starter_sheet.js, and the last run's "same again" line comes under these cards); then "Let the
 * AI do it", folded until opened (ui_ai_starters.js, drawn into a slot); then the first steps (set up,
 * scan, the tour, what's new). Each card opens its page (the saves card starts the canvas's saves,
 * ui_snapshot_bar.js). Rendered again on each visit, so text follows the language.
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
import { openPresetSheet } from './ui_ai_starter_sheet.js';
import { pickModelFiles } from './ui_model_import.js';
import { savesFromHome } from './ui_snapshot_bar.js';
import { fadeIn } from './ui_ai_art.js';

// One card per task: where it goes and its text (`homeCard<Name>Title` / `…Body`). The everyday four come
// first, large with their line; the rest small, the optional voices last, and only once the rail knows
// Anomalous_TTS is installed or Voices is pinned (shown late rather than gone again: ui_shell_rail.js).
const MAIN_CARDS = Object.freeze([
    { name: 'Models', icon: PAGE_ICONS.models, open: owner => owner.goTo('models') },
    { name: 'Doctor', icon: TOOL_ICONS.DOCTOR, open: owner => owner.openDoctorPage() },
    { name: 'Gallery', icon: PAGE_ICONS.gallery, open: owner => owner.goTo('gallery') },
    { name: 'Saves', icon: PAGE_ICONS.saves, open: owner => void savesFromHome(owner) },
]);
const MORE_CARDS = Object.freeze([
    { name: 'Recipes', icon: PAGE_ICONS.recipes, open: owner => owner.goTo('recipes') },
    { name: 'Preset', icon: PAGE_ICONS.presets, open: owner => void openPresetSheet(owner) },
    { name: 'Combos', icon: PAGE_ICONS.combos, open: owner => owner.goTo('combos') },
    { name: 'Prompts', icon: PAGE_ICONS.prompts, open: owner => owner.goTo('prompts') },
    { name: 'Voices', icon: PAGE_ICONS.script, open: owner => owner.goTo('script') },
]);
// The large cards' pictures (web/assets, drawn with ChatGPT like the AI cards), asked for as the window opens.
export const HOME_ART = MAIN_CARDS.map(card => `home_${card.name.toLowerCase()}`);

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

function cardIcon(card) {
    const icon = el('span', 'anomalous-home-card-icon');
    icon.innerHTML = card.icon; // static markup only
    return icon;
}

/** A large card's picture; its line icon if the picture is missing. */
function cardArt(card) {
    const img = el('img', 'anomalous-home-main-art');
    img.alt = '';
    img.decoding = 'async';
    img.onerror = () => img.replaceWith(cardIcon(card));
    img.src = new URL(`../assets/home_${card.name.toLowerCase()}.webp`, import.meta.url).href;
    return fadeIn(img);
}

/** A large card: the whole card opens its page (the button's ::after covers it); "+ Import models" sits above that. */
function mainCard(owner, card) {
    const node = el('div', 'anomalous-home-main');
    node.dataset.card = card.name.toLowerCase();
    node.append(cardArt(card), button('anomalous-home-main-open', t(`homeCard${card.name}Title`), () => card.open(owner)),
        el('p', 'anomalous-home-main-body', t(`homeCard${card.name}Body`)));
    if (card.name === 'Models') {
        const importer = button('anomalous-home-main-import', t('homeImportModels'), () => pickModelFiles(owner));
        importer.title = t('importChipTitle');
        node.append(importer);
    }
    return node;
}

function smallCard(owner, card) {
    const node = button('anomalous-home-card', '', () => card.open(owner));
    node.dataset.card = card.name.toLowerCase();
    node.title = t(`homeCard${card.name}Body`);
    node.append(cardIcon(card), el('span', 'anomalous-home-card-title', t(`homeCard${card.name}Title`)));
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

    const mains = el('div', 'anomalous-home-mains');
    mains.append(...MAIN_CARDS.map(card => mainCard(owner, card)));
    const more = el('div', 'anomalous-home-cards');
    more.append(...MORE_CARDS.filter(card => card.name !== 'Voices' || owner.rail.voicesShown()).map(card => smallCard(owner, card)));
    // The AI section comes back later; the slot keeps its place under the smaller cards.
    const slot = el('div', 'anomalous-home-ai-slot');

    const start = el('div', 'anomalous-home-start');
    start.append(el('span', 'anomalous-home-start-label', t('homeStartLabel')),
        button('anomalous-home-link', t('homeStartSetup'), () => void showFirstRun(owner, page, mains)),
        button('anomalous-home-link', t('homeStartScan'), () => owner.openScanPage()),
        button('anomalous-home-link', t('homeStartTour'), () => startSpotlightTour(owner)),
        button('anomalous-home-link', t('homeStartNews'), () => showUpdateGuide(owner, { force: true })));

    page.append(mains, more, slot, start, feedbackBand(owner));
    panel.replaceChildren(page);
    void renderFirstRun(owner, page, mains);
    renderAiStarters(owner, slot, more);
    renderRecentActivity(owner, page);
    renderRecentAiTasks(owner, page);
}
