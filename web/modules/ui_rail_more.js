/**
 * The rail's More menu (`#anomalous-more-btn`, ui_rail_tools.js): the pages and tools that can leave the
 * rail, in groups: not on the rail, pinned on it, and (while Anomalous_TTS is not installed and Voices is not
 * pinned) Voices as an extension. A row opens its page; the pin at its right puts the entry on the rail or
 * takes it off, and the menu stays open, drawn again with the rail. "Reset to minimal rail" at its foot
 * takes them all off. It lies beside the rail on <body>, in the popup menu's panel; a press outside, Esc
 * (the menu's only: the browser stays open), a resize, a chosen row or the browser closing closes it.
 */

import { translate as t } from './locales.js';
import { OPTIONAL_RAIL_ENTRIES } from './rail_pins.js';

const PIN_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 3.5h7"/><path d="M10 3.5v5.2L7 12v1.5h10V12l-3-3.3V3.5z"/><path d="M12 13.5v7"/></svg>';

// The open menu: { owner, entries, menu, onPointer, onKey }; one at a time.
let open = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const moreButton = () => document.getElementById('anomalous-more-btn');
const descKey = id => `railMoreDesc${id[0].toUpperCase()}${id.slice(1)}`;

function row(owner, entry) {
    const { rail } = owner;
    const pinned = rail.isPinned(entry.id);
    const line = el('div', 'anomalous-rail-more-row');

    const go = el('button', 'anomalous-popup-menu-item anomalous-rail-more-go');
    go.type = 'button';
    go.dataset.railMore = `go:${entry.id}`;
    go.setAttribute('role', 'menuitem');
    if (rail.activePage() === entry.id) {
        go.classList.add('is-current');
        go.setAttribute('aria-current', 'page');
    }
    const icon = el('span', 'anomalous-rail-more-icon');
    icon.innerHTML = entry.icon; // static markup only
    const name = el('span', 'anomalous-popup-menu-label', entry.name);
    if (rail.hasNews(entry.id)) name.append(el('span', 'anomalous-rail-more-dot'));
    const scanning = entry.id === 'scan' && owner.isScanning();
    go.classList.toggle('is-scanning', scanning);
    const note = scanning ? t('railMoreScanning')
        : entry.id === 'voices' && !rail.ttsInstalled() ? t('railMoreNeedsTts') : t(descKey(entry.id));
    const words = el('span', 'anomalous-popup-menu-words');
    words.append(name, el('span', 'anomalous-popup-menu-note', note));
    go.append(icon, words);
    go.onclick = (event) => {
        event.stopPropagation();
        closeRailMore();
        entry.open(owner);
    };

    const pin = el('button', 'anomalous-rail-more-pin');
    pin.type = 'button';
    pin.dataset.railMore = `pin:${entry.id}`;
    pin.setAttribute('role', 'menuitemcheckbox');
    pin.setAttribute('aria-checked', String(pinned));
    const what = t(pinned ? 'railMoreUnpin' : 'railMorePin');
    pin.setAttribute('aria-label', `${what}${t('wordColon')}${entry.name}`);
    pin.dataset.ambTooltip = what;
    pin.dataset.ambTooltipPos = 'right';
    pin.innerHTML = PIN_ICON; // static markup only
    pin.onclick = (event) => {
        event.stopPropagation();
        rail.togglePin(entry.id); // the rail draws its tools again, and this menu with them
    };
    line.append(go, pin);
    return line;
}

function render() {
    const { owner, entries, menu } = open;
    const { rail } = owner;
    // The focus stays on the same button drawn anew (a pin pressed from the keyboard).
    const focused = menu.contains(document.activeElement) ? document.activeElement.dataset.railMore : null;
    const voicesAway = !rail.ttsInstalled() && !rail.isPinned('voices');
    const groups = [
        ['railMoreSectionInMore', entries.filter(entry => !rail.isPinned(entry.id) && !(voicesAway && entry.id === 'voices'))],
        ['railMoreSectionPinned', entries.filter(entry => rail.isPinned(entry.id))],
        ['railMoreSectionExt', voicesAway ? entries.filter(entry => entry.id === 'voices') : []],
    ];
    menu.replaceChildren();
    for (const [key, list] of groups) {
        if (list.length) menu.append(el('div', 'anomalous-popup-menu-heading', t(key)), ...list.map(entry => row(owner, entry)));
    }
    if (OPTIONAL_RAIL_ENTRIES.some(id => rail.isPinned(id))) {
        const foot = el('div', 'anomalous-rail-more-foot');
        const reset = el('button', 'anomalous-rail-more-reset', t('railMoreReset'));
        reset.type = 'button';
        reset.dataset.railMore = 'reset';
        reset.setAttribute('role', 'menuitem');
        reset.onclick = (event) => {
            event.stopPropagation();
            rail.resetPins();
        };
        foot.append(reset);
        menu.append(foot);
    }
    if (focused !== null) (menu.querySelector(`[data-rail-more="${focused}"]`) || menu.querySelector('button'))?.focus({ preventScroll: true });
}

/** Beside More, its top level with the button's; kept inside the window (a docked or short window too). */
function place() {
    const box = moreButton()?.getBoundingClientRect();
    if (!box) return;
    const { menu } = open;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(box.right + 8, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(box.top, window.innerHeight - height - 8))}px`;
}

/** Opens the menu with `entries` ({ id, name, icon, open }), or closes it when it is open (More pressed again). */
export function openRailMore(owner, entries) {
    if (open) {
        closeRailMore();
        return;
    }
    const menu = el('div', 'anomalous-popup-menu anomalous-rail-more-menu');
    menu.setAttribute('role', 'menu'); // the browser's Esc leaves a menu on <body> alone (ui_browser_navigation.js)
    menu.setAttribute('aria-label', t('railMoreTitle'));
    const onPointer = (event) => {
        if (!menu.contains(event.target) && !event.target.closest?.('#anomalous-more-btn')) closeRailMore();
    };
    const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        event.preventDefault();
        closeRailMore();
        moreButton()?.focus({ preventScroll: true });
    };
    open = { owner, entries, menu, onPointer, onKey };
    document.body.append(menu);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closeRailMore);
    refreshRailMore();
    menu.querySelector('button')?.focus({ preventScroll: true });
}

/** Draws the open menu again (the rail changed: a pin, the open page, news, a scan). */
export function refreshRailMore() {
    if (!open) return;
    moreButton()?.setAttribute('aria-expanded', 'true');
    render();
    place();
}

export function closeRailMore() {
    if (!open) return;
    const { menu, onPointer, onKey } = open;
    open = null;
    menu.remove();
    window.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeRailMore);
    moreButton()?.setAttribute('aria-expanded', 'false');
}
