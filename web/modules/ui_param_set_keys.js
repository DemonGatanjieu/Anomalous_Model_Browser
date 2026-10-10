/**
 * Parameter sets (参数方案) at a glance. A recipe card says how many sets it has, and its
 * chip opens the recipe on its Parameters tab. A set's card there shows its key parameters'
 * values (key_params.js; marked when they differ from the recipe's own), how many values
 * differ from the recipe, and ⇄ to compare the two (ui_param_compare.js). Each workflow is
 * read once and kept while its data lives.
 */

import { translate as t } from './locales.js';
import { detachedGraph } from './detached_graph.js';
import { keyParamTest, onKeyParamsChange } from './key_params.js';
import { compareParams, readParams, shownValue } from './param_compare.js';
import { openParamCompare } from './ui_param_compare.js';

const CHIP_CHARS = 24;
const read = new WeakMap(); // workflow object → readParams
const decorated = new WeakMap(); // a set's card → [notebook, recipe], to draw it again after a star changes
let following = false;

/** A star changed: the set cards on screen show the new key values. */
function redrawSets() {
    for (const row of document.querySelectorAll('.anomalous-preset-item-card')) {
        const args = decorated.get(row);
        if (!args) continue;
        row.querySelector('.anomalous-preset-item-keys')?.remove();
        row.querySelector('.anomalous-preset-set-compare')?.remove();
        decorateParameterSet(row, ...args);
    }
}

function paramsOf(workflow) {
    if (!read.has(workflow)) read.set(workflow, readParams(detachedGraph(workflow)));
    return read.get(workflow);
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const short = value => {
    const text = shownValue(value);
    return text.length > CHIP_CHARS ? `${text.slice(0, CHIP_CHARS - 1)}…` : text;
};

/** { recipe filename → its sets' value signatures }, read once per list drawn; {} when it cannot be read. */
export function fetchParameterSetSignatures() {
    return fetch('/anomalous/parameters/signatures', { cache: 'no-store' })
        .then(response => (response.ok ? response.json() : {}))
        .then(data => (data && typeof data.sets === 'object' && data.sets) || {})
        .catch(() => ({}));
}

/**
 * The recipe card's 参数方案 N chip, once the signatures are here: N counts the sets whose values
 * differ from the recipe's (saving a recipe keeps a set of its own values too). It opens the
 * recipe on its Parameters tab.
 */
export function showParameterSetCount(owner, card, recipe, signatures) {
    signatures.then((map) => {
        const own = recipe?.data?.parameter_signature?.value;
        const sets = Array.isArray(map[recipe?.filename]) ? map[recipe.filename] : [];
        const count = sets.filter(signature => !own || signature !== own).length;
        const line = card.querySelector('.anomalous-wf-extras');
        if (!count || !line) return;
        const chip = el('button', 'anomalous-recipe-set-chip', `▤ ${count}`);
        chip.type = 'button';
        chip.title = `${t('paramSetCount', { count })} · ${t('paramSetCountHint')}`;
        chip.setAttribute('aria-label', chip.title);
        chip.onclick = (event) => {
            event.stopPropagation();
            owner.recipeReturnState = { activeTab: 'parameters' };
            card.click();
        };
        line.append(chip);
    });
}

/** A new set's name: the recipe's name and the first number from 2 no set of it has yet (`Name 2`). */
export function nextSetName(recipe, notebooks) {
    const base = String(recipe?.name || t('recipeUntitled')).trim();
    const taken = new Set((notebooks || []).map(notebook => String(notebook?.name || '').trim()));
    for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** Adds the key values, the count of differences and ⇄ to a set's card (`row`, with its main and actions). */
export function decorateParameterSet(row, notebook, recipe) {
    const setWorkflow = notebook?.data?.workflow;
    if (!setWorkflow || !recipe?.workflow) return;
    decorated.set(row, [notebook, recipe]);
    if (!following) {
        following = true;
        onKeyParamsChange(redrawSets);
    }
    let result;
    try {
        result = compareParams(paramsOf(recipe.workflow), paramsOf(setWorkflow), { isKey: keyParamTest() });
    } catch (error) {
        console.warn('[AMB] Parameter set not compared with its recipe.', error);
        return;
    }
    const counted = row => !row.volatile && !row.same;
    const differing = result.nodes.reduce((sum, node) => sum + node.rows.filter(counted).length, 0)
        + result.keys.filter(({ row }) => counted(row)).length;
    const line = el('div', 'anomalous-preset-item-keys');
    for (const { node, row } of result.keys) {
        const chip = el('span', `anomalous-preset-key-chip${row.same ? '' : ' is-differs'}`, `${row.name} ${short(row.b)}`);
        chip.title = `${node.title} · ${row.name}: ${shownValue(row.a)} → ${shownValue(row.b)}`;
        line.append(chip);
    }
    line.append(el('span', 'anomalous-preset-key-count', differing ? t('paramSetDiffers', { count: differing }) : t('paramSetSame')));
    row.querySelector('.anomalous-preset-item-main')?.append(line);

    const compare = el('button', 'anomalous-preset-item-btn anomalous-preset-set-compare', '⇄');
    compare.type = 'button';
    compare.title = t('paramSetCompare');
    compare.onclick = (event) => {
        event.stopPropagation();
        openParamCompare({ workflow: recipe.workflow, label: t('recipeParameterCurrentRecipe') }, { workflow: setWorkflow, label: notebook.name || t('recipeParameterUntitled') });
    };
    row.querySelector('.anomalous-preset-item-actions')?.prepend(compare);
}