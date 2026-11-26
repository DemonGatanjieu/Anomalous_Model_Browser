import assert from 'node:assert/strict';
import { createCandidateVisibility } from '../web/modules/prompt_candidate_visibility.js';

const values = new Map();
let broken = false;
const host = new EventTarget();
host.localStorage = {
    getItem: key => values.get(key) || null,
    setItem(key, value) {
        if (broken) throw Error('storage unavailable');
        values.set(key, value);
    },
};
const field = n => ({ hide_key: n.toString(16).padStart(64, '0'), stable: true, text: 'private source text' });
const first = createCandidateVisibility(host), second = createCandidateVisibility(host);
const off = first.subscribe(() => {});
let updates = 0;
const offOther = second.subscribe(() => updates++);
first.hide(field(1), 'image1');
assert(first.hidden(field(1), 'image2'));
assert(!first.hidden(field(2), 'image1'));
const [storageKey] = values.keys();
assert(storageKey.startsWith('anomalous_'));
assert(!values.get(storageKey).includes('private'));
function sync() {
    const event = new Event('storage');
    Object.defineProperty(event, 'key', { value: storageKey });
    host.dispatchEvent(event);
}
sync();
assert.equal(updates, 1);
assert(second.hidden(field(1), 'image2'));
second.restore([field(1)], 'image2');
sync();
assert(!first.hidden(field(1), 'image1'));
const session = { ...field(7), stable: false };
first.hide(session, 'image1');
assert(first.hidden(session, 'image1'));
assert(!first.hidden(session, 'image2'));
assert(!second.hidden(session, 'image1'));
assert(!values.get(storageKey).includes(session.hide_key));
for (let i = 1; i <= 515; ++i) first.hide(field(i), 'scope');
assert.equal(JSON.parse(values.get(storageKey)).keys.length, 512);
assert(!first.hidden(field(1), 'scope'));
broken = true;
first.hide(field(601), 'test');
assert(first.hidden(field(601), 'test'));
first.restore([field(601)], 'test');
assert(!first.hidden(field(601), 'test'));
const denied = new EventTarget();
Object.defineProperty(denied, 'localStorage', { get() { throw Error('access denied'); } });
const fallback = createCandidateVisibility(denied);
fallback.hide(field(2), 'image');
assert(fallback.hidden(field(2), 'image'));
off(); offOther();
console.log('Candidate visibility: field scope, restoration, storage sync, limits and memory fallback passed.');
