/**
 * "给 AI 的素材": what the user hands the AI to work with in a task (api/ai_toolbox.py). A side
 * panel on the right of the screen that leaves the workbench and the canvas usable (the kinds as
 * tabs, a line per item, a card's detail over them), or, expanded, a large window: a
 * search over everything, the kinds on the left (node types, combos, workflows,
 * prompts, models) with how many are picked, a second column to narrow by source (each custom
 * node pack with its badge, ComfyUI's own, paid API nodes), by where a prompt comes from or by
 * model type (a custom node pack can be picked whole there: every node type in it; in the side
 * panel that column is one "Source: All ▾" button opening a list to search), a grid of
 * cards (ui_ai_toolbox_cards.js) drawn as it scrolls, the card in focus
 * in full on the right, and the picks below with how strictly the AI keeps to them. Node types
 * are the page's own (no waiting); the rest is read ahead and kept (ai_toolbox_data.js). The
 * user's last choice of the two is remembered on this browser. On the AI page the side panel is a
 * view of the workbench's side column (setToolboxHost, ui_ai_side_views.js); elsewhere it docks
 * on the right of the screen. toolboxStep() is the timeline row of a pick.
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { aiWindow } from './ui_ai_connect.js';
import { KINDS, PICK_KINDS, keptCatalog, loadCatalog, nodeItems, nodeSources, prefetchToolbox, searchItems } from './ai_toolbox_data.js';
import { card, coverUrl, detail, refreshCard, rowCard } from './ui_ai_toolbox_cards.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { emptyPicture, sourceBadge } from './ui_ai_toolbox_icons.js';
import { deliveryState } from './ui_ai_delivery.js';

const MODES = ['prefer', 'only'];
const CHUNK = 60;
const SEARCH_DELAY_MS = 120;
const LAYOUT_KEY = 'anomalous.aiToolboxLayout';
let openNow = null; // {task, body, close} of the picker on screen
let sideHost = null; // (body, expand) => close, or null when the AI page is not shown

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function button(className, children, onClick, title) {
    const node = el('button', className);
    node.type = 'button';
    node.append(...[].concat(children).map(child => (typeof child === 'string' ? el('span', '', child) : child)));
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

async function postJson(url, body) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}

const empty = () => Object.fromEntries(PICK_KINDS.map(kind => [kind, []]));
const total = box => PICK_KINDS.reduce((sum, kind) => sum + (box?.[kind]?.length || 0), 0);
const keyOf = (kind, id) => `${kind}|${id}`;
/** The custom node packs among `nodes`, as items to pick whole (and to name with "@", ui_ai_mention.js). */
export const packItems = nodes => nodeSources(nodes).filter(source => source.kind === 'pack')
    .map(source => ({ kind: 'packs', id: source.key, title: t('aiTbPackName', { name: source.label || source.key }), source, count: source.count }));

function savedLayout() {
    try { return localStorage.getItem(LAYOUT_KEY) === 'full' ? 'full' : 'side'; } catch (_) { return 'side'; }
}

function keepLayout(layout) {
    try { localStorage.setItem(LAYOUT_KEY, layout); } catch (_) { /* only not remembered */ }
}

/** `body` in a panel on the right of the screen (nothing else blocked; the full-screen browser makes
 * room for it): its title, expand, close. Returns close. */
function dockPanel(title, body, expand) {
    const panel = el('aside', 'anomalous-tb-dock');
    panel.setAttribute('aria-label', title);
    const head = el('div', 'anomalous-tb-dock-head');
    const close = () => {
        panel.remove();
        document.body.classList.remove('anomalous-tb-docked');
    };
    document.body.classList.add('anomalous-tb-docked');
    head.append(icon('sparkle', 16), el('div', 'anomalous-tb-dock-title', title),
        iconButton('anomalous-tb-dock-btn', 'expand', t('aiTbExpand'), expand, { iconOnly: true }),
        iconButton('anomalous-tb-dock-btn', 'close', t('close'), close, { iconOnly: true }));
    panel.append(head, body);
    document.body.append(panel);
    return close;
}

let nodesKept = null; // the page's node types do not change while it is open
export const pageNodes = () => (nodesKept ||= nodeItems(globalThis.LiteGraph?.registered_node_types));

/** What narrows a kind in the second column: a node's source, a prompt's origin, a model's type. */
function facetOf(item) {
    if (item.kind === 'nodes') return { key: item.source.key, label: item.source.kind === 'pack' ? item.source.label : t(`aiTbSource_${item.source.kind}`), source: item.source };
    if (item.kind === 'prompts') return { key: item.source, label: t(`aiTbPromptFrom_${item.source}`) };
    if (item.kind === 'models') return { key: item.type, label: item.type };
    return null;
}

function facets(items, kind) {
    if (kind === 'nodes') {
        return nodeSources(items).map(source => ({ key: source.key, count: source.count, source,
            label: source.kind === 'pack' ? source.label : t(`aiTbSource_${source.kind}`) }));
    }
    const found = new Map();
    for (const item of items) {
        const facet = facetOf(item);
        if (!facet) continue;
        const entry = found.get(facet.key) || { ...facet, count: 0 };
        entry.count++;
        found.set(facet.key, entry);
    }
    return [...found.values()].sort((a, b) => b.count - a.count);
}

/** The window for task `task`; `changed()` after the picks were handed over. */
export async function openToolbox(task, changed = () => {}) {
    if (openNow?.body.isConnected) {
        const same = openNow.task === task.id;
        openNow.close();
        openNow = null;
        if (same) return; // its button again: put it away
    }
    const fromTask = Boolean(task.toolbox);
    const state = {
        kind: 'nodes', query: '', filter: 'all', facet: null, focus: null, mode: task.toolbox?.mode || 'prefer',
        picks: empty(), favorites: empty(), nodes: pageNodes(), catalog: keptCatalog(), error: '',
    };
    const byKey = new Map();
    const index = () => {
        byKey.clear();
        for (const item of [...state.nodes, ...packItems(state.nodes), ...(state.catalog || [])]) byKey.set(keyOf(item.kind, item.id), item);
    };
    index();
    try {
        const response = await fetch('/anomalous/ai_toolbox/favorites');
        if (response.ok) state.favorites = { ...empty(), ...(await response.json()).favorites };
    } catch (_) { /* none yet; a star still saves */ }
    for (const kind of PICK_KINDS) state.picks[kind] = [...((fromTask ? task.toolbox : state.favorites)[kind] || [])];

    const body = el('div', 'anomalous-tb');
    const top = el('div', 'anomalous-tb-top');
    const searchBox = el('label', 'anomalous-tb-search');
    const search = el('input');
    search.type = 'search';
    search.placeholder = t('aiTbSearch');
    searchBox.append(icon('search', 18), search, el('kbd', 'anomalous-tb-kbd', '/'));
    const filters = el('div', 'anomalous-tb-filters');
    top.append(el('div', 'anomalous-tb-for', t('aiTbFor', { task: task.title || t('aiUntitled') })), searchBox, filters);
    const rail = el('nav', 'anomalous-tb-rail');
    const side = el('aside', 'anomalous-tb-facets');
    const gridWrap = el('div', 'anomalous-tb-grid-wrap');
    const gridHead = el('div', 'anomalous-tb-grid-head');
    const scroller = el('div', 'anomalous-tb-scroller');
    const grid = el('div', 'anomalous-tb-grid');
    const sentinel = el('div', 'anomalous-tb-sentinel');
    scroller.append(grid, sentinel);
    const packBar = el('div', 'anomalous-tb-pack');
    gridWrap.append(gridHead, packBar, scroller);
    const pane = el('div', 'anomalous-tb-pane');
    const main = el('div', 'anomalous-tb-main');
    main.append(rail, side, gridWrap, pane);
    const tray = el('div', 'anomalous-tb-tray');
    body.append(top, main, tray);
    let closeFrame = () => {};
    /** Shows the picker as a side panel or a large window, moving the same `body` (nothing is redrawn but the pane). */
    function place(layout) {
        const scrolled = scroller.scrollTop;
        body.remove();
        closeFrame();
        keepLayout(layout);
        const changed = body.classList.contains('is-side') !== (layout === 'side');
        body.classList.toggle('is-side', layout === 'side');
        if (layout === 'side') {
            closeFrame = sideHost?.(body, () => place('full')) || dockPanel(t('aiToolboxTitle'), body, () => place('full'));
        } else {
            closeFrame = aiWindow(t('aiToolboxTitle'), body);
            const dialog = body.closest('.anomalous-ai-connect-dialog');
            dialog?.classList.add('is-toolbox');
            const shut = dialog?.querySelector('.anomalous-ai-connect-close');
            shut?.before(iconButton('anomalous-tb-dock-btn', 'panel', t('aiTbDock'), () => place('side'), { iconOnly: true }));
        }
        if (changed && grid.childElementCount) drawGrid(); // lines in the side panel, cards in the window
        else scroller.scrollTop = scrolled;
        drawPane();
    }
    const close = () => {
        body.remove();
        closeFrame();
        if (openNow?.body === body) openNow = null;
    };

    const picked = item => state.picks[item.kind].includes(item.id);
    const inPack = item => item.kind === 'nodes' && state.picks.packs.includes(item.source?.key);
    const liked = item => state.favorites[item.kind].includes(item.id);
    const cards = new Map(); // key -> drawn card
    const ctx = {
        picked, inPack, favorite: liked, focus: (item) => { state.focus = item; drawPane(); },
        peek: (item) => { if (!body.classList.contains('is-side')) ctx.focus(item); }, // the side panel's detail would cover the cards
        toggle: item => setPick(item.kind, item.id, !picked(item)),
        star: item => setFavorite(item),
        promptPicked: id => state.picks.prompts.includes(id),
        pickPrompt: id => setPick('prompts', id, !state.picks.prompts.includes(id)),
    };

    function setPick(kind, id, on) {
        state.picks[kind] = on ? [...new Set([...state.picks[kind], id])] : state.picks[kind].filter(item => item !== id);
        const item = byKey.get(keyOf(kind, id));
        const drawn = cards.get(keyOf(kind, id));
        if (drawn && item) refreshCard(drawn, item, ctx);
        if (kind === 'packs') {
            for (const [key, node] of cards) refreshCard(node, byKey.get(key), ctx);
            drawFacets(shown().beforeFacet);
            drawPackBar();
        }
        drawRail();
        drawFilters();
        drawTray();
        drawPane();
        if (state.filter === 'picked') drawGrid();
    }

    async function setFavorite(item) {
        const next = { ...state.favorites, [item.kind]: liked(item) ? state.favorites[item.kind].filter(id => id !== item.id) : [...state.favorites[item.kind], item.id] };
        try {
            state.favorites = { ...empty(), ...(await postJson('/anomalous/ai_toolbox/favorites', next)).favorites };
        } catch (error) {
            await anomalousAlert(error.message);
            return;
        }
        const drawn = cards.get(keyOf(item.kind, item.id));
        if (drawn) refreshCard(drawn, item, ctx);
        drawFilters();
        drawPane();
        if (state.filter === 'liked') drawGrid();
    }

    const itemsOf = kind => (kind === 'nodes' ? state.nodes : (state.catalog || []).filter(item => item.kind === kind));

    /** The cards of the current kind after the search, the filter and the second column. */
    function shown() {
        let items = searchItems(itemsOf(state.kind), state.query);
        if (state.filter === 'picked') items = items.filter(picked);
        if (state.filter === 'liked') items = items.filter(liked);
        const beforeFacet = items;
        if (state.facet) items = items.filter(item => facetOf(item)?.key === state.facet);
        return { items, beforeFacet };
    }

    function drawRail() {
        rail.replaceChildren(...KINDS.map((kind) => {
            const count = state.picks[kind].length + (kind === 'nodes' ? state.picks.packs.length : 0);
            const matches = state.query ? searchItems(itemsOf(kind), state.query).length : null;
            const node = button(`anomalous-tb-kind${state.kind === kind ? ' is-on' : ''}`, [icon(kind, 20), t(`aiToolboxKind_${kind}`)], () => {
                state.kind = kind;
                state.facet = null;
                state.focus = null;
                drawAll();
            });
            const meta = el('span', 'anomalous-tb-kind-meta');
            if (matches !== null) meta.append(el('span', 'anomalous-tb-kind-matches', String(matches)));
            if (count) meta.append(el('span', 'anomalous-tb-count', String(count)));
            node.append(meta);
            return node;
        }));
    }

    function drawFilters() {
        const picks = total(state.picks);
        const likes = total(state.favorites);
        filters.replaceChildren(...[['all', t('aiTbAll'), null], ['picked', t('aiTbPickedFilter'), picks], ['liked', t('aiTbLiked'), likes]].map(([key, label, count]) => {
            const node = button(`anomalous-tb-filter${state.filter === key ? ' is-on' : ''}`, [key === 'liked' ? icon('star', 14) : key === 'picked' ? icon('check', 14) : icon('list', 14), label], () => {
                state.filter = key;
                drawAll();
            }, label); // the side panel shows the icons alone
            if (count) node.append(el('span', 'anomalous-tb-count', String(count)));
            return node;
        }));
    }

    function drawFacets(beforeFacet) {
        const list = facets(beforeFacet, state.kind);
        side.hidden = list.length < 2;
        if (side.hidden) return;
        const row = (facet, label, count, badge) => {
            const node = button(`anomalous-tb-facet${state.facet === facet ? ' is-on' : ''}`, [badge || icon('list', 16), label], () => {
                state.facet = facet;
                drawGrid();
            });
            node.title = label;
            node.append(el('span', 'anomalous-tb-facet-count', String(count)));
            if (facet && state.picks.packs.includes(facet)) node.classList.add('has-pack');
            return node;
        };
        const title = t(state.kind === 'nodes' ? 'aiTbSources' : 'aiTbNarrow');
        const rows = () => [row(null, t('aiTbEverything'), beforeFacet.length),
            ...list.map(facet => row(facet.key, facet.label, facet.count, facet.source ? sourceBadge(facet.source, 22) : null))];
        if (!body.classList.contains('is-side')) {
            side.replaceChildren(el('div', 'anomalous-tb-facets-title', title), ...rows());
            return;
        }
        // The side panel: one button saying what is shown, opening the list to pick from (and search).
        const current = list.find(facet => facet.key === state.facet);
        const open = button(`anomalous-tb-facet-open${current && state.picks.packs.includes(current.key) ? ' has-pack' : ''}`, [
            current?.source ? sourceBadge(current.source, 20) : icon('list', 15),
            el('span', 'anomalous-tb-facet-open-label', `${title}：${current?.label || t('aiTbEverything')}`),
            el('span', 'anomalous-tb-facet-count', String(current?.count ?? beforeFacet.length)), icon('chevronDown', 14)],
        () => facetMenu(title, rows), t('aiTbPickSource'));
        open.setAttribute('aria-haspopup', 'listbox');
        side.replaceChildren(open);
    }

    let menu = null;
    /** The side panel's list of sources (or types) over the cards: a search when it is long; a pick or Esc closes it. */
    function facetMenu(title, rows) {
        if (menu?.isConnected) return void closeMenu();
        menu = el('div', 'anomalous-tb-facet-menu');
        menu.dataset.anomalousEscape = '1'; // Esc closes this list, not the browser
        const items = rows();
        const list = el('div', 'anomalous-tb-facet-menu-list');
        list.setAttribute('role', 'listbox');
        list.append(...items);
        if (items.length > 8) {
            const find = el('input', 'anomalous-tb-facet-menu-find');
            find.type = 'search';
            find.placeholder = t('aiTbFindSource', { what: title });
            find.addEventListener('input', () => {
                const words = find.value.trim().toLowerCase();
                for (const item of items) item.hidden = Boolean(words) && !item.title.toLowerCase().includes(words);
            });
            menu.append(find);
            requestAnimationFrame(() => find.focus());
        }
        menu.append(list);
        menu.addEventListener('click', (event) => { if (event.target.closest('.anomalous-tb-facet')) closeMenu(); });
        const top = side.offsetTop + side.offsetHeight;
        menu.style.top = `${top}px`;
        menu.style.maxHeight = `${Math.max(160, main.clientHeight - top - 8)}px`;
        main.append(menu);
        setTimeout(() => document.addEventListener('pointerdown', outside, true));
        document.addEventListener('keydown', escape);
    }

    function outside(event) {
        if (!menu?.contains(event.target) && !event.target.closest?.('.anomalous-tb-facet-open')) closeMenu();
    }

    // After the browser's own Esc handler has seen the list's mark (it then keeps the browser open).
    function escape(event) {
        if (event.key === 'Escape') setTimeout(closeMenu);
    }

    function closeMenu() {
        menu?.remove();
        menu = null;
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', escape);
    }

    /** While one custom node pack is shown: its name, how many node types, and picking it whole. */
    function drawPackBar() {
        const pack = state.kind === 'nodes' && state.facet ? byKey.get(keyOf('packs', state.facet)) : null;
        packBar.hidden = !pack;
        if (!pack) return;
        const on = state.picks.packs.includes(pack.id);
        const text = el('div', 'anomalous-tb-pack-text');
        text.append(el('div', 'anomalous-tb-pack-name', pack.source.label || pack.id), el('div', 'anomalous-tb-pack-count', t('aiTbPackCount', { count: pack.count })));
        packBar.replaceChildren(sourceBadge(pack.source, 26), text,
            button(`anomalous-tb-pack-pick${on ? ' is-on' : ''}`, [icon(on ? 'check' : 'plus', 15), t(on ? 'aiTbPackPicked' : 'aiTbPackPick')],
                () => setPick('packs', pack.id, !on), t('aiTbPackHint')));
    }

    let observer = null;
    function drawGrid() {
        closeMenu();
        observer?.disconnect();
        cards.clear();
        const { items, beforeFacet } = shown();
        drawFacets(beforeFacet);
        const facetLabel = state.facet ? (facets(beforeFacet, state.kind).find(facet => facet.key === state.facet)?.label || state.facet) : '';
        gridHead.replaceChildren(el('span', 'anomalous-tb-grid-title', facetLabel || t(`aiToolboxKind_${state.kind}`)),
            el('span', 'anomalous-tb-grid-count', t('aiTbCount', { count: items.length })));
        drawPackBar();
        if (state.kind !== 'nodes' && !state.catalog) {
            grid.replaceChildren(...Array.from({ length: 8 }, () => el('div', 'anomalous-tb-card is-skeleton')));
            if (state.error) grid.replaceChildren(el('div', 'anomalous-tb-note is-error', state.error));
            return;
        }
        if (!items.length) {
            grid.replaceChildren(el('div', 'anomalous-tb-note', state.filter === 'picked' ? t('aiToolboxNone') : t('aiToolboxEmptyList')));
            return;
        }
        grid.replaceChildren();
        let drawn = 0;
        const more = () => {
            const next = items.slice(drawn, drawn + CHUNK);
            drawn += next.length;
            grid.append(...next.map((item) => {
                const node = (body.classList.contains('is-side') ? rowCard : card)(item, ctx);
                cards.set(keyOf(item.kind, item.id), node);
                return node;
            }));
            if (drawn >= items.length) observer?.disconnect();
        };
        more();
        observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) more(); }, { root: scroller, rootMargin: '400px' });
        observer.observe(sentinel);
        scroller.scrollTop = 0;
    }

    function drawPane() {
        const side = body.classList.contains('is-side');
        pane.hidden = side && !state.focus; // beside the cards in the window; over them, while a card is open, in the side panel
        if (state.focus) {
            const back = button('anomalous-tb-pane-back', [icon('chevronLeft', 16), t('aiTbBack')], () => { state.focus = null; drawPane(); });
            pane.replaceChildren(...(side ? [back] : []), detail(state.focus, ctx));
            return;
        }
        const box = el('div', 'anomalous-tb-pane-empty');
        box.append(emptyPicture(), el('div', 'anomalous-tb-pane-title', total(state.picks) ? t('aiTbPaneCount', { count: total(state.picks) }) : t('aiTbPaneHello')),
            el('p', 'anomalous-tb-text is-soft', t('aiTbPaneTips')));
        pane.replaceChildren(box);
    }

    function chip(kind, id) {
        const item = byKey.get(keyOf(kind, id));
        const inner = kind === 'prompts' && /^(combo|workflow):/.test(id);
        const label = inner ? t('aiTbPromptOf', { name: id.replace(/^(combo|workflow):/, '') }) : item?.title || String(id).split(/[\\/:]/).pop();
        const node = el('span', `anomalous-tb-chip is-${kind}`);
        const url = item && ['combos', 'workflows', 'models'].includes(kind) ? coverUrl(item) : '';
        if (url) {
            const img = el('img');
            img.src = url;
            img.alt = '';
            img.loading = 'lazy';
            img.onerror = () => img.replaceWith(icon(kind, 14));
            node.append(img);
        } else if ((kind === 'nodes' || kind === 'packs') && item) {
            node.append(sourceBadge(item.source, 16));
        } else {
            node.append(icon(kind, 14));
        }
        node.append(el('span', 'anomalous-tb-chip-name', label));
        node.title = `${t(`aiToolboxKind_${kind}`)} · ${label}`;
        node.append(button('anomalous-tb-chip-x', [icon('close', 12)], () => setPick(kind, id, false), t('aiTbRemove')));
        return node;
    }

    function drawTray() {
        const chips = el('div', 'anomalous-tb-chips');
        for (const kind of PICK_KINDS) for (const id of state.picks[kind]) chips.append(chip(kind, id));
        if (!chips.children.length) chips.append(el('span', 'anomalous-tb-tray-empty', t('aiTbTrayEmpty')));
        const clear = button('anomalous-tb-clear', [icon('trash', 15)], () => {
            state.picks = empty();
            for (const [key, node] of cards) refreshCard(node, byKey.get(key), ctx);
            drawRail();
            drawFilters();
            drawTray();
            drawPane();
        }, t('aiTbClear'));
        clear.hidden = !total(state.picks);
        const modes = el('div', 'anomalous-tb-modes');
        modes.setAttribute('role', 'radiogroup');
        for (const mode of MODES) {
            const option = button(`anomalous-tb-mode${state.mode === mode ? ' is-on' : ''}`, [icon(mode === 'only' ? 'lock' : 'target', 16), t(`aiTbMode_${mode}`)], () => {
                state.mode = mode;
                drawTray();
            }, t(`aiTbModeHint_${mode}`));
            option.setAttribute('role', 'radio');
            option.setAttribute('aria-checked', String(state.mode === mode));
            modes.append(option);
        }
        const send = button('anomalous-tb-send', [icon('sparkle', 17), t('aiTbSend', { count: total(state.picks) })], async () => {
            send.disabled = true;
            try {
                await postJson(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}/toolbox`, { mode: state.mode, ...state.picks });
            } catch (error) {
                send.disabled = false;
                await anomalousAlert(error.message);
                return;
            }
            close();
            changed();
        });
        send.disabled = !total(state.picks) && !toolboxCount(task); // nothing picked, nothing to take back either
        tray.replaceChildren(chips, clear, modes, send);
    }

    function drawAll() {
        drawRail();
        drawFilters();
        drawGrid();
        drawPane();
    }

    let timer = null;
    search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            state.query = search.value.trim();
            state.facet = null;
            drawRail();
            drawGrid();
        }, SEARCH_DELAY_MS);
    });
    body.addEventListener('keydown', (event) => {
        if (event.key === '/' && event.target !== search) {
            event.preventDefault();
            search.focus();
        }
    });
    place(savedLayout());
    openNow = { task: task.id, body, close };
    drawAll();
    drawTray();
    search.focus();
    // The rest of the catalogue: what was kept is shown already; this brings it up to date.
    loadCatalog({ fresh: Boolean(state.catalog) }).then((items) => {
        state.catalog = items;
        index();
        drawRail();
        drawTray();
        if (state.kind !== 'nodes') drawGrid();
    }).catch((error) => {
        state.error = error.message;
        if (state.kind !== 'nodes' && !state.catalog) drawGrid();
    });
}

/** Where the side panel goes on the AI page: `host(body, expand)` puts it there and returns its close, or null. */
export function setToolboxHost(host) {
    sideHost = host;
}

/** Whether the picker is open for task `taskId` (shown or behind another view of the side column). */
export const toolboxOpenFor = taskId => Boolean(openNow?.body.isConnected && openNow.task === taskId);

/** Puts the picker away (the workbench moved to another task). */
export function closeToolbox() {
    openNow?.close();
    openNow = null;
}

/** How many materials task `task` has; reads the catalogue ahead for the picker. */
export function toolboxCount(task) {
    prefetchToolbox();
    return total(task.toolbox);
}

/** A pick on the timeline: what was handed over, how strictly, and whether the AI has it. */
export function toolboxStep(step) {
    const box = el('div', 'anomalous-tb-step');
    const picks = step.toolbox || {};
    if (!total(picks)) {
        box.append(el('div', 'anomalous-ai-user-text', t('aiToolboxCleared')));
    } else {
        const mode = el('div', `anomalous-tb-step-mode is-${picks.mode === 'only' ? 'only' : 'prefer'}`);
        mode.append(icon(picks.mode === 'only' ? 'lock' : 'target', 14), el('span', '', t(`aiToolboxStepMode_${picks.mode === 'only' ? 'only' : 'prefer'}`)));
        const chips = el('div', 'anomalous-tb-chips is-static');
        const nodes = picks.nodes?.length || picks.packs?.length ? pageNodes() : [];
        const known = new Map([...nodes, ...packItems(nodes), ...(keptCatalog() || [])].map(item => [keyOf(item.kind, item.id), item]));
        for (const kind of PICK_KINDS) {
            for (const id of picks[kind] || []) {
                const item = known.get(keyOf(kind, id));
                const node = el('span', `anomalous-tb-chip is-${kind}`);
                const url = item && kind !== 'prompts' ? coverUrl(item) : '';
                if (url) {
                    const img = el('img');
                    img.src = url;
                    img.alt = '';
                    img.loading = 'lazy';
                    img.onerror = () => img.replaceWith(icon(kind, 14));
                    node.append(img);
                } else {
                    node.append((kind === 'nodes' || kind === 'packs') && item ? sourceBadge(item.source, 16) : icon(kind === 'packs' ? 'nodes' : kind, 14));
                }
                const inner = kind === 'prompts' && /^(combo|workflow):/.test(id);
                node.append(el('span', 'anomalous-tb-chip-name', inner ? t('aiTbPromptOf', { name: id.replace(/^(combo|workflow):/, '') }) : item?.title || String(id).split(/[\\/:]/).pop()));
                chips.append(node);
            }
        }
        box.append(mode, chips);
    }
    box.append(deliveryState(step));
    return box;
}
