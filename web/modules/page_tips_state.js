/**
 * First-visit usage tip strips on pages that have no built-in onboarding of their own
 * (Models and Gallery). Pure state, no DOM: ui_page_tip.js renders the strip, checks
 * memory-only preview overrides from the review console, and remembers dismissals per browser.
 *
 * Upgraded browsers (seeded as 'upgraded' in rail_pins.js, or carrying earlier versions'
 * localStorage keys before rail pins are written) already know how AMB works and stay
 * undisturbed on update.
 */

import { LEGACY_STORAGE_KEYS, RAIL_PINS_KEY } from './rail_pins.js';

export const PAGE_TIPS_SEEN_KEY = 'anomalous_page_tips_seen';

export const PAGE_TIPS = Object.freeze({
    models: Object.freeze({ textKey: 'pageTipModels' }),
    gallery: Object.freeze({ textKey: 'pageTipGallery' }),
});

function read(storage, key) {
    try {
        return storage?.getItem(key) ?? null;
    } catch (_) {
        return null;
    }
}

function write(storage, key, value) {
    try {
        storage?.setItem(key, value);
    } catch (_) { /* per-browser convenience only */ }
}

/** Whether this browser already used AMB before first-visit page tips existed. */
export function isUpgradedBrowser(storage = globalThis.localStorage) {
    try {
        const pins = JSON.parse(read(storage, RAIL_PINS_KEY) || 'null');
        if (pins && typeof pins === 'object') {
            if (pins.seeded === 'upgraded') return true;
            if (pins.seeded === 'fresh') return false;
        }
    } catch (_) { /* fall back to legacy keys below */ }
    return LEGACY_STORAGE_KEYS.some(key => Boolean(read(storage, key)));
}

/** Set of tip page ids already dismissed in `storage`. */
export function readSeenPageTips(storage = globalThis.localStorage) {
    try {
        const parsed = JSON.parse(read(storage, PAGE_TIPS_SEEN_KEY) || '[]');
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter(id => Object.hasOwn(PAGE_TIPS, id)));
    } catch (_) {
        return new Set();
    }
}

/** Records `page` as dismissed in `storage` and returns the updated Set. */
export function markPageTipSeen(page, storage = globalThis.localStorage) {
    const seen = readSeenPageTips(storage);
    if (!Object.hasOwn(PAGE_TIPS, page)) return seen;
    seen.add(page);
    write(storage, PAGE_TIPS_SEEN_KEY, JSON.stringify([...seen].sort()));
    return seen;
}

/**
 * Whether `page` should show its first-visit tip strip.
 * When `preview` (a Set) is passed by the review console, upgraded/seen storage is bypassed.
 */
export function shouldShowPageTip(page, { storage = globalThis.localStorage, preview = null } = {}) {
    if (!Object.hasOwn(PAGE_TIPS, page)) return false;
    if (preview !== null) return preview.has(page);
    if (isUpgradedBrowser(storage)) return false;
    return !readSeenPageTips(storage).has(page);
}
