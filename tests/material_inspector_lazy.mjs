import assert from 'node:assert/strict';
import { renderDetailedNodeCards } from '../web/modules/material_inspector.js';

// Minimal DOM double: exercise allocation and toggle/copy handlers without a browser dependency.
class Element {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.listeners = {};
        this.dataset = {};
        this.classList = { toggle() {} };
        this.open = false;
    }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { this.children.push(...children); }
    prepend(...children) { this.children.unshift(...children); }
    setAttribute() {}
    querySelector(selector) { return this.children.find(child => child.className?.split(' ').includes(selector.slice(1))) || null; }
    addEventListener(event, callback) { (this.listeners[event] ||= []).push(callback); }
    toggle(open) { this.open = open; this.listeners.toggle?.forEach(callback => callback()); }
}
globalThis.document = { createElement: tag => new Element(tag) };
globalThis.window = { anomalous_browser_lang: 'zh' };
const descendants = node => [node, ...node.children.flatMap(descendants)];
const byClass = (node, className) => descendants(node).filter(child => child.className === className);
let propertiesRead = 0;
const blocks = Array.from({ length: 2000 }, (_, index) => ({
    node_id: index, type: 'KSampler', widgets_values: [123, 'fixed', 20, 7, 'euler', 'normal', 1],
    get properties() { propertiesRead++; return { long: 'x'.repeat(16000) }; },
}));
blocks.unshift({ node_id: 'prompt', type: 'CLIPTextEncode', widgets_values: ['  exact prompt\n'] });
const list = renderDetailedNodeCards(new Element('main'), blocks);
assert.equal(list.children.length, 2001);
assert.equal(list.children.filter(card => card.open).length, 1);
assert.equal(byClass(list, 'anomalous-material-node-parameter-content').length, 1);
assert.equal(propertiesRead, 0, 'closed nodes must not render/format their properties');
assert.equal(byClass(list.children[0], 'anomalous-material-prompt-body')[0].textContent, '  exact prompt\n');

const sampler = list.children[1];
sampler.toggle(true);
assert.equal(byClass(sampler, 'anomalous-material-node-parameter-content').length, 1);
assert.equal(propertiesRead, 1);
sampler.toggle(false);
sampler.toggle(true);
assert.equal(propertiesRead, 1, 'reopening must reuse the rendered content');
assert.equal(byClass(sampler, 'anomalous-material-node-parameter-content').length, 1);

const selectable = renderDetailedNodeCards(new Element('main'), blocks.slice(0, 2), { selectable: true });
assert.equal(selectable.children.filter(card => card.open).length, 0, 'workbench selection cards stay closed');
assert.equal(byClass(selectable, 'anomalous-material-node-parameter-content').length, 0);

const copy = byClass(list.children[0], 'anomalous-material-copy-prompt-btn')[0];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    clipboard: { writeText: async () => { throw new Error('denied'); } },
} });
await copy.onclick({ stopPropagation() {} });
assert.equal(copy.textContent, '复制失败，请重试');
navigator.clipboard.writeText = async value => assert.equal(value, '  exact prompt\n');
await copy.onclick({ stopPropagation() {} });
assert.notEqual(copy.textContent, '复制失败，请重试');
console.log('material inspector: 2001 cards, one initial body, lazy toggles and clipboard feedback OK');
