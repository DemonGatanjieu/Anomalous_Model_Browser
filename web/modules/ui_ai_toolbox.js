/**
 * "给 AI 的素材": what the user hands the AI to work with in a task (api/ai_toolbox.py). A window
 * lists node types grouped by where they come from (ComfyUI's own, each custom node pack, the
 * helpers that live only in the page, paid API nodes), then the user's combos, saved workflows,
 * prompts and models, by the names the AI's tools use. A tick picks one for this task; the star
 * keeps it among the favourites a task has until the user picks for it. "Hand to the AI" sends
 * the picks and how strictly (prefer / only) as a step the AI receives. toolboxButton() is the
 * entry in a task's header, toolboxStep() the timeline row of a pick.
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { aiWindow } from './ui_ai_connect.js';

const KINDS = ['nodes', 'combos', 'workflows', 'prompts', 'models'];
const MODES = ['prefer', 'only'];
const ROWS_SHOWN = 80;
const SEARCH_DELAY_MS = 250;

let nodeGroups = null; // read once per page: ComfyUI's node list does not change while it runs

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

async function getJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}

const post = (url, body) => getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const empty = () => Object.fromEntries(KINDS.map(kind => [kind, []]));
const total = box => KINDS.reduce((sum, kind) => sum + (box?.[kind]?.length || 0), 0);
const shortName = (kind, name) => (kind === 'models' ? String(name).split(/[\\/:]/).pop() : name);

/** Node types by source; the page-only helpers (in LiteGraph, not in ComfyUI's list) before the paid API nodes. */
async function loadNodeGroups() {
    if (nodeGroups) return nodeGroups;
    const { groups } = await getJson('/anomalous/ai_toolbox?kind=nodes');
    const known = new Set(groups.flatMap(group => group.nodes.map(node => node.type)));
    const registered = globalThis.LiteGraph?.registered_node_types || {};
    const pageOnly = Object.keys(registered).filter(type => !known.has(type)).sort()
        .map(type => ({ type, label: registered[type]?.title || type }));
    const paid = groups.filter(group => group.source === 'api');
    nodeGroups = [...groups.filter(group => group.source !== 'api'), ...(pageOnly.length ? [{ source: 'page', nodes: pageOnly }] : []), ...paid];
    return nodeGroups;
}

const sourceLabel = source => (['builtin', 'api', 'page'].includes(source) ? t(`aiToolboxSource_${source}`) : source);

/** The window for task `task`; `changed()` after the picks were handed over. */
export async function openToolbox(task, changed = () => {}) {
    const state = { kind: 'nodes', query: '', mode: task.toolbox?.mode || 'prefer', picks: empty(), favorites: empty(), open: new Set(['builtin']) };
    try {
        state.favorites = { ...empty(), ...(await getJson('/anomalous/ai_toolbox/favorites')).favorites };
    } catch (_) { /* no favourites yet; starring still saves */ }
    const fromTask = Boolean(task.toolbox);
    for (const kind of KINDS) state.picks[kind] = [...((fromTask ? task.toolbox : state.favorites)[kind] || [])];

    const body = el('div', 'anomalous-ai-toolbox');
    const search = el('input', 'anomalous-ai-toolbox-search');
    search.type = 'search';
    search.placeholder = t('aiToolboxSearch');
    const kinds = el('div', 'anomalous-ai-toolbox-kinds');
    const list = el('div', 'anomalous-ai-toolbox-list');
    const tray = el('div', 'anomalous-ai-toolbox-tray');
    const intro = el('p', 'anomalous-ai-toolbox-intro', `${t('aiToolboxIntro')}${!fromTask && total(state.favorites) ? ` ${t('aiToolboxFromFavorites')}` : ''}`);
    const main = el('div', 'anomalous-ai-toolbox-main');
    main.append(kinds, list);
    body.append(intro, search, main, tray);
    const close = aiWindow(t('aiToolboxTitle'), body);
    body.closest('.anomalous-ai-connect-dialog')?.classList.add('is-wide');

    const picked = (kind, name) => state.picks[kind].includes(name);
    const toggle = (kind, name, on) => {
        state.picks[kind] = on ? [...new Set([...state.picks[kind], name])] : state.picks[kind].filter(item => item !== name);
        drawKinds();
        drawTray();
    };
    const star = (kind, name) => {
        const on = state.favorites[kind].includes(name);
        const node = button(`anomalous-ai-toolbox-star${on ? ' is-on' : ''}`, on ? '★' : '☆', async () => {
            const next = { ...state.favorites, [kind]: on ? state.favorites[kind].filter(item => item !== name) : [...state.favorites[kind], name] };
            try {
                state.favorites = { ...empty(), ...(await post('/anomalous/ai_toolbox/favorites', next)).favorites };
            } catch (error) {
                await anomalousAlert(error.message);
                return;
            }
            node.replaceWith(star(kind, name));
        }, t(on ? 'aiToolboxUnfavorite' : 'aiToolboxFavorite'));
        return node;
    };
    const row = (kind, name, label, detail) => {
        const item = el('label', 'anomalous-ai-toolbox-row');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = picked(kind, name);
        box.onchange = () => toggle(kind, name, box.checked);
        const words = el('span', 'anomalous-ai-toolbox-name', label || shortName(kind, name));
        item.append(box, words);
        if (detail) item.append(el('span', 'anomalous-ai-toolbox-detail', detail));
        item.append(star(kind, name));
        return item;
    };

    function drawKinds() {
        kinds.replaceChildren(...KINDS.map((kind) => {
            const count = state.picks[kind].length;
            const node = button(`anomalous-ai-toolbox-kind${state.kind === kind ? ' is-on' : ''}`, t(`aiToolboxKind_${kind}`), () => {
                state.kind = kind;
                drawKinds();
                void drawList();
            });
            if (count) node.append(el('span', 'anomalous-ai-toolbox-kind-count', String(count)));
            return node;
        }));
    }

    async function drawNodes() {
        list.replaceChildren(el('div', 'anomalous-ai-toolbox-note', t('aiToolboxLoading')));
        const groups = await loadNodeGroups();
        const query = state.query.toLowerCase();
        const shown = [];
        for (const group of groups) {
            const nodes = query ? group.nodes.filter(node => `${node.type} ${node.label} ${node.category || ''}`.toLowerCase().includes(query)) : group.nodes;
            if (!nodes.length) continue;
            const holder = el('details', `anomalous-ai-toolbox-group is-${['builtin', 'api', 'page'].includes(group.source) ? group.source : 'pack'}`);
            holder.open = Boolean(query) || state.open.has(group.source);
            const count = nodes.filter(node => picked('nodes', node.type)).length;
            const summary = el('summary', 'anomalous-ai-toolbox-group-head');
            summary.append(el('span', 'anomalous-ai-toolbox-group-name', sourceLabel(group.source)),
                el('span', 'anomalous-ai-toolbox-detail', t('aiToolboxGroupCount', { count: nodes.length })));
            if (count) summary.append(el('span', 'anomalous-ai-toolbox-kind-count', String(count)));
            holder.append(summary);
            const fill = () => {
                if (holder.children.length > 1) return;
                holder.append(...nodes.slice(0, ROWS_SHOWN).map(node => row('nodes', node.type, node.label, node.label !== node.type ? node.type : '')));
                if (nodes.length > ROWS_SHOWN) holder.append(el('div', 'anomalous-ai-toolbox-note', t('aiToolboxMore', { count: nodes.length - ROWS_SHOWN })));
            };
            holder.addEventListener('toggle', () => {
                if (holder.open) state.open.add(group.source); else state.open.delete(group.source);
                if (holder.open) fill();
            });
            if (holder.open) fill();
            shown.push(holder);
        }
        list.replaceChildren(...(shown.length ? shown : [el('div', 'anomalous-ai-toolbox-note', t('aiToolboxEmptyList'))]));
    }

    async function drawItems(kind) {
        list.replaceChildren(el('div', 'anomalous-ai-toolbox-note', t('aiToolboxLoading')));
        const { items } = await getJson(`/anomalous/ai_toolbox?kind=${kind}&query=${encodeURIComponent(state.query)}`);
        if (state.kind !== kind) return;
        const listed = new Set(items.map(item => item.name));
        // What is picked stays on top, also when a search does not find it, so it can be taken back.
        const kept = state.picks[kind].filter(name => !listed.has(name)).map(name => row(kind, name));
        const rows = items.map(item => row(kind, item.name, item.label, item.detail));
        list.replaceChildren(...kept, ...(rows.length || kept.length ? rows : [el('div', 'anomalous-ai-toolbox-note', t('aiToolboxEmptyList'))]));
    }

    async function drawList() {
        try {
            await (state.kind === 'nodes' ? drawNodes() : drawItems(state.kind));
        } catch (error) {
            list.replaceChildren(el('div', 'anomalous-ai-toolbox-note is-error', error.message));
        }
    }

    function drawTray() {
        const chips = el('div', 'anomalous-ai-toolbox-chips');
        for (const kind of KINDS) {
            for (const name of state.picks[kind]) {
                chips.append(button(`anomalous-ai-toolbox-chip is-${kind}`, `${shortName(kind, name)} ×`, () => {
                    toggle(kind, name, false);
                    void drawList();
                }, t(`aiToolboxKind_${kind}`)));
            }
        }
        if (!chips.children.length) chips.append(el('span', 'anomalous-ai-toolbox-detail', t('aiToolboxNone')));
        const mode = el('select', 'anomalous-ai-toolbox-mode');
        for (const value of MODES) {
            const option = el('option', '', t(`aiToolboxMode_${value}`));
            option.value = value;
            option.selected = state.mode === value;
            mode.append(option);
        }
        mode.onchange = () => { state.mode = mode.value; };
        const send = button('anomalous-ai-toolbox-send', t('aiToolboxSend'), async () => {
            try {
                await post(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}/toolbox`, { mode: state.mode, ...state.picks });
            } catch (error) {
                await anomalousAlert(error.message);
                return;
            }
            close();
            changed();
        });
        const actions = el('div', 'anomalous-ai-toolbox-actions');
        actions.append(mode, send);
        tray.replaceChildren(el('span', 'anomalous-ai-toolbox-detail', t('aiToolboxPicked')), chips, actions);
    }

    let timer = null;
    search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            state.query = search.value.trim();
            void drawList();
        }, SEARCH_DELAY_MS);
    });
    drawKinds();
    drawTray();
    await drawList();
    search.focus();
}

/** The entry in a task's header: "Materials", with how many the task has. */
export function toolboxButton(task, changed) {
    const count = total(task.toolbox);
    return button('anomalous-ai-link', count ? t('aiToolboxCount', { count }) : t('aiToolbox'), () => void openToolbox(task, changed), t('aiToolboxTitle'));
}

/** A pick on the timeline: what was handed over, how strictly, and whether the AI has it. */
export function toolboxStep(step) {
    const box = el('div', 'anomalous-ai-toolbox-step');
    const picks = step.toolbox || {};
    if (!total(picks)) {
        box.append(el('div', 'anomalous-ai-user-text', t('aiToolboxCleared')));
    } else {
        box.append(el('div', 'anomalous-ai-toolbox-detail', t(`aiToolboxStepMode_${picks.mode === 'only' ? 'only' : 'prefer'}`)));
        const chips = el('div', 'anomalous-ai-toolbox-chips');
        for (const kind of KINDS) {
            for (const name of picks[kind] || []) chips.append(el('span', `anomalous-ai-toolbox-chip is-${kind}`, shortName(kind, name)));
        }
        box.append(chips);
    }
    box.append(el('div', 'anomalous-ai-user-state', t(step.delivered ? 'aiMessageSeen' : 'aiMessageWaiting')));
    return box;
}
