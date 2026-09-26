import { t } from './interface_settings.js';

/**
 * The fixed screens of the GPT-SoVITS import window (ui_tts_import.js): the first
 * question (what do you have?), the drop area of batch mode, the "add more" menu,
 * and the spotlight tour steps that explain them. Only markup and callbacks; the
 * window owns all state.
 */

const UPLOAD_SVG = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>';
const MODE_SVG = {
    single: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/></svg>',
    batch: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="10" cy="13" r="1.5"/><circle cx="15" cy="13" r="1.5"/></svg>',
    add: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="4"/><path d="M3 21v-1a7 7 0 0 1 11-5.7"/><path d="M18 14v6M15 17h6"/></svg>',
};

/** Steps of the two tours: which element each explains, and its text. */
export const TOURS = {
    choose: [
        { targetSelector: '.anomalous-tts-mode[data-mode="single"]', icon: '👤', titleKey: 'ttsTourSingleTitle', bodyKey: 'ttsTourSingleBody', position: 'bottom' },
        { targetSelector: '.anomalous-tts-mode[data-mode="batch"]', icon: '📦', titleKey: 'ttsTourBatchTitle', bodyKey: 'ttsTourBatchBody', position: 'bottom' },
        { targetSelector: '.anomalous-tts-mode[data-mode="add"]', icon: '➕', titleKey: 'ttsTourAddTitle', bodyKey: 'ttsTourAddBody', position: 'bottom' },
        { targetSelector: '.anomalous-tts-help', icon: '❔', titleKey: 'ttsTourHelpTitle', bodyKey: 'ttsTourHelpBody', position: 'bottom' },
    ],
    card: [
        { targetSelector: '.anomalous-tts-card.is-open .anomalous-tts-check', icon: '📋', titleKey: 'ttsTourChecklistTitle', bodyKey: 'ttsTourChecklistBody', position: 'bottom' },
        { targetSelector: '.anomalous-tts-card.is-open .anomalous-tts-check-item.is-next', icon: '👉', titleKey: 'ttsTourNextTitle', bodyKey: 'ttsTourNextBody', position: 'bottom' },
        { targetSelector: '.anomalous-tts-card.is-open .anomalous-tts-card-head', icon: '🏷️', titleKey: 'ttsTourHeadTitle', bodyKey: 'ttsTourHeadBody', position: 'bottom' },
        { targetSelector: '.anomalous-tts-import .anomalous-tts-footer .anomalous-voice-modal-submit', icon: '✅', titleKey: 'ttsTourImportTitle', bodyKey: 'ttsTourImportBody', position: 'top' },
    ],
};

const TOURS_KEY = 'anomalous_tts_import_tours';

/** Tours already shown on this browser (each runs once by itself; "?" replays it). */
export function seenTours() {
    try {
        const ids = JSON.parse(localStorage.getItem(TOURS_KEY) || '[]');
        return new Set(Array.isArray(ids) ? ids : []);
    } catch (_) { return new Set(); }
}

export function markTourSeen(id) {
    try { localStorage.setItem(TOURS_KEY, JSON.stringify([...seenTours().add(id)])); } catch (_) { /* convenience only */ }
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const btn = el('button', className, label);
    btn.type = 'button';
    btn.onclick = onClick;
    return btn;
}

/**
 * "What do you have?": one character, many characters or a package, or files for a
 * character already there (then pick which one). `on`: `{ single(), batch(), character(name) }`.
 */
export function renderChooseScreen(existing, on) {
    const choose = el('div', 'anomalous-tts-choose');
    const modeCard = (id, onClick, disabled = false) => {
        const card = button('anomalous-tts-mode', '', onClick);
        card.dataset.mode = id;
        card.disabled = disabled;
        const icon = el('span', 'anomalous-tts-mode-icon');
        icon.innerHTML = MODE_SVG[id]; // static markup only
        const words = el('span', 'anomalous-tts-mode-words');
        words.append(el('span', 'anomalous-tts-mode-title', t(`ttsMode_${id}`)), el('span', 'anomalous-tts-mode-desc', t(`ttsMode_${id}_desc`)));
        card.append(icon, words, el('span', 'anomalous-tts-mode-go', '›'));
        return card;
    };
    const pickCharacter = el('div', 'anomalous-tts-pick-character');
    pickCharacter.hidden = true;
    const pickList = el('div', 'anomalous-tts-pick-character-list');
    for (const name of existing) pickList.append(button('anomalous-tts-pick-character-item', name, () => on.character(name)));
    pickCharacter.append(el('div', 'anomalous-tts-pick-character-title', t('ttsModePickCharacter')), pickList);
    choose.append(el('div', 'anomalous-tts-choose-title', t('ttsChooseTitle')),
        modeCard('single', on.single),
        modeCard('batch', on.batch),
        modeCard('add', () => { pickCharacter.hidden = !pickCharacter.hidden; }, !existing.length),
        pickCharacter);
    return choose;
}

/** Batch mode before any file: what to bring, and where from. `on`: `{ folder, files, localFolder, localFiles, back }`. */
export function renderBatchHero(on) {
    const hero = el('div', 'anomalous-tts-hero');
    const heroIcon = el('div', 'anomalous-tts-hero-icon');
    heroIcon.innerHTML = UPLOAD_SVG; // static markup only
    const needs = el('div', 'anomalous-tts-hero-needs');
    for (const [key, ext] of [['ttsCardGpt', '.ckpt'], ['ttsCardSovits', '.pth'], ['ttsHeroClips', t('ttsHeroClipsLength')]]) {
        const chip = el('span', 'anomalous-tts-hero-need');
        chip.append(el('b', '', t(key)), el('span', '', ext));
        needs.append(chip);
    }
    const buttons = el('div', 'anomalous-tts-hero-buttons');
    buttons.append(button('anomalous-voice-modal-submit', t('ttsBatchPickFolder'), on.folder),
        button('anomalous-tts-ghost is-large', t('ttsImportPickFiles'), on.files));
    const local = el('div', 'anomalous-tts-hero-local');
    local.append(el('span', '', t('ttsHeroLocal')), button('anomalous-tts-link', t('ttsHeroLocalFolder'), on.localFolder),
        el('span', 'anomalous-tts-hero-dot', '·'), button('anomalous-tts-link', t('ttsHeroLocalFiles'), on.localFiles));
    hero.append(heroIcon, el('div', 'anomalous-tts-hero-title', t('ttsHeroTitle')), needs,
        el('div', 'anomalous-tts-hero-desc', t('ttsHeroDesc')), buttons, local, button('anomalous-tts-link', t('ttsChooseAgain'), on.back));
    return hero;
}

/**
 * "Add more": one button with a small menu, so the list stays the main thing.
 * `on`: `{ files, folder, localFiles, localFolder }`. Returns `{ root, menu }`; the
 * window closes the menu on an outside click or Escape (`menu` loses `is-open`).
 */
export function renderAddMenu(on) {
    const menu = el('div', 'anomalous-tts-menu');
    const item = (label, hint, onClick) => {
        const node = button('anomalous-tts-menu-item', '', () => { menu.classList.remove('is-open'); onClick(); });
        node.append(el('span', 'anomalous-tts-menu-label', label), el('span', 'anomalous-tts-menu-hint', hint));
        return node;
    };
    menu.append(item(t('ttsImportPickFiles'), t('ttsMenuUploadHint'), on.files),
        item(t('ttsBatchPickFolder'), t('ttsMenuUploadHint'), on.folder),
        item(t('ttsMenuLocalFiles'), t('ttsMenuLocalHint'), on.localFiles),
        item(t('ttsBatchPickLocalFolder'), t('ttsMenuLocalHint'), on.localFolder));
    const root = el('div', 'anomalous-tts-menu-wrap');
    root.append(button('anomalous-tts-ghost', t('ttsAddMore'), () => menu.classList.toggle('is-open')), menu);
    return { root, menu };
}
