// A page that answers anything (tests/load_order.mjs): every property, call and construction of the
// browser's and ComfyUI's objects gives the same stand-in, so a module's top level runs in Node.
import { register } from 'node:module';

const stand = new Proxy(function stand() {}, {
    get(target, key) {
        if (key === Symbol.toPrimitive) return () => '';
        if (key === Symbol.iterator) return function* none() {};
        if (key === 'then') return undefined; // not a promise: awaiting it goes on
        if (key === 'prototype') return target.prototype;
        if (key === 'length') return 0;
        return stand;
    },
    set: () => true,
    has: () => true,
    apply: () => stand,
    construct: () => stand,
});
globalThis.__loadOrderStand = stand;
const BROWSER = ['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location', 'history', 'screen',
    'HTMLElement', 'HTMLCanvasElement', 'Element', 'Node', 'CustomEvent', 'Event', 'EventTarget', 'MutationObserver',
    'ResizeObserver', 'IntersectionObserver', 'Image', 'Audio', 'AudioContext', 'requestAnimationFrame', 'cancelAnimationFrame',
    'getComputedStyle', 'matchMedia', 'customElements', 'DOMParser', 'FileReader', 'Worker', 'indexedDB', 'devicePixelRatio',
    'LiteGraph', 'LGraphCanvas', 'LGraphNode', 'comfyAPI', 'CanvasRenderingContext2D', 'alert', 'confirm', 'prompt'];
for (const name of BROWSER) {
    if (!(name in globalThis) || name === 'navigator' || name === 'location') {
        try {
            Object.defineProperty(globalThis, name, { value: stand, configurable: true, writable: true });
        } catch {
            // a name Node keeps read-only stays its own
        }
    }
}
register('./hooks.mjs', import.meta.url);
