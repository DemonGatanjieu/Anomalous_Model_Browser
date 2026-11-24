/**
 * The home page: first the four everyday tasks, large, each with its picture and line, the same four as the
 * rail's own pages (models, with "+ Import models" beside it and dropped model files imported; Model check;
 * the gallery; workflows); then "Let the AI do it", folded until opened (ui_ai_starters.js); then "More tools"
 * (canvas saves, combos, prompts, "Run my preset", optional voices), folded by default and remembered in
 * this browser; finally one quiet footer line (first-time scan, tour, what's new, feedback, star).
 * The first-run welcome card floats over the window when wanted (ui_first_run.js). Rendered again on
 * each visit so text follows the language.
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
import { icon } from './ui_ai_icons.js';

const MORE_OPEN_KEY = 'anomalous_home_more_open';

// One card per task: where it goes and its text (`homeCard<Name>Title` / `…Body`). The everyday four come
// first, large with their pictures; the rest fold cleanly under "More tools", Voices shown only when
// Anomalous_TTS is installed or Voices is pinned (ui_shell_rail.js).
const MAIN_CARDS = Object.freeze([
    { name: 'Models', icon: PAGE_ICONS.models, open: owner => owner.goTo('models') },
    { name: 'Doctor', icon: TOOL_ICONS.DOCTOR, open: owner => owner.openDoctorPage() },
    { name: 'Gallery', icon: PAGE_ICONS.gallery, open: owner => owner.goTo('gallery') },
    { name: 'Recipes', icon: PAGE_ICONS.recipes, open: owner => owner.goTo('recipes') },
]);
const MORE_CARDS = Object.freeze([
    { name: 'Saves', icon: PAGE_ICONS.saves, open: owner => void savesFromHome(owner) },
    { name: 'Combos', icon: PAGE_ICONS.combos, open: owner => owner.goTo('combos') },
    { name: 'Prompts', icon: PAGE_ICONS.prompts, open: owner => owner.goTo('prompts') },
    { name: 'Preset', icon: PAGE_ICONS.presets, open: owner => void openPresetSheet(owner) },
    { name: 'Voices', icon: PAGE_ICONS.script, open: owner => owner.goTo('script') },
]);
// The large cards' pictures (web/assets, 200 px flat spot illustrations), preloaded as the window opens.
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

function readMoreOpen() {
    try {
        return localStorage.getItem(MORE_OPEN_KEY) === '1';
    } catch {
        return false;
    }
}

function writeMoreOpen(open) {
    try {
        localStorage.setItem(MORE_OPEN_KEY, open ? '1' : '0');
    } catch { /* this visit only */ }
}

function cardIcon(card) {
    const box = el('span', 'anomalous-home-card-icon');
    box.innerHTML = card.icon; // static markup only
    return box;
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

/** Secondary tools bar ("More tools"): folded by default so Home stays calm; state kept in browser. */
function moreToolsSection(owner) {
    const visible = MORE_CARDS.filter(card => card.name !== 'Voices' || owner.rail.voicesShown());
    const section = el('section', 'anomalous-home-more');
    const head = el('div', 'anomalous-home-more-head');
    const title = el('h2', 'anomalous-home-more-title');
    title.id = 'anomalous-home-more-title';
    const mark = el('span', 'anomalous-home-more-mark');
    mark.innerHTML = PAGE_ICONS.more; // static markup only
    mark.setAttribute('aria-hidden', 'true');
    const summary = el('span', 'anomalous-home-more-summary', visible.map(card => t(`homeMoreItem${card.name}`)).join(' · '));
    title.append(mark, el('span', '', t('homeMoreTitle')), summary);

    const cards = el('div', 'anomalous-home-cards');
    cards.id = 'anomalous-home-more-cards';
    cards.append(...visible.map(card => smallCard(owner, card)));

    const show = (open) => {
        cards.hidden = !open;
        section.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.replaceChildren(el('span', '', t(open ? 'aiStartHide' : 'aiStartShow')), icon('chevronDown', 14));
    };
    const toggle = button('anomalous-home-more-toggle', '', () => {
        show(cards.hidden);
        writeMoreOpen(!cards.hidden);
    });
    toggle.setAttribute('aria-controls', cards.id);
    toggle.setAttribute('aria-describedby', title.id);
    show(readMoreOpen());

    head.append(title, toggle);
    section.append(head, cards);
    return section;
}

/** Quiet single-line footer: onboarding links, bug/idea feedback, diagnostics and GitHub Star. */
function homeFooter(owner) {
    const footer = el('footer', 'anomalous-home-footer');
    const copyBtn = button('anomalous-home-footer-link', t('feedbackCopy'), async () => {
        copyBtn.textContent = t(await copyDiagnostics(owner) ? 'feedbackCopied' : 'feedbackCopyFailed');
        setTimeout(() => { if (copyBtn.isConnected) copyBtn.textContent = t('feedbackCopy'); }, 1600);
    });
    copyBtn.title = t('feedbackCopyHint');
    const starBtn = button('anomalous-home-footer-link', t('starButton'), openRepoPage);
    starBtn.title = t('starHint');

    const items = [
        button('anomalous-home-footer-link', t('homeFooterFirstRun'), () => void showFirstRun(owner)),
        button('anomalous-home-footer-link', t('homeStartTour'), () => startSpotlightTour(owner)),
        button('anomalous-home-footer-link', t('homeStartNews'), () => showUpdateGuide(owner, { force: true })),
        button('anomalous-home-footer-link', t('feedbackReport'), () => openFeedbackDialog(owner, 'bug')),
        button('anomalous-home-footer-link', t('feedbackSuggest'), () => openFeedbackDialog(owner, 'idea')),
        copyBtn,
        starBtn,
    ];
    items.forEach((node, index) => {
        if (index > 0) {
            const dot = el('span', 'anomalous-home-footer-sep', '·');
            dot.setAttribute('aria-hidden', 'true');
            footer.append(dot);
        }
        footer.append(node);
    });
    return footer;
}

export function renderHome(owner, panel) {
    const page = el('div', 'anomalous-home');
    page.append(el('h1', 'anomalous-home-title', t('homeTitle')), el('p', 'anomalous-home-lead', t('homeLead')));

    const mains = el('div', 'anomalous-home-mains');
    mains.append(...MAIN_CARDS.map(card => mainCard(owner, card)));
    // "Let the AI do it" sits right below the primary cards; "More tools" folds under it.
    const slot = el('div', 'anomalous-home-ai-slot');
    const moreSection = moreToolsSection(owner);

    page.append(mains, slot, moreSection, homeFooter(owner));
    panel.replaceChildren(page);
    void renderFirstRun(owner);
    renderAiStarters(owner, slot, moreSection);
    renderRecentActivity(owner, page);
    renderRecentAiTasks(owner, page);
}
