/**
 * A Workflow Recipe's card on the Workflows page: its cover (a dot when its models are all
 * here, words when some are missing; 功能模块 marks a partial workflow), its name, a line of
 * its steps, sampler, LoRAs and size, and its model. Two small buttons in the cover's corner,
 * Open (or append, for a partial one) and ⋯ (edit, export, delete), show while the pointer is
 * on the card; a press anywhere else opens its details, and the card drags onto the canvas.
 * The page lays cards as a grid or a list
 * (styles/28-workflows.css).
 */

import { app } from "../../../scripts/app.js";
import { translate } from "./locales.js";
import { anomalousAlert, anomalousConfirm } from "./ui_dialog.js";
import { bindMaterialDrag } from "./material_drag.js";
import { applyRecipeToCanvas, showRecipeDetail } from "./ui_recipe_detail.js";
import { exportRecipePackage } from "./ui_recipe_package.js";
import { appendText } from "./ui_recipe_detail_dom.js";
import { appendRecipeCover, outputImageUrl, previewIsVideo, recipeAssetUrl, safeThumbnail } from "./ui_recipe_media.js";
import { openPopupMenu } from "./ui_popup_menu.js";

const t = (key, params) => translate(key, params);

async function runRecipeCardAction(actionButton, action, errorKey) {
    if (!actionButton || actionButton.disabled) return;
    actionButton.disabled = true;
    actionButton.classList.add('is-busy');
    try {
        await action();
    } catch (error) {
        console.error('Workflow Recipe action failed:', error);
        await anomalousAlert(t(errorKey));
    } finally {
        actionButton.disabled = false;
        actionButton.classList.remove('is-busy');
    }
}

function modelDisplayName(value) {
    const path = String(value || '').replace(/\\/g, '/');
    const filename = path.split('/').pop() || '';
    return filename.replace(/\.(?:safetensors|ckpt|pt|bin|sft)$/i, '');
}

function formatRecipeResolution(res) {
    if (!res) return '';
    if (typeof res === 'string' || typeof res === 'number') return String(res);
    if (Array.isArray(res) && res.length >= 2) return `${res[0]}×${res[1]}`;
    if (typeof res === 'object') {
        const w = res.width ?? res.w ?? res.x;
        const h = res.height ?? res.h ?? res.y;
        if (w && h) return `${w}×${h}`;
    }
    return '';
}

/** The line of how a recipe draws: steps, sampler, LoRAs, size. */
function recipeMetaLine(params) {
    if (!params || typeof params !== 'object') return '';
    const loras = Array.isArray(params.loras) ? params.loras : [];
    return [
        params.steps ? t('workflowsSteps', { count: params.steps }) : '',
        params.sampler_name || '',
        loras.length ? `${loras.length} LoRA` : '',
        formatRecipeResolution(params.resolution),
    ].filter(Boolean).join(' · ');
}

export function getRecipeReadiness(recipeData) {
    const refs = recipeData?.params?.model_references;
    if (!Array.isArray(refs) || !refs.length) {
        return { status: 'ready', label: t('recipeStatusReady') };
    }
    let missing = 0;
    let unverified = 0;
    for (const ref of refs) {
        const status = ref?.currentAvailability;
        if (status === 'unavailable' || status === 'missing' || ref?.identity?.status === 'unavailable') {
            missing++;
        } else if (status === 'available' || ref?.localModel) {
            // ready
        } else if (status !== 'available') {
            unverified++;
        }
    }
    if (missing > 0) {
        const tmpl = t('recipeStatusMissing');
        const label = tmpl.includes('{count}') ? tmpl.replace('{count}', String(missing)) : `${missing} ${tmpl}`;
        return { status: 'missing', label };
    }
    if (unverified > 0) {
        return { status: 'warning', label: `${unverified} ${t('recipeStatusUnverified')}` };
    }
    return { status: 'ready', label: t('recipeStatusReady') };
}

/** The models' state on the cover: a dot when all is well, words when something is missing. */
function readinessMark(data) {
    const readiness = getRecipeReadiness(data);
    const label = readiness.label.replace(/^[🟢🟡🔴⏳]\s*/u, '');
    const mark = document.createElement('span');
    mark.className = `anomalous-wf-status is-${readiness.status}`;
    mark.title = `${label} — ${t('recipeReadinessHint')}`;
    if (readiness.status === 'missing') mark.textContent = label;
    else mark.setAttribute('aria-label', label);
    return mark;
}

async function deleteRecipe(owner, recipe) {
    if (!await anomalousConfirm(t('recipeDeleteConfirm'))) return;
    const response = await fetch('/anomalous/delete_recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: recipe.filename }),
    });
    if (!response.ok) throw new Error('recipe deletion failed');
    await owner.refreshRecipes();
}

/** Open / append and ⋯: small buttons in the cover's corner, so a press meant for the details does not open the canvas. */
function cardActions(owner, recipe, services, isPartial) {
    const actions = document.createElement('div');
    actions.className = 'anomalous-wf-actions';
    const open = appendText(actions, 'button', isPartial ? '+' : '▶', 'anomalous-wf-open');
    open.type = 'button';
    open.title = t(isPartial ? 'recipeCardPrimaryActionTooltipPartial' : 'recipeCardPrimaryActionTooltipComplete');
    open.setAttribute('aria-label', t(isPartial ? 'recipeAppendCanvas' : 'recipeOpenCanvas'));
    open.onclick = (event) => {
        event.stopPropagation();
        runRecipeCardAction(open, async () => {
            const graph = app.graph;
            const fullRecipe = await services.fetchRecipeData(recipe.filename);
            if (app.graph !== graph) throw new Error('materialTargetChanged');
            await applyRecipeToCanvas(owner, fullRecipe);
        }, isPartial ? 'recipeAppendError' : 'recipeOpenError');
    };
    const more = appendText(actions, 'button', '⋯', 'anomalous-wf-more');
    more.type = 'button';
    more.title = t('notebookMore');
    more.setAttribute('aria-label', t('notebookMore'));
    more.onclick = (event) => {
        event.stopPropagation();
        openPopupMenu(more, [
            { label: t('recipeEdit'), run: () => runRecipeCardAction(more, () => services.editRecipe(owner, recipe?.data || {}, recipe.filename), 'recipeUpdateError') },
            { label: t('recipeExport'), run: () => exportRecipePackage(recipe) },
            { label: t('recipeDelete'), danger: true, run: () => runRecipeCardAction(more, () => deleteRecipe(owner, recipe), 'recipeDeleteError') },
        ]);
    };
    return actions;
}

/** The model's line; the parameter set count joins it on the right (ui_param_set_keys.js). */
function modelLine(params) {
    const line = document.createElement('div');
    line.className = 'anomalous-wf-extras';
    const model = modelDisplayName(params?.baseModel || params?.baseModels);
    const name = appendText(line, 'span', model, 'anomalous-wf-model');
    name.title = model;
    return line;
}

export function createRecipeCard(owner, recipe, services) {
    const data = recipe?.data || {};
    const isPartial = data.workflow_scope === 'partial';
    const card = document.createElement('article');
    card.className = 'anomalous-wf-card';
    card.title = `${data.name || t('recipeUntitled')} — ${t('recipeCardDragHint')}`;

    const cover = document.createElement('div');
    cover.className = 'anomalous-wf-cover';
    const sourceImageUrl = outputImageUrl(data.source_image);
    const savedCover = recipeAssetUrl(recipe.filename, data.presentation?.cover_asset_id);
    const thumbnail = savedCover || (previewIsVideo(sourceImageUrl)
        ? sourceImageUrl
        : safeThumbnail(data.thumbnail) || sourceImageUrl);
    appendRecipeCover(cover, thumbnail, data.name || t('recipeThumbnail'), recipe?.filename || data.name);
    cover.append(readinessMark(data));
    if (isPartial) appendText(cover, 'span', t('recipeScopePill_partial'), 'anomalous-wf-kind');
    card.append(cover, cardActions(owner, recipe, services, isPartial));

    const info = document.createElement('div');
    info.className = 'anomalous-wf-info';
    const title = appendText(info, 'h3', data.name || t('recipeUntitled'), 'anomalous-wf-title');
    title.title = data.name || t('recipeUntitled');
    const meta = appendText(info, 'div', recipeMetaLine(data.params), 'anomalous-wf-meta');
    meta.title = meta.textContent;
    info.append(modelLine(data.params));
    card.append(info);

    card.onclick = () => runRecipeCardAction(card, async () => {
        const bundle = await services.fetchRecipeBundle(recipe.filename);
        const result = await showRecipeDetail(owner, {
            recipe: bundle.data,
            filename: recipe.filename,
            history: bundle.history,
        });
        if (result?.mode === 'edit') await services.editRecipe(owner, bundle.data, recipe.filename, bundle.history);
    }, 'recipeLoadError');

    // Dragged onto the canvas, the card opens its workflow like a dropped ComfyUI picture.
    bindMaterialDrag(card, owner, {
        payload: () => ({
            type: 'recipe',
            filename: recipe.filename,
            scope: data.workflow_scope || 'complete',
            dragHint: t('recipeDragHint'),
            dragTargetHint: t('recipeDragTargetCanvas'),
        }),
        accepts: () => false,
        dropOnCanvas: async (event, dragData, graph) => {
            const fullRecipe = await services.fetchRecipeData(dragData.filename);
            if (app.graph !== graph) throw new Error('materialTargetChanged');
            await applyRecipeToCanvas(owner, fullRecipe);
        },
    });

    return card;
}