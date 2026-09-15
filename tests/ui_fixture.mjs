import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const all = node => [node, ...node.children.flatMap(all)];
export class Events {
    listeners = new Map();
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    dispatch(type, event = {}) { for (const fn of [...(this.listeners.get(type) || [])]) fn(event); }
    listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
export class Element extends Events {
    constructor(tag) {
        super();
        this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {};
        this.className = ''; this.value = ''; this._text = ''; this.disabled = false;
        this.style = { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } };
        this.classList = {
            contains: name => this.className.split(/\s+/).includes(name),
            add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
            remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
            toggle: (name, force) => { const enabled = force ?? !this.classList.contains(name); this.classList[enabled ? 'add' : 'remove'](name); return enabled; },
        };
    }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(value) { this.textContent = value; }
    get innerHTML() { return this.textContent; }
    appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    insertBefore(child, before) { if (!before) return this.appendChild(child); child.remove(); child.parentNode = this; this.children.splice(this.children.indexOf(before), 0, child); return child; }
    prepend(child) { child.remove(); child.parentNode = this; this.children.unshift(child); }
    replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...children); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    get parentElement() { return this.parentNode; }
    get isConnected() { return this.tagName === 'body' || !!this.parentNode?.isConnected; }
    get firstChild() { return this.children[0] || null; }
    get options() { return this.children; }
    cloneNode(deep = false) {
        const copy = new Element(this.tagName);
        copy.className = this.className; copy.value = this.value; copy._text = this._text;
        copy.attrs = { ...this.attrs }; copy.dataset = { ...this.dataset };
        if (deep) copy.append(...this.children.map(child => child.cloneNode(true)));
        return copy;
    }
    setAttribute(name, value) { this.attrs[name] = value; }
    removeAttribute(name) { delete this.attrs[name]; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    matches(selector) { return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : this.tagName === selector; }
    querySelectorAll(selector) { return all(this).slice(1).filter(child => selector.split(',').some(part => child.matches(part.trim()))); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
    contains(child) { return all(this).includes(child); }
    hasChildNodes() { return !!this.children.length; }
    getBoundingClientRect() { return { width: parseFloat(this.style.width || this.style['--amb-translator-width']) || 580, height: 600, top: 0, left: 0, right: 580, bottom: 600 }; }
    click() { if (!this.disabled) return this.onclick?.({ target: this, preventDefault() {}, stopPropagation() {} }); }
    showModal() { this.open = true; }
    close() { this.open = false; this.onclose?.(); }
    focus() {}
    scrollIntoView() {}
}

export function fixture() {
    const document = new Events();
    document.body = new Element('body');
    document.createElement = tag => new Element(tag);
    document.createDocumentFragment = () => new Element('fragment');
    document.querySelector = selector => document.body.querySelector(selector);
    document.querySelectorAll = selector => document.body.querySelectorAll(selector);
    const window = new Events();
    Object.assign(window, { innerWidth: 1440, innerHeight: 900, anomalous_browser_lang: 'en' });
    const storage = new Map();
    const timers = new Map();
    let timerId = 0;
    const errors = [], requests = [], clipboard = [];
    const node = { id: 1, type: 'CLIPTextEncode', widgets: [{ name: 'text', type: 'customtext', value: 'original' }], widgets_values: ['original'] };
    const app = { graph: { getNodeById: id => id === node.id ? node : null }, canvas: { selected_nodes: { 1: node } } };
    const state = {
        app, node, window, document, errors, requests, clipboard,
        async fetch(url) { return { ok: true, json: async () => String(url).includes('/materials?') ? { status: 'success', materials: [], pages: 1 } : { status: 'success', translated: 'translated' } }; },
    };
    const context = vm.createContext({ console, URL, URLSearchParams, Blob, AbortController, DOMException, structuredClone,
        document, window, app, errors, anomalous_browser_lang: 'en',
        setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
        requestAnimationFrame: callback => callback(), queueMicrotask,
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
        navigator: { clipboard: { async writeText(text) { clipboard.push(text); } } }, confirm: () => true,
        fetch: async (url, options = {}) => { requests.push([url, options]); return state.fetch(url, options); },
    });
    const modules = new Map();
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/modules');
    const load = filename => {
        if (modules.has(filename)) return modules.get(filename);
        let source;
        if (filename.endsWith('/scripts/app.js')) source = 'export const app = globalThis.app;';
        else if (filename.endsWith('/ui_dialog.js')) source = 'export async function anomalousAlert(message) { errors.push(message); } export async function anomalousConfirm() { return true; }';
        else if (filename.endsWith('/material_feedback.js')) source = 'export function showMaterialSaved() {}';
        else if (filename.endsWith('/ui_gallery_detail.js')) source = 'export function showImageWorkbench() {}';
        else source = fs.readFileSync(filename, 'utf8');
        const mod = new vm.SourceTextModule(source, { context, identifier: filename });
        modules.set(filename, mod); return mod;
    };
    state.module = async name => {
        const mod = load(path.resolve(root, name).replaceAll('\\', '/'));
        if (mod.status === 'unlinked') await mod.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier).replaceAll('\\', '/')));
        if (mod.status === 'linked') await mod.evaluate();
        return mod.namespace;
    };
    state.button = (rootNode, label) => all(rootNode).find(el => el.tagName === 'button' && el.textContent.includes(label));
    state.flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
    state.runTimers = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); };
    return state;
}
