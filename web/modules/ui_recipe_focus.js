/**
 * A workflow's focus values (recipe_focus.js) in its details: the 重点参数 section at the top of
 * a set (each value large with its node, its note, and for a saved set the workflow's own value
 * when it differs), a line on how to mark one while there are none, and the ☆ on each node
 * value under 全部节点参数. A change saves the recipe, then redraws the section, the stars and
 * the sets' rows.
 */

import { translate } from './locales.js';
import { anomalousAlert, anomalousPrompt } from './ui_dialog.js';
import { appendText, button } from './ui_recipe_detail_dom.js';
import { updateRecipeMetadata } from './ui_recipe_metadata.js';
import { redrawParameterSets, workflowParams } from './ui_param_set_keys.js';
import { shownValue } from './param_compare.js';
import { MAX_FOCUS, focusEntries, notedFocus, toggledFocus } from './recipe_focus.js';

const t = (key, params) => translate(key, params);
const starKey = (node, widget) => `${node}\n${widget}`;

/** The value of `entry`'s widget in a workflow read by workflowParams, as shown; null when it has none. */
function valueIn(params, entry) {
    const widget = params.get(entry.node)?.widgets.find(item => item.name === entry.widget);
    return widget ? shownValue(widget.value) : null;
}

/** Marks every ☆ under `root` as the recipe's marks now say. */
function syncStars(root, recipe) {
    const marked = new Set(focusEntries(recipe.params, recipe.workflow).map(entry => starKey(entry.node, entry.widget)));
    for (const star of root.querySelectorAll('.anomalous-wfd-focus-star[data-focus]')) {
        const on = marked.has(star.dataset.focus);
        star.classList.toggle('is-on', on);
        star.textContent = on ? '★' : '☆';
        star.title = t(on ? 'focusUnstar' : 'focusStar');
    }
}

/** Saves `params` (null: the list is full) on the recipe, then calls `after`. */
async function change(ctx, params, control, after) {
    if (!params) {
        await anomalousAlert(t('focusFull', { count: MAX_FOCUS }));
        return;
    }
    control.disabled = true;
    try {
        await updateRecipeMetadata(ctx.owner, ctx.recipe, { params });
    } catch (error) {
        console.error('Could not save the focus values:', error);
        await anomalousAlert(t('focusSaveError'));
        return;
    } finally {
        control.disabled = false;
    }
    after();
    redrawParameterSets();
}

/** Draws the 重点参数 of `source` (the recipe or one of its sets) into `slot`. */
export function drawFocus(slot, ctx, source) {
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
    const box = appendText(slot, 'section', '', 'anomalous-wfd-section anomalous-wfd-focus');
    appendText(appendText(box, 'div', '', 'anomalous-wfd-section-head'), 'h3', t('focusTitle'));
    const grid = appendText(box, 'div', '', 'anomalous-wfd-focus-grid');
    const own = workflowParams(recipe.workflow);
    const mine = source === recipe ? own : workflowParams(source.workflow);
    for (const entry of entries) {
        const value = valueIn(mine, entry);
        const base = source === recipe ? value : valueIn(own, entry);
        const differs = value !== null && base !== null && value !== base;
        const tile = appendText(grid, 'div', '', `anomalous-wfd-focus-tile${differs ? ' is-differs' : ''}`);
        const top = appendText(tile, 'div', '', 'anomalous-wfd-focus-top');
        const nodeTitle = own.get(entry.node)?.title || entry.type;
        appendText(top, 'span', entry.widget, 'anomalous-wfd-focus-name').title = `${nodeTitle} · ${entry.widget}`;
        const unmark = button(top, '★', 'anomalous-wfd-focus-star is-on');
        unmark.title = t('focusUnstar');
        unmark.onclick = () => change(ctx, toggledFocus(recipe.params || {}, { id: entry.node, type: entry.type }, entry.widget), unmark, redraw);
        appendText(tile, 'span', nodeTitle, 'anomalous-wfd-focus-node');
        appendText(tile, 'strong', value ?? '—', 'anomalous-wfd-focus-value').title = value ?? '';
        if (differs) appendText(tile, 'small', t('focusDefault', { value: base }), 'anomalous-wfd-focus-default');
        const note = button(tile, entry.note || `+ ${t('focusNote')}`, `anomalous-wfd-focus-note${entry.note ? '' : ' is-empty'}`);
        note.title = t('focusNotePrompt');
        note.onclick = async () => {
            const text = await anomalousPrompt(t('focusNotePrompt'), entry.note || '');
            if (text === null) return;
            await change(ctx, notedFocus(recipe.params || {}, entry, text), note, redraw);
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
        star.dataset.focus = starKey(node.id, widget);
        star.className = `anomalous-wfd-focus-star${marked.has(star.dataset.focus) ? ' is-on' : ''}`;
        star.textContent = marked.has(star.dataset.focus) ? '★' : '☆';
        star.title = t(marked.has(star.dataset.focus) ? 'focusUnstar' : 'focusStar');
        star.onclick = (event) => {
            event.stopPropagation();
            void change(ctx, toggledFocus(ctx.recipe.params || {}, node, widget), star, () => {
                drawFocus(slot, ctx, source);
                syncStars(star.closest('.anomalous-wfd-main') || slot.parentElement, ctx.recipe);
            });
        };
        return star;
    };
}
