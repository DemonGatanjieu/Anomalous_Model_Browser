import assert from 'node:assert/strict';
import { syncRows } from '../web/modules/sync_rows.js';

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
syncRows(list, [row('a'), row('b')]);
const [a, b] = list.children;
syncRows(list, [row('b'), row('a'), row('c')]);
assert.deepEqual(list.children.map(node => node.name), ['b 2', 'a 1', 'c 3'], 'rows with the same key are kept and moved');
syncRows(list, [row('a')]);
assert.deepEqual(list.children, [a], 'rows no longer asked for go');
globalThis.anomalous_browser_lang = 'en';
syncRows(list, [row('a'), row('b')]);
assert.equal(list.children.length, 2);
assert.notEqual(list.children[0], a, 'a row drawn in the other language is made again');
assert.notEqual(list.children[1], b);
console.log('sync_rows: kept rows, moved rows and a switch of language passed');
