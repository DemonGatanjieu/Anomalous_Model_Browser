/**
 * "What actually fed this run" recipe summary rendered above each run's generated pictures inside
 * the Results side view (ui_ai_outputs.js): actual reference/input picture thumbnails (`LoadImage`),
 * base model + LoRAs with weights, sampler/size/CFG snapshot, deltas vs the run before (`changes`),
 * and prompts — showing both real local values and privacy tokens (`[img*]`, `[M*]`, `[P*]`) when active.
 */

import { translate as t } from './locales.js';
import { recipeOfRun } from './ai_run_recipe.js';
import { changeWords } from './ui_ai_run_map.js';
import { icon } from './ui_ai_icons.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function tokenTag(token) {
    return el('span', 'anomalous-ai-out-token', token);
}

function makeInputThumb(img) {
    const row = el('div', 'anomalous-ai-out-input-img');
    if (img.urls?.length) {
        const pic = document.createElement('img');
        pic.className = 'anomalous-ai-out-input-thumb';
        pic.src = img.urls[0];
        pic.alt = img.path;
        pic.loading = 'lazy';
        let attempt = 0;
        pic.onerror = () => {
            attempt += 1;
            if (img.urls[attempt]) pic.src = img.urls[attempt];
            else pic.style.display = 'none';
        };
        row.append(pic);
    }
    const meta = el('div', 'anomalous-ai-out-input-meta');
    meta.append(el('span', 'anomalous-ai-out-input-file', img.filename || img.path));
    if (img.token) meta.append(tokenTag(img.token));
    row.append(meta);
    return row;
}

function samplerChips(sampler) {
    const chips = [];
    if (sampler.width && sampler.height) {
        chips.push(`${sampler.width}×${sampler.height}${sampler.batch > 1 ? ` ×${sampler.batch}` : ''}`);
    }
    if (sampler.steps) chips.push(t('aiRunSteps', { steps: sampler.steps }));
    if (sampler.cfg !== null && sampler.cfg !== undefined) chips.push(`CFG ${sampler.cfg}`);
    if (sampler.samplerName) chips.push(sampler.samplerName);
    if (sampler.scheduler) chips.push(sampler.scheduler);
    if (sampler.denoise !== null && sampler.denoise !== undefined) chips.push(t('aiMapDenoise', { value: sampler.denoise }));
    if (sampler.upscale) chips.push(sampler.upscale);
    return chips;
}

/** Build a compact collapsible recipe card for `step` (`task` optional for privacy badges). */
export function renderRunRecipe(step, task, { openDefault = false } = {}) {
    const recipe = recipeOfRun(step, task);
    if (!recipe.hasDetails) return null;

    const details = el('details', 'anomalous-ai-out-recipe');
    details.open = Boolean(openDefault || recipe.images.length || recipe.changes.length);

    const summary = el('summary', 'anomalous-ai-out-recipe-head');
    summary.append(icon('list', 13), el('span', '', t('aiOutRecipeTitle')));
    if (recipe.images.length) summary.append(el('span', 'anomalous-ai-out-recipe-tag', t('aiOutRecipeImgs', { count: recipe.images.length })));
    if (recipe.changes.length) summary.append(el('span', 'anomalous-ai-out-recipe-tag is-diff', t('aiOutRecipeDiffs', { count: recipe.changes.length })));
    details.append(summary);

    const body = el('div', 'anomalous-ai-out-recipe-body');

    if (recipe.images.length) {
        const imgSection = el('div', 'anomalous-ai-out-recipe-row');
        imgSection.append(el('span', 'anomalous-ai-out-recipe-label', t('aiOutUsedImages')));
        const imgList = el('div', 'anomalous-ai-out-input-imgs');
        for (const img of recipe.images) imgList.append(makeInputThumb(img));
        imgSection.append(imgList);
        body.append(imgSection);
    }

    if (recipe.models.length || recipe.loras.length) {
        const modSection = el('div', 'anomalous-ai-out-recipe-row');
        modSection.append(el('span', 'anomalous-ai-out-recipe-label', t('aiOutUsedModels')));
        const chips = el('div', 'anomalous-ai-out-recipe-chips');
        for (const m of recipe.models) {
            const chip = el('span', 'anomalous-ai-out-rchip is-model', m.file);
            if (m.token) chip.append(tokenTag(m.token));
            chips.append(chip);
        }
        for (const l of recipe.loras) {
            const label = l.strength !== null ? `${l.file} (${l.strength})` : l.file;
            const chip = el('span', 'anomalous-ai-out-rchip is-lora', label);
            if (l.token) chip.append(tokenTag(l.token));
            chips.append(chip);
        }
        modSection.append(chips);
        body.append(modSection);
    }

    const params = samplerChips(recipe.sampler);
    if (params.length) {
        const paramRow = el('div', 'anomalous-ai-out-recipe-row');
        paramRow.append(el('span', 'anomalous-ai-out-recipe-label', t('aiOutUsedParams')));
        const chips = el('div', 'anomalous-ai-out-recipe-chips');
        for (const text of params) chips.append(el('span', 'anomalous-ai-out-rchip', text));
        paramRow.append(chips);
        body.append(paramRow);
    }

    if (recipe.changes.length) {
        const diffRow = el('div', 'anomalous-ai-out-recipe-row');
        diffRow.append(el('span', 'anomalous-ai-out-recipe-label', t('aiOutChangedParams')));
        const chips = el('div', 'anomalous-ai-out-recipe-chips');
        for (const ch of recipe.changes) chips.append(el('span', 'anomalous-ai-out-rchip is-diff', changeWords(ch)));
        diffRow.append(chips);
        body.append(diffRow);
    }

    if (recipe.prompts.length) {
        const pRow = el('div', 'anomalous-ai-out-recipe-row');
        pRow.append(el('span', 'anomalous-ai-out-recipe-label', t('aiOutUsedPrompts')));
        const pList = el('div', 'anomalous-ai-out-rprompts');
        for (const p of recipe.prompts) {
            const line = el('div', `anomalous-ai-out-rprompt is-${p.polarity}`);
            const roleTag = el('span', 'anomalous-ai-out-rprompt-role', t(p.polarity === 'negative' ? 'aiMapNegative' : 'aiMapPositive'));
            line.append(roleTag);
            if (p.token) line.append(tokenTag(p.token));
            line.append(el('span', 'anomalous-ai-out-rprompt-text', p.text));
            pList.append(line);
        }
        pRow.append(pList);
        body.append(pRow);
    }

    details.append(body);
    return details;
}
