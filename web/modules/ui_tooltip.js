/**
 * The plugin's tooltips: an element says its text in `data-amb-tooltip` and, if it wants, a
 * side in `data-amb-tooltip-pos` (top, bottom, left, right; top by default).
 *
 * One bubble on <body> (styles/58-tooltips.css) is placed beside the element, flipped to the
 * other side when it does not fit and kept inside the window. The tooltips used to be drawn
 * inside the element (::after), where a card or panel that clips its overflow cut them (the
 * scan button's tip lost its first characters) and where they took the element's own ::after
 * (the AI page's news dot on the rail never showed).
 *
 * Shown after a short pause on hover or keyboard focus; gone on leave, press, scroll or Esc.
 */

const GAP = 8;
const EDGE = 6;
const DELAY = 350;
const SIDES = new Set(['top', 'bottom', 'left', 'right']);
const FLIP = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Where the bubble goes, in window pixels. `anchor` is the element's box, `size` the bubble's,
 * `view` the window's. The side asked for, or the other one when only that fits; then pushed
 * back inside the window. `arrow` is where the arrow meets the bubble, along its edge.
 */
export function placeTip(anchor, size, side, view) {
    const fits = {
        top: anchor.top - GAP - size.height >= EDGE,
        bottom: anchor.bottom + GAP + size.height <= view.height - EDGE,
        left: anchor.left - GAP - size.width >= EDGE,
        right: anchor.right + GAP + size.width <= view.width - EDGE,
    };
    let chosen = SIDES.has(side) ? side : 'top';
    if (!fits[chosen] && fits[FLIP[chosen]]) chosen = FLIP[chosen];
    const across = chosen === 'top' || chosen === 'bottom';
    const middleX = anchor.left + anchor.width / 2;
    const middleY = anchor.top + anchor.height / 2;
    let x = across ? middleX - size.width / 2
        : chosen === 'left' ? anchor.left - GAP - size.width : anchor.right + GAP;
    let y = !across ? middleY - size.height / 2
        : chosen === 'top' ? anchor.top - GAP - size.height : anchor.bottom + GAP;
    x = clamp(x, EDGE, view.width - size.width - EDGE);
    y = clamp(y, EDGE, view.height - size.height - EDGE);
    const arrow = across
        ? clamp(middleX - x, 10, size.width - 10)
        : clamp(middleY - y, 8, size.height - 8);
    return { x: Math.round(x), y: Math.round(y), side: chosen, arrow: Math.round(arrow) };
}

let bubble = null;
let target = null;
let timer = 0;

function ensureBubble() {
    if (!bubble || !bubble.isConnected) {
        bubble = document.createElement('div');
        bubble.className = 'anomalous-tip';
        bubble.setAttribute('role', 'tooltip');
        bubble.hidden = true;
        document.body.appendChild(bubble);
    }
    return bubble;
}

function show(element) {
    const text = element.getAttribute('data-amb-tooltip');
    if (!text || !element.isConnected || !element.getClientRects().length) return;
    const tip = ensureBubble();
    tip.textContent = text;
    tip.classList.remove('is-shown');
    tip.hidden = false;
    const place = placeTip(element.getBoundingClientRect(), { width: tip.offsetWidth, height: tip.offsetHeight },
        element.getAttribute('data-amb-tooltip-pos') || 'top', { width: window.innerWidth, height: window.innerHeight });
    tip.style.left = `${place.x}px`;
    tip.style.top = `${place.y}px`;
    tip.dataset.side = place.side;
    tip.style.setProperty('--amb-tip-arrow', `${place.arrow}px`);
    tip.classList.add('is-shown');
}

export function hideTooltip() {
    clearTimeout(timer);
    timer = 0;
    target = null;
    if (bubble) {
        bubble.classList.remove('is-shown');
        bubble.hidden = true;
    }
}

function later(element) {
    hideTooltip();
    target = element;
    timer = setTimeout(() => {
        if (target === element && (element.matches(':hover') || element.matches(':focus-visible'))) show(element);
    }, DELAY);
}

/** One set of listeners per page. */
export function bindTooltips(doc = document) {
    if (doc.__anomalousTooltips) return;
    doc.__anomalousTooltips = true;
    doc.addEventListener('pointerover', (event) => {
        const element = event.target.closest?.('[data-amb-tooltip]');
        if (element === target) return;
        if (!element || event.pointerType === 'touch') return hideTooltip();
        later(element);
    });
    doc.addEventListener('pointerout', (event) => {
        if (target && !target.contains(event.relatedTarget)) hideTooltip();
    });
    doc.addEventListener('focusin', (event) => {
        const element = event.target.closest?.('[data-amb-tooltip]');
        if (element && element.matches(':focus-visible')) later(element);
    });
    doc.addEventListener('focusout', hideTooltip);
    doc.addEventListener('pointerdown', hideTooltip, true);
    doc.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideTooltip(); }, true);
    window.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('blur', hideTooltip);
}
