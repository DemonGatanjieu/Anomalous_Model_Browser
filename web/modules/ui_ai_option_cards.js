/**
 * A question's options that are models or saved workflows (api/ai_panel_parts.py card_option) as cards in the
 * AI workbench's panels (ui_ai_panel.js choices; a small cover on the question bar's buttons, ui_ai_now.js): a
 * model's cover, name and type (its base model once the
 * picker's catalogue is read, ai_toolbox_data.js), a workflow as the Workflows page's card face; the AI's line
 * under each. And the way out when none fits: the models' or the workflows' picker window (ui_ai_model_pick.js,
 * ui_workflow_pick.js), whose pick goes back as the answer (`picked`).
 */

import { translate as t } from './locales.js';
import { keptCatalog, loadCatalog } from './ai_toolbox_data.js';
import { icon } from './ui_ai_icons.js';
import { openModelPicker } from './ui_ai_model_pick.js';
import { standInCover } from './ui_ai_toolbox_icons.js';
import { typeLabel } from './ui_model_types.js';
import { createRecipeCardFace, recipeCoverUrl } from './ui_recipe_cards.js';
import { appendRecipeCover } from './ui_recipe_media.js';
import { openWorkflowPicker, readRecipes } from './ui_workflow_pick.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function modelFace(model, label) {
    const box = el('span', 'anomalous-ai-option-face is-model');
    const cover = el('span', 'anomalous-ai-option-cover');
    const fallback = () => cover.replaceChildren(standInCover('models', model.folder));
    if (model.cover) {
        const img = el('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = `${model.cover}${model.cover.includes('?') ? '&' : '?'}variant=card`;
        img.onerror = fallback;
        cover.append(img);
    } else fallback();
    const type = typeLabel({ type: model.folder });
    const meta = el('span', 'anomalous-ai-option-meta', type);
    const withBase = () => {
        const base = (keptCatalog() || []).find(item => item.kind === 'models' && item.id === model.model_id)?.base;
        if (base) meta.textContent = `${type} · ${base}`;
    };
    if (keptCatalog()) withBase();
    else loadCatalog().then(withBase, () => {});
    box.append(cover, el('span', 'anomalous-ai-option-name', label), meta);
    return box;
}

function workflowFace(flow) {
    const box = el('span', 'anomalous-ai-option-face is-workflow');
    const draw = recipe => box.replaceChildren(createRecipeCardFace(recipe || { filename: flow.file, data: { name: flow.name, params: {} } }).card);
    draw(null);
    readRecipes().then(recipes => draw(recipes.get(flow.file)), () => {});
    return box;
}

/** A small cover of an option that is a model or a saved workflow, for the question bar's buttons. */
export function optionThumb(option) {
    const box = el('span', 'anomalous-ai-option-thumb');
    if (option.model) {
        const fallback = () => box.replaceChildren(standInCover('models', option.model.folder));
        if (!option.model.cover) fallback();
        else {
            const img = el('img');
            img.alt = '';
            img.src = `${option.model.cover}${option.model.cover.includes('?') ? '&' : '?'}variant=card`;
            img.onerror = fallback;
            box.append(img);
        }
        return box;
    }
    box.append(icon('workflows', 14));
    readRecipes().then((recipes) => {
        const recipe = recipes.get(option.workflow.file);
        if (!recipe) return;
        box.replaceChildren();
        appendRecipeCover(box, recipeCoverUrl(recipe), option.workflow.name, option.workflow.file);
    }, () => {});
    return box;
}

/** What goes inside an option's button when it is a model or a saved workflow: its card, the AI's line under it. */
export function optionCard(option, label, detail) {
    const box = el('span', 'anomalous-ai-option-card');
    box.append(option.model ? modelFace(option.model, label) : workflowFace(option.workflow));
    if (detail) box.append(el('span', 'anomalous-ai-option-detail', detail));
    return box;
}

/** "None of these? Pick one yourself…": the picker of the block's kind; `send(value)` with the model id or the workflow's file. */
export function pickAnother(block, send) {
    const models = block.pick_kind === 'models';
    const node = el('button', 'anomalous-ai-option-other');
    node.type = 'button';
    node.append(icon(models ? 'models' : 'workflows', 15), el('span', '', t(models ? 'aiPanelPickModel' : 'aiPanelPickWorkflow')));
    node.onclick = async () => {
        node.disabled = true;
        try {
            if (models) {
                const types = new Set(block.options.map(option => option.model?.folder).filter(Boolean));
                const all = (await loadCatalog()).filter(item => item.kind === 'models');
                const sameType = all.filter(item => types.has(item.type));
                openModelPicker({ title: t('aiPanelPickModelTitle'), models: sameType.length ? sameType : all, max: 1, min: 1, from: node, onDone: ids => send(ids[0]) });
            } else {
                const recipes = await readRecipes();
                const workflows = [...recipes.values()].map(recipe => ({ name: recipe.data?.name || recipe.filename, file: recipe.filename }));
                openWorkflowPicker({ title: t('aiWfPickTitle'), workflows, from: node, onDone: workflow => send(workflow.file) });
            }
        } catch (error) {
            node.title = error.message;
        } finally {
            node.disabled = false;
        }
    };
    return node;
}
