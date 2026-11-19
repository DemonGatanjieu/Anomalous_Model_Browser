/**
 * Reusable saved-workflow visual card selector for AI task setup ("Run my preset" and
 * "Start from -> A saved workflow"): reuses the Workflows page card face (`createRecipeCardFace`,
 * `28-workflows.css`) and filter helper (`recipeMatchesFilter`), hydrating full covers, readiness
 * dots and model info from `/anomalous/recipes` while keeping scroll position intact.
 */

import { translate as t } from './locales.js';
import { createRecipeCardFace } from './ui_recipe_cards.js';
import { recipeMatchesFilter } from './ui_recipe_catalog.js';
import { icon } from './ui_ai_icons.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

const fallbackRecipe = wf => ({ filename: wf.file, data: { name: wf.name, params: {} } });

function matches(wf, recipe, query) {
    if (!query.trim()) return true;
    if (recipeMatchesFilter(recipe.data, query, null, 'all')) return true;
    const base = recipe.data?.params?.baseModel || recipe.data?.params?.baseModels || '';
    const text = `${wf.name || ''} ${wf.file || ''} ${base}`.toLowerCase();
    return query.trim().toLowerCase().split(/\s+/).every(term => text.includes(term));
}

/**
 * Builds `{ node, setSelected(file), stop() }`.
 * `workflows`: `[{ name, file, shape, presets }]`; `selected`: initially picked `file`;
 * `showPresets`: show saved preset counts per card; `onPick(workflow)` fires on selection;
 * `onConfirm(workflow)` optionally fires on double-click.
 */
export function workflowCardGrid({ workflows = [], selected = '', showPresets = false, onPick, onConfirm } = {}) {
    const abort = new AbortController();
    let current = selected || workflows[0]?.file || '';
    let query = '';
    const byFile = new Map(workflows.map(item => [item.file, fallbackRecipe(item)]));

    const root = el('div', 'anomalous-wf-pick');
    const searchRow = el('div', 'anomalous-ai-pick-search');
    const search = el('input', 'anomalous-ai-start-input');
    search.type = 'search';
    search.placeholder = t('aiPresetSearch');
    search.setAttribute('aria-label', t('aiPresetSearch'));
    const count = el('span', 'anomalous-wf-count');
    searchRow.append(icon('search', 14), search, count);
    searchRow.hidden = workflows.length <= 1;

    const grid = el('div', 'anomalous-wf-list is-grid anomalous-wf-pick-grid');
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', t('aiStartWorkflow'));
    root.append(searchRow, grid);

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

    function draw() {
        const keepTop = grid.scrollTop;
        const shown = workflows.filter(wf => matches(wf, byFile.get(wf.file) || fallbackRecipe(wf), query));
        count.textContent = workflows.length ? `${shown.length}/${workflows.length}` : '';
        cards.clear();
        if (!shown.length) {
            grid.replaceChildren(el('div', 'anomalous-ai-pics-none', t('recipeNoMatches')));
            return;
        }
        const nodes = shown.map((wf) => {
            const recipe = byFile.get(wf.file) || fallbackRecipe(wf);
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
        query = search.value || '';
        draw();
    };

    draw();

    fetch('/anomalous/recipes', { cache: 'no-store', signal: abort.signal })
        .then(res => (res.ok ? res.json() : null))
        .then((payload) => {
            if (abort.signal.aborted || !Array.isArray(payload?.recipes)) return;
            for (const item of payload.recipes) {
                if (item?.filename && byFile.has(item.filename)) byFile.set(item.filename, item);
            }
            draw();
        })
        .catch(() => {});

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
    };
}
