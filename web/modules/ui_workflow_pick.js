/**
 * The saved-workflow pickers, reused wherever a saved workflow is chosen (as ui_ai_model_pick.js is for models).
 * The card grid (workflowCardGrid): the Workflows page's card face (`createRecipeCardFace`, `28-workflows.css`)
 * with its readiness dot and settings, its search (`recipeMatchesFilter`), and chips for what the page's filter
 * menu offers (complete or a module, the user's tags) and, where presets count, the ones that have some; it is
 * embedded in "Run my preset". The same grid as a window (openWorkflowPicker: "Done", or a double click, takes
 * the one picked). The chosen one as a card, its cover, name and settings, whose press opens that window
 * (workflowChoice: "Start from → A saved workflow", ui_picked_card.js). Covers and settings come from GET /anomalous/recipes, kept a minute.
 */

import { translate as t } from './locales.js';
import { aiWindow } from './ui_ai_connect.js';
import { icon } from './ui_ai_icons.js';
import { createRecipeCardFace, recipeCoverUrl, recipeMetaLine } from './ui_recipe_cards.js';
import { recipeMatchesFilter } from './ui_recipe_catalog.js';
import { appendRecipeCover } from './ui_recipe_media.js';
import { pickedCard } from './ui_picked_card.js';

const KEEP_MS = 60 * 1000;
let kept = null; // {at, recipes: Map(file → recipe)}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, children, onClick) {
    const node = el('button', className);
    node.type = 'button';
    node.append(...[].concat(children).map(child => (typeof child === 'string' ? el('span', '', child) : child)));
    node.onclick = onClick;
    return node;
}

/** The saved workflows as the Workflows page reads them: Map(file → recipe), kept a minute. */
export async function readRecipes(signal) {
    if (kept && Date.now() - kept.at < KEEP_MS) return kept.recipes;
    const payload = await fetch('/anomalous/recipes', { cache: 'no-store', signal }).then(res => (res.ok ? res.json() : null));
    const recipes = new Map((payload?.recipes || []).filter(item => item?.filename).map(item => [item.filename, item]));
    kept = { at: Date.now(), recipes };
    return recipes;
}

const fallbackRecipe = wf => ({ filename: wf.file, data: { name: wf.name, params: {} } });
const kindOf = recipe => recipe.data?.workflow_scope || 'complete';

function matches(wf, recipe, { query, kind, tag, withPresets }) {
    if (withPresets && !wf.presets?.length) return false;
    const data = recipe.data || {};
    if (recipeMatchesFilter(data, query, tag ? [tag] : null, kind || 'all')) return true;
    if (!query.trim() || (kind && kindOf(recipe) !== kind) || (tag && !(data.tags || []).includes(tag))) return false;
    const base = data.params?.baseModel || data.params?.baseModels || '';
    const text = `${wf.name || ''} ${wf.file || ''} ${base}`.toLowerCase();
    return query.trim().toLowerCase().split(/\s+/).every(term => text.includes(term));
}

function chip(label, count, on, onClick) {
    const node = button('anomalous-model-base-chip', [label, el('span', 'anomalous-model-type-count', count)], onClick);
    node.setAttribute('aria-pressed', String(on));
    return node;
}

/**
 * Builds `{ node, setSelected(file), stop(), focus() }`. `workflows`: `[{ name, file, presets }]`; `selected`:
 * the `file` picked at first; `showPresets`: each card says how many presets it has, and a chip lists those with
 * some; `search: false` leaves out its search (a window searching itself, ui_ai_prompt_fetch.js); `onPick(workflow)`
 * on a press, `onConfirm(workflow)` on a double click or Enter.
 */
export function workflowCardGrid({ workflows = [], selected = '', showPresets = false, search: withSearch = true, onPick, onConfirm } = {}) {
    const abort = new AbortController();
    let current = selected || workflows[0]?.file || '';
    const filter = { query: '', kind: null, tag: null, withPresets: false };
    const byFile = new Map(workflows.map(item => [item.file, fallbackRecipe(item)]));

    const root = el('div', 'anomalous-wf-pick');
    const searchRow = el('div', 'anomalous-ai-pick-search');
    const search = el('input', 'anomalous-ai-start-input');
    search.type = 'search';
    search.placeholder = t('aiPresetSearch');
    search.setAttribute('aria-label', t('aiPresetSearch'));
    const count = el('span', 'anomalous-wf-count');
    searchRow.append(icon('search', 14), search, count);
    searchRow.hidden = !withSearch || workflows.length <= 1;
    const chips = el('div', 'anomalous-model-bases anomalous-wf-pick-chips');
    chips.setAttribute('role', 'toolbar');
    chips.setAttribute('aria-label', t('workflowsFilter'));

    const grid = el('div', 'anomalous-wf-list is-grid anomalous-wf-pick-grid');
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', t('aiStartWorkflow'));
    root.append(searchRow, chips, grid);

    const cards = new Map();

    const syncMarks = (scrollIntoView = false) => {
        for (const [file, card] of cards) {
            const on = file === current;
            card.classList.toggle('is-on', on);
            card.setAttribute('aria-selected', String(on));
            if (on && scrollIntoView) card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    };

    const pick = (wf, confirm = false) => {
        if (!wf) return;
        current = wf.file;
        syncMarks(false);
        onPick?.(wf);
        if (confirm) onConfirm?.(wf);
    };

    /** The chips: complete or a module (when both are saved), the tags, the ones with presets; each again turns it off. */
    function drawChips() {
        const recipes = workflows.map(wf => byFile.get(wf.file));
        const kinds = ['complete', 'partial'].map(kind => [kind, recipes.filter(recipe => kindOf(recipe) === kind).length]);
        const tags = new Map();
        for (const recipe of recipes) for (const tag of recipe.data?.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1);
        const withPresets = workflows.filter(wf => wf.presets?.length).length;
        const nodes = [];
        const toggle = (key, value) => () => {
            filter[key] = filter[key] === value ? (key === 'withPresets' ? false : null) : value;
            drawChips();
            draw();
        };
        if (kinds.every(([, number]) => number)) nodes.push(...kinds.map(([kind, number]) => chip(t(`recipeScopePill_${kind}`), number, filter.kind === kind, toggle('kind', kind))));
        nodes.push(...[...tags].sort((a, b) => a[0].localeCompare(b[0])).map(([tag, number]) => chip(`#${tag}`, number, filter.tag === tag, toggle('tag', tag))));
        if (showPresets && withPresets && withPresets < workflows.length) nodes.push(chip(t('aiWfWithPresets'), withPresets, filter.withPresets, toggle('withPresets', true)));
        chips.hidden = !nodes.length;
        chips.replaceChildren(...nodes);
    }

    function draw() {
        const keepTop = grid.scrollTop;
        const shown = workflows.filter(wf => matches(wf, byFile.get(wf.file), filter));
        count.textContent = workflows.length ? `${shown.length}/${workflows.length}` : '';
        cards.clear();
        if (!shown.length) {
            grid.replaceChildren(el('div', 'anomalous-ai-pics-none', t('recipeNoMatches')));
            return;
        }
        const nodes = shown.map((wf) => {
            const recipe = byFile.get(wf.file);
            const badge = el('span', 'anomalous-wf-pick-check');
            badge.append(icon('check', 12));
            const presetChip = showPresets
                ? el('span', wf.presets?.length ? 'anomalous-recipe-set-chip' : 'anomalous-wf-pick-plain',
                    wf.presets?.length ? t('aiPresetCardCount', { count: wf.presets.length }) : t('aiPresetCardOwnOnly'))
                : null;
            const { card } = createRecipeCardFace(recipe, { coverExtra: badge, infoExtra: presetChip });
            card.classList.add('anomalous-wf-pick-card');
            card.dataset.file = wf.file;
            card.tabIndex = 0;
            card.setAttribute('role', 'option');
            card.onclick = () => pick(wf);
            card.ondblclick = () => pick(wf, true);
            card.onkeydown = (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                pick(wf, event.key === 'Enter');
            };
            cards.set(wf.file, card);
            return card;
        });
        grid.replaceChildren(...nodes);
        syncMarks(false);
        grid.scrollTop = keepTop;
    }

    search.addEventListener('keydown', (event) => { if (event.key !== 'Escape') event.stopPropagation(); });
    search.oninput = () => {
        filter.query = search.value || '';
        draw();
    };

    drawChips();
    draw();

    readRecipes(abort.signal).then((recipes) => {
        if (abort.signal.aborted) return;
        for (const wf of workflows) if (recipes.has(wf.file)) byFile.set(wf.file, recipes.get(wf.file));
        drawChips();
        draw();
    }).catch(() => {});

    return {
        node: root,
        setSelected(file, { scroll = false } = {}) {
            if (!file) return;
            current = file;
            syncMarks(scroll);
        },
        stop() {
            abort.abort();
        },
        focus: () => (searchRow.hidden ? grid.querySelector('.anomalous-wf-pick-card') : search)?.focus(),
    };
}

/**
 * The grid as a window: `workflows` as for the grid, `picked` the file shown picked, `from` takes the focus back;
 * `onDone(workflow)` with the one picked once "Done" or a double click takes it.
 */
export function openWorkflowPicker({ title, workflows, picked = '', showPresets = false, from = null, onDone }) {
    let chosen = workflows.find(wf => wf.file === picked) || workflows[0] || null;
    const finish = () => {
        if (!chosen) return;
        onDone(chosen);
        close();
    };
    const grid = workflowCardGrid({ workflows, selected: chosen?.file || '', showPresets, onPick: (wf) => { chosen = wf; }, onConfirm: finish });
    const foot = el('div', 'anomalous-ai-pick-foot');
    foot.append(el('span', 'anomalous-ai-pick-hint', t('aiWfPickHint')), button('anomalous-ai-start-go', t('aiPickDone'), finish));
    const body = el('div', 'anomalous-wf-pick-window');
    body.append(grid.node, foot);
    const close = aiWindow(title, body, () => {
        grid.stop();
        from?.focus();
    });
    body.closest('.anomalous-ai-connect-dialog')?.classList.add('is-workflow-pick');
    grid.setSelected(chosen?.file, { scroll: true });
    grid.focus();
}

/**
 * The chosen saved workflow as a card (cover, name, its settings and presets) whose press opens the window.
 * Builds `{ node, set(file) }`; `onChange(workflow)` when another is taken.
 */
export function workflowChoice({ workflows, picked = '', showPresets = false, onChange }) {
    let current = workflows.find(wf => wf.file === picked) || workflows[0];
    let recipes = null;
    const row = el('div', 'anomalous-ai-start-models anomalous-wf-choice');
    const card = pickedCard({
        onOpen: () => openWorkflowPicker({
            title: t('aiWfPickTitle'), workflows, picked: current?.file, showPresets, from: card.node,
            onDone: (wf) => {
                current = wf;
                draw();
                onChange?.(wf);
            },
        }),
    });
    row.append(card.node);

    function draw() {
        const recipe = recipes?.get(current?.file);
        const cover = el('span', 'anomalous-picked-img');
        if (recipe) appendRecipeCover(cover, recipeCoverUrl(recipe), current.name, current.file);
        else cover.append(icon('workflows', 20));
        const meta = [recipe ? recipeMetaLine(recipe.data?.params) : '', showPresets && current?.presets?.length ? t('aiPresetCardCount', { count: current.presets.length }) : '']
            .filter(Boolean).join(' · ');
        card.fill({ cover, name: current?.name || '', meta });
    }
    draw();
    readRecipes().then((map) => {
        recipes = map;
        draw();
    }).catch(() => {});
    return {
        node: row,
        set(file) {
            const found = workflows.find(wf => wf.file === file);
            if (!found || found === current) return;
            current = found;
            draw();
        },
    };
}
