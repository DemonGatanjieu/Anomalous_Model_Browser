/** Workflow Recipe overview and inline metadata view. */

import { translate } from "./locales.js";
import { appendCopyButton, appendText, button, dateText } from "./ui_recipe_detail_dom.js";
import { fingerprintText } from "./ui_recipe_versions.js";
import { applyAllLocalModelMatches, appendRecipeCover, matchRecipeModels } from "./ui_recipe_model_matching.js";
import { formatRecipeResolution } from "./ui_recipe_parameter_utils.js";
import { updateRecipeMetadata } from "./ui_recipe_metadata.js";

const t = (key, params) => translate(key, params);

async function runRecipeAction(actionButton, action) {
    if (!actionButton || actionButton.disabled) return false;
    actionButton.disabled = true;
    actionButton.classList.add('is-busy');
    try {
        return await action();
    } finally {
        actionButton.disabled = false;
        actionButton.classList.remove('is-busy');
    }
}

function recipeCanvasActionLabel(recipe) {
    return t(recipe?.workflow_scope === 'partial' ? 'recipeAppendCanvas' : 'recipeOpenCanvas');
}

function compact(value, limit = 180) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function beginInlineEdit(owner, recipe, container, field, renderValue, options = {}) {
    const editor = document.createElement('div');
    editor.className = `anomalous-recipe-inline-editor${options.multiline ? ' is-multiline' : ''}`;
    const input = document.createElement(options.multiline ? 'textarea' : 'input');
    input.className = 'anomalous-recipe-inline-input';
    input.value = Array.isArray(recipe[field]) ? recipe[field].join(', ') : String(recipe[field] || '');
    if (!options.multiline) input.type = 'text';
    if (options.maxLength) input.maxLength = options.maxLength;
    if (options.multiline) input.rows = Math.max(3, Math.min(10, input.value.split('\n').length));
    
    let finished = false;
    
    const restore = () => {
        if (finished) return;
        finished = true;
        renderValue(container);
    };
    
    const commit = async () => {
        if (finished) return;
        const raw = input.value.trim();
        const value = options.parse ? options.parse(raw) : raw;
        if (options.required && !value) {
            input.focus();
            return;
        }
        finished = true;
        input.disabled = true;
        
        // Simple visual feedback during save
        input.style.opacity = '0.5';
        try {
            await updateRecipeMetadata(owner, recipe, { [field]: value });
            renderValue(container);
        } catch (error) {
            console.error('Could not update inline recipe metadata:', error);
            finished = false;
            input.disabled = false;
            input.style.opacity = '1';
            input.focus();
        }
    };
    
    input.addEventListener('blur', () => void commit());
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            restore();
        } else if (event.key === 'Enter' && (!options.multiline || event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void commit();
        }
    });
    
    editor.appendChild(input);
    container.replaceChildren(editor);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
}

function missingNodeTypes(recipe) {
    const registry = globalThis.LiteGraph?.registered_node_types;
    if (!registry) return [];
    return [...new Set((recipe?.workflow?.nodes || [])
        .map((node) => node?.type || node?.class_type)
        .filter((type) => type && !registry[type]))];
}

function renderStat(parent, label, value, kind = '') {
    const stat = document.createElement('div');
    stat.className = 'anomalous-recipe-detail-stat';
    appendText(stat, 'span', label, 'anomalous-recipe-detail-stat-label');
    appendText(stat, 'strong', value, kind ? `anomalous-recipe-detail-stat-${kind}` : '');
    parent.appendChild(stat);
}


function renderInlineTitle(parent, owner, recipe) {
    parent.replaceChildren();
    const title = button(parent, recipe.name || t('recipeUntitled'), 'anomalous-recipe-inline-title');
    title.title = t('recipeInlineEditName');
    title.onclick = () => beginInlineEdit(
        owner,
        recipe,
        parent,
        'name',
        (target) => renderInlineTitle(target, owner, recipe),
        { maxLength: 120, required: true },
    );
}

function renderInlineNotes(parent, owner, recipe) {
    parent.replaceChildren();
    const notes = appendText(
        parent,
        'p',
        recipe.notes || t('recipeDetailNoNotes'),
        'anomalous-recipe-detail-muted anomalous-recipe-inline-editable',
    );
    notes.title = t('recipeInlineEditNotes');
    notes.onclick = () => beginInlineEdit(
        owner,
        recipe,
        parent,
        'notes',
        (target) => renderInlineNotes(target, owner, recipe),
        { multiline: true, maxLength: 5000 },
    );
    if (recipe.notes) appendCopyButton(parent, recipe.notes);
}

function renderInlineTags(parent, owner, recipe) {
    parent.replaceChildren();
    for (const tag of recipe.tags || []) appendText(parent, 'span', tag, 'anomalous-recipe-badge anomalous-recipe-badge-tag');
    const edit = button(parent, t('recipeInlineEditTags'), 'anomalous-recipe-inline-edit-button');
    edit.onclick = () => beginInlineEdit(
        owner,
        recipe,
        parent,
        'tags',
        (target) => renderInlineTags(target, owner, recipe),
        {
            maxLength: 300,
            parse: (value) => [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
        },
    );
}

function renderReadinessBanner(parent, owner, recipe, references, finish, onRerender) {
    const banner = document.createElement('div');
    const hasPendingMatches = (references || []).some((ref) => ref.localMatch && !ref.localModel);
    const missingCandidates = (references || []).filter((ref) => !ref.localModel && ref.currentAvailability === 'missing' && !ref.localMatch);
    const missingNodes = missingNodeTypes(recipe);

    let bannerKind = 'is-ready';
    let statusText = t('recipeStatusReady');

    if (hasPendingMatches) {
        bannerKind = 'is-warning';
        const pendingCount = (references || []).filter((ref) => ref.localMatch && !ref.localModel).length;
        statusText = t('recipeStatusNeedAttention').replace('{count}', String(pendingCount));
    } else if (missingCandidates.length > 0) {
        bannerKind = 'is-missing';
        statusText = t('recipeStatusMissing').replace('{count}', String(missingCandidates.length));
    }

    banner.className = `anomalous-recipe-readiness-banner ${bannerKind}`;

    const textWrap = document.createElement('div');
    textWrap.style.display = 'flex';
    textWrap.style.flexDirection = 'column';
    textWrap.style.gap = '3px';

    const mainStatus = appendText(textWrap, 'strong', statusText);
    if (missingNodes.length > 0) {
        appendText(textWrap, 'small', `⚠️ ${t('recipeMissingNodes')}: ${missingNodes.slice(0, 3).join(', ')}${missingNodes.length > 3 ? '…' : ''}`, 'anomalous-recipe-detail-muted');
    }
    banner.appendChild(textWrap);

    const actionWrap = document.createElement('div');
    actionWrap.style.display = 'flex';
    actionWrap.style.gap = '8px';
    actionWrap.style.alignItems = 'center';

    if (hasPendingMatches) {
        const applyAllBtn = button(actionWrap, t('recipeApplyAllMatches'), 'anomalous-recipe-banner-btn is-match-all');
        applyAllBtn.onclick = async () => {
            applyAllBtn.disabled = true;
            await applyAllLocalModelMatches(owner, recipe, references, mainStatus, onRerender);
        };
    } else if (missingCandidates.length > 0) {
        const matchBtn = button(actionWrap, '🔎 ' + t('recipeMatchRecipeModels'), 'anomalous-btn-ghost');
        matchBtn.style.padding = '4px 10px';
        matchBtn.style.fontSize = '0.8rem';
        matchBtn.onclick = async () => {
            matchBtn.disabled = true;
            matchBtn.textContent = t('recipeMatchingRecipeModels');
            try {
                await matchRecipeModels(owner, references, mainStatus, onRerender);
            } finally {
                matchBtn.disabled = false;
                matchBtn.textContent = '🔎 ' + t('recipeMatchRecipeModels');
            }
        };
    }

    banner.appendChild(actionWrap);
    parent.appendChild(banner);
}

function renderPromptOverviewSection(parent, recipe, services) {
    const prompts = services.promptValues(recipe, recipe);
    if (!prompts?.entries?.length) return;

    const wrap = document.createElement('div');
    wrap.style.display = 'grid';
    wrap.style.gap = '10px';
    wrap.style.marginBottom = '16px';

    for (const entry of prompts.entries) {
        const promptText = entry?.text || entry?.value;
        if (!promptText || typeof promptText !== 'string' || !promptText.trim()) continue;
        const isNegative = entry.role === 'negative';
        const box = document.createElement('div');
        box.className = `anomalous-recipe-prompt-box ${isNegative ? 'is-negative' : 'is-positive'}`;

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '8px';

        const badge = document.createElement('span');
        badge.className = `anomalous-recipe-prompt-badge ${isNegative ? 'is-negative' : 'is-positive'}`;
        const isZh = window.anomalous_browser_lang === 'zh';
        badge.textContent = isNegative ? (isZh ? '🔴 负向提示词 (Negative)' : '🔴 Negative Prompt') : (isZh ? '🟢 正向提示词 (Positive)' : '🟢 Positive Prompt');
        header.appendChild(badge);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'anomalous-recipe-prompt-micro-copy';
        const copyTitle = isZh ? '复制提示词' : 'Copy prompt';
        const copiedTitle = isZh ? '已复制' : 'Copied';
        copyBtn.title = copyTitle;
        copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(promptText).then(() => {
                copyBtn.classList.add('is-copied');
                copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
                copyBtn.title = copiedTitle;
                setTimeout(() => {
                    copyBtn.classList.remove('is-copied');
                    copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
                    copyBtn.title = copyTitle;
                }, 1500);
            });
        };
        header.appendChild(copyBtn);

        box.appendChild(header);
        const text = appendText(box, 'div', promptText);
        text.style.whiteSpace = 'pre-wrap';
        text.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        text.style.fontSize = '0.82rem';
        text.style.lineHeight = '1.6';
        text.style.color = '#cbd5e1';

        wrap.appendChild(box);
    }

    if (wrap.childElementCount) {
        parent.appendChild(wrap);
    }
}

function createRecipeOverviewActionBar(recipe, owner, finish, services) {
    const overviewActions = document.createElement('div');
    overviewActions.className = 'anomalous-recipe-actions-primary';
    overviewActions.style.margin = '8px 0';
    overviewActions.style.display = 'flex';
    overviewActions.style.alignItems = 'center';
    overviewActions.style.gap = '8px';

    const heroAppendIcon = recipe?.workflow_scope === 'partial'
        ? `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`
        : `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    const heroAppend = button(
        overviewActions,
        '',
        'anomalous-recipe-btn-primary-action',
    );
    heroAppend.innerHTML = `${heroAppendIcon}${recipeCanvasActionLabel(recipe)}`;
    heroAppend.style.padding = '8px 16px';
    heroAppend.style.fontSize = '0.88rem';
    heroAppend.style.flexShrink = '0';
    heroAppend.style.whiteSpace = 'nowrap';
    heroAppend.onclick = () => {
        void runRecipeAction(heroAppend, async () => {
            if (await services.applyRecipeToCanvas(owner, recipe)) finish('canvas');
        });
    };

    // Floating More Dropdown Menu
    const moreWrapper = document.createElement('div');
    moreWrapper.className = 'anomalous-recipe-dropdown-wrapper';

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'anomalous-recipe-more-btn';
    moreBtn.innerHTML = `<span>··· ${t('notebookMore') || (window.anomalous_browser_lang === 'zh' ? '更多' : 'More')}</span> <span style="font-size:0.7rem;margin-left:2px;">▾</span>`;

    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'anomalous-recipe-dropdown-menu';

    const heroEdit = button(dropdownMenu, '', 'anomalous-recipe-dropdown-item');
    heroEdit.type = 'button';
    heroEdit.innerHTML = `<svg style="width:14px;height:14px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><span>${t('recipeEdit')}</span>`;
    heroEdit.title = t('recipeEdit');
    heroEdit.onclick = (e) => {
        e.stopPropagation();
        dropdownMenu.classList.remove('show');
        moreBtn.classList.remove('active');
        finish('edit');
    };

    const heroExport = button(dropdownMenu, '', 'anomalous-recipe-dropdown-item');
    heroExport.type = 'button';
    heroExport.innerHTML = `<svg style="width:14px;height:14px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>${t('recipeExport')}</span>`;
    heroExport.title = t('recipeExportUnavailable');
    heroExport.setAttribute('aria-label', t('recipeExportUnavailable'));
    heroExport.disabled = true;

    moreBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = dropdownMenu.classList.toggle('show');
        moreBtn.classList.toggle('active', isOpen);
    };

    const onDocClick = (e) => {
        if (!moreWrapper.contains(e.target)) {
            dropdownMenu.classList.remove('show');
            moreBtn.classList.remove('active');
        }
    };
    document.addEventListener('click', onDocClick);

    moreWrapper.append(moreBtn, dropdownMenu);
    overviewActions.appendChild(moreWrapper);
    return overviewActions;
}

export function renderOverview(content, owner, recipe, references, finish, services) {
    const overview = document.createElement('div');
    overview.className = 'anomalous-recipe-detail-overview';
    const hero = document.createElement('div');
    hero.className = 'anomalous-recipe-detail-hero';
    
    // Left media wrap
    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'anomalous-recipe-detail-hero-media';
    appendRecipeCover(mediaWrap, owner, recipe);
    hero.appendChild(mediaWrap);

    // Right control deck
    const copy = document.createElement('div');
    copy.className = 'anomalous-recipe-detail-hero-copy';
    
    // Title + Scope Capsule
    const titleRow = document.createElement('div');
    titleRow.className = 'anomalous-recipe-inline-title-row';
    titleRow.style.display = 'flex';
    titleRow.style.alignItems = 'center';
    titleRow.style.gap = '8px';
    titleRow.style.flexWrap = 'wrap';
    renderInlineTitle(titleRow, owner, recipe);
    
    const scopePill = document.createElement('span');
    scopePill.className = 'anomalous-recipe-scope-pill';
    scopePill.textContent = recipe.workflow_scope === 'partial' ? t('recipeScopePartial') : t('recipeScopeComplete');
    titleRow.appendChild(scopePill);
    copy.appendChild(titleRow);

    // Readiness status banner inside Hero
    renderReadinessBanner(copy, owner, recipe, references, finish, () => {
        if (owner.recipeDetailActiveTab === 'overview') {
            content.replaceChildren();
            renderOverview(content, owner, recipe, references, finish, services);
        }
    });

    // Primary action bar
    copy.appendChild(createRecipeOverviewActionBar(recipe, owner, finish, services));

    // Studio Metrics Grid
    const params = recipe?.params || {};
    const resDisplay = formatRecipeResolution(params.resolution);
    if (params.steps || params.cfg || params.sampler_name || resDisplay) {
        const metrics = document.createElement('div');
        metrics.className = 'anomalous-recipe-studio-metrics';
        const addTile = (labelKey, val) => {
            if (val === undefined || val === null || val === '') return;
            const tile = document.createElement('div');
            tile.className = 'anomalous-recipe-studio-metric-tile';
            appendText(tile, 'span', t(labelKey), 'anomalous-recipe-studio-metric-label');
            appendText(tile, 'span', String(val), 'anomalous-recipe-studio-metric-val');
            metrics.appendChild(tile);
        };
        addTile('recipeDetailSteps', params.steps);
        addTile('recipeDetailCFG', params.cfg);
        addTile('recipeDetailSampler', params.sampler_name || params.samplers);
        addTile('recipeDetailResolution', resDisplay);
        copy.appendChild(metrics);
    }

    // Notes & Tags
    const notes = document.createElement('div');
    notes.className = 'anomalous-recipe-detail-notes';
    renderInlineNotes(notes, owner, recipe);
    copy.appendChild(notes);

    const tags = document.createElement('div');
    tags.className = 'anomalous-recipe-tags anomalous-recipe-detail-tags';
    renderInlineTags(tags, owner, recipe);
    copy.appendChild(tags);

    const updatedSmall = appendText(copy, 'small', `${t('recipeDetailUpdated')}: ${dateText(recipe.updated_timestamp || recipe.timestamp)}`, 'anomalous-recipe-detail-muted');
    updatedSmall.style.marginTop = '6px';
    updatedSmall.style.display = 'block';
    updatedSmall.style.opacity = '0.75';

    hero.appendChild(copy);
    overview.appendChild(hero);

    // Prompt Showcase Section
    renderPromptOverviewSection(overview, recipe, services);

    // Technical details
    const advanced = document.createElement('details');
    advanced.className = 'anomalous-recipe-advanced-info';
    advanced.style.marginBottom = '14px';
    appendText(advanced, 'summary', t('recipeAdvancedInfo'));
    const fingerprint = document.createElement('div');
    fingerprint.className = 'anomalous-recipe-advanced-row';
    appendText(fingerprint, 'span', `${t('recipeDetailFingerprint')}:`);
    appendText(fingerprint, 'code', fingerprintText(recipe) || t('recipeDetailNotIndexed'));
    if (fingerprintText(recipe)) appendCopyButton(fingerprint, fingerprintText(recipe), t('recipeDetailCopyFingerprint'));
    advanced.appendChild(fingerprint);
    overview.appendChild(advanced);

    // Model Equipment Summary
    const summary = document.createElement('section');
    summary.className = 'anomalous-recipe-detail-section';
    appendText(summary, 'h4', t('recipeDetailSummary'));
    const modelComposition = document.createElement('div');
    modelComposition.className = 'anomalous-recipe-model-composition';
    summary.appendChild(modelComposition);
    services.renderModelComposition(modelComposition, owner, recipe, references, finish, params);
    overview.appendChild(summary);

    content.appendChild(overview);
}

