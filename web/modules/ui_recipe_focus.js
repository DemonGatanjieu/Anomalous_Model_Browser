/**
 * A workflow's focus values (recipe_focus.js) in its details: the 重点参数 section at the top of
 * a set (each value large with its node, its note, and for a saved set the workflow's own value
 * when it differs), a line on how to mark one while there are none, and the ☆ on each node
 * value under 全部节点参数. A star turns at once and the save follows (a failed save turns it
 * back); then the section, the other stars and the sets' rows are drawn again, the value just
 * marked fading in.
 */

import { translate } from './locales.js';
import { anomalousAlert, anomalousPrompt } from './ui_dialog.js';
import { appendText, button } from './ui_recipe_detail_dom.js';

import { redrawParameterSets, workflowParams } from './ui_param_set_keys.js';
import { shownValue } from './param_compare.js';
import { MAX_FOCUS, focusEntries, notedFocus, toggledFocus } from './recipe_focus.js';

const t = (key, params) => translate(key, params);
const starKey = (node, widget) => `${node}\n${widget}`;
let queue = Promise.resolve(); // changes save one after another, each from what the last one saved

/** Saves the focus values alone (/anomalous/recipe_focus: no new version), then keeps them on `recipe`. */
async function saveFocus(owner, recipe, focusParams) {
    const response = await fetch('/anomalous/recipe_focus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: owner.recipeDetailFilename, focusParams }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status !== 'success') throw new Error(payload.message || `HTTP ${response.status}`);
    recipe.params = { ...(recipe.params || {}), focusParams: payload.focusParams };
}

/** The value of `entry`'s widget in a workflow read by workflowParams, as shown; null when it has none. */
function valueIn(params, entry) {
    const widget = params.get(entry.node)?.widgets.find(item => item.name === entry.widget);
    return widget ? shownValue(widget.value) : null;
}

function showStar(star, on) {
    star.classList.toggle('is-on', on);
    star.textContent = on ? '★' : '☆';
    star.title = t(on ? 'focusUnstar' : 'focusStar');
    star.setAttribute('aria-pressed', String(on));
}

/** The star's little bounce when pressed (restarted on a quick second press). */
function pop(star) {
    star.classList.remove('is-popping');
    void star.offsetWidth;
    star.classList.add('is-popping');
}

/** Marks every ☆ under `root` as the recipe's marks now say. */
function syncStars(root, recipe) {
    const marked = new Set(focusEntries(recipe.params, recipe.workflow).map(entry => starKey(entry.node, entry.widget)));
    for (const star of root.querySelectorAll('.anomalous-wfd-focus-star[data-focus]')) showStar(star, marked.has(star.dataset.focus));
}

/**
 * Saves `next(params)` on the recipe (null: the list is full) after any change still saving;
 * `after` once saved, `undo` when it was not (what the press already showed is taken back).
 */
function change(ctx, next, after, undo) {
    queue = queue.then(async () => {
        const params = next(ctx.recipe.params || {});
        if (!params) {
            undo();
            await anomalousAlert(t('focusFull', { count: MAX_FOCUS }));
            return;
        }
        try {
            await saveFocus(ctx.owner, ctx.recipe, params.focusParams);
        } catch (error) {
            console.error('Could not save the focus values:', error);
            undo();
            await anomalousAlert(t('focusSaveError'));
            return;
        }
        after();
        redrawParameterSets();
    });
    return queue;
}

/** Draws the 重点参数 of `source` (the recipe or one of its sets) into `slot`; `fresh`: the value just marked. */
export function drawFocus(slot, ctx, source, fresh = '') {
    const { recipe } = ctx;
    const redraw = () => {
        drawFocus(slot, ctx, source);
        if (slot.parentElement) syncStars(slot.parentElement, recipe);
    };
    slot.replaceChildren();
    const entries = focusEntries(recipe.params, recipe.workflow);
    if (!entries.length) {
        appendText(slot, 'p', t('focusHint'), 'anomalous-wfd-muted anomalous-wfd-focus-hint');
        return;
    }
    const box = appendText(slot, 'section', '', `anomalous-wfd-section anomalous-wfd-focus${fresh && entries.length === 1 ? ' is-new' : ''}`);
    appendText(appendText(box, 'div', '', 'anomalous-wfd-section-head'), 'h3', t('focusTitle'));
    const grid = appendText(box, 'div', '', 'anomalous-wfd-focus-grid');
    const own = workflowParams(recipe.workflow);
    const mine = source === recipe ? own : workflowParams(source.workflow);
    for (const entry of entries) {
        const value = valueIn(mine, entry);
        const base = source === recipe ? value : valueIn(own, entry);
        const differs = value !== null && base !== null && value !== base;
        const isNew = fresh === starKey(entry.node, entry.widget);
        const tile = appendText(grid, 'div', '', `anomalous-wfd-focus-tile${differs ? ' is-differs' : ''}${isNew ? ' is-new' : ''}`);
        const top = appendText(tile, 'div', '', 'anomalous-wfd-focus-top');
        const nodeTitle = own.get(entry.node)?.title || entry.type;
        appendText(top, 'span', entry.widget, 'anomalous-wfd-focus-name').title = `${nodeTitle} · ${entry.widget}`;
        const unmark = button(top, '', 'anomalous-wfd-focus-star');
        showStar(unmark, true);
        unmark.onclick = () => {
            showStar(unmark, false);
            pop(unmark);
            tile.classList.add('is-leaving');
            void change(ctx, params => toggledFocus(params, { id: entry.node, type: entry.type }, entry.widget), redraw, () => {
                showStar(unmark, true);
                tile.classList.remove('is-leaving');
            });
        };
        appendText(tile, 'span', nodeTitle, 'anomalous-wfd-focus-node');
        appendText(tile, 'strong', value ?? '—', 'anomalous-wfd-focus-value').title = value ?? '';
        if (differs) appendText(tile, 'small', t('focusDefault', { value: base }), 'anomalous-wfd-focus-default');
        const note = button(tile, entry.note || `+ ${t('focusNote')}`, `anomalous-wfd-focus-note${entry.note ? '' : ' is-empty'}`);
        note.title = t('focusNotePrompt');
        note.onclick = async () => {
            const text = await anomalousPrompt(t('focusNotePrompt'), entry.note || '');
            if (text === null) return;
            await change(ctx, params => notedFocus(params, entry, text), redraw, () => {});
        };
    }
}

/**
 * The ☆ for each node value under 全部节点参数: (node { id, type }, widget name) → a button that
 * marks or unmarks it. `slot` holds the 重点参数 drawn by drawFocus, redrawn after a change.
 */
export function focusStars(ctx, slot, source) {
    const marked = new Set(focusEntries(ctx.recipe.params, ctx.recipe.workflow).map(entry => starKey(entry.node, entry.widget)));
    return (node, widget) => {
        const star = document.createElement('button');
        star.type = 'button';
        star.className = 'anomalous-wfd-focus-star';
        star.dataset.focus = starKey(node.id, widget);
        showStar(star, marked.has(star.dataset.focus));
        star.onclick = (event) => {
            event.stopPropagation();
            const on = !star.classList.contains('is-on');
            showStar(star, on);
            pop(star);
            void change(ctx, params => toggledFocus(params, node, widget), () => {
                drawFocus(slot, ctx, source, on ? star.dataset.focus : '');
                syncStars(star.closest('.anomalous-wfd-main') || slot.parentElement, ctx.recipe);
            }, () => showStar(star, !on));
        };
        return star;
    };
}