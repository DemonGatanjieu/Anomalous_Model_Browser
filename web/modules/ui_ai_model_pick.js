/**
 * The window models are picked in: the base models of "Build a new one (text to image)" (ui_ai_start_from.js)
 * and the private card's LoRAs (ui_ai_private_sheet.js). Cards with a cover, the name and the family, a
 * search, the families as chips when there are two or more, and the favourites (first in the list, a star
 * on the cover). A press picks a card or lets it go; a picked card carries its number when the order matters
 * (the first draws first) and the words for its part; a card that cannot go with those picked says why when
 * pressed. "Done" hands the picks back; closing the window any other way leaves them as they were. Only the
 * first cards of a long list are drawn, the search finds the rest.
 */

import { filterModels, modelFamilies } from './ai_start_from.js';
import { translate as t } from './locales.js';
import { aiWindow } from './ui_ai_connect.js';
import { icon } from './ui_ai_icons.js';
import { coverUrl } from './ui_ai_toolbox_cards.js';
import { standInCover } from './ui_ai_toolbox_icons.js';

const SHOWN = 120;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** A base model family as the routes name it ("anima", "SDXL") in the words shown: its first letter a capital. */
const familyName = family => family.charAt(0).toUpperCase() + family.slice(1);

/** `model`'s cover in a box of `className`; its type's picture while it has none or it does not load. */
export function modelThumb(model, className) {
    const box = el('span', className);
    const url = coverUrl({ kind: 'models', cover: model.cover });
    const fallback = () => box.replaceChildren(standInCover('models', model.type || ''));
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

/**
 * Opens the window. `models`: [{model_id, name, family, cover, favourite, type?}]; `picked`: model ids, in
 * order; at most `max`, at least `min` on "Done". `fits(pickedIds, model)`: whether `model` can join those
 * picked, else `unfit` says why; `role(index)`: the words under the picked card at `index`; `note`: a line
 * under the search; `hint`: the line at the foot; `from`: what gets the focus back; `onDone(ids)`.
 */
export function openModelPicker({ title, models, picked = [], max = 1, min = 0, numbered = false, fits = () => true, unfit = '', role = () => '', note = '', hint = '', from = null, onDone }) {
    const chosen = picked.filter(id => models.some(model => model.model_id === id));
    let query = '';
    let family = null;
    let favourites = false;
    const body = el('div', 'anomalous-ai-pick');
    const search = el('input', 'anomalous-ai-start-input');
    search.type = 'search';
    search.placeholder = t('aiStartModelSearch');
    const searchRow = el('label', 'anomalous-ai-pick-search');
    searchRow.append(icon('search', 14), search);
    const chips = el('div', 'anomalous-model-bases anomalous-ai-pick-chips');
    const grid = el('div', 'anomalous-ai-pick-grid');
    const more = el('div', 'anomalous-ai-pick-more');
    const say = el('span', 'anomalous-ai-pick-hint');
    const done = el('button', 'anomalous-ai-start-go', t('aiPickDone'));
    done.type = 'button';
    const foot = el('div', 'anomalous-ai-pick-foot');
    foot.append(say, done);
    body.append(searchRow, ...(note ? [el('div', 'anomalous-ai-pick-note', note)] : []), chips, grid, more, foot);

    const tell = (words = hint, warn = false) => {
        say.textContent = words;
        say.classList.toggle('is-warn', warn);
    };

    function chip(label, on, onClick, count) {
        const node = el('button', 'anomalous-model-base-chip');
        node.type = 'button';
        node.setAttribute('aria-pressed', String(on));
        node.append(...(Array.isArray(label) ? label : [el('span', '', label)]));
        if (count !== undefined) node.append(el('span', 'anomalous-model-type-count', String(count)));
        node.onclick = () => { onClick(); drawChips(); drawGrid(); };
        return node;
    }

    function drawChips() {
        const families = modelFamilies(models);
        const starred = models.filter(model => model.favourite).length;
        const row = [];
        if (families.length > 1) {
            row.push(chip(t('modelBasesAll'), family === null && !favourites, () => { family = null; favourites = false; }, models.length));
            for (const [name, count] of families) {
                row.push(chip(name ? familyName(name) : t('modelBasesUnknown'), family === name, () => { family = name; favourites = false; }, count));
            }
        }
        if (starred) row.push(chip([icon('starOn', 12), el('span', '', t('aiPickFavourites'))], favourites, () => { favourites = !favourites; family = null; }, starred));
        chips.replaceChildren(...row);
        chips.hidden = !row.length;
    }

    function toggle(model) {
        const at = chosen.indexOf(model.model_id);
        if (at >= 0) chosen.splice(at, 1);
        else if (!fits(chosen, model)) return tell(unfit, true);
        else if (chosen.length >= max) return tell(t('aiPickMax', { max }), true);
        else chosen.push(model.model_id);
        tell();
        drawGrid();
    }

    function card(model) {
        const at = chosen.indexOf(model.model_id);
        const node = el('button', `anomalous-ai-pick-card${at >= 0 ? ' is-on' : ''}${at < 0 && !fits(chosen, model) ? ' is-unfit' : ''}`);
        node.type = 'button';
        node.setAttribute('aria-pressed', String(at >= 0));
        const cover = modelThumb(model, 'anomalous-ai-pick-cover');
        if (model.favourite) {
            const star = el('span', 'anomalous-ai-pick-star');
            star.append(icon('starOn', 12));
            cover.append(star);
        }
        if (at >= 0) cover.append(el('span', 'anomalous-ai-pick-badge', numbered ? String(at + 1) : '✓'));
        const sub = [model.family ? familyName(model.family) : '', at >= 0 ? role(at) : ''].filter(Boolean).join(' · ');
        node.append(cover, el('span', 'anomalous-ai-pick-name', model.name), el('span', 'anomalous-ai-pick-sub', sub));
        node.title = model.name;
        node.onclick = () => toggle(model);
        return node;
    }

    function drawGrid() {
        const found = filterModels(models, { query, family }).filter(model => !favourites || model.favourite);
        // What is picked first, in its order, while it matches.
        const list = [...chosen.map(id => found.find(model => model.model_id === id)).filter(Boolean),
            ...found.filter(model => !chosen.includes(model.model_id))];
        grid.replaceChildren(...list.slice(0, SHOWN).map(card));
        more.textContent = !list.length ? t('aiMentionNone') : list.length > SHOWN ? t('aiPickMore', { count: list.length - SHOWN }) : '';
        more.hidden = !more.textContent;
    }

    search.addEventListener('input', () => {
        query = search.value;
        drawGrid();
    });
    const close = aiWindow(title, body, () => from?.focus());
    done.onclick = () => {
        if (chosen.length < min) return tell(t('aiPickNone'), true);
        onDone([...chosen]);
        close(); // after the sheet has drawn the picks, so the focus goes back to its button
    };
    body.closest('.anomalous-ai-connect-dialog')?.classList.add('is-model-pick');
    tell();
    drawChips();
    drawGrid();
    search.focus();
}
