/**
 * The versions of one model on the cards and in the details (model_versions.js groups them by their
 * Civitai page). Folded, a model is one card with a tab on its right edge; open, its versions are
 * cards side by side, the shown one first, each with a pin to make it the one shown when folded.
 * Which version is shown and which models stay open are kept in this browser (localStorage, a
 * convenience only: without it the newest is shown, folded). Moving the cards is animated here
 * (moveCards); ui_grid.js draws them. The versions not downloaded yet are listed on demand by
 * ui_civitai_versions.js.
 */

import { translate as t } from './locales.js';
import { formatSize } from './file_size.js';
import { pageId, versionId, versionsOf } from './model_versions.js';

const SHOWN_KEY = 'anomalous.modelVersions'; // { pageId: versionId } shown when folded
const OPEN_KEY = 'anomalous.modelVersionsOpen'; // { all: true|false, pageId: true|false } models left open

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function stored(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || '{}');
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
}

function store(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch { /* storage off: the defaults next time */ }
}

/** The version id shown for model page `page` when folded, or 0 (the newest). */
export const chosenVersion = page => Number(stored(SHOWN_KEY)[page]) || 0;

/** Whether every model starts open ("Open all versions"). */
export const allOpen = () => stored(OPEN_KEY).all === true;

/** Whether model page `page` is open: its own choice, else the "open all" switch. */
export function isOpen(page) {
    const open = stored(OPEN_KEY);
    return typeof open[page] === 'boolean' ? open[page] : open.all === true;
}

/** Opens or folds one model page; it stays so until changed again or "open all" is switched. */
export function setOpen(page, open) {
    store(OPEN_KEY, { ...stored(OPEN_KEY), [page]: open });
}

/** "Open all versions" on or off; the models' own choices are forgotten. */
export function setAllOpen(open) {
    store(OPEN_KEY, { all: open });
}

/** How a version is called: its Civitai name, else its file's. */
export const versionLabel = model => model.metadata?.version_name || model.filename;

function versionFacts(model) {
    return [model.metadata?.baseModel, model.size_bytes ? formatSize(model.size_bytes) : ''].filter(Boolean).join(' · ');
}

const CHEVRON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
const PIN = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';

/** The tab on a card's right edge: folded it opens the `count` versions, open (on the last one) it folds them. */
export function versionsTab(open, count, onToggle) {
    const tab = el('button', 'anomalous-card-versions-tab');
    tab.type = 'button';
    tab.setAttribute('aria-expanded', String(open));
    tab.innerHTML = CHEVRON;
    if (!open) tab.append(el('span', 'anomalous-card-versions-count', count));
    tab.title = open ? t('modelVersionsFold') : t('modelVersionsOpen', { count });
    tab.onclick = event => {
        event.stopPropagation();
        onToggle();
    };
    return tab;
}

/** An open model's pin: pressed on the version shown when folded; pressing another makes it that one. */
export function versionPin(model, shown, onPin) {
    const pin = el('button', 'anomalous-card-version-pin');
    pin.type = 'button';
    pin.setAttribute('aria-pressed', String(shown));
    pin.innerHTML = PIN;
    pin.title = shown ? t('modelVersionsShown') : t('modelVersionsPin');
    pin.onclick = event => {
        event.stopPropagation();
        if (shown) return;
        store(SHOWN_KEY, { ...stored(SHOWN_KEY), [pageId(model)]: versionId(model) });
        onPin();
    };
    return pin;
}

/** The "Open all versions" switch; `onChange` redraws the list. */
export function openAllSwitch(onChange) {
    const chip = el('button', 'anomalous-model-base-chip anomalous-versions-all', t('modelVersionsAll'));
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(allOpen()));
    chip.title = t('modelVersionsAllHint');
    chip.onclick = () => {
        setAllOpen(!allOpen());
        onChange();
    };
    return chip;
}

const quiet = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * Runs `change` (which replaces some of `grid`'s cards) and slides the cards that stayed from their
 * old place to the new one; `leaving` cards shrink away first, cards new to the grid grow in after.
 * `keyOf(card)` names a card across the change (the same model). Only cards near the view move.
 */
export async function moveCards(grid, leaving, change, keyOf) {
    if (quiet() || !grid.animate) {
        change();
        return;
    }
    await Promise.all(leaving.map(card => card.animate(
        [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-24px) scale(0.92)' }],
        { duration: 140, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {})));
    const view = grid.getBoundingClientRect();
    const near = rect => rect.bottom > view.top - 400 && rect.top < view.bottom + 400;
    const before = new Map();
    for (const card of grid.querySelectorAll('.anomalous-card')) {
        const rect = card.getBoundingClientRect();
        if (near(rect)) before.set(keyOf(card), rect);
    }
    change();
    let entering = 0;
    for (const card of grid.querySelectorAll('.anomalous-card')) {
        const rect = card.getBoundingClientRect();
        if (!near(rect)) continue;
        const old = before.get(keyOf(card));
        if (!old) {
            card.animate([{ opacity: 0, transform: 'translateX(-28px) scale(0.92)' }, { opacity: 1, transform: 'none' }],
                { duration: 320, delay: 40 * entering++, easing: EASE, fill: 'backwards' });
        } else if (old.left !== rect.left || old.top !== rect.top) {
            card.animate([{ transform: `translate(${old.left - rect.left}px, ${old.top - rect.top}px)` }, { transform: 'none' }],
                { duration: 360, easing: EASE });
        }
    }
}

/** The details' row of the versions downloaded here (`owner.models`), `onOpen(model)` going to one; null without others. */
export function detailVersionRow(owner, model, onOpen) {
    const versions = versionsOf(owner.models, model);
    if (versions.length < 2) return null;
    const row = el('div', 'anomalous-detail-versions');
    row.append(el('span', 'anomalous-detail-versions-label', t('modelVersionsHere', { count: versions.length })));
    for (const version of versions) {
        const chip = el('button', `anomalous-detail-version${version === model ? ' is-current' : ''}`, versionLabel(version));
        chip.type = 'button';
        chip.title = [versionFacts(version), version.filename].filter(Boolean).join('\n');
        if (version === model) chip.setAttribute('aria-current', 'true');
        else chip.onclick = () => onOpen(version);
        row.append(chip);
    }
    return row;
}
