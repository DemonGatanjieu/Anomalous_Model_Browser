/**
 * "给 AI 的素材": the one picker for what the user hands the AI in a task (api/ai_toolbox.py),
 * opened by the message box's "+" (ui_ai_plus.js), the side column's switch or "/素材". A view of
 * the workbench's side column that leaves the timeline and the message box usable (the kinds as
 * tabs, a line per item, a card's detail over them), or, expanded, a large window: a search over
 * everything, the kinds on the left (models, ways, combos, workflows, prompts, node types), the
 * filters all / given / favourites / recent, a second column to narrow by source, type or job
 * (ui_ai_toolbox_sources.js), the base model chips and a model's versions on one card as the
 * Models page has them, a grid of cards (ui_ai_toolbox_cards.js) drawn as it scrolls, the card in
 * focus in full on the right. A press puts a thing on the message being written (a chip with its
 * note, ui_ai_mention.js) or takes it off; sent, it is on the task's picks. The row at the bottom
 * says what the task has, how strictly the AI keeps to it (applied at once) and how many things
 * are on the message. The picker keeps neither: it asks the message box's `refs` handle and the
 * task as the page has it, and redraws when either changes. What it showed last (kind, second
 * column, base model) and what was sent lately are kept on this browser (ai_toolbox_state.js).
 */

import { resolveLocale, translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { aiWindow } from './ui_ai_connect.js';
import { KINDS, PICK_KINDS, fetchUsableWays, keptCatalog, loadCatalog, prefetchToolbox, searchItems } from './ai_toolbox_data.js';
import {
    countRecent, emptyPicks, filterPickerItems, keepLayout, keyOf, pickOffered,
    readPickerState, readRecent, rememberBase, rememberFacet, rememberKind,
    resolveOpenKind, savedLayout, standingInWithFavorites, taskEffectivePicks, totalPicks,
} from './ai_toolbox_state.js';
import { card, detail, el, kindIcon, refreshCard, rowCard, tbButton as button } from './ui_ai_toolbox_cards.js';
import { facetOf, facets, packItems, pageNodes, renderBases, renderFacets, renderPackBar } from './ui_ai_toolbox_sources.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { emptyPicture } from './ui_ai_toolbox_icons.js';
import { baseFamily, countBases } from './model_bases.js';
import { groupByPage, pageId, versionId } from './model_versions.js';
import { chosenVersion } from './ui_model_versions.js';
import { taskTitle } from './ai_task_title.js';
import { createViewScope } from './ui_lifecycle.js';

const MODES = ['prefer', 'only'];
const CHUNK = 60;
const SEARCH_DELAY_MS = 120;
let openNow = null; // {task, body, close, switchKind, updateTask}
let sideHost = null; // (body, expand) => close, or null when the AI page is not shown

async function postJson(url, body) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}

const empty = () => emptyPicks(PICK_KINDS);
const total = box => totalPicks(box, PICK_KINDS);

/**
 * Opens or switches the single picker for `task`; `changed()` runs after a task pick update.
 * `options`: `{ kind: 'models' | 'ways' | 'other' | null, layout, messageBox, onShow }`.
 */
export async function openToolbox(task, changed = () => {}, options = {}) {
    if (openNow?.body.isConnected) {
        const same = openNow.task === task.id;
        if (same && options.kind) {
            openNow.switchKind(resolveOpenKind(options.kind), task, options.layout, options.messageBox);
            options.onShow?.();
            return;
        }
        openNow.close();
        openNow = null;
        if (same && !options.kind) return;
    }

    const scope = createViewScope();
    let currentTask = task;
    let messageBox = options.messageBox || null;
    const initialKind = resolveOpenKind(options.kind || null);
    if (options.kind) rememberKind(initialKind);
    const remembered = readPickerState();
    const state = {
        kind: initialKind, query: '', filter: 'all', focus: null,
        facet: remembered.facets[initialKind] ?? null,
        base: initialKind === 'models' ? remembered.base : null,
        versions: new Map(), favorites: empty(), nodes: pageNodes(), catalog: keptCatalog(), ways: null,
        error: '', waysError: '', notice: '', saving: false,
    };

    const byKey = new Map();
    const index = () => {
        byKey.clear();
        for (const item of [...state.nodes, ...packItems(state.nodes), ...(state.catalog || []), ...(state.ways || [])]) {
            byKey.set(keyOf(item.kind, item.id), item);
        }
    };
    index();

    const msg = () => messageBox?.refs || null;
    const picked = item => Boolean(msg()?.has(item.kind, item.id));
    const inPack = item => item.kind === 'nodes' && Boolean(msg()?.has('packs', item.source?.key));
    const liked = item => state.favorites[item.kind]?.includes(item.id) || false;
    const standingIn = () => standingInWithFavorites(currentTask, state.favorites, PICK_KINDS);
    const taskEffective = () => taskEffectivePicks(currentTask, state.favorites, PICK_KINDS);
    const given = item => Boolean(taskEffective()?.[item.kind]?.includes(item.id));
    const givenCount = () => total(taskEffective());
    const kindLoaded = kind => (kind === 'nodes' || kind === 'packs' ? true : kind === 'ways' ? state.ways !== null : state.catalog !== null);
    const favIdsFor = kind => (kind === 'nodes' ? [...(state.favorites.nodes || []), ...(state.favorites.packs || [])] : (state.favorites[kind] || []));

    const body = el('div', 'anomalous-tb');
    const forTask = el('div', 'anomalous-tb-for', t('aiTbFor', { task: taskTitle(currentTask) }));
    const top = el('div', 'anomalous-tb-top');
    const searchBox = el('label', 'anomalous-tb-search');
    const search = el('input');
    search.type = 'search';
    search.placeholder = t('aiTbSearch');
    searchBox.append(icon('search', 18), search, el('kbd', 'anomalous-tb-kbd', '/'));
    const filters = el('div', 'anomalous-tb-filters');
    top.append(forTask, searchBox, filters);
    const rail = el('nav', 'anomalous-tb-rail');
    const side = el('aside', 'anomalous-tb-facets');
    const gridWrap = el('div', 'anomalous-tb-grid-wrap');
    const gridHead = el('div', 'anomalous-tb-grid-head');
    const baseBar = el('div', 'anomalous-model-bases anomalous-tb-bases');
    const scroller = el('div', 'anomalous-tb-scroller');
    const grid = el('div', 'anomalous-tb-grid');
    const sentinel = el('div', 'anomalous-tb-sentinel');
    scroller.append(grid, sentinel);
    const packBar = el('div', 'anomalous-tb-pack');
    gridWrap.append(gridHead, baseBar, packBar, scroller);
    const pane = el('div', 'anomalous-tb-pane');
    const main = el('div', 'anomalous-tb-main');
    main.append(rail, side, gridWrap, pane);
    const tray = el('div', 'anomalous-tb-tray');
    body.append(top, main, tray);

    let closeFrame = () => {};
    let observer = null;
    let timer = null;
    scope.onDispose(() => {
        observer?.disconnect();
        clearTimeout(timer);
    });

    /** Shows the picker in the side column or as a large window, moving the same `body` (nothing is redrawn but
     * the pane and the bottom row). `keep`: the user chose this layout, so it is the one remembered. */
    function place(layout, keep = false) {
        const scrolled = scroller.scrollTop;
        body.remove();
        closeFrame();
        if (keep) keepLayout(layout);
        const docked = layout === 'side' ? sideHost?.(body, () => place('full', true)) : null; // no column to dock in: the window
        const changedLayout = body.classList.contains('is-side') !== Boolean(docked);
        body.classList.toggle('is-side', Boolean(docked));
        if (docked) {
            closeFrame = docked;
        } else {
            closeFrame = aiWindow(t('aiToolboxTitle'), body);
            const dialog = body.closest('.anomalous-ai-connect-dialog');
            dialog?.classList.add('is-toolbox');
            const shut = dialog?.querySelector('.anomalous-ai-connect-close');
            shut?.before(iconButton('anomalous-tb-dock-btn', 'panel', t('aiTbDock'), () => place('side', true), { iconOnly: true }));
        }
        if (changedLayout && grid.childElementCount) drawGrid();
        else scroller.scrollTop = scrolled;
        drawPane();
        drawTray();
    }

    const close = () => {
        scope.dispose();
        body.remove();
        closeFrame();
        if (openNow?.body === body) openNow = null;
    };

    const cards = new Map();
    const ctx = {
        picked, inPack, favorite: liked, given,
        get showTakeBack() { return state.filter === 'given'; },
        focus: (item) => { state.focus = item; drawPane(); },
        peek: (item) => { if (!body.classList.contains('is-side')) ctx.focus(item); },
        toggle: (item, focusNote = true) => toggleItem(item, focusNote),
        star: item => setFavorite(item),
        promptPicked: id => Boolean(msg()?.has('prompts', id)),
        pickPrompt: id => togglePrompt(id),
        takeBack: item => removeTaskItem(item),
        showVersion,
    };

    function refreshAllCards() {
        for (const [key, node] of cards) {
            const item = byKey.get(key);
            if (item) refreshCard(node, item, ctx);
        }
    }

    function toggleItem(item, allowFocusNote = true) {
        const handle = msg();
        if (!handle) return;
        state.notice = '';
        if (handle.has(item.kind, item.id)) {
            handle.remove(item.kind, item.id);
        } else if (!handle.add(item, { focusNote: allowFocusNote && body.classList.contains('is-side') })) {
            state.notice = t('aiTbMessageFull', { max: handle.count() + handle.room() });
            drawTray();
        }
    }

    function togglePrompt(id) {
        const item = byKey.get(keyOf('prompts', id));
        if (item) toggleItem(item, false);
    }

    function showVersion(item, version) {
        state.versions.set(pageId(item), versionId(version));
        version.versions = item.versions;
        const old = cards.get(keyOf('models', item.id));
        const drawn = (body.classList.contains('is-side') ? rowCard : card)(version, ctx);
        old?.replaceWith(drawn);
        cards.delete(keyOf('models', item.id));
        cards.set(keyOf('models', version.id), drawn);
        if (picked(item)) msg()?.swap('models', item.id, version);
        if (state.focus === item) ctx.focus(version);
    }

    async function saveTaskToolbox(next) {
        if (state.saving) return;
        state.saving = true;
        state.notice = '';
        drawTray();
        try {
            await postJson(`/anomalous/ai_tasks/${encodeURIComponent(currentTask.id)}/toolbox`, next);
            currentTask = { ...currentTask, toolbox: next };
            drawFilters();
            refreshAllCards();
            if (state.filter === 'given') drawGrid();
            drawPane();
            changed();
        } catch (error) {
            await anomalousAlert(error.message);
        } finally {
            state.saving = false;
            drawTray();
        }
    }

    async function removeTaskItem(item) {
        const box = taskEffective();
        if (!box) return;
        const next = { mode: box.mode || 'prefer', ...empty() };
        for (const kind of PICK_KINDS) {
            next[kind] = (box[kind] || []).filter(id => !(kind === item.kind && id === item.id));
        }
        await saveTaskToolbox(next);
    }

    async function setMode(mode) {
        const box = taskEffective();
        if (!total(box) || (box.mode || 'prefer') === mode) return;
        const next = { mode, ...empty() };
        for (const kind of PICK_KINDS) next[kind] = [...(box[kind] || [])];
        await saveTaskToolbox(next);
    }

    async function setFavorite(item) {
        const next = { ...state.favorites, [item.kind]: liked(item) ? state.favorites[item.kind].filter(id => id !== item.id) : [...state.favorites[item.kind], item.id] };
        try {
            state.favorites = { ...empty(), ...(await postJson('/anomalous/ai_toolbox/favorites', next)).favorites };
        } catch (error) {
            await anomalousAlert(error.message);
            return;
        }
        refreshAllCards();
        drawFilters();
        if (state.filter === 'liked' || (state.filter === 'given' && standingIn())) drawGrid(); // elsewhere it stays put: no jump to the top
        drawPane();
        drawTray();
    }

    const rawItemsOf = (kind, includePacks = false) => {
        if (kind === 'nodes') return includePacks ? [...state.nodes, ...packItems(state.nodes)] : state.nodes;
        if (kind === 'ways') return state.ways || [];
        return (state.catalog || []).filter(item => item.kind === kind);
    };

    const recentCount = () => countRecent(readRecent(), byKey, kindLoaded);

    /** The things of `kind` the search and the filter list, before the second column narrows them. */
    const listed = kind => filterPickerItems({
        kind, filter: state.filter, query: state.query, rawItems: rawItemsOf(kind, state.filter !== 'all'),
        recentEntries: readRecent(), byKey, favIds: favIdsFor(kind), given, liked, search: searchItems,
    });

    /** The cards of the kind shown, and what the second column and the base chips are on: the user's choice, or
     * everything where this list does not offer it (the choice itself stays for the lists that do). */
    function shown() {
        let items = listed(state.kind);
        const beforeFacet = items;
        const facet = pickOffered(state.facet, facets(beforeFacet, state.kind).map(each => each.key));
        if (facet) items = items.filter(item => facetOf(item)?.key === facet);
        if (state.kind !== 'models') return { items, beforeFacet, beforeBase: [], facet, base: null };
        const beforeBase = items;
        const base = pickOffered(state.base, countBases(items).map(([family]) => family));
        if (base !== null) items = items.filter(item => baseFamily(item) === base);
        // The versions of a model on one card, as the Models page has them: the one on the message, else the one last shown here or pinned there.
        const pickedVersions = new Map((msg()?.itemsOf('models') || []).map(ref => byKey.get(keyOf('models', ref.id))).filter(Boolean).map(item => [pageId(item), versionId(item)]));
        const folded = groupByPage(items, page => pickedVersions.get(page) || state.versions.get(page) || chosenVersion(page));
        return { items: folded.map(({ model, versions }) => Object.assign(model, { versions })), beforeFacet, beforeBase, facet, base };
    }

    function drawRail() {
        rail.replaceChildren(...KINDS.map((kind) => {
            const count = msg()?.countOf(kind) || 0; // on the message
            const matches = state.query || state.filter !== 'all' ? listed(kind).length : null; // what the search or the filter lists of it
            const node = button(`anomalous-tb-kind${state.kind === kind ? ' is-on' : ''}`, [icon(kindIcon(kind), 20), t(`aiToolboxKind_${kind}`)], () => {
                switchTo(kind);
            });
            const meta = el('span', 'anomalous-tb-kind-meta');
            if (matches !== null) meta.append(el('span', 'anomalous-tb-kind-matches', String(matches)));
            if (count) meta.append(el('span', 'anomalous-tb-count', String(count)));
            node.append(meta);
            return node;
        }));
    }

    function drawFilters() {
        const specs = [
            ['all', t('aiTbAll'), null, 'list'],
            ['given', t('aiTbGiven'), givenCount(), 'sparkle'],
            ['liked', t('aiTbLiked'), total(state.favorites), 'star'],
            ['recent', t('aiTbRecent'), recentCount(), 'clock'],
        ];
        filters.replaceChildren(...specs.map(([key, label, count, glyph]) => {
            const node = button(`anomalous-tb-filter${state.filter === key ? ' is-on' : ''}`, [icon(glyph, 14), label], () => {
                state.filter = key;
                drawAll();
            }, label);
            if (count) node.append(el('span', 'anomalous-tb-count', String(count)));
            return node;
        }));
    }

    let facetOn = null; // the second column's choice the grid shows now (shown)
    function drawPackBar() {
        const pack = state.kind === 'nodes' && facetOn ? byKey.get(keyOf('packs', facetOn)) : null;
        renderPackBar({ packBar, pack, on: Boolean(pack && msg()?.has('packs', pack.id)), onToggle: () => pack && toggleItem(pack, false) });
    }

    function drawGrid() {
        observer?.disconnect();
        cards.clear();
        const { items, beforeFacet, beforeBase, facet, base } = shown();
        facetOn = facet;
        renderFacets({
            side, main, isSide: body.classList.contains('is-side'), kind: state.kind, activeFacet: facet, beforeFacet,
            hasPack: key => Boolean(msg()?.has('packs', key)),
            onPick: (key) => { state.facet = key; rememberFacet(state.kind, key); drawGrid(); },
        });
        renderBases({ baseBar, models: beforeBase, active: base, onPick: (family) => { state.base = family; rememberBase(family); drawGrid(); } });
        const facetLabel = facet ? (facets(beforeFacet, state.kind).find(each => each.key === facet)?.label || facet) : '';
        gridHead.replaceChildren(el('span', 'anomalous-tb-grid-title', facetLabel || t(`aiToolboxKind_${state.kind}`)),
            el('span', 'anomalous-tb-grid-count', t('aiTbCount', { count: items.length })));
        drawPackBar();
        const loadError = state.kind === 'ways' ? state.waysError : state.kind !== 'nodes' ? state.error : '';
        if (!kindLoaded(state.kind)) {
            if (loadError) grid.replaceChildren(el('div', 'anomalous-tb-note is-error', loadError));
            else grid.replaceChildren(...Array.from({ length: 8 }, () => el('div', 'anomalous-tb-card is-skeleton')));
            return;
        }
        if (!items.length) {
            const emptyKey = state.query ? 'aiToolboxEmptyList' : state.filter === 'given' ? 'aiTbEmptyGiven' : state.filter === 'recent' ? 'aiTbEmptyRecent' : state.filter === 'liked' ? 'aiToolboxNone' : 'aiToolboxEmptyList';
            grid.replaceChildren(el('div', 'anomalous-tb-note', t(emptyKey)));
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
        const isSide = body.classList.contains('is-side');
        pane.hidden = isSide && !state.focus;
        if (state.focus) {
            const back = button('anomalous-tb-pane-back', [icon('chevronLeft', 16), t('aiTbBack')], () => { state.focus = null; drawPane(); });
            pane.replaceChildren(...(isSide ? [back] : []), detail(state.focus, ctx));
            return;
        }
        const box = el('div', 'anomalous-tb-pane-empty');
        const onMsg = msg()?.count() || 0;
        box.append(emptyPicture(), el('div', 'anomalous-tb-pane-title', onMsg ? t('aiTbOnMessage', { count: onMsg }) : t('aiTbPaneHello')),
            el('p', 'anomalous-tb-text is-soft', t('aiTbPaneTips')));
        pane.replaceChildren(box);
    }

    function drawTray() {
        const nodes = [];
        if (state.notice) nodes.push(el('div', 'anomalous-tb-full-note', state.notice));
        const row = el('div', 'anomalous-tb-bar');
        const status = el('div', 'anomalous-tb-status');
        const count = givenCount();
        // What the task has, listed: in the kind shown when it has some of it, else in the first kind that does.
        const showGiven = () => {
            state.filter = 'given';
            const kind = KINDS.find(each => rawItemsOf(each, true).some(given));
            if (kind && !rawItemsOf(state.kind, true).some(given)) switchTo(kind);
            else drawAll();
        };
        if (currentTask?.toolbox && count) status.append(button('anomalous-tb-status-btn', t('aiTbTaskHas', { count }), showGiven));
        else if (standingIn()) status.append(button('anomalous-tb-status-btn is-soft', t('aiTbFavStandIn', { count }), showGiven));
        status.append(el('span', 'anomalous-tb-msg-count', t('aiTbOnMessage', { count: msg()?.count() || 0 })));
        const activeMode = taskEffective()?.mode || 'prefer';
        const modes = el('div', 'anomalous-tb-modes');
        modes.setAttribute('role', 'radiogroup');
        for (const mode of MODES) {
            const option = button(`anomalous-tb-mode${activeMode === mode ? ' is-on' : ''}`, [icon(mode === 'only' ? 'lock' : 'target', 16), t(`aiTbMode_${mode}`)], () => void setMode(mode), t(`aiTbModeHint_${mode}`));
            option.setAttribute('role', 'radio');
            option.setAttribute('aria-checked', String(activeMode === mode));
            option.disabled = state.saving || !count;
            modes.append(option);
        }
        row.append(status, modes);
        if (!body.classList.contains('is-side')) row.append(button('anomalous-tb-done', t('aiTbDone'), close));
        nodes.push(row);
        tray.replaceChildren(...nodes);
    }

    function drawAll() {
        drawRail();
        drawFilters();
        drawGrid();
        drawPane();
        drawTray();
    }

    function switchTo(kind, nextTask = currentTask, nextLayout = null, nextBox = messageBox) {
        currentTask = nextTask;
        attachMessageBox(nextBox);
        rememberKind(kind);
        const mem = readPickerState();
        state.kind = kind;
        state.facet = mem.facets[kind] ?? null;
        state.base = kind === 'models' ? mem.base : null;
        state.focus = null;
        state.notice = '';
        if (nextLayout && (body.classList.contains('is-side') ? 'side' : 'full') !== nextLayout) place(nextLayout);
        else drawAll();
        search.focus();
    }

    let boxAbort = null;
    scope.onDispose(() => boxAbort?.abort());
    function attachMessageBox(nextBox) {
        if (nextBox === messageBox && boxAbort) return;
        boxAbort?.abort();
        boxAbort = null;
        messageBox = nextBox || null;
        if (!messageBox) return;
        boxAbort = new AbortController();
        messageBox.addEventListener('anomalous-refs', () => {
            if (msg()?.room() > 0) state.notice = '';
            refreshAllCards();
            drawRail();
            drawPackBar();
            drawTray();
            drawPane();
        }, { signal: boxAbort.signal });
    }
    attachMessageBox(messageBox);

    let lastTaskSnap = '';
    function updateTask(nextTask) {
        if (!nextTask) return;
        const snap = JSON.stringify([nextTask.toolbox || null, nextTask.title || '', Boolean(nextTask.ended)]);
        currentTask = nextTask;
        if (snap === lastTaskSnap) return;
        lastTaskSnap = snap;
        forTask.textContent = t('aiTbFor', { task: taskTitle(currentTask) });
        refreshAllCards();
        drawFilters();
        if (state.filter === 'given') drawGrid();
        drawPane();
        drawTray();
    }

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

    place(options.layout || savedLayout());
    openNow = { task: task.id, body, close, switchKind: switchTo, updateTask };
    drawAll();
    search.focus();

    fetch('/anomalous/ai_toolbox/favorites', { signal: scope.signal })
        .then(res => (res.ok ? res.json() : null))
        .then((data) => {
            if (!data || scope.signal.aborted) return;
            state.favorites = { ...empty(), ...data.favorites };
            refreshAllCards();
            drawFilters();
            if (state.filter === 'liked' || (state.filter === 'given' && standingIn()) || (state.filter === 'all' && !state.query)) drawGrid();
            drawPane();
            drawTray();
        }).catch(() => {});

    fetchUsableWays(resolveLocale(), { signal: scope.signal }).then((items) => {
        if (scope.signal.aborted) return;
        state.ways = items;
        index();
        drawRail();
        drawFilters();
        if (state.kind === 'ways') drawGrid();
    }).catch((error) => {
        if (error?.name === 'AbortError' || scope.signal.aborted) return;
        state.waysError = error.message;
        if (state.kind === 'ways') drawGrid();
    });

    loadCatalog({ fresh: Boolean(state.catalog) }).then((items) => {
        if (scope.signal.aborted) return;
        state.catalog = items;
        index();
        drawRail();
        drawFilters();
        if (state.kind !== 'nodes' && state.kind !== 'ways') drawGrid();
    }).catch((error) => {
        if (scope.signal.aborted) return;
        state.error = error.message;
        if (state.kind !== 'nodes' && state.kind !== 'ways' && !state.catalog) drawGrid();
    });
}

/** Where the side panel goes on the AI page: `host(body, expand)` puts it there and returns its close, or null. */
export function setToolboxHost(host) {
    sideHost = host;
}

/** Whether the picker is open for task `taskId` (shown or behind another view of the side column). */
export const toolboxOpenFor = taskId => Boolean(openNow?.body.isConnected && openNow.task === taskId);

/** The task as the page has it now, for the picker open on it: its picks changed when a message handed things over. */
export function syncToolboxTask(task) {
    if (toolboxOpenFor(task.id)) openNow.updateTask(task);
}

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
