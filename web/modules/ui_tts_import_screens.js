import { t } from './interface_settings.js';

/**
 * The fixed screens of the GPT-SoVITS import window (ui_tts_import.js): its frame
 * (header, steps, footer), the toolbar over the cards, the first question (what do you have?), the drop area of
 * batch mode, the "add more" menu, and the spotlight tour steps that explain them.
 * Only markup and callbacks; the window owns all state.
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

function button(className, label, onClick, title) {
    const btn = el('button', className, label);
    btn.type = 'button';
    if (title) { btn.title = title; btn.setAttribute('aria-label', title); }
    btn.onclick = onClick;
    return btn;
}

/**
 * The toolbar over the cards: what is found, the drop hint, Choose again, Next batch,
 * the "add more" menu and New character. `on`: `{ files(), folder(), add(), next(), back() }`.
 */
export function renderImportToolbar(on) {
    const { root: menuWrap, menu } = renderAddMenu({ files: on.files, folder: on.folder });
    const parts = {
        menuWrap,
        menu,
        found: el('span', 'anomalous-tts-toolbar-title'),
        dropHint: el('span', 'anomalous-tts-toolbar-hint', t('ttsSoloDropHint')),
        backBtn: button('anomalous-tts-link', t('ttsChooseAgain'), on.back),
        nextBtn: button('anomalous-tts-pick', '', on.next),
        newBtn: button('anomalous-tts-ghost', t('ttsBatchNewDraft'), on.add),
        toolbar: el('div', 'anomalous-tts-toolbar'),
    };
    parts.toolbar.append(parts.found, parts.dropHint, parts.backBtn, parts.nextBtn, menuWrap, parts.newBtn);
    return parts;
}

/**
 * The window's frame: the header (title, ? replays the tour, × closes), the three
 * steps and the footer (summary, where it saves, Cancel, the import button).
 * `on`: `{ help(), close(), submit() }`. `frame.setStep(at)` marks the current step.
 */
export function renderImportFrame(title, on) {
    const header = el('div', 'anomalous-voice-modal-header');
    const heading = el('div', 'anomalous-voice-modal-heading');
    heading.append(el('div', 'anomalous-voice-modal-title', title));
    const closeBtn = button('anomalous-voice-modal-close', '×', on.close, t('close'));
    const headerButtons = el('div', 'anomalous-tts-header-buttons');
    headerButtons.append(button('anomalous-tts-help', '?', on.help, t('ttsTourReplay')), closeBtn);
    header.append(heading, headerButtons);

    const steps = el('ol', 'anomalous-tts-steps');
    const stepItems = ['ttsStepChoose', 'ttsStepFiles', 'ttsStepImport'].map((key, i) => {
        const item = el('li', 'anomalous-tts-step');
        item.append(el('span', 'anomalous-tts-step-no', String(i + 1)), el('span', 'anomalous-tts-step-label', t(key)));
        steps.append(item);
        return item;
    });
    const setStep = (at) => stepItems.forEach((item, i) => {
        item.classList.toggle('is-current', i === at);
        item.classList.toggle('is-done', i < at);
    });

    const saveTo = el('span', 'anomalous-tts-footer-path');
    const summary = el('span', 'anomalous-tts-footer-summary');
    const submit = button('anomalous-voice-modal-submit', '', on.submit);
    const footerInfo = el('div', 'anomalous-tts-footer-info');
    footerInfo.append(summary, saveTo);
    const footer = el('div', 'anomalous-voice-modal-footer anomalous-tts-footer');
    footer.append(footerInfo, button('anomalous-voice-modal-cancel', t('dialogCancel'), on.close), submit);
    return { header, steps, footer, setStep, summary, saveTo, submit, closeBtn };
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

/** Batch mode before any file: what to bring, and where from. `on`: `{ folder, files, back }`. */
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
    hero.append(heroIcon, el('div', 'anomalous-tts-hero-title', t('ttsHeroTitle')), needs,
        el('div', 'anomalous-tts-hero-desc', t('ttsHeroDesc')), buttons, renderFolderLayout(),
        button('anomalous-tts-link', t('ttsChooseAgain'), on.back));
    return hero;
}

/** A folder that sorts cleanly: one folder per character, named after it. Folded by default. */
function renderFolderLayout() {
    const box = el('details', 'anomalous-tts-layout');
    box.append(el('summary', '', t('ttsLayoutTitle')));
    const tree = el('div', 'anomalous-tts-layout-tree');
    const [a, b, clip] = [t('ttsLayoutCharA'), t('ttsLayoutCharB'), t('ttsLayoutClip')];
    for (const [depth, name, note] of [
        [0, `${t('ttsLayoutRoot')}/`, t('ttsLayoutRootNote')],
        [1, `${a}/`, t('ttsLayoutCharNote')],
        [2, `${a}-e15.ckpt`, t('ttsCardGpt')],
        [2, `${a}_e8_s200.pth`, t('ttsCardSovits')],
        [2, `${clip}.wav`, t('ttsLayoutClipNote')],
        [2, `${clip}.lab`, t('ttsLayoutLineNote')],
        [1, `${b}/`, t('ttsLayoutMore')],
    ]) {
        const file = el('span', 'anomalous-tts-layout-name', name);
        file.style.paddingLeft = `${depth * 16}px`;
        tree.append(file, el('span', 'anomalous-tts-layout-note', note));
    }
    box.append(tree, el('p', 'anomalous-tts-layout-foot', t('ttsLayoutFoot')));
    return box;
}

/**
 * "Add more": one button with a small menu, so the list stays the main thing.
 * `on`: `{ files, folder }`. Returns `{ root, menu }`; the
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
        item(t('ttsBatchPickFolder'), t('ttsMenuUploadHint'), on.folder));
    const root = el('div', 'anomalous-tts-menu-wrap');
    root.append(button('anomalous-tts-ghost', t('ttsAddMore'), () => menu.classList.toggle('is-open')), menu);
    return { root, menu };
}
