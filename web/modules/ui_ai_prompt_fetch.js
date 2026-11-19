/**
 * "Take a saved prompt" beside a prompt the user writes for a private task (the private card's sealed prompt,
 * ui_ai_starter_sheet.js; the prompt box an AI asks with, ui_ai_prompt_box.js). Its press opens a window that lists
 * them by where they are kept: "Prompts" (the saved ones, cards with their tags and first lines), "Combos" (cards
 * with their covers) and "Workflows" (the reusable workflow card grid, ui_workflow_pick.js), each tab with how many
 * hold a prompt, one search for all three. The card picked shows its whole prompt and negative under the grid;
 * "Use this", or a double click, puts the prompt in the field (after what is there) and the negative in the negative
 * field while that is empty. The materials picker's catalogue (ai_toolbox_data.js) gives them. Nothing leaves the
 * page: the AI gets the field as a token, as it would typed text.
 */

import { translate as t } from './locales.js';
import { keptCatalog, loadCatalog, searchItems } from './ai_toolbox_data.js';
import { aiWindow } from './ui_ai_connect.js';
import { icon } from './ui_ai_icons.js';
import { coverUrl } from './ui_ai_toolbox_cards.js';
import { standInCover } from './ui_ai_toolbox_icons.js';
import { workflowCardGrid } from './ui_workflow_pick.js';

const SOURCES = ['saved', 'combo', 'workflow'];
const SHOWN = 120;
let lastSource = ''; // the tab picked last, opened on again while the page stays

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** `text` after what `field` holds (a comma between), as far as the field takes. */
function put(field, text) {
    const value = String(text || '').trim();
    if (!field || !value) return;
    const now = field.value.trim();
    const joined = now ? `${now}${/[,，]$/.test(now) ? ' ' : ', '}${value}` : value;
    field.value = field.maxLength > 0 ? joined.slice(0, field.maxLength) : joined;
    field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Each tab's entries from the catalogue: the saved prompts, the combos and workflows that hold one. */
function entriesOf(catalog) {
    return {
        saved: catalog.filter(item => item.kind === 'prompts' && (item.source || 'saved') === 'saved' && (item.positive || item.negative)),
        combo: catalog.filter(item => item.kind === 'combos' && item.prompt).map(item => ({ ...item, positive: item.prompt, negative: '' })),
        workflow: catalog.filter(item => item.kind === 'workflows' && (item.prompt || item.negative)).map(item => ({ ...item, positive: item.prompt })),
    };
}

/** A combo's cover, or the stand-in while it has none or it does not load. */
function cover(item) {
    const box = el('span', 'anomalous-ai-prompt-card-cover');
    const url = coverUrl(item);
    const fallback = () => box.replaceChildren(standInCover('combos'));
    if (!url) {
        fallback();
        return box;
    }
    const img = el('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.src = url;
    img.onerror = fallback;
    box.append(img);
    return box;
}

/** The window: `use(entry)` with the one taken. */
function openPromptWindow(use, from) {
    let entries = null;
    let source = '';
    let chosen = null;
    let workflowGrid = null;

    const body = el('div', 'anomalous-ai-prompt-take');
    const head = el('div', 'anomalous-ai-prompt-take-head');
    const tabs = el('div', 'anomalous-model-bases anomalous-ai-prompt-take-tabs');
    tabs.setAttribute('role', 'toolbar');
    const searchRow = el('div', 'anomalous-ai-pick-search anomalous-ai-prompt-take-search');
    const search = el('input', 'anomalous-ai-start-input');
    search.type = 'search';
    search.placeholder = t('aiPromptFetchSearch');
    search.setAttribute('aria-label', t('aiPromptFetchSearch'));
    searchRow.append(icon('search', 14), search);
    head.append(tabs, searchRow);
    const grid = el('div', 'anomalous-ai-prompt-take-grid');
    const preview = el('div', 'anomalous-ai-prompt-take-preview');
    preview.setAttribute('aria-live', 'polite');
    const take = () => {
        if (!chosen) return;
        use(chosen);
        close();
    };
    const useButton = el('button', 'anomalous-ai-start-go', t('aiPromptFetchUse'));
    useButton.type = 'button';
    useButton.onclick = take;
    const foot = el('div', 'anomalous-ai-pick-foot');
    foot.append(el('span', 'anomalous-ai-pick-hint', t('aiPromptFetchHint')), useButton);
    body.append(head, grid, preview, foot);

    const close = aiWindow(t('aiPromptFetchTitle'), body, () => {
        workflowGrid?.stop();
        from?.focus();
    });
    body.closest('.anomalous-ai-connect-dialog')?.classList.add('is-prompt-take');

    const found = () => searchItems(entries[source], search.value).slice(0, SHOWN);

    function drawPreview() {
        preview.hidden = !chosen;
        if (!chosen) return;
        const words = el('p', 'anomalous-ai-prompt-take-text', chosen.positive || '');
        preview.replaceChildren(el('div', 'anomalous-ai-prompt-take-name', chosen.title || chosen.name || ''), words);
        if (chosen.negative) preview.append(el('p', 'anomalous-ai-prompt-take-negative', t('aiPromptFetchNegative', { text: chosen.negative })));
    }

    function choose(entry) {
        chosen = entry;
        for (const card of grid.querySelectorAll('.anomalous-ai-prompt-card')) {
            const on = card.dataset.id === entry?.id;
            card.classList.toggle('is-on', on);
            card.setAttribute('aria-selected', String(on));
        }
        drawPreview();
    }

    /** A saved prompt (its tags, name, first lines) or a combo (its cover, name, first line) as a card. */
    function card(entry) {
        const node = el('button', 'anomalous-ai-prompt-card');
        node.type = 'button';
        node.dataset.id = entry.id;
        node.setAttribute('role', 'option');
        if (source === 'combo') node.append(cover(entry));
        else if (entry.tags?.length) node.append(el('span', 'anomalous-ai-prompt-card-tags', entry.tags.slice(0, 3).map(tag => `#${tag}`).join(' ')));
        node.append(el('span', 'anomalous-ai-prompt-card-name', entry.title || entry.name || entry.id),
            el('span', `anomalous-ai-prompt-card-text${source === 'combo' ? ' is-one' : ''}`, entry.positive || entry.negative || ''));
        node.onclick = () => choose(entry);
        node.ondblclick = () => {
            choose(entry);
            take();
        };
        node.onkeydown = (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            choose(entry);
            take();
        };
        return node;
    }

    function drawGrid() {
        workflowGrid?.stop();
        workflowGrid = null;
        const shown = found();
        if (!shown.includes(chosen)) chosen = shown[0] || null;
        if (!shown.length) {
            grid.replaceChildren(el('div', 'anomalous-ai-prompt-fetch-none', t('recipeNoMatches')));
        } else if (source === 'workflow') {
            const byFile = new Map(shown.map(item => [item.filename, item]));
            workflowGrid = workflowCardGrid({
                workflows: shown.map(item => ({ name: item.name, file: item.filename })),
                selected: chosen?.filename,
                search: false,
                onPick: wf => choose(byFile.get(wf.file)),
                onConfirm: (wf) => {
                    choose(byFile.get(wf.file));
                    take();
                },
            });
            grid.replaceChildren(workflowGrid.node);
        } else {
            const list = el('div', 'anomalous-ai-prompt-cards');
            list.setAttribute('role', 'listbox');
            list.append(...shown.map(card));
            grid.replaceChildren(list);
        }
        choose(chosen);
    }

    function drawTabs() {
        tabs.replaceChildren(...SOURCES.filter(key => entries[key].length).map((key) => {
            const tab = el('button', 'anomalous-model-base-chip');
            tab.type = 'button';
            tab.setAttribute('aria-pressed', String(key === source));
            tab.append(el('span', '', t(`aiPromptFetchTab_${key}`)), el('span', 'anomalous-model-type-count', entries[key].length));
            tab.onclick = () => {
                if (key === source) return;
                source = lastSource = key;
                chosen = null;
                drawTabs();
                drawGrid();
            };
            return tab;
        }));
    }

    function start(catalog) {
        entries = entriesOf(catalog || []);
        const kept = SOURCES.filter(key => entries[key].length);
        if (!kept.length) {
            head.hidden = true;
            preview.hidden = true;
            grid.replaceChildren(el('div', 'anomalous-ai-prompt-fetch-none', t('aiPromptFetchNone')));
            return;
        }
        source = kept.includes(lastSource) ? lastSource : kept[0];
        drawTabs();
        drawGrid();
        search.focus();
    }

    search.addEventListener('keydown', (event) => { if (event.key !== 'Escape') event.stopPropagation(); });
    search.oninput = () => { if (entries) drawGrid(); };
    preview.hidden = true;
    if (keptCatalog()) start(keptCatalog());
    else {
        grid.replaceChildren(el('div', 'anomalous-ai-prompt-fetch-none', t('aiPromptFetchLoading')));
        loadCatalog().then(start, () => grid.replaceChildren(el('div', 'anomalous-ai-prompt-fetch-none', t('materialLoadError'))));
    }
}

/**
 * Builds `{ button }`, named after the field it fills; its press opens the window. `target()` gives the field a
 * pick fills (it may make one), `negative()` the negative field or null.
 */
export function promptFetch({ target, negative = () => null }) {
    const button = el('button', 'anomalous-ai-prompt-fetch');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.append(icon('prompts', 13), el('span', '', t('aiPromptFetch')));
    button.onclick = () => openPromptWindow((entry) => {
        const field = target();
        put(field, entry.positive);
        if (entry.negative && !negative()?.value.trim()) put(negative(), entry.negative); // once, not again with each prompt
        requestAnimationFrame(() => field?.focus());
    }, button);
    return { button };
}
