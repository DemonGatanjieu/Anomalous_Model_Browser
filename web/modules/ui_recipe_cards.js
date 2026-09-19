/** Workflow Recipe cards and card-level actions. */

import { app } from "../../../scripts/app.js";
import { translate } from "./locales.js";
import { anomalousAlert, anomalousConfirm } from "./ui_dialog.js";
import { bindMaterialDrag } from "./material_drag.js";
import { applyRecipeToCanvas, showRecipeDetail } from "./ui_recipe_detail.js";
import { appendText } from "./ui_recipe_detail_dom.js";
import { appendRecipeCover, outputImageUrl, previewIsVideo, recipeAssetUrl, safeThumbnail } from "./ui_recipe_media.js";

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

function compactText(value, limit = 110) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function modelDisplayName(value) {
    const path = String(value || '').replace(/\\/g, '/');
    const filename = path.split('/').pop() || '';
    return filename.replace(/\.(?:safetensors|ckpt|pt|bin|sft)$/i, '');
}

function formatRecipeResolution(res) {
    if (!res) return '';
    if (typeof res === 'string' || typeof res === 'number') return String(res);
    if (Array.isArray(res) && res.length >= 2) return `${res[0]}x${res[1]}`;
    if (typeof res === 'object') {
        const w = res.width ?? res.w ?? res.x;
        const h = res.height ?? res.h ?? res.y;
        if (w && h) return `${w}x${h}`;
    }
    return '';
}

function createRecipeQuickSpecs(params) {
    if (!params || typeof params !== 'object') return null;
    const strip = document.createElement('div');
    strip.className = 'anomalous-recipe-specs-strip';

    const loras = Array.isArray(params.loras) ? params.loras : [];
    if (loras.length > 0) {
        const loraTag = appendText(strip, 'span', '', 'anomalous-recipe-spec-tag is-lora');
        loraTag.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>${loras.length} ${t('recipeCardSpecsLoras')}`;
        loraTag.title = loras.map((l) => (typeof l === 'object' && l?.name ? l.name : String(l))).join(', ');
    }

    if (params.steps) {
        const samplerName = params.sampler_name ? ` · ${params.sampler_name}` : '';
        const stepTag = appendText(strip, 'span', '', 'anomalous-recipe-spec-tag is-step');
        stepTag.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${params.steps} ${t('recipeCardSpecsSteps')}${samplerName}`;
        stepTag.title = `${params.steps} ${t('recipeCardSpecsSteps')}${samplerName}`;
    }

    const formattedRes = formatRecipeResolution(params.resolution);
    if (formattedRes) {
        const resTag = appendText(strip, 'span', '', 'anomalous-recipe-spec-tag');
        resTag.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>${formattedRes}`;
        resTag.title = `${t('recipeCardSpecsResolution')}: ${formattedRes}`;
    }

    return strip.childElementCount ? strip : null;
}

export function getRecipeReadiness(recipeData) {
    const refs = recipeData?.params?.model_references;
    if (!Array.isArray(refs) || !refs.length) {
        return { status: 'ready', label: t('recipeStatusReady') };
    }
    let missing = 0;
    let unverified = 0;
    let pendingMatch = 0;
    for (const ref of refs) {
        if (ref?.localMatch && !ref?.localModel) {
            pendingMatch++;
            continue;
        }
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
    if (pendingMatch > 0) {
        return { status: 'warning', label: t('recipeStatusNeedAttention').replace('{count}', String(pendingMatch)) };
    }
    if (unverified > 0) {
        return { status: 'warning', label: `${unverified} ${t('recipeStatusUnverified')}` };
    }
    return { status: 'ready', label: t('recipeStatusReady') };
}

export function ensureRecipeGuideStyles() {
    if (typeof document === 'undefined') return;
    if (document.querySelector?.('#anomalous-recipe-guide-styles')) return;
    if (typeof document.createElement !== 'function') return;

    const style = document.createElement('style');
    style.id = 'anomalous-recipe-guide-styles';
    style.textContent = `
        .anomalous-recipe-card {
            cursor: grab !important;
        }
        .anomalous-recipe-card:active {
            cursor: grabbing !important;
        }
        .anomalous-recipe-card button,
        .anomalous-recipe-card a,
        .anomalous-recipe-card select,
        .anomalous-recipe-card input {
            cursor: pointer;
        }
        .anomalous-recipe-drag-badge {
            position: absolute;
            top: 6px;
            left: 6px;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.65rem;
            font-weight: 500;
            background: rgba(10, 12, 16, 0.75);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #cbd5e1;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            pointer-events: none;
            transition: opacity 0.15s ease, background 0.15s ease, border-color 0.15s ease;
            opacity: 0.85;
            z-index: 2;
        }
        .anomalous-recipe-card:hover .anomalous-recipe-drag-badge {
            opacity: 1;
            background: rgba(15, 23, 42, 0.9);
            border-color: rgba(99, 102, 241, 0.4);
            color: #e2e8f0;
        }
        /* 修复封面底部模型就绪状态徽标对比度与穿透：深色高对比毛玻璃底板 */
        .anomalous-recipe-readiness-pill {
            display: inline-flex !important;
            align-items: center !important;
            gap: 5px !important;
            background: rgba(10, 12, 18, 0.88) !important;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border: 1px solid rgba(255, 255, 255, 0.16) !important;
            padding: 2.5px 8px !important;
            border-radius: 6px !important;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45) !important;
            color: #f1f5f9 !important;
        }
        .anomalous-recipe-readiness-pill.is-ready {
            background: rgba(10, 12, 18, 0.9) !important;
            border-color: rgba(16, 185, 129, 0.5) !important;
        }
        .anomalous-recipe-readiness-pill.is-ready .anomalous-recipe-readiness-text {
            color: #6ee7b7 !important;
            font-weight: 600 !important;
        }
        .anomalous-recipe-readiness-pill.is-warning {
            background: rgba(10, 12, 18, 0.9) !important;
            border-color: rgba(245, 158, 11, 0.6) !important;
        }
        .anomalous-recipe-readiness-pill.is-warning .anomalous-recipe-readiness-text {
            color: #fde68a !important;
            font-weight: 600 !important;
        }
        .anomalous-recipe-readiness-pill.is-missing {
            background: rgba(10, 12, 18, 0.9) !important;
            border-color: rgba(239, 68, 68, 0.6) !important;
        }
        .anomalous-recipe-readiness-pill.is-missing .anomalous-recipe-readiness-text {
            color: #fca5a5 !important;
            font-weight: 600 !important;
        }
        .anomalous-recipe-readiness-dot {
            width: 7px !important;
            height: 7px !important;
            flex-shrink: 0 !important;
        }
        .anomalous-recipe-drag-hint-strip {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 6px 14px;
            margin: 8px 16px 4px 16px;
            border-radius: 8px;
            font-size: 12px;
            color: #94a3b8;
            background: rgba(30, 41, 59, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
            flex-shrink: 0;
            line-height: 1.4;
        }
        .anomalous-recipe-drag-hint-content {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
        }
        .anomalous-recipe-drag-hint-icon {
            font-size: 14px;
            line-height: 1;
            flex-shrink: 0;
        }
        .anomalous-recipe-drag-hint-text {
            color: #cbd5e1;
            font-size: 12px;
        }
        .anomalous-recipe-drag-hint-close {
            background: transparent;
            border: none;
            color: #64748b;
            font-size: 16px;
            line-height: 1;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
            transition: all 0.15s ease;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .anomalous-recipe-drag-hint-close:hover {
            color: #f1f5f9;
            background: rgba(255, 255, 255, 0.08);
        }
        .anomalous-recipe-empty-guide {
            grid-column: 1 / -1;
            max-width: 580px;
            margin: 32px auto;
            padding: 28px 24px;
            background: rgba(255, 255, 255, 0.025);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            text-align: center;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
        }
        .anomalous-recipe-empty-icon {
            width: 52px;
            height: 52px;
            border-radius: 50%;
            background: rgba(99, 102, 241, 0.1);
            border: 1px solid rgba(99, 102, 241, 0.25);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            margin-bottom: 2px;
        }
        .anomalous-recipe-empty-title {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: #f1f5f9;
            letter-spacing: 0.2px;
        }
        .anomalous-recipe-empty-subtitle {
            margin: 0;
            font-size: 12.5px;
            line-height: 1.55;
            color: #94a3b8;
            max-width: 440px;
        }
        .anomalous-recipe-empty-steps {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 12px;
            width: 100%;
            margin-top: 8px;
            text-align: left;
        }
        .anomalous-recipe-empty-step {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 10px;
            padding: 14px 14px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            transition: background 0.15s ease, border-color 0.15s ease;
        }
        .anomalous-recipe-empty-step:hover {
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.12);
        }
        .anomalous-recipe-step-icon {
            font-size: 20px;
            line-height: 1;
            margin-bottom: 2px;
        }
        .anomalous-recipe-empty-step strong {
            font-size: 13px;
            color: #e2e8f0;
            font-weight: 600;
        }
        .anomalous-recipe-empty-step p {
            margin: 0;
            font-size: 11.5px;
            line-height: 1.5;
            color: #94a3b8;
        }
        .anomalous-recipe-empty-action-btn {
            margin-top: 6px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 18px;
            font-size: 13px;
            font-weight: 500;
            color: #fff;
            background: #4f46e5;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.15s ease;
        }
        .anomalous-recipe-empty-action-btn:hover {
            background: #4338ca;
        }
    `;
    (document.head || document.body)?.appendChild(style);
}

export function createRecipeCard(owner, recipe, services) {
    ensureRecipeGuideStyles();
    const data = recipe?.data || {};
    const card = document.createElement('article');
    card.className = 'anomalous-recipe-card';
    card.style.cursor = 'grab';
    card.title = `${data.name || t('recipeUntitled')} — ${t('recipeCardDragHint') || '按住可拖拽至画布打开工作流'}`;

    // 1. Bento Media Wrap: Cover on TOP (136px)
    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'anomalous-recipe-card-media-wrap';
    const sourceImageUrl = outputImageUrl(data.source_image);
    const savedCover = recipeAssetUrl(recipe.filename, data.presentation?.cover_asset_id);
    const thumbnail = savedCover || (previewIsVideo(sourceImageUrl)
        ? sourceImageUrl
        : safeThumbnail(data.thumbnail) || sourceImageUrl);
    appendRecipeCover(mediaWrap, thumbnail, data.name || t('recipeThumbnail'), recipe?.filename || data.name);

    // Frosted Glass Chips at bottom-left of cover (Readiness Pill + Base Model)
    const bottomChips = document.createElement('div');
    bottomChips.className = 'anomalous-recipe-cover-bottom-chips';

    const readiness = getRecipeReadiness(data);
    const readinessPill = document.createElement('span');
    readinessPill.className = `anomalous-recipe-readiness-pill is-${readiness.status}`;
    readinessPill.title = `${readiness.label} — ${t('recipeReadinessHint') || (window.anomalous_browser_lang === 'zh' ? '检测工作流所需模型在本地环境中的就绪状态，点击卡片进入详情可进行智能比对与替换' : 'Detects model dependencies; open details for smart matching and replacement')}`;
    const dot = document.createElement('span');
    dot.className = `anomalous-recipe-readiness-dot is-${readiness.status}`;
    const rText = document.createElement('span');
    rText.className = 'anomalous-recipe-readiness-text';
    rText.textContent = readiness.label.replace(/^[🟢🟡🔴⏳]\s*/, '');
    readinessPill.append(dot, rText);
    bottomChips.appendChild(readinessPill);

    const baseModelStr = data.params?.baseModel || data.params?.baseModels;
    if (baseModelStr) {
        const pill = document.createElement('span');
        pill.className = 'anomalous-recipe-cover-pill';
        pill.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:-1px;margin-right:4px;"><path d="m21 16-9 5-9-5V8l9-5 9 5v8z"/><path d="m3.27 6.96 8.73 4.84 8.73-4.84"/><path d="M12 22.08V11.8"/></svg>';
        appendText(pill, 'span', modelDisplayName(baseModelStr));
        pill.title = String(baseModelStr);
        bottomChips.appendChild(pill);
    }
    mediaWrap.appendChild(bottomChips);

    // Scope Pill (Top-right of cover)
    const isPartial = data.workflow_scope === 'partial';
    const scopePill = document.createElement('span');
    scopePill.className = `anomalous-recipe-scope-pill ${isPartial ? 'is-partial' : 'is-complete'}`;
    const scopeSvg = isPartial
        ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:-1px;margin-right:3px;"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v6"/><path d="M9 6h6"/></svg>`
        : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:-1px;margin-right:3px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
    scopePill.innerHTML = `${scopeSvg}<span>${t(isPartial ? 'recipeScopePill_partial' : 'recipeScopePill_complete')}</span>`;
    mediaWrap.appendChild(scopePill);

    // Drag Affordance Badge (Top-left of cover)
    const dragBadge = document.createElement('span');
    dragBadge.className = 'anomalous-recipe-drag-badge';
    dragBadge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block;vertical-align:-1px;margin-right:3px;"><circle cx="9" cy="5" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="19" r="2"/><circle cx="15" cy="19" r="2"/></svg><span>${t('recipeDraggableBadge') || (window.anomalous_browser_lang === 'zh' ? '可拖拽' : 'Draggable')}</span>`;
    dragBadge.title = t('recipeCardDragHint') || '按住可拖拽至画布打开工作流';
    mediaWrap.appendChild(dragBadge);

    card.appendChild(mediaWrap);

    // 2. Card Body
    const body = document.createElement('div');
    body.className = 'anomalous-recipe-card-body';

    // Header: Clean Title (Readiness relocated to cover pill)
    const header = document.createElement('div');
    header.className = 'anomalous-recipe-card-header';
    const title = appendText(header, 'h3', data.name || t('recipeUntitled'), 'anomalous-recipe-card-title');
    title.title = data.name || t('recipeUntitled');
    body.appendChild(header);

    // Quick Specs Strip
    const specs = createRecipeQuickSpecs(data.params);
    if (specs) body.appendChild(specs);

    // Compact Tags (first 3)
    if (Array.isArray(data.tags) && data.tags.length) {
        const tags = document.createElement('div');
        tags.className = 'anomalous-recipe-tags';
        for (const tag of data.tags.slice(0, 3)) {
            const tagButton = appendText(tags, 'button', compactText(tag, 18), 'anomalous-recipe-badge anomalous-recipe-badge-tag');
            tagButton.type = 'button';
            tagButton.title = t('recipeFilterByTag');
            tagButton.onclick = (event) => {
                event.stopPropagation();
                if (!owner.recipeSelectedTags) owner.recipeSelectedTags = new Set();
                owner.recipeSelectedTags = new Set([tag]);
                if (owner.recipeTagSelect) owner.recipeTagSelect.value = tag;
                owner.renderRecipeList(owner.recipeRecords || []);
            };
        }
        body.appendChild(tags);
    }

    // Footer: Primary Action Button + Mini Actions
    const footer = document.createElement('div');
    footer.className = 'anomalous-recipe-card-footer';

    const appendBtn = document.createElement('button');
    appendBtn.type = 'button';
    appendBtn.className = 'anomalous-recipe-btn-primary-action anomalous-tooltip-target';
    const actionSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:inline-block;vertical-align:-1px;margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    appendBtn.innerHTML = `${actionSvg}<span>${t(isPartial ? 'recipeAppendCanvas' : 'recipeOpenCanvas')}</span>`;
    appendBtn.removeAttribute('title');
    const primaryTooltip = isPartial
        ? (t('recipeCardPrimaryActionTooltipPartial') || `${t('recipeAppendCanvas')}（也可按住卡片直接拖至画布）`)
        : (t('recipeCardPrimaryActionTooltipComplete') || `${t('recipeOpenCanvas')}（也可按住卡片直接拖至画布）`);
    appendBtn.setAttribute('data-tooltip', primaryTooltip);
    appendBtn.setAttribute('data-tooltip-pos', 'top');
    appendBtn.onclick = (e) => {
        e.stopPropagation();
        runRecipeCardAction(appendBtn, async () => {
            const graph = app.graph;
            const fullRecipe = await services.fetchRecipeData(recipe.filename);
            if (app.graph !== graph) throw new Error('materialTargetChanged');
            await applyRecipeToCanvas(owner, fullRecipe);
        }, isPartial ? 'recipeAppendError' : 'recipeOpenError');
    };
    footer.appendChild(appendBtn);

    const miniActions = document.createElement('div');
    miniActions.className = 'anomalous-recipe-card-mini-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'anomalous-recipe-card-mini-btn anomalous-tooltip-target';
    editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
    editBtn.removeAttribute('title');
    editBtn.setAttribute('data-tooltip', t('recipeEdit'));
    editBtn.setAttribute('data-tooltip-pos', 'top');
    editBtn.onclick = (e) => {
        e.stopPropagation();
        runRecipeCardAction(editBtn, () => services.editRecipe(owner, recipe?.data || {}, recipe.filename), 'recipeUpdateError');
    };

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'anomalous-recipe-card-mini-btn anomalous-tooltip-target';
    exportBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    exportBtn.removeAttribute('title');
    exportBtn.setAttribute('data-tooltip', t('recipeExportUnavailable'));
    exportBtn.setAttribute('aria-label', t('recipeExportUnavailable'));
    exportBtn.disabled = true;
    exportBtn.setAttribute('data-tooltip-pos', 'top');

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'anomalous-recipe-card-mini-btn is-delete anomalous-tooltip-target';
    removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;
    removeBtn.removeAttribute('title');
    removeBtn.setAttribute('data-tooltip', t('recipeDelete'));
    removeBtn.setAttribute('data-tooltip-pos', 'top');
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        runRecipeCardAction(removeBtn, async () => {
            if (!await anomalousConfirm(t('recipeDeleteConfirm'))) return;
            const response = await fetch('/anomalous/delete_recipe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: recipe.filename }),
            });
            if (!response.ok) throw new Error('recipe deletion failed');
            await owner.refreshRecipes();
        }, 'recipeDeleteError');
    };

    miniActions.append(editBtn, exportBtn, removeBtn);
    footer.appendChild(miniActions);
    body.appendChild(footer);
    card.appendChild(body);

    // Card click for Detail Modal
    card.onclick = () => runRecipeCardAction(card, async () => {
        const bundle = await services.fetchRecipeBundle(recipe.filename);
        const result = await showRecipeDetail(owner, {
            recipe: bundle.data,
            filename: recipe.filename,
            history: bundle.history,
        });
        if (result?.mode === 'edit') await services.editRecipe(owner, bundle.data, recipe.filename, bundle.history);
    }, 'recipeLoadError');

    // 3. 一拖直达画布: "拖入画布后直接打开一个新的画布，就像拖入一个ComfyUI的图片一样"
    bindMaterialDrag(card, owner, {
        payload: () => ({
            type: 'recipe',
            filename: recipe.filename,
            scope: data.workflow_scope || 'complete',
            dragHint: t('recipeDragHint') || '按住拖拽至画布打开工作流',
            dragTargetHint: t('recipeDragTargetCanvas') || '释放以在画布打开工作流',
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

