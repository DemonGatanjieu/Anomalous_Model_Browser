import assert from 'node:assert/strict';
import { noticeOf } from '../web/modules/ai_notice.js';

assert.equal(noticeOf(null), null);
assert.equal(noticeOf({ id: 't' }), null, 'a plain update asks nothing of the user');
assert.equal(noticeOf({ id: 't', progress: { step: 's', percent: 40 } }), null);
assert.equal(noticeOf({ id: 't', panel: 'Two bases', asks: false }), null, 'a panel that only shows something');
assert.deepEqual(noticeOf({ id: 't', panel: 'Which base?', asks: true }), { title: 'aiNotifyAsks', text: 'Which base?' });
assert.deepEqual(noticeOf({ id: 't', gate: 'download', asks: true }), { title: 'aiNotifyGate', body: 'aiGateQ_download' });
assert.deepEqual(noticeOf({ id: 't', ran: 'done' }), { title: 'aiNotifyRan', body: 'aiNotifyRanDo' });
assert.equal(noticeOf({ id: 't', ran: 'error' }).title, 'aiNotifyFailed');
assert.equal(noticeOf({ id: 't', ran: 'cancelled' }), null, 'a run the user stopped is no news to them');
console.log('ai_notice: what a task event asks of the user passed');
