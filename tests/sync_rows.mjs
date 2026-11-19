import assert from 'node:assert/strict';
import { syncRows, watchScrollIdle } from '../web/modules/sync_rows.js';

// A list's children as the page has them: enough of the DOM for syncRows.
function parent() {
    const list = {
        children: [],
        insertBefore(node, before) {
            if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
            node.parent = list;
            const at = before ? list.children.indexOf(before) : -1;
            list.children.splice(at < 0 ? list.children.length : at, 0, node);
        },
    };
    return list;
}
let made = 0;
const row = (key) => ({ key, make: () => ({ dataset: {}, name: `${key} ${++made}`, remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); } }) });

const list = parent();
globalThis.anomalous_browser_lang = 'zh';
assert.equal(syncRows(list, [row('a'), row('b')]), true, 'initial rows report changed');
assert.equal(syncRows(list, [row('a'), row('b')]), false, 'unchanged rows skip mutation and report false');
const [a, b] = list.children;
assert.equal(syncRows(list, [row('b'), row('a'), row('c')]), true, 'reordered/added rows report changed');
assert.deepEqual(list.children.map(node => node.name), ['b 2', 'a 1', 'c 3'], 'rows with the same key are kept and moved');
assert.equal(syncRows(list, [row('a')]), true, 'removed rows report changed');
assert.deepEqual(list.children, [a], 'rows no longer asked for go');
globalThis.anomalous_browser_lang = 'en';
assert.equal(syncRows(list, [row('a'), row('b')]), true, 'language switch rebuilds and reports changed');
assert.equal(list.children.length, 2);
assert.notEqual(list.children[0], a, 'a row drawn in the other language is made again');
assert.notEqual(list.children[1], b);

// Scroll idle tracker marks scrolling active on scroll and invokes onIdle when scrollend fires.
const listeners = {};
const scroller = {
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
};
let idleCalls = 0;
const watch = watchScrollIdle(scroller, () => { idleCalls += 1; }, 5000);
assert.equal(watch.isScrolling(), false);
listeners.scroll.forEach(fn => fn());
assert.equal(watch.isScrolling(), true);
assert.equal(idleCalls, 0);
listeners.scrollend.forEach(fn => fn());
assert.equal(watch.isScrolling(), false);
assert.equal(idleCalls, 1);
watch.reset();
console.log('sync_rows: kept rows, moved rows, change flags, scroll idle tracker and language switch passed');
