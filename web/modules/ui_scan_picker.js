/**
 * The scan settings' model picker (GET /anomalous/scan_pickable): every model a scan reads, as
 * a list or as covers, each with how the last scan left it (the scan page's words: not scanned
 * yet, not found, damaged, found, set to "don't scan"), its folder, base model and size. The
 * folders on the left, the state chips, the search and "picked only" narrow what is shown;
 * "pick these" picks all of it, a click one model, a shift-click the run since the last click.
 * OK hands the picks to the settings page as items { type, path_idx, rel, filename, name, size };
 * Cancel, ✕, Esc and the backdrop leave them as they were. Long lists are drawn a screenful at
 * a time.
 */

import { translate as t } from './locales.js';
import { createViewScope } from './ui_lifecycle.js';
import { typeLabel } from './ui_model_types.js';
import { formatSize } from './ui_model_download.js';

const STATES = ['new', 'unmatched', 'damaged', 'matched', 'skip'];
const STATE_KEYS = {
    new: 'scanPageNew', unmatched: 'scanPageUnmatched', damaged: 'modelSourceDamagedShort',
    matched: 'scanPickFound', skip: 'modelSourceSkipped',
};
const STEP = 60; // rows drawn at a time
const VIEW_KEY = 'anomalous_scan_picker_view';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

function stored() {
    try {
        return localStorage.getItem(VIEW_KEY) === 'covers' ? 'covers' : 'list';
    } catch {
        return 'list';
    }
}

function store(view) {
    try {
        localStorage.setItem(VIEW_KEY, view);
    } catch { /* the view is only a convenience */ }
}

/** How the last scan left a model, from the metadata its card badge reads too. */
export function scanState(meta) {
    if (meta.scan_choice === 'skip') return 'skip';
    if (meta.info_source === 'civitai') return 'matched';
    if (meta.info_source === 'local') return meta.unmatched_reason === 'damaged' ? 'damaged' : 'unmatched';
    return 'new';
}

export const pickKey = item => `${item.type}|${item.path_idx}|${item.rel}`;

/** The picks' count and size, as the settings page and the picker's footer say them. */
export function picksLine(items) {
    if (!items.length) return t('scanPickNone');
    return t('scanPickSummary', { count: items.length, size: formatSize(items.reduce((sum, item) => sum + (item.size || 0), 0)) });
}

/**
 * The listed models as rows to show (their key, state, folder and what a search matches), in
 * folder order, and the models folders with their labels: the type, and where the folder is
 * when it is not named after it or the type has two.
 */
function readModels(data) {
    const perType = new Map();
    for (const root of data.roots || []) perType.set(root.type, (perType.get(root.type) || 0) + 1);
    const roots = new Map((data.roots || []).map((root) => {
        const where = perType.get(root.type) > 1 ? `${root.parent}/${root.name}` : root.name !== root.type ? root.name : '';
        const name = typeLabel({ type: root.type });
        return [`${root.type}|${root.path_idx}`, { ...root, name, label: name + (where ? ` · ${where}` : '') }];
    }).sort(([, a], [, b]) => a.name.localeCompare(b.name) || a.path_idx - b.path_idx));
    const order = new Map([...roots.keys()].map((key, index) => [key, index]));
    const models = (data.models || []).map((model) => {
        const meta = model.metadata || {};
        const cut = model.rel.lastIndexOf('/');
        const root = `${model.type}|${model.path_idx}`;
        const name = meta.custom_name || model.filename.replace(/\.safetensors$/i, '');
        return {
            ...model, meta, name, root, dir: cut < 0 ? '' : model.rel.slice(0, cut),
            key: pickKey(model), state: scanState(meta),
            base: meta.baseModel || (meta.base_guess ? `≈ ${meta.base_guess}` : ''),
            path: [roots.get(root)?.label || model.type, ...model.rel.split('/')].join(' / '),
            text: `${name}\n${model.rel}`.toLowerCase(),
        };
    }).sort((a, b) => order.get(a.root) - order.get(b.root) || a.rel.localeCompare(b.rel, undefined, { sensitivity: 'base' }));
    return { models, roots };
}

/** The item kept for a picked model (what the settings page lists and the scan needs). */
const asItem = model => ({
    type: model.type, path_idx: model.path_idx, rel: model.rel, filename: model.filename,
    name: model.name, size: model.size,
});

/** Opens the picker over the page with `picked` (items) picked; `onConfirm(items)` on OK. */
export function openScanPicker(picked, onConfirm) {
    const scope = createViewScope();
    const picks = new Map(picked.map(item => [pickKey(item), item]));
    const filter = { folder: '', state: '', query: '', onlyPicked: false };
    let view = stored();
    let all = [];
    let roots = new Map();
    let shown = [];
    let drawn = 0;
    let lastClicked = -1;

    const overlay = el('div', 'anomalous-pick-overlay');
    const dialog = el('div', 'anomalous-pick-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const close = () => scope.dispose();

    const head = el('div', 'anomalous-pick-head');
    const search = el('input', 'anomalous-pick-search');
    search.type = 'search';
    search.placeholder = t('scanPickSearch');
    const views = el('div', 'anomalous-pick-views');
    head.append(el('h2', 'anomalous-pick-title', t('scanPickTitle')), search, views, button('anomalous-pick-close', '✕', close));

    const folders = el('nav', 'anomalous-pick-folders');
    const chips = el('div', 'anomalous-pick-chips');
    const bar = el('div', 'anomalous-pick-bar');
    const list = el('div', 'anomalous-pick-list');
    const main = el('div', 'anomalous-pick-main');
    main.append(chips, bar, list);
    const body = el('div', 'anomalous-pick-body');
    body.append(folders, main);

    const summary = el('span', 'anomalous-pick-summary');
    const foot = el('div', 'anomalous-pick-foot');
    foot.append(summary, el('span', 'anomalous-pick-hint', t('scanPickRangeHint')),
        button('anomalous-scan-secondary anomalous-scan-small-btn', t('dialogCancel'), close),
        button('anomalous-scan-primary anomalous-scan-small-btn', t('dialogOk'), () => {
            onConfirm([...picks.values()]);
            close();
        }));
    dialog.append(head, body, foot);
    overlay.append(dialog);
    document.body.append(overlay);
    scope.onDispose(() => overlay.remove());
    scope.listen(overlay, 'mousedown', (event) => { if (event.target === overlay) close(); });
    scope.listen(window, 'keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation(); // the scan page behind stays open
        close();
    }, true);

    // More rows when the end of the list comes near.
    const more = el('div', 'anomalous-pick-more');
    const watcher = new IntersectionObserver((entries) => {
        if (entries.some(entry => entry.isIntersecting)) drawMore();
    }, { root: list, rootMargin: '300px' });
    scope.onDispose(() => watcher.disconnect());

    // A folder: '' all, "type|path_idx" a models folder, "type|path_idx|dir" a folder in it (subfolders too).
    const inFolder = (model, folder = filter.folder) => !folder || folder === model.root
        || (folder.startsWith(`${model.root}|`) && `${model.dir}/`.startsWith(`${folder.slice(model.root.length + 1)}/`));
    const matches = model => (!filter.query || model.text.includes(filter.query)) && (!filter.onlyPicked || picks.has(model.key));

    function paintSummary() {
        summary.textContent = picksLine([...picks.values()]);
    }

    function paintViews() {
        views.replaceChildren(...[['list', 'scanPickViewList'], ['covers', 'scanPickViewCovers']].map(([value, key]) => {
            const node = button(`anomalous-pick-view${view === value ? ' is-on' : ''}`, t(key), () => {
                view = value;
                store(view);
                paintViews();
                paintList();
            });
            node.setAttribute('aria-pressed', String(view === value));
            return node;
        }));
    }

    function paintFolders() {
        const rows = [['', t('scanPickAllFolders'), 0, all]];
        for (const [root, info] of roots) {
            const inRoot = all.filter(model => model.root === root);
            if (!inRoot.length) continue;
            rows.push([root, info.label, 0, inRoot]);
            const dirs = [...new Set(inRoot.flatMap(model => model.dir ? model.dir.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/')) : []))].sort();
            for (const dir of dirs) {
                const key = `${root}|${dir}`;
                rows.push([key, dir.split('/').pop(), dir.split('/').length, inRoot.filter(model => inFolder(model, key))]);
            }
        }
        folders.replaceChildren(...rows.map(([key, label, depth, models]) => {
            const row = button(`anomalous-pick-folder${key === filter.folder ? ' is-on' : ''}${depth ? '' : ' is-root'}`, undefined, () => {
                filter.folder = key;
                lastClicked = -1;
                paintFolders();
                paintChips();
                paintList();
            });
            row.style.paddingLeft = `${10 + depth * 14}px`;
            const count = models.filter(model => picks.has(model.key)).length;
            row.append(el('span', 'anomalous-pick-folder-name', label), el('span', 'anomalous-pick-folder-count', String(models.length)));
            if (count) row.append(el('span', 'anomalous-pick-folder-picked', String(count)));
            row.title = label;
            return row;
        }));
    }

    function paintChips() {
        const here = all.filter(model => inFolder(model) && matches(model));
        const counts = Object.fromEntries(STATES.map(state => [state, here.filter(model => model.state === state).length]));
        const chip = (state, label, count) => {
            const node = button(`anomalous-pick-chip${filter.state === state ? ' is-on' : ''}${state ? ` is-${state}` : ''}`, undefined, () => {
                filter.state = state;
                lastClicked = -1;
                paintChips();
                paintList();
            });
            node.append(el('span', '', label), el('strong', '', String(count)));
            node.setAttribute('aria-pressed', String(filter.state === state));
            return node;
        };
        chips.replaceChildren(chip('', t('scanPickStateAll'), here.length),
            ...STATES.filter(state => counts[state] || filter.state === state).map(state => chip(state, t(STATE_KEYS[state]), counts[state])));
    }

    function paintBar() {
        const fresh = shown.filter(model => !picks.has(model.key)).length;
        const pick = button('anomalous-scan-secondary anomalous-scan-small-btn', t('scanPickShown', { count: shown.length }), () => {
            for (const model of shown) picks.set(model.key, asItem(model));
            refresh();
        });
        pick.disabled = !fresh;
        const unpick = button('anomalous-scan-secondary anomalous-scan-small-btn', t('scanPickUnpickShown'), () => {
            for (const model of shown) picks.delete(model.key);
            refresh();
        });
        unpick.disabled = fresh === shown.length;
        const only = el('label', 'anomalous-pick-only');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = filter.onlyPicked;
        box.onchange = () => {
            filter.onlyPicked = box.checked;
            refresh();
        };
        only.append(box, el('span', '', t('scanPickOnlyPicked')));
        const clear = button('anomalous-pick-link', t('scanPickClear'), () => {
            picks.clear();
            refresh();
        });
        clear.disabled = !picks.size;
        bar.replaceChildren(pick, unpick, only, clear);
    }

    function paintList() {
        shown = all.filter(model => inFolder(model) && matches(model) && (!filter.state || model.state === filter.state));
        drawn = 0;
        list.className = `anomalous-pick-list is-${view}`;
        list.replaceChildren();
        if (!shown.length) list.append(el('p', 'anomalous-pick-empty', t('scanPickEmpty')));
        drawMore();
        paintBar();
    }

    function drawMore() {
        if (drawn >= shown.length) return;
        more.remove();
        const end = Math.min(shown.length, drawn + STEP);
        for (let index = drawn; index < end; index += 1) list.append(row(shown[index], index));
        drawn = end;
        if (drawn < shown.length) {
            list.append(more);
            watcher.observe(more);
        }
    }

    /** One model: a click picks or unpicks it, a shift-click the models since the last click as well. */
    function row(model, index) {
        const node = button(`anomalous-pick-row${picks.has(model.key) ? ' is-picked' : ''}`, undefined, (event) => {
            const pick = !picks.has(model.key);
            const from = event.shiftKey && lastClicked >= 0 ? Math.min(lastClicked, index) : index;
            const to = event.shiftKey && lastClicked >= 0 ? Math.max(lastClicked, index) : index;
            for (const each of shown.slice(from, to + 1)) {
                if (pick) picks.set(each.key, asItem(each));
                else picks.delete(each.key);
            }
            lastClicked = index;
            if (filter.onlyPicked && !pick) refresh();
            else {
                for (const each of list.querySelectorAll('.anomalous-pick-row')) each.classList.toggle('is-picked', picks.has(each.dataset.key));
                paintFolders();
                paintBar();
                paintSummary();
            }
        });
        node.dataset.key = model.key;
        node.setAttribute('role', 'checkbox');
        node.setAttribute('aria-checked', String(picks.has(model.key)));
        const cover = el('span', 'anomalous-pick-cover');
        if (model.preview_url) {
            const img = el('img');
            img.loading = 'lazy';
            img.alt = '';
            img.src = `${model.preview_url}&variant=${/\.(mp4|webm|mov)(?:&|$)/i.test(model.preview_url) ? 'poster' : 'card'}`;
            img.onerror = () => img.remove();
            cover.append(img);
        }
        const names = el('span', 'anomalous-pick-names');
        names.append(el('strong', 'anomalous-pick-name', model.name), el('small', 'anomalous-pick-path', model.path));
        const facts = el('span', 'anomalous-pick-facts');
        facts.append(el('span', `anomalous-pick-state is-${model.state}`, t(STATE_KEYS[model.state])));
        facts.append(el('span', 'anomalous-pick-base', model.base));
        facts.append(el('span', 'anomalous-pick-size', formatSize(model.size)));
        node.append(el('span', 'anomalous-pick-check', '✓'), cover, names, facts);
        node.title = model.state === 'skip' ? `${model.rel}\n${t('modelSourceSkippedHint')}` : model.rel;
        return node;
    }

    function refresh() {
        paintFolders();
        paintChips();
        paintList();
        paintSummary();
    }

    scope.listen(search, 'input', (event) => {
        if (event.isComposing) return;
        filter.query = search.value.trim().toLowerCase();
        lastClicked = -1;
        refresh();
    });
    scope.listen(search, 'compositionend', () => search.dispatchEvent(new Event('input')));

    paintViews();
    paintSummary();
    list.append(el('p', 'anomalous-pick-empty', t('scanPickLoading')));
    (async () => {
        try {
            const res = await fetch('/anomalous/scan_pickable', { signal: scope.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (scope.signal.aborted) return;
            ({ models: all, roots } = readModels(data));
            if (data.total > all.length) main.insertBefore(el('p', 'anomalous-pick-note', t('scanPickTruncated', { shown: all.length, total: data.total })), list);
            refresh();
            search.focus();
        } catch (error) {
            if (scope.signal.aborted) return;
            list.replaceChildren(el('p', 'anomalous-pick-empty', t('scanPickFailed', { error: String(error.message || error) })));
        }
    })();
}
