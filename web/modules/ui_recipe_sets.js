/**
 * The left column of a workflow's details: its values (the workflow's own, then each saved
 * set unlike them, newest first) and two more views, all its pictures and its versions. A set
 * shows its key values and how many values differ (ui_param_set_keys.js); Save the canvas and
 * New add one; a set's ⋯ renames or deletes it.
 */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { assertRecipeSkeleton } from './recipe_actions.js';
import { captureRecipeDraft } from './recipe_parser.js';
import { appendText, button, dateText } from './ui_recipe_detail_dom.js';
import { cloneJson } from './ui_recipe_parameter_utils.js';
import { decorateParameterSet, nextSetName } from './ui_param_set_keys.js';
import { openPopupMenu } from './ui_popup_menu.js';

const t = (key, params) => translate(key, params);

const post = (url, body) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
}).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (payload.status && payload.status !== 'success')) throw new Error(payload.message || `HTTP ${response.status}`);
    return payload;
});

/** The saved sets worth listing: those whose values differ from the workflow's own (saving it keeps one equal). */
export function listedSets(recipe, notebooks) {
    const own = recipe?.parameter_signature?.value;
    return (notebooks || []).filter(notebook => !own || notebook?.data?.parameter_signature?.value !== own);
}

/** Saves the canvas's values as a new set of this workflow, when its nodes match; selects it. */
async function saveCanvasAsSet(ctx) {
    const { owner, recipe, parameterState } = ctx;
    try {
        if (!app.graph?.serialize) throw new Error('recipe_parameter_canvas_unavailable');
        const current = captureRecipeDraft(app.graph);
        assertRecipeSkeleton(recipe.workflow, current.workflow);
        const { filename } = await post('/anomalous/save_parameter', {
            name: nextSetName(recipe, parameterState.notebooks),
            tags: recipe.tags || [],
            notes: recipe.notes || '',
            params: current.metadata,
            workflow: current.workflow,
            recipe_filename: owner.recipeDetailFilename,
        });
        parameterState.selectedFilename = filename || null;
        await parameterState.refresh?.(true);
        ctx.select('set', filename || null);
    } catch (error) {
        console.error('Could not save the canvas as a parameter set:', error);
        await anomalousAlert(error.code === 'recipe_parameter_skeleton_mismatch'
            ? t('recipeParameterSkeletonMismatch')
            : t('recipeParameterReadCurrentError'));
    }
}

/** A new set to edit, from `source`'s values (the workflow's own when none). */
export function editNewSet(ctx, source) {
    const { recipe, parameterState } = ctx;
    const draft = cloneJson({ workflow: (source || recipe).workflow, params: (source || recipe).params || {} });
    if (!draft?.workflow) return;
    parameterState.editor = { draft, name: nextSetName(recipe, parameterState.notebooks) };
    ctx.select('set', parameterState.selectedFilename);
}

export async function renameSet(ctx, notebook) {
    const current = notebook.name || t('recipeParameterUntitled');
    const name = (await anomalousPrompt(t('recipeParameterRenamePrompt'), current))?.trim();
    if (!name || name === current) return;
    try {
        await post('/anomalous/rename_parameter', { filename: notebook.filename, name });
        await ctx.parameterState.refresh?.(true);
    } catch (error) {
        console.error('Could not rename parameter set:', error);
        await anomalousAlert(t('recipeParameterRenameError'));
    }
}

export async function deleteSet(ctx, notebook) {
    const name = notebook.name || t('recipeParameterUntitled');
    if (!await anomalousConfirm(t('recipeParameterDeleteConfirm', { name }))) return;
    const { parameterState } = ctx;
    try {
        await post('/anomalous/delete_parameter', { filename: notebook.filename });
        if (parameterState.selectedFilename === notebook.filename) parameterState.selectedFilename = null;
        parameterState.editor = null;
        await parameterState.refresh?.(true);
        ctx.select('set', parameterState.selectedFilename);
    } catch (error) {
        console.error('Could not delete parameter set:', error);
        await anomalousAlert(t('recipeParameterDeleteError'));
    }
}

function navItem(list, label, active, onClick, className = '') {
    const item = button(list, label, `anomalous-wfd-nav-item ${className}${active ? ' is-active' : ''}`);
    item.onclick = onClick;
    return item;
}

/** A saved set's row: name and date, its key values (added by decorateParameterSet), ⇄ and ⋯ on hover. */
function setRow(list, ctx, notebook, active) {
    const row = document.createElement('div');
    row.className = `anomalous-wfd-set${active ? ' is-active' : ''}`;
    row.onclick = () => {
        ctx.parameterState.editor = null;
        ctx.select('set', notebook.filename);
    };
    const main = document.createElement('div');
    main.className = 'anomalous-wfd-set-main';
    const name = appendText(main, 'div', notebook.name || t('recipeParameterUntitled'), 'anomalous-wfd-set-name');
    name.title = name.textContent;
    appendText(main, 'div', dateText(notebook.timestamp), 'anomalous-wfd-set-date');
    const actions = document.createElement('div');
    actions.className = 'anomalous-wfd-set-actions';
    const more = button(actions, '⋯', 'anomalous-preset-item-btn');
    more.title = t('notebookMore');
    more.onclick = (event) => {
        event.stopPropagation();
        openPopupMenu(more, [
            { label: t('recipeParameterRename'), run: () => renameSet(ctx, notebook) },
            { label: t('workflowSetCopy'), run: () => editNewSet(ctx, notebook.data) },
            { label: t('recipeParameterDelete'), danger: true, run: () => deleteSet(ctx, notebook) },
        ]);
    };
    row.append(main, actions);
    list.appendChild(row);
    decorateParameterSet(row, notebook, ctx.recipe);
}

/** Draws the column into `nav` for the current view ({ kind: 'set' | 'gallery' | 'versions', filename }). */
export function renderDetailNav(nav, ctx) {
    const { recipe, parameterState, gallery, history, view } = ctx;
    nav.replaceChildren();
    const head = document.createElement('div');
    head.className = 'anomalous-wfd-nav-head';
    appendText(head, 'span', t('recipeParameterSnapshots'));
    const fromCanvas = button(head, `+ ${t('workflowSetFromCanvas')}`, 'anomalous-wfd-nav-add');
    fromCanvas.title = t('recipeParameterReadCurrent');
    fromCanvas.onclick = async () => {
        fromCanvas.disabled = true;
        await saveCanvasAsSet(ctx);
        fromCanvas.disabled = false;
    };
    nav.appendChild(head);

    const list = document.createElement('div');
    list.className = 'anomalous-wfd-set-list';
    const own = navItem(list, t('workflowOwnValues'), view.kind === 'set' && !view.filename && !parameterState.editor, () => {
        parameterState.editor = null;
        ctx.select('set', null);
    }, 'is-own');
    own.title = t('workflowOwnValuesHint');
    if (parameterState.status === 'loading') appendText(list, 'p', t('recipeParameterLoading'), 'anomalous-wfd-muted');
    else if (parameterState.status === 'error') appendText(list, 'p', t('recipeParameterLoadError'), 'anomalous-wfd-muted');
    for (const notebook of listedSets(recipe, parameterState.notebooks)) {
        setRow(list, ctx, notebook, view.kind === 'set' && view.filename === notebook.filename && !parameterState.editor);
    }
    if (parameterState.editor) navItem(list, `${parameterState.editor.name} · ${t('workflowSetEditing')}`, true, () => {}, 'is-editing');
    const add = button(list, `+ ${t('recipeParameterNew')}`, 'anomalous-wfd-nav-new');
    add.onclick = () => editNewSet(ctx, parameterState.notebooks.find(item => item.filename === view.filename)?.data);
    nav.appendChild(list);

    const more = document.createElement('div');
    more.className = 'anomalous-wfd-nav-more';
    const pictures = gallery.status === 'ready' ? ` (${gallery.images.length})` : '';
    navItem(more, `${t('workflowAllPictures')}${pictures}`, view.kind === 'gallery', () => ctx.select('gallery'));
    navItem(more, `${t('recipeDetailVersions')} (${(history || []).length})`, view.kind === 'versions', () => ctx.select('versions'));
    nav.appendChild(more);
}