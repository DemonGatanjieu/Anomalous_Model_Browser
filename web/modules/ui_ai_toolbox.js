/**
 * "给 AI 的素材": the one picker for what the user hands the AI in a task (api/ai_toolbox.py),
 * opened by the message box's "+" (ui_ai_plus.js), the side column's switch or "/素材". A view of
 * the workbench's side column that leaves the timeline and the message box usable (the kinds as
 * tabs, a line per item, a card's detail over them), or, expanded, a large window: a search over
 * everything, the kinds on the left (models, ways, combos, workflows, prompts, node types), the
 * filters all / given / favourites / recent, a second column to narrow by source, type or job
 * (ui_ai_toolbox_sources.js), the base model chips and a model's versions on one card as the
 * Models page has them, a grid of cards (ui_ai_toolbox_cards.js) drawn as it scrolls, the card pressed in
 * full on the right. A card's circle or the detail's button (or a note there) puts it on the message (a chip,
 * ui_ai_mention.js) or takes it off; sent, it is on the task's picks; Done asks about ticked paragraphs of
 * a model not on it (ui_ai_model_lock.js). The bottom row: what the task has, how strictly the AI keeps to it,
 * how many things are on the message. The picker keeps neither: it asks the message box's `refs` handle
 * and the task as the page has it. What it showed last and what was sent lately: ai_toolbox_state.js.
 */

import { resolveLocale, translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { aiWindow } from './ui_ai_connect.js';
import { KINDS, PICK_KINDS, keptCatalog, loadPickerSources, prefetchToolbox, searchItems } from './ai_toolbox_data.js';
import {
    countRecent, emptyPicks, filterPickerItems, keepLayout, keyOf, pickOffered,
    readPickerState, readRecent, rememberBase, rememberFacet, rememberKind,
    resolveOpenKind, savedLayout, standingInWithFavorites, taskEffectivePicks, totalPicks,
} from './ai_toolbox_state.js';
import { card, detail, el, refreshCard, renderPickedBar, rowCard, syncNoteInputs, tbButton as button } from './ui_ai_toolbox_cards.js';
import { facetOf, facets, packItems, pageNodes, renderBases, renderFacets, renderFilterTabs, renderKindRail, renderPackBar, renderSubhead } from './ui_ai_toolbox_sources.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { emptyPicture } from './ui_ai_toolbox_icons.js';
import { baseFamily, countBases } from './model_bases.js';
import { groupByPage, pageId, versionId } from './model_versions.js';
import { chosenVersion } from './ui_model_versions.js';
import { taskTitle } from './ai_task_title.js';
import { createViewScope } from './ui_lifecycle.js';
import { openListedModel } from './ui_scan_lists.js';
import { remindUnpicked } from './ui_ai_model_lock.js';

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
        error: '', waysError: '', notice: '', saving: false, ticked: new Map(), // ticked: models whose paragraphs were ticked here
    };

    const byKey = new Map();
    const index = () => {
        byKey.clear();
        for (const item of [...state.nodes, ...packItems(state.nodes), ...(state.catalog || []), ...(state.ways || [])]) {
            byKey.set(keyOf(item.kind, item.id), item);
        }
    };
    index();
    if (options.focus) state.focus = byKey.get(keyOf('models', options.focus)) || null; // back from that model's page

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
    const subhead = el('div', 'anomalous-tb-subhead');
    const gridHead = el('div', 'anomalous-tb-grid-head');
    const baseBar = el('div', 'anomalous-model-bases anomalous-tb-bases');
    subhead.append(gridHead, baseBar);
    const scroller = el('div', 'anomalous-tb-scroller');
    const grid = el('div', 'anomalous-tb-grid');
    const sentinel = el('div', 'anomalous-tb-sentinel');
    scroller.append(grid, sentinel);
    const packBar = el('div', 'anomalous-tb-pack');
    gridWrap.append(subhead, packBar, scroller);
    const pane = el('div', 'anomalous-tb-pane');
    const main = el('div', 'anomalous-tb-main');
    main.append(rail, side, gridWrap, pane);
    const pickedRow = el('div', 'anomalous-tb-picked');
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
        forTask.remove();
        searchBox.remove();
        rail.remove();
        body.remove();
        closeFrame();
        if (keep) keepLayout(layout);
        const docked = layout === 'side' ? sideHost?.(body, () => place('full', true)) : null; // no column to dock in: the window
        const changedLayout = body.classList.contains('is-side') !== Boolean(docked);
        body.classList.toggle('is-side', Boolean(docked));
        if (docked) {
            top.replaceChildren(forTask, searchBox, filters);
            main.replaceChildren(rail, side, gridWrap, pane);
            closeFrame = docked;
        } else {
            top.replaceChildren(rail, filters);
            main.replaceChildren(side, gridWrap, pane);
            closeFrame = aiWindow(t('aiToolboxTitle'), body);
            const dialog = body.closest('.anomalous-ai-connect-dialog');
            dialog?.classList.add('is-toolbox');
            const shut = dialog?.querySelector('.anomalous-ai-connect-close');
            shut?.before(forTask, searchBox, iconButton('anomalous-tb-dock-btn', 'panel', t('aiTbDock'), () => place('side', true), { iconOnly: true }));
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
        privateTask: () => Boolean(currentTask?.private), task: () => currentTask,
        noteOf: item => msg()?.noteOf?.(item.kind, item.id) || '',
        setNote: (item, text) => { if (!picked(item)) toggleItem(item, false); msg()?.setNote?.(item.kind, item.id, text); syncNoteInputs(body, item, text); drawPickedRow(); },
        focus: (item) => { state.focus = item; drawPane(); },
        select: (item) => { state.focus = item; for (const [key, node] of cards) node.classList.toggle('is-focus', key === keyOf(item.kind, item.id)); drawPane(); },
        isFocus: item => state.focus?.kind === item.kind && state.focus?.id === item.id, ticked: item => state.ticked.set(item.id, item), side: () => body.classList.contains('is-side'),
        toggle: (item, focusNote = true, focusPaneNote = false) => toggleItem(item, focusNote, focusPaneNote),
        star: item => setFavorite(item),
        promptPicked: id => Boolean(msg()?.has('prompts', id)),
        pickPrompt: id => togglePrompt(id),
        takeBack: item => removeTaskItem(item),
        focusPicked: (ref) => {
            const found = ref.item || byKey.get(keyOf(ref.kind, ref.id));
            if (!found) return;
            state.focus = found;
            drawPane(true);
        },
        removePicked: ref => msg()?.remove?.(ref.kind, ref.id),
        showVersion,
        openModel: options.owner ? item => openModelPage(item) : null,
    };

    /** The model's own page in the browser (details, pictures, versions); its Back reopens the picker on it. */
    function openModelPage(item) {
        const [, type, pathIdx, rel] = /^([\w-]+):(\d+):(.+)$/.exec(String(item.id)) || [];
        if (!rel) return;
        const again = { ...options, kind: state.kind, focus: item.id, layout: body.classList.contains('is-side') ? 'side' : 'full' };
        close();
        void openListedModel(options.owner, { type, path_idx: Number(pathIdx), rel, filename: item.file },
            () => { options.owner.goTo('ai'); void openToolbox(currentTask, changed, { ...again, messageBox: options.messageBoxOf?.() || messageBox }); });
    }

    function refreshAllCards() {
        for (const [key, node] of cards) {
            const item = byKey.get(key);
            if (item) refreshCard(node, item, ctx);
        }
    }

    function toggleItem(item, allowFocusNote = true, focusPaneNote = false) {
        const handle = msg();
        if (!handle) return;
        state.notice = '';
        if (handle.has(item.kind, item.id)) {
            handle.remove(item.kind, item.id);
        } else {
            if (!body.classList.contains('is-side')) ctx.select(item);
            if (!handle.add(item, { focusNote: allowFocusNote && body.classList.contains('is-side') })) {
                state.notice = t('aiTbMessageFull', { max: handle.count() + handle.room() });
                drawTray();
            } else if (focusPaneNote && !body.classList.contains('is-side')) {
                drawPane(true);
            }
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
        if (state.kind !== 'models') return { items, matchedFiles: items.length, beforeFacet, beforeBase: [], facet, base: null };
        const beforeBase = items;
        const base = pickOffered(state.base, countBases(items).map(([family]) => family));
        if (base !== null) items = items.filter(item => baseFamily(item) === base);
        const matchedFiles = items.length;
        // The versions of a model on one card, as the Models page has them: the one on the message, else the one last shown here or pinned there.
        const pickedVersions = new Map((msg()?.itemsOf('models') || []).map(ref => byKey.get(keyOf('models', ref.id))).filter(Boolean).map(item => [pageId(item), versionId(item)]));
        const folded = groupByPage(items, page => pickedVersions.get(page) || state.versions.get(page) || chosenVersion(page));
        return { items: folded.map(({ model, versions }) => Object.assign(model, { versions })), matchedFiles, beforeFacet, beforeBase, facet, base };
    }

    function drawRail() {
        const showMatches = Boolean(state.query || state.filter !== 'all');
        renderKindRail({
            rail, kinds: KINDS, activeKind: state.kind,
            countOf: kind => msg()?.countOf(kind) || 0,
            matchCountOf: kind => (showMatches ? listed(kind).length : null),
            onSwitch: switchTo,
        });
    }

    function drawFilters() {
        renderFilterTabs({
            filters, activeFilter: state.filter,
            counts: { given: givenCount(), liked: total(state.favorites), recent: recentCount() },
            onPick: (key) => { state.filter = key; drawAll(); },
        });
    }

    let facetOn = null; // the second column's choice the grid shows now (shown)
    function drawPackBar() {
        const pack = state.kind === 'nodes' && facetOn ? byKey.get(keyOf('packs', facetOn)) : null;
        renderPackBar({ packBar, pack, on: Boolean(pack && msg()?.has('packs', pack.id)), onToggle: () => pack && toggleItem(pack, false) });
    }

    function drawGrid() {
        observer?.disconnect();
        cards.clear();
        const { items, matchedFiles, beforeFacet, beforeBase, facet, base } = shown();
        facetOn = facet;
        renderFacets({
            side, main, isSide: body.classList.contains('is-side'), kind: state.kind, activeFacet: facet, beforeFacet,
            hasPack: key => Boolean(msg()?.has('packs', key)),
            onPick: (key) => { state.facet = key; rememberFacet(state.kind, key); drawGrid(); },
        });
        renderBases({ baseBar, models: beforeBase, active: base, onPick: (family) => { state.base = family; rememberBase(family); drawGrid(); } });
        const facetLabel = facet ? (facets(beforeFacet, state.kind).find(each => each.key === facet)?.label || facet) : '';
        const countText = state.kind === 'models' && matchedFiles > items.length
            ? t('aiTbCountFolded', { cards: items.length, files: matchedFiles }) : t('aiTbCount', { count: items.length });
        renderSubhead({ gridHead, baseBar, isSide: body.classList.contains('is-side'), kind: state.kind, facetLabel, countText });
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

    function drawPane(focusNote = false) {
        const isSide = body.classList.contains('is-side');
        pane.hidden = isSide && !state.focus;
        if (state.focus) {
            const activeNote = pane.contains(document.activeElement) && document.activeElement.matches?.('.anomalous-tb-note-input');
            if (activeNote && document.activeElement.dataset.refKey === keyOf(state.focus.kind, state.focus.id)) return;
            const back = button('anomalous-tb-pane-back', [icon('chevronLeft', 16), t('aiTbBack')], () => { state.focus = null; drawPane(); });
            pane.replaceChildren(...(isSide ? [back] : []), detail(state.focus, ctx));
            if (focusNote) pane.querySelector('.anomalous-tb-note-input')?.focus();
            return;
        }
        const box = el('div', 'anomalous-tb-pane-empty');
        const onMsg = msg()?.count() || 0;
        box.append(emptyPicture(), el('div', 'anomalous-tb-pane-title', onMsg ? t('aiTbOnMessage', { count: onMsg }) : t('aiTbPaneHello')),
            el('p', 'anomalous-tb-text is-soft', t('aiTbPaneTips')));
        pane.replaceChildren(box);
    }

    const drawPickedRow = () => renderPickedBar(pickedRow, body.classList.contains('is-side') ? [] : (msg()?.items?.() || []), ctx);

    function drawTray() {
        const nodes = [];
        if (state.notice) nodes.push(el('div', 'anomalous-tb-full-note', state.notice));
        drawPickedRow();
        if (!pickedRow.hidden) nodes.push(pickedRow);
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
            const option = button(`anomalous-tb-mode${activeMode === mode ? ' is-on' : ''}`, [icon(mode === 'only' ? 'filter' : 'target', 16), t(`aiTbMode_${mode}`)], () => void setMode(mode), t(`aiTbModeHint_${mode}`));
            option.setAttribute('role', 'radio');
            option.setAttribute('aria-checked', String(activeMode === mode));
            option.disabled = state.saving || !count;
            modes.append(option);
        }
        row.append(status, modes);
        if (!body.classList.contains('is-side')) row.append(button('anomalous-tb-done', t('aiTbDone'), async () => { if (await remindUnpicked(state.ticked, picked, item => toggleItem(item, false))) close(); }));
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
        messageBox.addEventListener('anomalous-ref-note', () => {
            drawPickedRow();
            const active = pane.querySelector('.anomalous-tb-note-input');
            if (active && active !== document.activeElement) active.value = msg()?.noteOf?.(state.focus?.kind, state.focus?.id) || '';
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

    loadPickerSources({
        locale: resolveLocale(), signal: scope.signal, freshCatalog: Boolean(state.catalog),
        onFavorites: (favorites) => {
            state.favorites = { ...empty(), ...favorites };
            refreshAllCards();
            drawFilters();
            if (state.filter === 'liked' || (state.filter === 'given' && standingIn()) || (state.filter === 'all' && !state.query)) drawGrid();
            drawPane();
            drawTray();
        },
        onWays: (items, error) => {
            if (items) { state.ways = items; index(); drawRail(); drawFilters(); } else state.waysError = error;
            if (state.kind === 'ways') drawGrid();
        },
        onCatalog: (items, error) => {
            if (items) { state.catalog = items; index(); drawRail(); drawFilters(); } else state.error = error;
            if (state.kind !== 'nodes' && state.kind !== 'ways' && (items || !state.catalog)) drawGrid();
            if (options.focus && !state.focus && byKey.has(keyOf('models', options.focus))) ctx.focus(byKey.get(keyOf('models', options.focus)));
        },
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
