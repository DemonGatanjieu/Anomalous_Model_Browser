// What Home's first-run card shows (web/modules/first_run_state.js): one button for each case of the folders,
// the network check on the way, the offline / retry / proxy strip only when Civitai does not answer, a refused
// key that never stops the scan, and every word it names in both languages.
import assert from 'node:assert/strict';
import { describeFirstRun } from '../web/modules/first_run_state.js';
import { i18n } from '../web/modules/locales.js';

const seen = [];
const view = (input) => {
    const out = describeFirstRun(input);
    seen.push(out);
    return out;
};
const NEW = { total: 42, waiting: 42 };

// Waiting for the press: no models, models never scanned, everything scanned.
let card = view({ phase: 'idle', counts: { total: 0, waiting: 0 } });
assert.equal(card.kind, 'empty');
assert.equal(card.bodyKey, 'firstRunScanNone');
assert.equal(card.primaryAction, 'import');
assert.equal(card.primaryLabelKey, 'homeImportModels');
assert.equal(card.showTourLink, true);
assert.equal(view({ phase: 'idle' }).primaryAction, 'import', 'no counts yet: nothing to scan');

card = view({ phase: 'idle', counts: NEW });
assert.equal(card.kind, 'ready');
assert.deepEqual([card.bodyKey, card.bodyParams], ['firstRunLeadCount', { count: 42 }]);
assert.deepEqual([card.primaryAction, card.primaryLabelKey, card.primaryDisabled], ['scan', 'firstRunScanMyModels', false]);
assert.equal(card.showTourLink, true);
assert.equal(card.showFallback, false);
assert.equal(card.dismissKey, 'firstRunLater');

card = view({ phase: 'idle', counts: { total: 9, waiting: 0 } });
assert.equal(card.kind, 'scanned');
assert.equal(card.bodyKey, 'firstRunScanNothingNew');
assert.deepEqual([card.primaryAction, card.primaryLabelKey], ['scan', 'firstRunScanAgain']);

// Asking Civitai: the button waits.
card = view({ phase: 'checking', counts: NEW });
assert.deepEqual([card.primaryAction, card.primaryLabelKey, card.primaryDisabled], ['scan', 'firstRunNetChecking', true]);
assert.equal(card.bodyKey, 'firstRunLeadCount');
assert.equal(card.showTourLink, false);

// Civitai did not answer: the strip, no big button.
card = view({ phase: 'offline_choice', counts: NEW, netFailure: 'timeout', netError: 'timed out' });
assert.equal(card.showFallback, true);
assert.equal(card.fallbackKey, 'firstRunOfflineFallback');
assert.deepEqual(card.fallback, { failure: 'timeout', error: 'timed out' });
assert.equal(card.primaryAction, 'none');
assert.deepEqual(view({ phase: 'offline_choice', counts: NEW }).fallback, { failure: '', error: '' });
for (const phase of ['idle', 'checking', 'running', 'done', 'failed']) {
    assert.equal(view({ phase, counts: NEW }).showFallback, false, `${phase}: the strip only when Civitai did not answer`);
}

// Scanning, done, failed.
card = view({ phase: 'running', counts: NEW });
assert.deepEqual([card.kind, card.bodyKey, card.primaryAction], ['running', 'firstRunScanRunning', 'none']);
card = view({ phase: 'done', counts: NEW });
assert.deepEqual([card.bodyKey, card.pillKey, card.dismissKey, card.primaryAction], ['firstRunScanDoneBody', 'firstRunScanDone', 'firstRunDone', 'none']);
assert.equal(card.showTourLink, true, 'the tour is offered, never started');
card = view({ phase: 'failed', counts: NEW });
assert.deepEqual([card.bodyKey, card.primaryAction, card.primaryLabelKey, card.showOfflineScan], ['firstRunScanFailed', 'retry', 'firstRunRetry', true]);
assert.equal(view({ phase: 'failed', offline: true }).showOfflineScan, false, 'an offline scan failed: no offline button again');

// A key Civitai refuses: the scan goes on, a note says so (not after an offline scan, which never asked).
for (const phase of ['running', 'done', 'failed']) {
    card = view({ phase, counts: NEW, keyRefused: true });
    assert.equal(card.keyWarning, true, phase);
    assert.notEqual(card.primaryDisabled, true);
}
assert.equal(view({ phase: 'running', keyRefused: true, offline: true }).keyWarning, false);
assert.equal(view({ phase: 'running' }).keyWarning, false);

assert.throws(() => describeFirstRun({ phase: 'later' }), /unknown phase/);

// Every word named is on screen in both languages.
const keys = new Set(seen.flatMap(item => [item.titleKey, item.bodyKey, item.primaryLabelKey, item.dismissKey, item.pillKey, item.fallbackKey])
    .concat(['firstRunScanOffline', 'firstRunRetry', 'firstRunProxySettings', 'firstRunTourQuick', 'firstRunKeyRefusedNote', 'firstRunKeyFix',
        'firstRunPreviewNoScan', 'firstRunScanPreparing'])
    .filter(Boolean));
for (const key of keys) {
    for (const lang of ['zh', 'en']) assert.ok(i18n[lang][key], `${lang} has no '${key}'`);
}
assert.match(i18n.zh.firstRunOfflineFallback, /\{why\}/);
assert.match(i18n.en.firstRunOfflineFallback, /\{why\}/);
console.log('first-run card state: ok');
