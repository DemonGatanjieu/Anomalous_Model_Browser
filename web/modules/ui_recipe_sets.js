/**
 * The presets of a workflow's details: the row of tabs under the flow (the workflow's own values,
 * then each saved preset unlike them, newest first, each with how many values it changes; + to add
 * one; all its pictures and its versions at the end) and the preset actions (save the canvas, new,
 * rename, delete).
 */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { assertRecipeSkeleton } from './recipe_actions.js';
import { captureRecipeDraft } from './recipe_parser.js';
import { appendText, button, dateText } from './ui_recipe_detail_dom.js';
import { cloneJson } from './ui_recipe_parameter_utils.js';
import { nextSetName, setDifferences } from './ui_param_set_keys.js';
import { addWorkflowSave } from './ui_snapshot_bar.js';
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
export async function saveCanvasAsSet(ctx) {
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

/** Whether the canvas shows the workflow `source` belongs to. */
function canvasIsSet(source) {
    try {
        const skeleton = assertRecipeSkeleton(source.workflow, app.graph.serialize());
        return skeleton.sourceCount === skeleton.candidateCount;
    } catch {
        return false;
    }
}

/** Puts `source`'s values among the saves of the canvas showing this workflow; with none open, the workflow opens on a new tab first. */
export async function addSetToSaves(ctx, source) {
    if (!canvasIsSet(source)) await app.loadGraphData(cloneJson(ctx.recipe.workflow));
    await addWorkflowSave(source.workflow);
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

/** One tab of the row: `name` over `note`; `className` adds is-own, is-active and the like. */
function tab(row, name, note, className, onClick) {
    const item = button(row, '', `anomalous-wfd-tab ${className}`.trim());
    appendText(item, 'span', name, 'anomalous-wfd-tab-name').title = name;
    if (note) appendText(item, 'span', note.text, `anomalous-wfd-tab-note${note.differs ? ' is-differs' : ''}`);
    item.setAttribute('role', 'tab');
    item.setAttribute('aria-selected', String(className.includes('is-active')));
    item.onclick = onClick;
    return item;
}

/** A preset's line under its name: how many values it sets unlike the workflow's own ({ text, differs, count }). */
export function differenceNote(notebook, recipe) {
    const count = setDifferences(notebook, recipe);
    if (count === null) return { text: dateText(notebook.timestamp), count };
    return count ? { text: t('workflowPresetDiffers', { count }), differs: true, count } : { text: t('paramSetSame'), count };
}

/**
 * Draws the row of tabs under the flow into `row` for the current view ({ kind: 'set' | 'gallery' |
 * 'versions', filename }): the workflow's own values, then each preset unlike them, newest first,
 * then + (save the canvas, or a new one from the preset shown); at the end all pictures and versions.
 */
export function renderPresetTabs(row, ctx) {
    const { recipe, parameterState, gallery, history, view } = ctx;
    row.replaceChildren();
    const tabs = appendText(row, 'div', '', 'anomalous-wfd-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', t('recipeParameterSnapshots'));
    const showing = filename => view.kind === 'set' && view.filename === filename && !parameterState.editor;
    const choose = filename => () => {
        parameterState.editor = null;
        ctx.select('set', filename);
    };
    tab(tabs, t('workflowOwnValues'), { text: t('workflowOwnValuesShort') }, `is-own${showing(null) ? ' is-active' : ''}`, choose(null)).title = t('workflowOwnValuesHint');
    if (parameterState.status === 'loading') appendText(tabs, 'span', t('recipeParameterLoading'), 'anomalous-wfd-muted');
    else if (parameterState.status === 'error') appendText(tabs, 'span', t('recipeParameterLoadError'), 'anomalous-wfd-muted');
    for (const notebook of listedSets(recipe, parameterState.notebooks)) {
        tab(tabs, notebook.name || t('recipeParameterUntitled'), differenceNote(notebook, recipe), showing(notebook.filename) ? 'is-active' : '', choose(notebook.filename));
    }
    if (parameterState.editor) tab(tabs, parameterState.editor.name, { text: t('workflowSetEditing') }, 'is-active is-editing', () => {});
    const add = button(tabs, `+ ${t('workflowPresetAdd')}`, 'anomalous-wfd-tab-add');
    add.onclick = () => openPopupMenu(add, [
        { label: t('recipeParameterReadCurrent'), run: () => saveCanvasAsSet(ctx) },
        { label: t('workflowPresetFromShown'), run: () => editNewSet(ctx, parameterState.notebooks.find(item => item.filename === view.filename)?.data) },
    ]);
    const more = appendText(row, 'div', '', 'anomalous-wfd-views');
    const pictures = gallery.status === 'ready' ? ` (${gallery.images.length})` : '';
    for (const [kind, label] of [['gallery', `${t('workflowAllPictures')}${pictures}`], ['versions', `${t('recipeDetailVersions')} (${(history || []).length})`]]) {
        const item = button(more, label, `anomalous-wfd-view${view.kind === kind ? ' is-active' : ''}`);
        item.onclick = () => ctx.select(kind);
    }
}
