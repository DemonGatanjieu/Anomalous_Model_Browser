/**
 * The right side of a workflow's details for one set of values (the workflow's own, or a saved
 * set): its name with Apply to canvas, ⇄ and ⋯; for the workflow's own, its cover, notes and
 * tags; the main values (steps, CFG, sampler…, the model and LoRAs); the prompts; the pictures
 * made with these values (each ⇄ to compare); the models (the workflow's own only) and every
 * node's values, folded. A new set being made shows its editor instead.
 */

import { translate } from './locales.js';
import { applyRecipeParametersToCanvas } from './recipe_actions.js';
import { appendText, button, dateText } from './ui_recipe_detail_dom.js';
import { formatRecipeResolution } from './ui_recipe_parameter_utils.js';
import { renderParameterNotebookEditor, renderPromptSection, renderRawNodesLazy } from './ui_recipe_parameters.js';
import { renderImageGrid } from './ui_recipe_gallery.js';
import { renderRecipeInfo } from './ui_recipe_info.js';
import { modelDisplayName, renderRecipeModels } from './ui_recipe_models.js';
import { deleteSet, editNewSet, renameSet } from './ui_recipe_sets.js';
import { openParamCompare } from './ui_param_compare.js';
import { openPopupMenu } from './ui_popup_menu.js';

const t = (key, params) => translate(key, params);

function section(parent, title, className = '') {
    const box = document.createElement('section');
    box.className = `anomalous-wfd-section ${className}`.trim();
    const head = document.createElement('div');
    head.className = 'anomalous-wfd-section-head';
    appendText(head, 'h3', title);
    box.appendChild(head);
    parent.appendChild(box);
    return box;
}

/** A folded section: its body is drawn the first time it opens. */
function foldedSection(parent, title, draw, open = false) {
    const box = document.createElement('details');
    box.className = 'anomalous-wfd-section is-folded';
    appendText(box, 'summary', title);
    let drawn = false;
    const drawOnce = () => {
        if (drawn || !box.open) return;
        drawn = true;
        draw(box);
    };
    box.addEventListener('toggle', drawOnce);
    parent.appendChild(box);
    box.open = open;
    drawOnce();
}

/** Writes `source`'s values onto the canvas's matching nodes and says how it went. */
function applyToCanvas(source, applyButton, status) {
    applyButton.disabled = true;
    status.classList.remove('is-error');
    try {
        const result = applyRecipeParametersToCanvas(source);
        status.textContent = t('recipeParameterApplied', { count: result.widgets });
    } catch (error) {
        console.error('Could not apply parameter set:', error);
        const key = {
            recipe_parameter_skeleton_mismatch: 'recipeParameterSkeletonMismatch',
            recipe_parameter_widget_mismatch: 'recipeParameterWidgetMismatch',
            recipe_parameter_node_unavailable: 'recipeParameterNodeUnavailable',
        }[error.code] || 'recipeParameterApplyError';
        status.textContent = `${t(key)} ${error.message || ''}`.trim();
        status.classList.add('is-error');
    } finally {
        applyButton.disabled = false;
    }
}

function setHead(main, ctx, notebook, source) {
    const { recipe } = ctx;
    const name = notebook ? notebook.name || t('recipeParameterUntitled') : t('workflowOwnValues');
    const head = document.createElement('div');
    head.className = 'anomalous-wfd-set-head';
    const titles = document.createElement('div');
    titles.className = 'anomalous-wfd-set-titles';
    appendText(titles, 'h2', name, 'anomalous-wfd-set-title');
    appendText(titles, 'small', notebook ? dateText(notebook.timestamp) : t('workflowOwnValuesHint'), 'anomalous-wfd-muted');
    const actions = document.createElement('div');
    actions.className = 'anomalous-wfd-actions';
    const status = document.createElement('small');
    status.className = 'anomalous-wfd-apply-status';
    const apply = button(actions, t('recipeParameterApply'), 'anomalous-wfd-primary');
    apply.onclick = () => applyToCanvas(source, apply, status);
    const own = { workflow: recipe.workflow, label: t('workflowOwnValues') };
    const mine = { workflow: source.workflow, label: name };
    const compare = button(actions, `⇄ ${t('workflowCompare')}`, 'anomalous-wf-filter');
    compare.onclick = () => openPopupMenu(compare, [
        ...(notebook ? [{ label: t('compareWithDefault'), run: () => openParamCompare(own, mine) }] : []),
        { label: t('compareWithCanvas'), run: () => openParamCompare(mine, { canvas: true }) },
    ]);
    const more = button(actions, '⋯', 'anomalous-wf-icon-btn');
    more.title = t('notebookMore');
    more.onclick = () => openPopupMenu(more, [
        { label: t('workflowSetCopy'), run: () => editNewSet(ctx, source) },
        ...(notebook ? [
            { label: t('recipeParameterRename'), run: () => renameSet(ctx, notebook) },
            { label: t('recipeParameterDelete'), danger: true, run: () => deleteSet(ctx, notebook) },
        ] : []),
    ]);
    head.append(titles, actions);
    main.append(head, status);
    return { own, mine };
}

/** The values one sees first: tiles for steps, CFG and the like, then the model and LoRAs. */
function mainValues(main, params) {
    const box = section(main, t('workflowMainValues'));
    const tiles = document.createElement('div');
    tiles.className = 'anomalous-wfd-stats';
    for (const [key, value] of [
        ['recipeDetailSteps', params.steps],
        ['recipeDetailCFG', params.cfg],
        ['recipeDetailSampler', params.sampler_name || params.samplers],
        ['recipeDetailScheduler', params.scheduler],
        ['recipeDetailResolution', formatRecipeResolution(params.resolution)],
        ['recipeDetailDenoise', params.denoise],
    ]) {
        const shown = Array.isArray(value) ? value.join(', ') : value;
        if (shown === undefined || shown === null || shown === '') continue;
        const tile = document.createElement('div');
        tile.className = 'anomalous-wfd-stat';
        appendText(tile, 'span', t(key), 'anomalous-wfd-stat-label');
        const strong = appendText(tile, 'strong', String(shown), 'anomalous-wfd-stat-value');
        strong.title = String(shown);
        tiles.appendChild(tile);
    }
    if (tiles.childElementCount) box.appendChild(tiles);
    const models = document.createElement('div');
    models.className = 'anomalous-wfd-model-lines';
    const base = params.baseModel || params.baseModels;
    if (base) {
        const line = appendText(models, 'div', '', 'anomalous-wfd-model-line');
        appendText(line, 'span', t('recipeDetailBaseModel'), 'anomalous-wfd-stat-label');
        appendText(line, 'span', modelDisplayName(base), 'anomalous-wfd-model-name').title = String(base);
    }
    for (const lora of Array.isArray(params.loras) ? params.loras : []) {
        const loraName = typeof lora === 'object' && lora ? lora.name || '' : String(lora);
        const line = appendText(models, 'div', '', 'anomalous-wfd-model-line');
        appendText(line, 'span', 'LoRA', 'anomalous-wfd-stat-label');
        appendText(line, 'span', modelDisplayName(loraName), 'anomalous-wfd-model-name').title = loraName;
        if (typeof lora === 'object' && lora) appendText(line, 'span', `${lora.strength_model ?? 1} / ${lora.strength_clip ?? 1}`, 'anomalous-wfd-model-weight');
    }
    if (models.childElementCount) box.appendChild(models);
    if (!box.querySelector('.anomalous-wfd-stats, .anomalous-wfd-model-lines')) appendText(box, 'p', t('recipeDetailNoSavedParameters'), 'anomalous-wfd-muted');
}

/** The pictures made with these values, each ⇄ to compare (with the workflow's own values too, for a set). */
function pictures(main, ctx, sides) {
    const { owner, parameterGallery, notebook } = ctx;
    const count = parameterGallery.status === 'ready' ? ` (${parameterGallery.images.length})` : '';
    const box = section(main, `${t('workflowSetPictures')}${count}`);
    if (parameterGallery.status === 'ready' && parameterGallery.images.length) {
        renderImageGrid(box, owner, parameterGallery.images, {
            compareOthers: notebook ? [{ label: t('compareWithDefault'), side: sides.own }] : [],
        });
        return;
    }
    const key = parameterGallery.status === 'error' ? 'recipeGalleryLoadError'
        : parameterGallery.status === 'ready' ? 'workflowSetNoPictures' : 'recipeGalleryLoading';
    appendText(box, 'p', t(key), 'anomalous-wfd-muted');
}

/** Draws the set view into `main`. ctx: owner, recipe, parameterState, parameterGallery, references, notebook, openModel, rerender. */
export function renderSetView(main, ctx) {
    const { owner, recipe, parameterState, references, notebook } = ctx;
    main.replaceChildren();
    if (parameterState.editor) {
        renderParameterNotebookEditor(main, owner, recipe, parameterState, ctx.rerender);
        return;
    }
    const source = notebook?.data?.workflow ? notebook.data : recipe;
    const sides = setHead(main, ctx, notebook, source);
    if (!notebook) renderRecipeInfo(main, owner, recipe);
    mainValues(main, source.params || {});
    renderPromptSection(section(main, t('recipeDetailPrompts')), owner, recipe, source, ctx.rerender);
    pictures(main, ctx, sides);
    if (!notebook) {
        const missing = references.some(ref => ref.currentAvailability === 'missing');
        foldedSection(main, `${t('recipeDetailModelComposition')} (${references.length})`, (box) => {
            const list = document.createElement('div');
            box.appendChild(list);
            renderRecipeModels(list, owner, recipe, references, ctx.openModel);
        }, missing);
    }
    foldedSection(main, t('workflowAllNodeValues'), box => renderRawNodesLazy(box, source));
}