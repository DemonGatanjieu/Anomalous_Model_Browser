/**
 * The materials picker's data (ui_ai_toolbox.js), no DOM. Node types come from the page's own
 * node definitions (LiteGraph's registered types and their nodeData: no request, so the node
 * list is there at once): their source (ComfyUI's own, a custom node pack, the paid API nodes,
 * or a helper that lives only in the page, put with its pack when its name says which), their
 * sockets, settings and outputs. Combos, workflows, prompts and models come in one answer
 * (GET /anomalous/ai_toolbox?kind=all), read ahead (prefetchToolbox) and kept a minute; a window
 * opened meanwhile uses what is kept and refreshes it behind. searchItems matches and ranks.
 */

export const KINDS = Object.freeze(['nodes', 'combos', 'workflows', 'prompts', 'models']);
const SETTING_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO']);
const KEEP_MS = 60 * 1000;
const lower = value => String(value ?? '').toLowerCase();

/** The pack a page-only helper belongs to, by what its name says (rgthree's "(rgthree)" and so on). */
const PAGE_HINTS = [[/\(rgthree\)$/i, 'rgthree'], [/\|pysssss$/i, 'custom-scripts'], [/^easy /i, 'easy-use']];

function socketsAndSettings(data) {
    const inputs = [];
    const settings = [];
    for (const [section, required] of [['required', true], ['optional', false]]) {
        for (const [name, conf] of Object.entries(data?.input?.[section] || {})) {
            const [kind, options = {}] = Array.isArray(conf) ? conf : [conf];
            const choices = Array.isArray(kind) ? kind : kind === 'COMBO' && Array.isArray(options?.options) ? options.options : null;
            if ((choices || SETTING_TYPES.has(kind)) && !options?.forceInput) {
                settings.push({ name, type: choices ? 'choice' : String(kind), required, default: options?.default, choices: choices ? choices.length : 0 });
            } else {
                inputs.push({ name, type: String(kind), required });
            }
        }
    }
    const names = data?.output_name || data?.output || [];
    const outputs = (data?.output || []).map((type, slot) => ({ slot, name: String(names[slot] ?? type), type: String(type) }));
    return { inputs, settings, outputs };
}

/** A pack's folder or label in plain words: "comfyui_controlnet_aux" → "controlnet aux", "ComfyUI-Impact-Pack" → "Impact Pack". */
export function packLabel(text) {
    const words = String(text || '').split(/[\s_\-.]+/).filter(Boolean);
    const kept = words.filter((word, index) => !(/^comfy(ui)?$/i.test(word) && words.length > 1 && (index === 0 || index === words.length - 1)));
    return kept.join(' ') || String(text || '');
}

function sourceOf(data) {
    const module = String(data.python_module || '');
    if (data.api_node || module.startsWith('comfy_api_nodes')) return { key: 'api', kind: 'api' };
    if (module.startsWith('custom_nodes.')) {
        const folder = module.split('.')[1];
        return { key: folder, kind: 'pack', label: packLabel(data.nodeSource?.displayText || folder) };
    }
    return { key: 'builtin', kind: 'builtin' };
}

/** Every node type the page knows, as picker items. `registered`: LiteGraph.registered_node_types. */
export function nodeItems(registered) {
    const items = [];
    const packs = new Map();
    const pageOnly = [];
    for (const [type, cls] of Object.entries(registered || {})) {
        const data = cls?.nodeData;
        if (!data) {
            pageOnly.push([type, cls]);
            continue;
        }
        const source = sourceOf(data);
        if (source.kind === 'pack' && !packs.has(source.key)) packs.set(source.key, source.label);
        const shape = socketsAndSettings(data);
        items.push({
            kind: 'nodes', id: type, title: String(data.display_name || type), sub: data.display_name && data.display_name !== type ? type : '',
            source, category: String(data.category || ''), description: String(data.description || ''), ...shape,
            deprecated: Boolean(data.deprecated), experimental: Boolean(data.experimental), paid: source.kind === 'api', page: false,
        });
    }
    for (const [type, cls] of pageOnly) {
        const hint = PAGE_HINTS.find(([pattern]) => pattern.test(type))?.[1];
        const key = hint ? [...packs.keys()].find(folder => lower(folder).includes(hint)) : null;
        const source = key ? { key, kind: 'pack', label: packs.get(key) } : { key: 'builtin', kind: 'builtin' };
        items.push({
            kind: 'nodes', id: type, title: String(cls?.title || type), sub: cls?.title && cls.title !== type ? type : '',
            source, category: String(cls?.category || ''), description: '', inputs: [], settings: [], outputs: [],
            deprecated: false, experimental: false, paid: false, page: true,
        });
    }
    for (const item of items) {
        item.haystack = lower([item.id, item.title, item.category, item.source.label || '', item.description.slice(0, 200)].join(' '));
    }
    return items.sort((a, b) => a.title.localeCompare(b.title));
}

/** The sources of `items` with how many each has: ComfyUI's own first, packs by name, paid API nodes last. */
export function nodeSources(items) {
    const found = new Map();
    for (const item of items) {
        const entry = found.get(item.source.key) || { ...item.source, count: 0 };
        entry.count++;
        found.set(item.source.key, entry);
    }
    const order = source => (source.kind === 'builtin' ? 0 : source.kind === 'api' ? 2 : 1);
    return [...found.values()].sort((a, b) => order(a) - order(b) || lower(a.label || a.key).localeCompare(lower(b.label || b.key)));
}

/** The other kinds (GET /anomalous/ai_toolbox?kind=all) as picker items. */
export function catalogItems(payload) {
    const out = [];
    for (const combo of payload?.combos || []) {
        out.push({ kind: 'combos', id: combo.name, title: combo.name, sub: combo.model || '', ...combo,
            haystack: lower([combo.name, combo.model, combo.base, combo.prompt, ...(combo.loras || [])].join(' ')) });
    }
    for (const flow of payload?.workflows || []) {
        out.push({ kind: 'workflows', id: flow.name, title: flow.name, sub: (flow.tags || []).join(' · '), ...flow,
            haystack: lower([flow.name, flow.base, flow.notes, flow.prompt, ...(flow.tags || [])].join(' ')) });
    }
    for (const prompt of payload?.prompts || []) {
        out.push({ kind: 'prompts', ...prompt, id: prompt.id, title: prompt.name,
            haystack: lower([prompt.name, prompt.positive, prompt.negative, ...(prompt.tags || [])].join(' ')) });
    }
    for (const model of payload?.models || []) {
        out.push({ kind: 'models', ...model, id: model.id, title: model.name, sub: model.file,
            haystack: lower([model.name, model.file, model.folder, model.type, model.base, ...(model.words || [])].join(' ')) });
    }
    return out;
}

/** `items` matching every word of `query`: titles that start with it first, then titles that hold it, then the rest. */
export function searchItems(items, query) {
    const terms = lower(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return items;
    const whole = terms.join(' ');
    return items.filter(item => terms.every(term => item.haystack.includes(term)))
        .map((item, index) => {
            const title = lower(item.title);
            const id = lower(item.id);
            return { item, index, rank: title.startsWith(whole) || id.startsWith(whole) ? 0 : terms.every(term => title.includes(term) || id.includes(term)) ? 1 : 2 };
        })
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map(entry => entry.item);
}

let kept = null; // { at, items }
let loading = null;

/** The catalogue, kept a minute; `fresh` reads it again. Resolves to the items. */
export function loadCatalog({ fresh = false, fetcher = globalThis.fetch } = {}) {
    if (!fresh && kept && Date.now() - kept.at < KEEP_MS) return Promise.resolve(kept.items);
    loading ||= fetcher('/anomalous/ai_toolbox?kind=all')
        .then(async (response) => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            kept = { at: Date.now(), items: catalogItems(data) };
            return kept.items;
        })
        .finally(() => { loading = null; });
    return loading;
}

/** What is kept now (even when old), or null: a window shows it at once while loadCatalog refreshes. */
export const keptCatalog = () => kept?.items || null;

/** Reads the catalogue ahead, so the picker opens with it; errors wait for the window to say them. */
export function prefetchToolbox() {
    loadCatalog().catch(() => {});
}
