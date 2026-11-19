/**
 * "Take a saved prompt" beside a prompt the user writes for a private task (the private card's sealed prompt,
 * ui_ai_starter_sheet.js; the prompt box an AI asks with, ui_ai_prompt_box.js). Its press opens a window of a fixed
 * height, picked on the left and seen on the right: tabs by where prompts are kept ("Prompts", "Combos",
 * "Workflows", each with how many hold one; empty ones left out, the last one opened again) and one search over the
 * cards, small and alike (a cover and a name; a saved prompt, having none, its tags and first words), the only part
 * that scrolls; on the right the one picked, its big cover, name and a line of what it is (the workflow's settings
 * from GET /anomalous/recipes), the prompt and the negative as chips of their comma parts (as many as about fit, "+n"
 * shows the rest; a long part is a rounded box, not a pill), and "Put it in the prompt" (a double click or Enter on a card too): the prompt goes in the field after
 * what is there, the negative into the negative field while that is empty. The materials picker's catalogue
 * (ai_toolbox_data.js) gives them. Nothing leaves the page: the AI gets the field as a token, as it would typed text.
 */

import { translate as t } from './locales.js';
import { keptCatalog, loadCatalog, searchItems } from './ai_toolbox_data.js';
import { aiWindow } from './ui_ai_connect.js';
import { icon } from './ui_ai_icons.js';
import { coverUrl } from './ui_ai_toolbox_cards.js';
import { standInCover } from './ui_ai_toolbox_icons.js';
import { recipeMetaLine } from './ui_recipe_cards.js';
import { readRecipes } from './ui_workflow_pick.js';

const SOURCES = ['saved', 'combo', 'workflow'];
const SHOWN = 200;
const ROOM = { positive: 260, negative: 110 }; // letters of chips shown before "+n" (at least one chip)
const LONG = 36; // a part longer than this wraps: a box, not a pill
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

/** A prompt's comma parts, as its chips. */
const partsOf = text => String(text || '').split(/[,，\n]+/).map(part => part.trim()).filter(Boolean);
const nameOf = entry => entry.title || entry.name || entry.id || '';

/** Each tab's entries from the catalogue: the saved prompts, the combos and workflows that hold one. */
function entriesOf(catalog) {
    return {
        saved: catalog.filter(item => item.kind === 'prompts' && (item.source || 'saved') === 'saved' && (item.positive || item.negative)),
        combo: catalog.filter(item => item.kind === 'combos' && item.prompt).map(item => ({ ...item, positive: item.prompt, negative: '' })),
        workflow: catalog.filter(item => item.kind === 'workflows' && (item.prompt || item.negative)).map(item => ({ ...item, positive: item.prompt })),
    };
}

/** A combo's or workflow's cover in a box of `className`, its kind's picture while it has none or it does not load. */
function coverBox(entry, className) {
    const box = el('span', className);
    const url = coverUrl(entry);
    const fallback = () => box.replaceChildren(standInCover(entry.kind));
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

/** The window: `use(entry)` with the one taken; `from` gets the focus back. */
function openPromptWindow(use, from) {
    let entries = null;
    let source = '';
    let chosen = null;
    let recipes = null;
    const expanded = { positive: false, negative: false };

    const body = el('div', 'anomalous-ai-prompt-take');
    const bar = el('div', 'anomalous-ai-prompt-take-bar');
    const tabs = el('div', 'anomalous-model-bases anomalous-ai-prompt-take-tabs');
    tabs.setAttribute('role', 'toolbar');
    const searchRow = el('div', 'anomalous-ai-pick-search anomalous-ai-prompt-take-search');
    const search = el('input', 'anomalous-ai-start-input');
    search.type = 'search';
    search.placeholder = t('aiPromptFetchSearch');
    search.setAttribute('aria-label', t('aiPromptFetchSearch'));
    searchRow.append(icon('search', 14), search);
    bar.append(tabs, searchRow);
    const main = el('div', 'anomalous-ai-prompt-take-main');
    const list = el('div', 'anomalous-ai-prompt-take-list');
    list.setAttribute('role', 'listbox');
    const detail = el('div', 'anomalous-ai-prompt-take-detail');
    detail.setAttribute('aria-live', 'polite');
    main.append(list, detail);
    body.append(bar, main);

    const take = () => {
        if (!chosen) return;
        use(chosen);
        close();
    };
    const foot = el('div', 'anomalous-ai-prompt-take-foot');
    const useButton = el('button', 'anomalous-ai-start-go', t('aiPromptFetchUse'));
    useButton.type = 'button';
    useButton.onclick = take;
    foot.append(el('span', 'anomalous-ai-pick-hint', t('aiPromptFetchHint')), useButton);

    const close = aiWindow(t('aiPromptFetchTitle'), body, () => from?.focus());
    body.closest('.anomalous-ai-connect-dialog')?.classList.add('is-prompt-take');

    const found = () => searchItems(entries[source], search.value).slice(0, SHOWN);

    /** What the one picked is: where it is kept, then its tags, its model, or its workflow's settings. */
    function metaOf(entry) {
        const recipe = source === 'workflow' ? recipes?.get(entry.filename) : null;
        const more = source === 'saved' ? (entry.tags || []).map(tag => `#${tag}`)
            : source === 'combo' ? [entry.model, entry.base]
                : [recipe ? recipeMetaLine(recipe.data?.params) : ''];
        return [t(`aiPromptFetchTab_${source}`), ...more].filter(Boolean).join(' · ');
    }

    /** The prompt or the negative (`kind`) as chips under its label; the first few, "+n" for the rest. */
    function chipPart(kind, text) {
        const parts = partsOf(text);
        if (!parts.length) return [];
        const box = el('div', `anomalous-ai-prompt-take-chips is-${kind}`);
        let used = 0;
        const over = parts.findIndex(part => (used += part.length) > ROOM[kind]); // the first chip past the room
        const fit = over < 0 ? parts.length : Math.max(1, over);
        const shown = expanded[kind] ? parts : parts.slice(0, fit);
        box.append(...shown.map(part => el('span', `anomalous-ai-prompt-take-chip${part.length > LONG ? ' is-long' : ''}`, part)));
        if (parts.length > fit) {
            const more = el('button', 'anomalous-ai-prompt-take-chip is-more',
                expanded[kind] ? t('aiPromptFetchLess') : t('aiPromptFetchMore', { count: parts.length - fit }));
            more.type = 'button';
            more.setAttribute('aria-expanded', String(expanded[kind]));
            if (!expanded[kind]) more.title = t('aiPromptFetchShowAll');
            more.onclick = () => {
                expanded[kind] = !expanded[kind];
                drawDetail();
            };
            box.append(more);
        }
        return [el('div', 'anomalous-ai-prompt-take-label', t(kind === 'positive' ? 'aiPromptFetchPositiveHead' : 'aiPromptFetchNegativeHead')), box];
    }

    function drawDetail() {
        if (!chosen) {
            detail.replaceChildren();
            return;
        }
        const titles = el('div', 'anomalous-ai-prompt-take-titles');
        titles.append(el('div', 'anomalous-ai-prompt-take-name', nameOf(chosen)), el('div', 'anomalous-ai-prompt-take-meta', metaOf(chosen)));
        const texts = el('div', 'anomalous-ai-prompt-take-texts');
        texts.append(...chipPart('positive', chosen.positive), ...chipPart('negative', chosen.negative));
        detail.replaceChildren(...(source === 'saved' ? [] : [coverBox(chosen, 'anomalous-ai-prompt-take-cover')]), titles, texts, foot);
    }

    function choose(entry) {
        if (entry !== chosen) Object.assign(expanded, { positive: false, negative: false });
        chosen = entry;
        for (const card of list.querySelectorAll('.anomalous-ai-prompt-card')) {
            const on = card.dataset.id === entry?.id;
            card.classList.toggle('is-on', on);
            card.setAttribute('aria-selected', String(on));
        }
        drawDetail();
    }

    /** A card, all alike: a cover and a name; a saved prompt (no cover) its tags and first words in that place. */
    function card(entry) {
        const node = el('button', `anomalous-ai-prompt-card${source === 'saved' ? ' is-text' : ''}`);
        node.type = 'button';
        node.dataset.id = entry.id;
        node.setAttribute('role', 'option');
        if (source === 'saved') {
            const face = el('span', 'anomalous-ai-prompt-card-face');
            if (entry.tags?.length) face.append(el('span', 'anomalous-ai-prompt-card-tags', entry.tags.slice(0, 3).map(tag => `#${tag}`).join(' ')));
            face.append(el('span', 'anomalous-ai-prompt-card-text', entry.positive || entry.negative || ''));
            node.append(face);
        } else {
            node.append(coverBox(entry, 'anomalous-ai-prompt-card-cover'));
        }
        node.append(el('span', 'anomalous-ai-prompt-card-name', nameOf(entry)));
        node.title = nameOf(entry);
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

    function drawList() {
        const shown = found();
        const next = shown.includes(chosen) ? chosen : shown[0] || null;
        list.scrollTop = 0;
        list.replaceChildren(...(shown.length ? shown.map(card) : [el('div', 'anomalous-ai-prompt-fetch-none', t('recipeNoMatches'))]));
        choose(next);
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
                drawList();
            };
            return tab;
        }));
    }

    function start(catalog) {
        entries = entriesOf(catalog || []);
        const kept = SOURCES.filter(key => entries[key].length);
        if (!kept.length) {
            bar.hidden = true;
            main.replaceChildren(el('div', 'anomalous-ai-prompt-fetch-none', t('aiPromptFetchNone')));
            return;
        }
        source = kept.includes(lastSource) ? lastSource : kept[0];
        drawTabs();
        drawList();
        search.focus();
    }

    search.addEventListener('keydown', (event) => { if (event.key !== 'Escape') event.stopPropagation(); });
    search.oninput = () => { if (entries) drawList(); };
    readRecipes().then((map) => {
        recipes = map;
        if (source === 'workflow') drawDetail();
    }).catch(() => {});
    if (keptCatalog()) start(keptCatalog());
    else {
        list.replaceChildren(el('div', 'anomalous-ai-prompt-fetch-none', t('aiPromptFetchLoading')));
        loadCatalog().then(start, () => list.replaceChildren(el('div', 'anomalous-ai-prompt-fetch-none', t('materialLoadError'))));
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
