/**
 * Presets (预设) at a glance. A recipe card says how many presets it has, and its chip opens the
 * recipe on its first one. The details' preset tabs and a preset's head say how many values it
 * sets unlike the recipe's own (setDifferences). Each workflow is read once and kept while its
 * data lives.
 */

import { translate as t } from './locales.js';
import { readDetached } from './detached_graph.js';
import { compareParams, readParams } from './param_compare.js';

const read = new WeakMap(); // workflow object → readParams

/** A workflow's values as readParams reads them, read once per workflow object. */
export function workflowParams(workflow) {
    if (!read.has(workflow)) read.set(workflow, readDetached(workflow, readParams));
    return read.get(workflow);
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

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
 * recipe on its first set.
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
            owner.recipeReturnState = { activeTab: 'set', firstSet: true };
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

/** How many values preset `notebook` sets unlike its workflow `recipe` (a seed's after-run choice aside); null when they cannot be compared. */
export function setDifferences(notebook, recipe) {
    const setWorkflow = notebook?.data?.workflow;
    if (!setWorkflow || !recipe?.workflow) return null;
    try {
        const result = compareParams(workflowParams(recipe.workflow), workflowParams(setWorkflow));
        return result.nodes.reduce((sum, node) => sum + node.rows.filter(row => !row.volatile && !row.same).length, 0);
    } catch (error) {
        console.warn('[AMB] Parameter set not compared with its recipe.', error);
        return null;
    }
}
