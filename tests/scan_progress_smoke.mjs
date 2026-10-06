import assert from 'node:assert/strict';


class TestClassList {
    constructor() { this.values = new Set(); }
    add(...values) { values.forEach(value => this.values.add(value)); }
    remove(...values) { values.forEach(value => this.values.delete(value)); }
    toggle(value, force) {
        if (force) this.values.add(value);
        else this.values.delete(value);
    }
    contains(value) { return this.values.has(value); }
}


class TestElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.attributes = new Map();
        this.classList = new TestClassList();
        this.style = {};
        this.textContent = '';
        this.id = '';
    }
    set className(value) {
        this.classList = new TestClassList();
        String(value).split(/\s+/).filter(Boolean).forEach(name => this.classList.add(name));
    }
    appendChild(child) { this.children.push(child); return child; }
    remove() { this.removed = true; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    querySelector(selector) {
        const className = selector.startsWith('.') ? selector.slice(1) : '';
        for (const child of this.children) {
            if (className && child.classList.contains(className)) return child;
            const nested = child.querySelector(selector);
            if (nested) return nested;
        }
        return null;
    }
}


const body = new TestElement('body');
globalThis.document = {
    body,
    createElement: tagName => new TestElement(tagName),
    getElementById(id) {
        const visit = element => {
            if (element.id === id) return element;
            for (const child of element.children) {
                const found = visit(child);
                if (found) return found;
            }
            return null;
        };
        return visit(body);
    },
};
globalThis.anomalous_browser_lang = 'en';

const { updateScanProgress, finishScanProgress } = await import('../web/modules/scan_progress.js');
updateScanProgress({ scanning: true, phase: 'enumerating' });
const panel = document.getElementById('anomalous-scan-progress');
assert.ok(panel);
assert.equal(panel.querySelector('.anomalous-scan-progress-fill').classList.contains('is-indeterminate'), true);

updateScanProgress({ scanning: true, phase: 'scanning', total: 4, current: 2, filename: 'model.safetensors' });
assert.equal(panel.querySelector('.anomalous-scan-progress-fill').style.width, '50%');
assert.match(panel.querySelector('.anomalous-scan-progress-item').textContent, /2\/4/);

finishScanProgress('Custom finish message');
assert.equal(panel.querySelector('.anomalous-scan-progress-detail').textContent, 'Custom finish message');
assert.equal(panel.classList.contains('is-complete'), true);

// Calling without arguments preserves existing custom detail
finishScanProgress();
assert.equal(panel.querySelector('.anomalous-scan-progress-detail').textContent, 'Custom finish message');

console.log('scan progress smoke OK');
