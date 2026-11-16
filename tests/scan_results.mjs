// node tests/scan_results.mjs — the words for a scan's result: a cover that did not come says why.
import assert from 'node:assert/strict';
import { countsLine, coverMissed, fileOutcome } from '../web/modules/scan_results.js';
import { failureWords } from '../web/modules/net_failure.js';
import { translate as t } from '../web/modules/locales.js';

const failed = { status: 'matched', name: 'A · v1', filename: 'a.safetensors', cover: 'failed', cover_error: 'http:503' };
assert.equal(coverMissed(failed), t('scanFileCoverFailed', { why: failureWords('http:503') }));
assert.equal(fileOutcome(failed), `${t('scanFileMatched', { name: 'A · v1' })} · ${coverMissed(failed)}`);

// A model scanned again only for its cover: the line is the cover's, not "updated".
const again = { status: 'unchanged', filename: 'b.safetensors', cover: 'skipped' };
assert.equal(fileOutcome(again), t('scanFileCoverSkipped'));
assert.equal(fileOutcome({ status: 'unchanged', filename: 'c.safetensors', cover: 'new' }), t('scanFileUpdated'));
assert.equal(coverMissed({ status: 'matched', cover: 'new' }), '');

assert.ok(countsLine({ covers: 2, covers_missed: 1 }).includes(t('scanCountCoversMissed', { count: 1 })));
console.log('scan_results: ok');
