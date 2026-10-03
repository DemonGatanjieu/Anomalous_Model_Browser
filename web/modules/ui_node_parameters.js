/**
 * The current-node panel's parameters: every saved set of values for the node's type
 * (node_parameter_sets.js: materials and recipes, merged), each with exactly what it would
 * change on this node; one press puts those in (seeds and model files stay, the receipt
 * undoes it); saved values (not a recipe's) can be deleted. "Save these values" keeps the
 * node's current values for the next node of its kind.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { showApplyReceipt } from './ui_apply_receipt.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { applyParameterChanges, deleteSavedValues, loadParameterSets, parameterChanges, saveNodeParameters } from './node_parameter_sets.js';

const SHOWN_CHANGES = 4;
const SEARCH_FROM = 6; // entries before a search box is worth showing
const ROLE_KEYS = { positive: 'recipePromptRolePositive', negative: 'recipePromptRoleNegative', both: 'recipePromptRoleBoth' };

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

const brief = (value) => {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ') : JSON.stringify(value);
    return text.length > 48 ? `${text.slice(0, 47)}…` : text;
};

const sourceLabel = source => (source.kind === 'recipe'
    ? t('currentNodeFromRecipe', { name: source.label })
    : t('currentNodeFromMaterial'));

function entryCard(node, entry, receiptHost, redraw, remove) {
    const changes = parameterChanges(node, entry.values);
    const made = changes.filter(change => !change.keep);
    const card = el('div', 'anomalous-node-param');
    const head = el('div', 'anomalous-node-param-head');
    head.append(el('strong', 'anomalous-node-param-name', entry.name));
    if (ROLE_KEYS[entry.role]) head.append(el('span', `anomalous-node-param-role is-${entry.role}`, t(ROLE_KEYS[entry.role])));
    const sources = el('div', 'anomalous-node-param-sources');
    for (const label of new Set(entry.sources.map(sourceLabel))) sources.append(el('span', '', label));
    card.append(head, sources);

    if (made.length) {
        const list = el('ul', 'anomalous-node-param-changes');
        for (const change of made.slice(0, SHOWN_CHANGES)) {
            const item = el('li', '', `${change.label}: ${brief(change.from)} → ${brief(change.to)}`);
            item.title = `${change.label}: ${change.to}`;
            list.append(item);
        }
        if (made.length > SHOWN_CHANGES) list.append(el('li', 'is-more', t('currentNodeMoreChanges', { count: made.length - SHOWN_CHANGES })));
        card.append(list);
    }
    const kept = changes.filter(change => change.keep);
    if (kept.length) card.append(el('p', 'anomalous-node-param-kept', t('currentNodeKept', { names: kept.map(change => change.label).join(', ') })));

    const apply = button('anomalous-node-param-apply', made.length ? t('currentNodeApply', { count: made.length }) : t('currentNodeSame'), () => {
        try {
            const result = applyParameterChanges(app, node, made);
            showApplyReceipt(receiptHost, { undo() { result.undo(); redraw(); } }, node);
            redraw();
        } catch (error) {
            showWorkbenchToast(t(error.message) === error.message ? t('materialApplyFailed') : t(error.message));
        }
    });
    apply.disabled = !made.length;
    const actions = el('div', 'anomalous-node-param-actions');
    // Values saved here or kept from images can be deleted; a recipe's sets belong to the recipe.
    const saved = [...new Set(entry.sources.filter(source => source.kind === 'material' && source.filename).map(source => source.filename))];
    if (saved.length) actions.append(button('anomalous-node-param-delete', t('currentNodeDelete'), () => remove(entry, saved)));
    actions.append(apply);
    card.append(actions);
    return card;
}

/** Appends the parameters section for `node` to `container` and loads its entries. */
export function renderNodeParameters(node, container) {
    const section = el('section', 'anomalous-node-section');
    const head = el('div', 'anomalous-node-section-head');
    const search = el('input', 'anomalous-node-param-search');
    search.type = 'search';
    search.placeholder = t('currentNodeSearch');
    search.hidden = true;
    const list = el('div', 'anomalous-node-param-list');
    list.append(el('p', 'anomalous-node-muted', t('loading')));
    section.append(head, search, list);
    container.append(section);

    let entries = [];
    const draw = () => {
        const query = search.value.trim().toLowerCase();
        const shown = entries.filter(entry => !query
            || `${entry.name} ${entry.sources.map(source => source.label).join(' ')}`.toLowerCase().includes(query));
        search.hidden = entries.length < SEARCH_FROM;
        list.replaceChildren(...(shown.length
            ? shown.map(entry => entryCard(node, entry, section, draw, remove))
            : [el('p', 'anomalous-node-muted', t(entries.length ? 'currentNodeNoMatch' : 'currentNodeNoSets'))]));
    };
    search.oninput = draw;

    const load = async () => {
        const run = (section._load = (section._load || 0) + 1);
        try {
            const loaded = await loadParameterSets(node.type);
            if (run !== section._load || !section.isConnected) return;
            entries = loaded;
            draw();
        } catch (error) {
            if (run === section._load) list.replaceChildren(el('p', 'anomalous-node-muted is-error', t('currentNodeLoadFailed')));
        }
    };

    const remove = async (entry, filenames) => {
        if (!await anomalousConfirm(t('currentNodeDeleteConfirm', { name: entry.name }), t('currentNodeDelete'), { okLabel: t('currentNodeDelete') })) return;
        try {
            for (const filename of filenames) await deleteSavedValues(filename);
        } catch (error) {
            showWorkbenchToast(t('currentNodeDeleteFailed'));
        }
        if (section.isConnected) load();
    };

    const save = async () => {
        const name = await anomalousPrompt(t('currentNodeSaveName'), node.title || node.type, t('currentNodeSave'));
        if (name === null) return;
        try {
            const result = await saveNodeParameters(node, name || node.title || node.type);
            showWorkbenchToast(t(result.status === 'duplicate' ? 'currentNodeSavedBefore' : 'currentNodeSaved', { name: result.name }));
            if (section.isConnected) load();
        } catch (error) {
            showWorkbenchToast(t('currentNodeSaveFailed'));
        }
    };
    head.append(el('h3', '', t('currentNodeParams')), button('anomalous-node-section-btn', t('currentNodeSave'), save));
    load();
}
