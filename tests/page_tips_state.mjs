// First-visit page tips state (web/modules/page_tips_state.js):
// fresh browsers see Models and Gallery tips once each, upgraded browsers stay undisturbed,
// corrupt or throwing storage fails safely, memory-only preview overrides storage, and both languages have all copy.
import assert from 'node:assert/strict';
import { LEGACY_STORAGE_KEYS, RAIL_PINS_KEY } from '../web/modules/rail_pins.js';
import {
    PAGE_TIPS,
    PAGE_TIPS_SEEN_KEY,
    isUpgradedBrowser,
    markPageTipSeen,
    readSeenPageTips,
    shouldShowPageTip,
} from '../web/modules/page_tips_state.js';
import { i18n } from '../web/modules/locales.js';

function memoryStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => { map.set(key, String(value)); },
        dump: () => Object.fromEntries(map),
    };
}

// 1. Fresh browser (empty storage or seeded: 'fresh'): shows Models & Gallery, not Doctor/Recipes/unknown.
const empty = memoryStorage();
assert.equal(isUpgradedBrowser(empty), false);
assert.equal(shouldShowPageTip('models', { storage: empty }), true);
assert.equal(shouldShowPageTip('gallery', { storage: empty }), true);
assert.equal(shouldShowPageTip('doctor', { storage: empty }), false);
assert.equal(shouldShowPageTip('recipes', { storage: empty }), false);
assert.equal(shouldShowPageTip('unknown', { storage: empty }), false);

const seededFresh = memoryStorage({
    [RAIL_PINS_KEY]: JSON.stringify({ version: 1, pinned: ['home', 'models', 'gallery', 'recipes', 'doctor'], seeded: 'fresh' }),
});
assert.equal(isUpgradedBrowser(seededFresh), false);
assert.equal(shouldShowPageTip('models', { storage: seededFresh }), true);
assert.equal(shouldShowPageTip('gallery', { storage: seededFresh }), true);

// 2. Dismissing records per-page independently without touching other pages.
markPageTipSeen('models', seededFresh);
assert.equal(shouldShowPageTip('models', { storage: seededFresh }), false);
assert.equal(shouldShowPageTip('gallery', { storage: seededFresh }), true);
markPageTipSeen('gallery', seededFresh);
assert.equal(shouldShowPageTip('gallery', { storage: seededFresh }), false);
assert.deepEqual([...readSeenPageTips(seededFresh)].sort(), ['gallery', 'models']);
assert.equal(JSON.parse(seededFresh.dump()[PAGE_TIPS_SEEN_KEY]).length, 2);

// Unknown page does not pollute storage.
markPageTipSeen('doctor', empty);
assert.equal(Object.hasOwn(empty.dump(), PAGE_TIPS_SEEN_KEY), false);

// 3. Upgraded browser: seeded: 'upgraded' or pre-existing legacy storage keys stay quiet.
const upgradedPins = memoryStorage({
    [RAIL_PINS_KEY]: JSON.stringify({ version: 1, pinned: ['home', 'models', 'gallery', 'recipes', 'doctor'], seeded: 'upgraded' }),
});
assert.equal(isUpgradedBrowser(upgradedPins), true);
assert.equal(shouldShowPageTip('models', { storage: upgradedPins }), false);
assert.equal(shouldShowPageTip('gallery', { storage: upgradedPins }), false);

const legacyOnly = memoryStorage({ [LEGACY_STORAGE_KEYS[0]]: 'models' });
assert.equal(isUpgradedBrowser(legacyOnly), true);
assert.equal(shouldShowPageTip('models', { storage: legacyOnly }), false);
assert.equal(shouldShowPageTip('gallery', { storage: legacyOnly }), false);

// 4. Memory-only preview overrides upgraded/seen state without mutating storage.
const beforeSnapshot = upgradedPins.dump();
const preview = new Set(['models', 'gallery']);
assert.equal(shouldShowPageTip('models', { storage: upgradedPins, preview }), true);
assert.equal(shouldShowPageTip('gallery', { storage: upgradedPins, preview }), true);
preview.delete('models');
assert.equal(shouldShowPageTip('models', { storage: upgradedPins, preview }), false);
assert.equal(shouldShowPageTip('gallery', { storage: upgradedPins, preview }), true);
assert.deepEqual(upgradedPins.dump(), beforeSnapshot);

// 5. Corrupt JSON & throwing storage fail safely.
const corrupt = memoryStorage({
    [RAIL_PINS_KEY]: '{not-json',
    [PAGE_TIPS_SEEN_KEY]: '{"models":true}',
});
assert.equal(isUpgradedBrowser(corrupt), false);
assert.deepEqual([...readSeenPageTips(corrupt)], []);
assert.equal(shouldShowPageTip('models', { storage: corrupt }), true);

const brokenStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
};
assert.equal(isUpgradedBrowser(brokenStorage), false);
assert.equal(shouldShowPageTip('models', { storage: brokenStorage }), true);
assert.doesNotThrow(() => markPageTipSeen('models', brokenStorage));

// 6. Locale completeness in both zh and en.
const keys = new Set([
    ...Object.values(PAGE_TIPS).map(entry => entry.textKey),
    'pageTipAria', 'pageTipGotIt', 'galleryEmpty',
    'reviewGo_pageTips', 'reviewPageTipModels', 'reviewPageTipGallery',
]);
for (const key of keys) {
    for (const lang of ['zh', 'en']) {
        assert.ok(i18n[lang][key] && String(i18n[lang][key]).trim(), `${lang} missing '${key}'`);
    }
}
console.log('page tips state: ok');
