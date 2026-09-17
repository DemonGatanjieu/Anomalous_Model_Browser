import { escapeHtml } from './safe_dom.js';
import { showMaterialSaved } from './material_feedback.js';
import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import {
    deriveRecipeModelReferences,
    formatIdentitySize,
    normaliseIdentity,
} from './recipe_identity.js';
import {
    appendRecipeToCanvas,
    applyRecipeParametersToCanvas,
    assertRecipeSkeleton,
} from './recipe_actions.js';
import {
    applyRecipeWidgetChanges,
    captureRecipeDraft,
    isSupportedPromptNodeType,
} from './recipe_parser.js';
import { replaceWorkflowModelHashRecord } from './recipe_provenance.js';
import {
    appendCopyButton,
    appendText,
    appendValueViewer,
    button,
    dateText,
    displayValue,
} from './ui_recipe_detail_dom.js';
import { renderVersions } from './ui_recipe_versions.js';
import { openGalleryImageDetail, outputImageUrl, renderRecipeGallery } from './ui_recipe_gallery.js';
import { updateRecipeMetadata as updateInlineRecipeMetadata } from './ui_recipe_metadata.js';
import { renderOverview } from './ui_recipe_overview.js';
import {
    applyLocalModelMatch,
    appendModelPreview,
    identityBadge,
    loadCurrentPreviews,
    matchLocalModel,
    modelDisplayName,
    openLocalModel,
    updateRecipeModelNote,
} from './ui_recipe_model_matching.js';
import {
    cloneJson,
    editorValueText,
    formatRecipeResolution,
    isVolatileParameter,
    parameterNodeOrder,
    parseEditorValue,
    promptRoleLabel,
} from './ui_recipe_parameter_utils.js';

const t = (key, params) => translate(key, params);

function closeRecipeWorkspace(owner) {
    if (!owner) return;
    owner.nbPanel && (owner.nbPanel.style.display = 'none');
    owner.notebookBody && (owner.notebookBody.style.display = 'none');
    owner.recipeView && (owner.recipeView.style.display = 'none');
    owner.modal?.classList.remove('visible');
    owner?.close?.();
}

export async function applyRecipeToCanvas(owner, recipe) {
    try {
        if (recipe?.workflow_scope === 'partial') {
            appendRecipeToCanvas(recipe);
        } else {
            if (!recipe?.workflow || typeof app.loadGraphData !== 'function') throw new Error('recipe_open_unavailable');
            await app.loadGraphData(JSON.parse(JSON.stringify(recipe.workflow)));
            app.canvas?.setDirty?.(true, true);
        }
        closeRecipeWorkspace(owner);
        return true;
    } catch (error) {
        const partial = recipe?.workflow_scope === 'partial';
        console.error(`Could not ${partial ? 'append' : 'open'} Workflow Recipe:`, error);
        await anomalousAlert(partial && error.code === 'recipe_append_missing_node'
            ? `${t('recipeAppendError')}\n${error.message}`
            : t(partial ? 'recipeAppendError' : 'recipeOpenError'));
        return false;
    }
}

function promptTextForNode(source, node) {
    const values = [];
    for (const widget of node?.widgets || []) {
        if (!PROMPT_WIDGET_NAME.test(String(widget?.name || ''))) continue;
        const value = fullWidgetValue(source, node, widget);
        if (typeof value === 'string' && value.trim() && !values.includes(value.trim())) values.push(value.trim());
    }
    if (!values.length && isSupportedPromptNodeType(node?.type)) {
        const workflowNode = (source?.workflow?.nodes || []).find((candidate) => String(candidate?.id) === String(node?.id));
        const value = workflowNode?.widgets_values?.find((candidate) => typeof candidate === 'string' && candidate.trim());
        if (value) values.push(value.trim());
    }
    return values.join('\n\n');
}

function legacyPromptRole(params, text) {
    if (!text) return null;
    const positive = new Set(Array.isArray(params?.promptPositive) ? params.promptPositive : []);
    const negative = new Set(Array.isArray(params?.promptNegative) ? params.promptNegative : []);
    if (positive.has(text) && !negative.has(text)) return 'positive';
    if (negative.has(text) && !positive.has(text)) return 'negative';
    return null;
}

function promptEntries(source, roleOwner = source) {
    const params = source?.params || {};
    const roleParams = roleOwner?.params || {};
    const overrides = roleParams.promptRoleOverrides || {};
    const entries = [];
    for (const node of params.nodes || []) {
        const text = promptTextForNode(source, node);
        if (!text) continue;
        const isKnown = isSupportedPromptNodeType(node?.type);
        const isTextCandidate = isKnown || (node.widgets || []).some((widget) => PROMPT_WIDGET_NAME.test(String(widget?.name || '')));
        if (!isTextCandidate) continue;
        const override = overrides[String(node.id)]?.role;
        const automaticRole = PROMPT_ROLES.has(node.role)
            ? node.role
            : (isKnown ? legacyPromptRole(params, text) : null);
        entries.push({
            id: node.id,
            type: node.type || 'Unknown',
            title: node.title || node.type || t('recipeDetailUnknownNode'),
            text,
            supported: isKnown,
            automaticRole: automaticRole || 'unknown',
            role: PROMPT_ROLES.has(override) ? override : (automaticRole || 'unknown'),
            manual: PROMPT_ROLES.has(override),
        });
    }
    return entries;
}

function promptValues(source, roleOwner = source) {
    const positive = [];
    const negative = [];
    const entries = promptEntries(source, roleOwner);
    for (const entry of entries) {
        if ((entry.role === 'positive' || entry.role === 'both') && !positive.includes(entry.text)) positive.push(entry.text);
        if ((entry.role === 'negative' || entry.role === 'both') && !negative.includes(entry.text)) negative.push(entry.text);
    }
    return { positive, negative, entries };
}

function paramsWithPromptRole(recipe, nodeId, selectedRole) {
    const params = JSON.parse(JSON.stringify(recipe?.params || {}));
    const overrides = { ...(params.promptRoleOverrides || {}) };
    const key = String(nodeId);
    if (selectedRole === 'auto') {
        delete overrides[key];
    } else if (PROMPT_ROLES.has(selectedRole)) {
        const workflowNode = (recipe?.workflow?.nodes || []).find((node) => String(node?.id) === key);
        overrides[key] = {
            role: selectedRole,
            nodeType: workflowNode?.type || (params.nodes || []).find((node) => String(node?.id) === key)?.type || 'Unknown',
            source: 'manual',
        };
    }
    if (Object.keys(overrides).length) params.promptRoleOverrides = overrides;
    else delete params.promptRoleOverrides;

    const owner = { ...recipe, params };
    const resolved = promptEntries(owner, owner);
    params.promptPositive = [...new Set(resolved.filter((entry) => entry.role === 'positive' || entry.role === 'both').map((entry) => entry.text))];
    params.promptNegative = [...new Set(resolved.filter((entry) => entry.role === 'negative' || entry.role === 'both').map((entry) => entry.text))];
    return params;
}

function fullWidgetValue(recipe, node, widget) {
    const workflowNode = (recipe?.workflow?.nodes || []).find((candidate) => String(candidate?.id) === String(node?.id));
    const index = Number.isInteger(widget?.index) ? widget.index : -1;
    if (index >= 0 && Array.isArray(workflowNode?.widgets_values) && workflowNode.widgets_values[index] !== undefined) {
        return workflowNode.widgets_values[index];
    }
    return widget?.value;
}

function openOriginEditDialog(owner, recipe, reference, finish) {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(0, 0, 0, 0.6)';
    overlay.style.backdropFilter = 'blur(4px)';
    overlay.style.padding = '20px';
    overlay.style.boxSizing = 'border-box';
    
    const dialog = document.createElement('div');
    dialog.style.background = 'linear-gradient(145deg, rgba(48, 49, 55, 0.98), rgba(27, 28, 33, 0.98))';
    dialog.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    dialog.style.borderRadius = '16px';
    dialog.style.padding = '24px';
    dialog.style.maxWidth = '400px';
    dialog.style.width = '100%';
    dialog.style.boxShadow = '0 12px 40px rgba(0, 0, 0, 0.4)';
    dialog.style.color = '#fff';
    dialog.style.fontFamily = 'Inter, -apple-system, sans-serif';
    dialog.style.display = 'flex';
    dialog.style.flexDirection = 'column';
    dialog.style.gap = '16px';
    
    const title = document.createElement('h3');
    title.textContent = t('recipeOriginDialogTitle');
    title.style.margin = '0 0 8px 0';
    title.style.fontSize = '18px';
    title.style.fontWeight = '600';
    dialog.appendChild(title);

    if (!recipe.params || typeof recipe.params !== 'object') recipe.params = {};
    if (!Array.isArray(recipe.params.model_references)) recipe.params.model_references = [];
    const referenceCategory = reference?.category || reference?.type || '';
    let match = recipe.params.model_references.find((r) => (
        String(r?.node_id ?? '') === String(reference?.node_id ?? '')
        && Number(r?.widget_index) === Number(reference?.widget_index)
        && String(r?.category || r?.type || '') === String(referenceCategory)
        && r?.saved_value === reference?.saved_value
    ));
    if (!match) {
        match = {
            node_id: reference.node_id,
            node_type: reference.node_type,
            node_title: reference.node_title,
            widget_index: reference.widget_index,
            widget_name: reference.widget_name,
            saved_value: reference.saved_value,
            category: referenceCategory,
            base_model: reference.base_model,
            identity: reference.identity,
        };
        recipe.params.model_references.push(match);
    }

    const createInputGroup = (labelText, value) => {
        const group = document.createElement('div');
        group.style.display = 'flex';
        group.style.flexDirection = 'column';
        group.style.gap = '6px';
        const label = document.createElement('label');
        label.textContent = labelText;
        label.style.fontSize = '13px';
        label.style.color = 'rgba(255, 255, 255, 0.7)';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value || '';
        input.style.background = 'rgba(0, 0, 0, 0.2)';
        input.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        input.style.padding = '10px 12px';
        input.style.borderRadius = '8px';
        input.style.color = '#fff';
        input.style.fontSize = '14px';
        input.style.outline = 'none';
        input.style.transition = 'border-color 0.2s';
        input.onfocus = () => input.style.borderColor = 'var(--anomalous-accent, #6366f1)';
        input.onblur = () => input.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        group.appendChild(label);
        group.appendChild(input);
        return { group, input };
    };

    const nameGroup = createInputGroup(t('recipeOriginOfficialName'), match.origin?.model_name);
    dialog.appendChild(nameGroup.group);
    
    const urlGroup = createInputGroup(t('recipeOriginModelUrl'), match.origin?.model_url);
    dialog.appendChild(urlGroup.group);

    const hash = reference.identity?.sha256;
    if (hash) {
        const fetchBtn = document.createElement('button');
        fetchBtn.type = 'button';
        fetchBtn.className = 'anomalous-btn-ghost';
        fetchBtn.textContent = t('recipeOriginFetchHash');
        fetchBtn.style.padding = '8px 14px';
        fetchBtn.style.fontSize = '13px';
        fetchBtn.style.marginTop = '4px';
        
        fetchBtn.onclick = async () => {
            fetchBtn.disabled = true;
            fetchBtn.style.opacity = '0.5';
            fetchBtn.style.cursor = 'not-allowed';
            const originalText = fetchBtn.textContent;
            fetchBtn.textContent = t('recipeOriginFetching');
            try {
                const res = await fetch(`https://civitai.com/api/v1/model-versions/by-hash/${hash}`);
                if (!res.ok) throw new Error('Fetch failed');
                const data = await res.json();
                if (data && data.model && data.model.name) {
                    nameGroup.input.value = data.model.name;
                    urlGroup.input.value = `https://civitai.com/models/${data.modelId}?modelVersionId=${data.id}`;
                    fetchBtn.textContent = t('recipeOriginFetchSuccess');
                    fetchBtn.style.background = 'rgba(46, 204, 113, 0.2)';
                    fetchBtn.style.borderColor = 'rgba(46, 204, 113, 0.5)';
                    fetchBtn.style.color = '#2ecc71';
                } else {
                    throw new Error('Invalid data');
                }
            } catch (err) {
                console.error('Civitai fetch error:', err);
                fetchBtn.textContent = t('recipeOriginFetchFailed');
                fetchBtn.style.background = 'rgba(231, 76, 60, 0.2)';
                fetchBtn.style.borderColor = 'rgba(231, 76, 60, 0.5)';
                fetchBtn.style.color = '#e74c3c';
            }
            setTimeout(() => {
                fetchBtn.textContent = originalText;
                fetchBtn.disabled = false;
                fetchBtn.style.opacity = '1';
                fetchBtn.style.cursor = 'pointer';
                fetchBtn.style.background = '';
                fetchBtn.style.borderColor = '';
                fetchBtn.style.color = '';
            }, 2500);
        };
        dialog.appendChild(fetchBtn);
    }

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '12px';
    actions.style.justifyContent = 'flex-end';
    actions.style.marginTop = '16px';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = t('recipeCancel');
    cancelBtn.className = 'anomalous-btn-danger';
    cancelBtn.style.padding = '8px 16px';
    cancelBtn.style.fontSize = '14px';
    cancelBtn.onclick = () => document.body.removeChild(overlay);
    
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = t('recipeSave');
    saveBtn.className = 'anomalous-btn-primary';
    saveBtn.style.padding = '8px 16px';
    saveBtn.style.fontSize = '14px';
    
    saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
        saveBtn.style.cursor = 'wait';
        
        const newName = nameGroup.input.value.trim();
        const newUrl = urlGroup.input.value.trim();
        if (!match.origin) match.origin = {};
        match.origin.provider = 'civitai';
        if (newName) match.origin.model_name = newName; else delete match.origin.model_name;
        if (newUrl) match.origin.model_url = newUrl; else delete match.origin.model_url;
        
        try {
            await updateInlineRecipeMetadata(owner, recipe, { params: recipe.params });
            document.body.removeChild(overlay);
            finish('refresh');
        } catch (e) {
            console.error('Update failed', e);
            saveBtn.disabled = false;
            cancelBtn.disabled = false;
            saveBtn.style.opacity = '1';
            saveBtn.style.cursor = 'pointer';
            anomalousAlert(t('recipeUpdateError'));
        }
    };
    
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    dialog.appendChild(actions);
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    // Close on click outside
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });
}

function renderModelComposition(container, owner, recipe, references, finish, params) {
    container.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'anomalous-recipe-detail-section-heading';
    appendText(heading, 'h5', t('recipeDetailModelComposition'));
    const refresh = button(heading, t('recipeDetailRefreshAvailability'), 'anomalous-btn-primary anomalous-recipe-refresh-button');
    const status = appendText(
        heading,
        'small',
        owner.recipeDetailPreviewState === 'loading' ? t('recipeDetailLoadingPreviews') : '',
        'anomalous-recipe-detail-muted',
    );
    status.setAttribute('aria-live', 'polite');
    refresh.onclick = async () => {
        if (refresh.disabled) return;
        refresh.disabled = true;
        refresh.classList.add('is-loading');
        refresh.setAttribute('aria-busy', 'true');
        refresh.textContent = t('recipeDetailRefreshing');
        status.textContent = t('recipeDetailRefreshing');
        try {
            const response = await fetch('/anomalous/refresh_recipe_identity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: owner.recipeDetailFilename, references }),
            });
            const payload = await response.json();
            if (!response.ok || payload.status !== 'success') throw new Error('identity refresh failed');
            const resultMap = new Map((payload.results || []).map((item) => [
                `${item.node_id}:${item.widget_index}:${item.saved_value}`,
                item,
            ]));
            for (const reference of references) {
                const result = resultMap.get(`${reference.node_id}:${reference.widget_index}:${reference.saved_value}`);
                if (!result) continue;
                reference.currentAvailability = result.availability;
                if (result.identity && result.identity.status === 'verified' && !reference.identity?.sha256) {
                    reference.identity = result.identity;
                }
            }
            await loadCurrentPreviews(owner, references);
            renderModelComposition(container, owner, recipe, references, finish, params);
        } catch (error) {
            console.error('Could not refresh recipe model availability:', error);
            status.textContent = t('recipeDetailRefreshError');
            refresh.textContent = t('recipeDetailRefreshAvailability');
            refresh.disabled = false;
            refresh.classList.remove('is-loading');
            refresh.removeAttribute('aria-busy');
        }
    };
    container.appendChild(heading);
    if (!references.length) {
        appendText(container, 'p', t('recipeDetailNoModelReferences'), 'anomalous-recipe-detail-muted');
        return;
    }
    const baseModels = [];
    const otherModels = [];
    for (const reference of references) {
        const isBaseMatch = (params && params.baseModel && reference.saved_value === params.baseModel) || /(unet|checkpoint|ckpt|base)/i.test(reference.node_title || reference.node_type || reference.category || '');
        if (isBaseMatch) baseModels.push(reference);
        else otherModels.push(reference);
    }

    const createCard = (reference, forceBaseClass) => {
        const card = document.createElement('article');
        const isLocal = Boolean(reference.localModel);
        const isBase = forceBaseClass;
        card.className = `anomalous-recipe-model-reference${isLocal ? ' is-local' : ' is-unresolved'}${isBase ? ' is-base-model' : ''}`;
        const body = document.createElement('div');
        body.className = 'anomalous-recipe-model-reference-body';
        const openModel = isLocal
            ? () => {
                const payload = owner.recipeDetailPayload;
                const view = owner.recipeDetailView;
                owner.recipeReturnState = {
                    activeTab: owner.recipeDetailActiveTab || 'overview',
                    scrollTop: view?.scrollTop || 0,
                };
                owner.recipeModelReturn = () => {
                    owner.modal?.classList.add('visible');
                    if (owner.nbPanel) owner.nbPanel.style.display = 'flex';
                    if (owner.notebookBody) owner.notebookBody.style.display = 'none';
                    if (owner.recipeContainer) owner.recipeContainer.style.display = 'flex';
                    owner.notebookNotesTab?.classList.remove('active');
                    owner.notebookRecipesTab?.classList.add('active');
                    if (owner.detailPanel) {
                        owner.detailPanel.style.display = 'none';
                        owner.stopMediaInContainer?.(owner.detailPanel);
                        owner.detailPanel.replaceChildren();
                    }
                    if (owner.recipeView) owner.recipeView.style.display = 'flex';
                    if (payload) showRecipeDetail(owner, payload);
                };
                if (openLocalModel(owner, reference.localModel)) finish('model');
                else owner.recipeModelReturn = null;
            }
            : null;
        appendModelPreview(body, owner, reference, openModel);
        const details = document.createElement('div');
        details.className = 'anomalous-recipe-model-reference-details';
        const top = document.createElement('div');
        top.className = 'anomalous-recipe-model-reference-top';
        appendText(top, 'strong', reference.node_title || reference.node_type || t('recipeUnknownNode'));
        appendText(top, 'span', reference.category || t('recipeDetailModel'), 'anomalous-recipe-detail-muted');
        top.appendChild(identityBadge(reference));
        details.appendChild(top);
        const origin = reference.origin;
        const officialNameStr = origin?.model_name;
        const localFileNameStr = reference.saved_value || t('recipeDetailUnavailable');
        
        const primaryNameStr = officialNameStr ? officialNameStr : localFileNameStr;
        const nameBlock = document.createElement('div');
        nameBlock.className = 'anomalous-recipe-model-name-block';
        details.appendChild(nameBlock);
        
        const nameRow = document.createElement('div');
        nameRow.className = 'anomalous-recipe-model-name-row';
        nameBlock.appendChild(nameRow);

        const primaryName = isLocal
            ? button(nameRow, modelDisplayName(primaryNameStr), 'anomalous-recipe-model-name is-resolved')
            : appendText(nameRow, 'span', modelDisplayName(primaryNameStr), 'anomalous-recipe-model-name is-unresolved');
        
        primaryName.title = officialNameStr || localFileNameStr;
        if (isLocal) primaryName.onclick = openModel;

        if (officialNameStr && origin?.model_url) {
            const civitaiLink = document.createElement('a');
            civitaiLink.href = origin.model_url;
            civitaiLink.target = '_blank';
            civitaiLink.className = 'anomalous-recipe-civitai-btn';
            civitaiLink.innerHTML = '🌍 Civitai';
            civitaiLink.title = 'View on Civitai';
            civitaiLink.onclick = (e) => e.stopPropagation();
            nameRow.appendChild(civitaiLink);
        }
        
        const editOriginBtn = document.createElement('button');
        editOriginBtn.className = 'anomalous-recipe-civitai-btn';
        editOriginBtn.innerHTML = t('recipeDetailEditOrigin');
        editOriginBtn.title = t('recipeOriginDialogTitle');
        editOriginBtn.style.marginLeft = '8px';
        editOriginBtn.style.background = 'transparent';
        editOriginBtn.style.border = '1px solid rgba(255,255,255,0.1)';
        editOriginBtn.style.color = 'rgba(255,255,255,0.7)';
        editOriginBtn.onclick = (e) => {
            e.stopPropagation();
            openOriginEditDialog(owner, recipe, reference, finish);
        };

        if (officialNameStr) {
            const subName = document.createElement('div');
            subName.className = 'anomalous-recipe-model-subtitle';
            subName.textContent = localFileNameStr;
            subName.title = localFileNameStr;
            nameBlock.appendChild(subName);
        }
        const referenceDetails = document.createElement('details');
        referenceDetails.className = 'anomalous-recipe-advanced-info anomalous-recipe-model-path';
        appendText(referenceDetails, 'summary', t('recipeAdvancedInfo'));
        referenceDetails.appendChild(editOriginBtn);
        const referenceValue = document.createElement('div');
        referenceValue.className = 'anomalous-recipe-advanced-row';
        appendText(referenceValue, 'span', `${t('recipeModelPath')}:`);
        appendText(referenceValue, 'code', reference.saved_value || t('recipeDetailUnavailable'));
        appendCopyButton(referenceValue, reference.saved_value || '', t('recipeCopyParameter'));
        referenceDetails.appendChild(referenceValue);
        
        const meta = document.createElement('div');
        meta.className = 'anomalous-recipe-model-reference-meta';
        const identity = normaliseIdentity(reference.identity);
        if (identity.sha256) {
            const hash = document.createElement('div');
            hash.className = 'anomalous-recipe-advanced-row';
            appendText(hash, 'span', 'SHA256:');
            appendText(hash, 'code', identity.sha256);
            appendCopyButton(hash, identity.sha256, t('recipeDetailCopyHash'));
            referenceDetails.appendChild(hash);
        }
        details.appendChild(referenceDetails);
        if (formatIdentitySize(identity.size)) appendText(meta, 'span', formatIdentitySize(identity.size));
        appendText(meta, 'span', reference.currentAvailability === 'available'
            ? t('recipeDetailAvailable')
            : reference.currentAvailability === 'missing' ? t('recipeDetailMissing') : t('recipeDetailAvailabilityNotChecked'));
        const noteText = appendText(
            meta,
            'small',
            reference.user_note || t('recipeModelNoteEmpty'),
            'anomalous-recipe-model-note anomalous-recipe-detail-muted',
        );
        noteText.title = reference.user_note || t('recipeModelNoteEmpty');
        const noteButton = button(
            meta,
            t(reference.user_note ? 'recipeModelNoteEdit' : 'recipeModelNoteAdd'),
            'anomalous-btn-ghost anomalous-recipe-model-match',
        );
        noteButton.onclick = async () => {
            const note = await anomalousPrompt(
                t('recipeModelNotePrompt'),
                reference.user_note || '',
                t('recipeModelNoteTitle'),
                { multiline: true, maxLength: 1000, rows: 6 },
            );
            if (note === null) return;
            noteButton.disabled = true;
            try {
                await updateRecipeModelNote(owner, recipe, reference, note, () => {
                    renderModelComposition(container, owner, recipe, references, finish, params);
                });
            } catch (error) {
                console.error('Could not update recipe model note:', error);
                noteButton.disabled = false;
                await anomalousAlert(t('recipeModelNoteError'));
            }
        };
        if (!isLocal) {
            const matchStatus = appendText(meta, 'small', '', 'anomalous-recipe-model-match-status');
            const match = button(meta, t('recipeMatchLocalModel'), 'anomalous-btn-primary anomalous-recipe-model-match');
            match.onclick = async () => {
                match.disabled = true;
                await matchLocalModel(owner, recipe, reference, matchStatus, () => {
                    renderModelComposition(container, owner, recipe, references, finish, params);
                });
                if (!reference.localModel) match.disabled = false;
            };
        }
        if (reference.localMatch?.filename && reference.localMatch.filename !== reference.saved_value) {
            const applyStatus = appendText(meta, 'small', '', 'anomalous-recipe-model-match-status');
            const applyLabel = reference.localMatch.confirmation_required
                ? t('recipeConfirmSizeCandidate')
                : t('recipeApplyLocalMatch');
            const apply = button(meta, applyLabel, 'anomalous-btn-ghost anomalous-recipe-model-match');
            apply.title = t('recipeApplyLocalMatchDesc');
            apply.onclick = async () => {
                apply.disabled = true;
                await applyLocalModelMatch(owner, recipe, reference, applyStatus, () => {
                    renderModelComposition(container, owner, recipe, references, finish, params);
                });
                if (reference.localMatch?.filename) apply.disabled = false;
            };
        }
        details.appendChild(meta);
        body.appendChild(details);
        card.appendChild(body);
        return card;
    };

    const categories = new Map();
    for (const reference of otherModels) {
        let cat = 'Other';
        const typeStr = (reference.node_title || reference.node_type || reference.category || '').toLowerCase();
        if (/lora/i.test(typeStr)) cat = 'LoRA';
        else if (/vae/i.test(typeStr)) cat = 'VAE';
        else if (/controlnet/i.test(typeStr)) cat = 'ControlNet';
        else if (/clip/i.test(typeStr)) cat = 'CLIP';
        else if (/upscale/i.test(typeStr)) cat = 'Upscaler';
        
        if (!categories.has(cat)) categories.set(cat, []);
        categories.get(cat).push(reference);
    }

    const appendSection = (title, models, isBase) => {
        if (!models.length) return;
        if (container.children.length > 1) { // Skip divider for the very first section
            const divider = document.createElement('hr');
            divider.className = 'anomalous-recipe-model-divider';
            divider.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
            divider.style.margin = '20px 0 16px 0';
            container.appendChild(divider);
        }
        
        if (title) {
            const h = document.createElement('h5');
            h.textContent = title;
            h.style.margin = '0 0 12px 0';
            h.style.color = '#9ec8ff';
            h.style.fontSize = '0.9rem';
            h.style.textTransform = 'uppercase';
            h.style.letterSpacing = '0.5px';
            container.appendChild(h);
        }
        
        const list = document.createElement('div');
        list.className = 'anomalous-recipe-model-reference-list';
        models.forEach(ref => list.appendChild(createCard(ref, isBase)));
        container.appendChild(list);
    };

    appendSection('Base Models', baseModels, true);
    for (const [cat, models] of categories.entries()) {
        appendSection(cat, models, false);
    }
}

function renderParameterField(parent, label, value, options = {}) {
    if (value === undefined || value === null || value === '') return false;
    const row = document.createElement('div');
    row.className = 'anomalous-recipe-detail-parameter-row';
    const text = displayValue(value);
    if (options.wide || Array.isArray(value) || typeof value === 'object' || text.length > 35) {
        row.classList.add('is-wide');
    }
    appendText(row, 'span', label, 'anomalous-recipe-detail-label');
    appendValueViewer(
        row,
        options.redact ? t('recipeDetailVolatileIgnored') : value,
        '',
        { collapse: options.collapse !== false, copy: options.copy !== false && !options.redact },
    );
    parent.appendChild(row);
    return true;
}

async function saveParameterMaterial(owner, recipe, parameterState, nodeIds, name, actionButton) {
    if (!owner?.recipeDetailFilename || !actionButton || actionButton.disabled) return false;
    const originalLabel = actionButton.textContent;
    actionButton.disabled = true;
    actionButton.textContent = t('materialSaving');
    const body = {
        recipe_filename: owner.recipeDetailFilename,
        ...(parameterState?.selectedFilename ? { parameter_filename: parameterState.selectedFilename } : {}),
        ...(Array.isArray(nodeIds) && nodeIds.length ? { selected_node_ids: nodeIds } : {}),
        name: String(name || '').trim().slice(0, 120),
        tags: Array.isArray(recipe?.tags) ? recipe.tags : [],
    };
    const send = () => fetch('/anomalous/save_parameter_material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    try {
        let response = await send();
        if (response.status === 409) {
            const duplicate = await response.json();
            if (duplicate.status !== 'duplicate') throw new Error('parameter material conflict');
            if (!await anomalousConfirm(t('materialDuplicateConfirm', { name: duplicate.name }))) return false;
            body.allow_duplicate = true;
            response = await send();
        }
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'parameter material save failed');
        actionButton.textContent = t('materialSaved');
        showMaterialSaved(owner, payload.material);
        await owner.refreshMaterials?.();
        window.setTimeout(() => {
            if (!actionButton.isConnected) return;
            actionButton.textContent = originalLabel;
            actionButton.disabled = false;
        }, 1400);
        return true;
    } catch (error) {
        console.error('Could not save recipe parameter material:', error);
        await anomalousAlert(t('materialSaveError'));
        return false;
    } finally {
        if (actionButton.isConnected && actionButton.textContent !== t('materialSaved')) {
            actionButton.textContent = originalLabel;
            actionButton.disabled = false;
        }
    }
}

function renderParameterNotebookEditor(wrapper, owner, recipe, parameterState, source, selectParameterTab) {
    const editorState = parameterState.editor;
    editorState.draft.params = editorState.draft.params || {};
    const editor = document.createElement('section');
    editor.className = 'anomalous-recipe-detail-section anomalous-recipe-parameter-editor';
    const heading = document.createElement('div');
    heading.className = 'anomalous-recipe-detail-section-heading anomalous-recipe-parameter-editor-sticky-header';
    appendText(heading, 'h4', t('recipeParameterNew'));
    const actions = document.createElement('div');
    const cancel = button(actions, t('recipeParameterCancel'), 'anomalous-btn-ghost');
    cancel.onclick = () => {
        parameterState.editor = null;
        selectParameterTab?.();
    };
    const save = button(actions, t('recipeParameterSave'), 'anomalous-btn-primary');
    save.onclick = async () => {
        const name = nameInput.value.trim() || recipe.name || t('recipeParameterUntitled');
        save.disabled = true;
        try {
            const response = await fetch('/anomalous/save_parameter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    tags: recipe.tags || [],
                    notes: recipe.notes || '',
                    params: editorState.draft.params || {},
                    workflow: editorState.draft.workflow,
                    recipe_filename: owner.recipeDetailFilename,
                }),
            });
            if (!response.ok) throw new Error('parameter note save failed');
            parameterState.editor = null;
            parameterState.status = 'idle';
            parameterState.selectedFilename = null;
            await parameterState.refresh?.(true);
            selectParameterTab?.();
        } catch (error) {
            console.error('Could not save the new parameter notebook:', error);
            await anomalousAlert(t('recipeParameterSaveError'));
            save.disabled = false;
        }
    };
    actions.append(cancel, save);
    heading.appendChild(actions);
    editor.appendChild(heading);
    appendText(editor, 'p', t('recipeParameterNewHint'), 'anomalous-recipe-detail-muted');

    const nameRow = document.createElement('label');
    nameRow.className = 'anomalous-recipe-parameter-editor-name';
    appendText(nameRow, 'span', t('recipeParameterName'));
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 200;
    nameInput.value = editorState.name || `${recipe.name || t('recipeUntitled')} · ${t('recipeParameterNew')}`;
    nameRow.appendChild(nameInput);
    editor.appendChild(nameRow);

    const nodeList = document.createElement('div');
    nodeList.className = 'anomalous-recipe-detail-parameter-list anomalous-recipe-parameter-editor-list';
    let rendered = 0;
    for (const { summary: node, workflowNode } of parameterNodeOrder(editorState.draft)) {
        if (!workflowNode || !Array.isArray(workflowNode.widgets_values)) continue;
        const widgets = Array.isArray(node?.widgets) && node.widgets.length
            ? node.widgets
            : workflowNode.widgets_values.map((value, index) => ({ name: `${t('recipeDetailWidget')} ${index + 1}`, index, value }));
        const block = document.createElement('article');
        block.className = 'anomalous-recipe-detail-parameter-node';
        const titleText = [node.title, node.type].filter(Boolean).join(' · ') || t('recipeDetailUnknownNode');
        appendText(block, 'strong', titleText, 'anomalous-recipe-detail-node-title');
        
        const widgetsContainer = document.createElement('div');
        widgetsContainer.className = 'anomalous-recipe-detail-node-widgets';
        
        for (let visibleIndex = 0; visibleIndex < widgets.length && rendered < 1200; visibleIndex += 1) {
            const widget = widgets[visibleIndex] || {};
            const index = Number.isInteger(widget.index) ? widget.index : visibleIndex;
            if (index < 0 || index >= workflowNode.widgets_values.length) continue;
            const value = workflowNode.widgets_values[index];
            const row = document.createElement('label');
            row.className = 'anomalous-recipe-detail-parameter-row anomalous-recipe-parameter-editor-row';
            appendText(row, 'span', widget.name || `${t('recipeDetailWidget')} ${index + 1}`, 'anomalous-recipe-detail-parameter-name');
            const volatile = isVolatileParameter(node, widget, index);
            const sensitive = /(?:api.?key|access.?token|auth|password|passwd|secret|credential)/i.test(String(widget.name || ''));
            if (volatile || sensitive) {
                appendValueViewer(row, t(volatile ? 'recipeDetailVolatileIgnored' : 'recipeParameterSensitiveHidden'), '', { copy: false });
            } else {
                const input = document.createElement(typeof value === 'string' && (value.length > 100 || /text|prompt/i.test(String(widget.name || ''))) ? 'textarea' : 'input');
                input.className = 'anomalous-recipe-parameter-editor-input';
                input.value = editorValueText(value);
                if (input.tagName === 'TEXTAREA') input.rows = Math.min(8, Math.max(3, input.value.split(/\r?\n/).length));
                input.onchange = () => {
                    try {
                        const next = parseEditorValue(input.value, value);
                        applyRecipeWidgetChanges(editorState.draft.params || {}, editorState.draft.workflow, [{
                            nodeId: workflowNode.id,
                            widgetIndex: index,
                            value: next,
                            previousValue: value,
                        }]);
                        workflowNode.widgets_values[index] = next;
                        input.classList.remove('is-invalid');
                    } catch (error) {
                        input.classList.add('is-invalid');
                        console.warn('Parameter input invalid:', error);
                    }
                };
                row.appendChild(input);
            }
            widgetsContainer.appendChild(row);
            rendered += 1;
        }
        if (widgetsContainer.childElementCount) {
            block.appendChild(widgetsContainer);

            nodeList.appendChild(block);
        }
    }
    if (!nodeList.childElementCount) appendText(nodeList, 'p', t('recipeDetailNoSavedParameters'), 'anomalous-recipe-detail-muted');
    editor.appendChild(nodeList);
    wrapper.appendChild(editor);
}

function renderRawNodesLazy(parent, source, options = {}) {
    const ordered = parameterNodeOrder(source);
    if (!ordered.length) return;
    const reusable = ordered.filter(({ workflowNode }) =>
        workflowNode?.id != null && Array.isArray(workflowNode.widgets_values) && workflowNode.widgets_values.length
    );
    const selectedIds = new Set();

    const details = document.createElement('details');
    details.className = 'anomalous-recipe-advanced-info anomalous-recipe-raw-nodes-details';
    details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'anomalous-recipe-raw-nodes-summary';
    const updateSummary = () => {
        const arrow = details.open ? '▾' : '▸';
        summary.textContent = `${arrow} ${t('recipeRawNodesToggle')} (${ordered.length} ${t('recipeRawNodesCount')})`;
    };
    updateSummary();
    details.appendChild(summary);

    let selecting = false;
    let updateSelection = () => {};
    if (typeof options.onSaveNodes === 'function' && reusable.length) {
        const selectionBar = document.createElement('div');
        selectionBar.className = 'anomalous-recipe-material-selection';
        selectionBar.hidden = true;
        const choose = button(details, t('materialChooseParameters'), 'anomalous-btn-ghost');
        choose.setAttribute('aria-expanded', 'false');
        choose.onclick = () => {
            selecting = !selecting;
            selectionBar.hidden = !selecting;
            choose.textContent = t(selecting ? 'materialFinishSelection' : 'materialChooseParameters');
            choose.setAttribute('aria-expanded', String(selecting));
            if (!selecting) selectedIds.clear();
            updateSelection();
        };
        const selectionText = appendText(selectionBar, 'span', '', 'anomalous-workbench-node-selection-count');
        const selectAll = button(selectionBar, t('materialSelectAllNodes'), 'anomalous-btn-ghost');
        const clear = button(selectionBar, t('materialClearNodeSelection'), 'anomalous-btn-ghost');
        const saveSelected = button(selectionBar, t('materialSaveSelectedAction', { count: 0 }), 'anomalous-preset-btn-primary');
        updateSelection = () => {
            const count = selectedIds.size;
            selectionText.textContent = t('materialSelectedNodeCount', { count });
            saveSelected.textContent = t('materialSaveSelectedAction', { count });
            saveSelected.disabled = count === 0;
            details.querySelectorAll('.anomalous-recipe-material-node-select').forEach(input => {
                input.hidden = !selecting;
                input.checked = selectedIds.has(input.dataset.nodeId);
            });
        };
        selectAll.onclick = () => {
            reusable.forEach(({ workflowNode }) => selectedIds.add(String(workflowNode.id)));
            updateSelection();
        };
        clear.onclick = () => {
            selectedIds.clear();
            updateSelection();
        };
        saveSelected.onclick = () => options.onSaveNodes(
            [...selectedIds],
            t('materialSelectedNodesName', { count: selectedIds.size }),
            saveSelected,
        );
        updateSelection();
        details.appendChild(selectionBar);
    }

    const nodeList = document.createElement('div');
    nodeList.className = 'anomalous-recipe-detail-parameter-list';
    nodeList.style.marginTop = '12px';

    let renderedCount = 0;
    const PAGE_SIZE = 15;

    const renderNextBatch = () => {
        const batch = ordered.slice(renderedCount, renderedCount + PAGE_SIZE);
        for (const { summary: node, workflowNode } of batch) {
            const widgets = Array.isArray(node?.widgets) && node.widgets.length
                ? node.widgets
                : (Array.isArray(workflowNode?.widgets_values)
                    ? workflowNode.widgets_values.map((value, index) => ({
                        name: `${t('recipeDetailWidget')} ${index + 1}`,
                        index,
                        value,
                    }))
                    : []);
            if (!widgets.length) continue;
            const block = document.createElement('article');
            block.className = 'anomalous-recipe-detail-parameter-node';
            const title = [node.title, node.type].filter(Boolean).join(' · ') || t('recipeDetailUnknownNode');
            const nodeHeader = document.createElement('div');
            nodeHeader.className = 'anomalous-recipe-material-node-header';
            if (typeof options.onSaveNodes === 'function' && workflowNode?.id != null) {
                const select = document.createElement('input');
                select.type = 'checkbox';
                select.hidden = !selecting;
                select.className = 'anomalous-recipe-material-node-select';
                select.setAttribute('aria-label', t('materialSelectNodeForSaving'));
                select.dataset.nodeId = String(workflowNode.id);
                select.checked = selectedIds.has(select.dataset.nodeId);
                select.title = t('materialSelectNodeForSaving');
                select.onchange = () => {
                    if (select.checked) selectedIds.add(select.dataset.nodeId);
                    else selectedIds.delete(select.dataset.nodeId);
                    updateSelection();
                };
                nodeHeader.appendChild(select);
            }
            appendText(nodeHeader, 'strong', title, 'anomalous-recipe-detail-node-title');
            if (typeof options.onSaveNodes === 'function' && workflowNode?.id != null) {
                const saveNode = button(nodeHeader, t('materialSaveToLibraryShort'), 'anomalous-material-node-save');
                saveNode.onclick = () => options.onSaveNodes([workflowNode.id], title, saveNode);
            }
            block.appendChild(nodeHeader);
            const widgetsContainer = document.createElement('div');
            widgetsContainer.className = 'anomalous-recipe-detail-node-widgets';
            for (let visibleIndex = 0; visibleIndex < widgets.length; visibleIndex += 1) {
                const widget = widgets[visibleIndex] || {};
                const index = Number.isInteger(widget.index) ? widget.index : visibleIndex;
                const value = Array.isArray(workflowNode?.widgets_values) && workflowNode.widgets_values[index] !== undefined
                    ? workflowNode.widgets_values[index]
                    : widget.value;
                const label = widget.name || `${t('recipeDetailWidget')} ${index + 1}`;
                const volatile = isVolatileParameter(node, widget, index);
                renderParameterField(widgetsContainer, label, volatile ? 0 : value, {
                    redact: volatile,
                    collapse: false,
                });
            }
            if (widgetsContainer.childElementCount) {
                block.appendChild(widgetsContainer);
                nodeList.appendChild(block);
            }
        }
        renderedCount += batch.length;
        updateSelection();

        const oldBtn = details.querySelector('.anomalous-recipe-lazy-expand-btn');
        if (oldBtn) oldBtn.remove();

        if (renderedCount < ordered.length) {
            const remaining = ordered.length - renderedCount;
            const expandBtn = document.createElement('button');
            expandBtn.type = 'button';
            expandBtn.className = 'anomalous-recipe-lazy-expand-btn';
            expandBtn.textContent = `${t('recipeRawNodesShowMore')} (${remaining})`;
            expandBtn.onclick = (e) => {
                e.preventDefault();
                renderNextBatch();
            };
            details.appendChild(expandBtn);
        }
    };

    details.ontoggle = () => {
        updateSummary();
        if (details.open && renderedCount === 0) {
            renderNextBatch();
        }
    };

    details.appendChild(nodeList);
    parent.appendChild(details);
    if (details.open && renderedCount === 0) {
        renderNextBatch();
    }
}

function renderPromptSection(parent, owner, recipe, source, rerender, onSaveNodes) {
    const prompts = promptValues(source, recipe);
    if (!prompts.entries.length) {
        appendText(parent, 'p', t('recipeDetailNoPrompts'), 'anomalous-recipe-detail-muted');
        return;
    }

    const heading = document.createElement('div');
    heading.className = 'anomalous-recipe-detail-section-heading';
    heading.style.display = 'flex';
    heading.style.alignItems = 'center';
    heading.style.justifyContent = 'space-between';
    heading.style.marginBottom = '12px';

    const headingLeft = document.createElement('div');
    headingLeft.style.display = 'flex';
    headingLeft.style.alignItems = 'center';
    headingLeft.style.gap = '8px';
    appendText(headingLeft, 'h5', t('recipeDetailPrompts') || '提示词');

    const noticeTooltip = t('recipePromptSupportNotice') || '当前仅自动识别 ComfyUI 原生 CLIPTextEncode 与已知官方连接；第三方文本节点请手动标注。';
    const infoIcon = document.createElement('span');
    infoIcon.className = 'anomalous-recipe-info-bubble';
    infoIcon.title = noticeTooltip;
    infoIcon.innerHTML = `ⓘ <span style="font-size:0.75rem;font-weight:normal;opacity:0.75;">${window.anomalous_browser_lang === 'zh' ? '支持说明' : 'Notice'}</span>`;
    infoIcon.style.cursor = 'help';
    headingLeft.appendChild(infoIcon);
    heading.appendChild(headingLeft);
    parent.appendChild(heading);

    const promptList = document.createElement('div');
    promptList.className = 'anomalous-recipe-detail-prompt-list';
    for (const entry of prompts.entries) {
        const card = document.createElement('article');
        card.className = `anomalous-recipe-detail-prompt anomalous-recipe-prompt-role-${entry.role}`;

        // Top full-width header bar
        const headerRow = document.createElement('div');
        headerRow.className = 'anomalous-recipe-prompt-card-header';
        headerRow.style.display = 'flex';
        headerRow.style.justifyContent = 'space-between';
        headerRow.style.alignItems = 'center';
        headerRow.style.gap = '10px';
        headerRow.style.marginBottom = '8px';

        // Left info group: Interactive role badge + Node title & type
        const leftGroup = document.createElement('div');
        leftGroup.className = 'anomalous-recipe-prompt-card-header-left';
        leftGroup.style.display = 'flex';
        leftGroup.style.alignItems = 'center';
        leftGroup.style.gap = '8px';
        leftGroup.style.flexWrap = 'wrap';

        const isZh = window.anomalous_browser_lang === 'zh';
        const roleBadge = document.createElement('button');
        roleBadge.type = 'button';
        roleBadge.className = `anomalous-recipe-prompt-role-badge is-${entry.role} is-interactive`;
        const roleDot = entry.role === 'positive' ? '🟢' : entry.role === 'negative' ? '🔴' : '🟣';
        roleBadge.innerHTML = `${roleDot} <span>${promptRoleLabel(entry.role)}</span> <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>`;
        roleBadge.title = isZh ? '点击切换提示词用途 (正向/负向/忽略)' : 'Click to adjust prompt role';

        const roleSelect = document.createElement('select');
        roleSelect.className = 'anomalous-recipe-prompt-role-select';
        roleSelect.setAttribute('aria-label', t('recipePromptRoleChoose'));
        const choices = [
            ['auto', `${t('recipePromptRoleAutomatic')} · ${promptRoleLabel(entry.automaticRole)}`],
            ['positive', t('recipePromptRolePositive')],
            ['negative', t('recipePromptRoleNegative')],
            ['both', t('recipePromptRoleBoth')],
            ['unknown', t('recipePromptRoleUnknown')],
            ['ignored', t('recipePromptRoleIgnored')],
        ];
        for (const [value, label] of choices) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            roleSelect.appendChild(option);
        }
        roleSelect.value = entry.manual ? entry.role : 'auto';
        roleSelect.style.display = 'none';
        roleSelect.onchange = async () => {
            const previous = entry.manual ? entry.role : 'auto';
            roleSelect.disabled = true;
            card.classList.add('is-saving');
            try {
                const params = paramsWithPromptRole(recipe, entry.id, roleSelect.value);
                await updateInlineRecipeMetadata(owner, recipe, { params });
                rerender?.();
            } catch (error) {
                console.error('Could not update prompt role:', error);
                roleSelect.value = previous;
                roleSelect.disabled = false;
                card.classList.remove('is-saving');
                await anomalousAlert(t('recipePromptRoleSaveError'));
            }
        };
        roleBadge.onclick = () => {
            if (roleSelect.style.display === 'none') {
                roleSelect.style.display = 'inline-block';
                roleSelect.focus();
            } else {
                roleSelect.style.display = 'none';
            }
        };

        leftGroup.appendChild(roleBadge);
        leftGroup.appendChild(roleSelect);

        const nodeTitle = document.createElement('span');
        nodeTitle.className = 'anomalous-recipe-prompt-card-node-title';
        nodeTitle.textContent = entry.title || 'CLIPTextEncode';
        nodeTitle.title = entry.type || '';
        leftGroup.appendChild(nodeTitle);

        if (entry.type && entry.type !== entry.title) {
            const nodeTypeEl = document.createElement('span');
            nodeTypeEl.className = 'anomalous-recipe-prompt-card-node-type';
            nodeTypeEl.textContent = `(${entry.type})`;
            leftGroup.appendChild(nodeTypeEl);
        }

        headerRow.appendChild(leftGroup);

        // Right actions tray (Save to Material + Micro Copy)
        const actionTray = document.createElement('div');
        actionTray.className = 'anomalous-recipe-prompt-card-action-tray';
        actionTray.style.display = 'flex';
        actionTray.style.alignItems = 'center';
        actionTray.style.gap = '6px';

        if (typeof onSaveNodes === 'function') {
            const savePromptBtn = document.createElement('button');
            savePromptBtn.type = 'button';
            savePromptBtn.className = 'anomalous-recipe-prompt-micro-copy';
            savePromptBtn.title = t('materialSavePromptAction') || '存入素材库';
            savePromptBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
            savePromptBtn.onclick = (e) => {
                e.stopPropagation();
                onSaveNodes([entry.id], entry.title || t('materialPromptNode'), savePromptBtn);
            };
            actionTray.appendChild(savePromptBtn);
        }

        const copyPromptBtn = document.createElement('button');
        copyPromptBtn.type = 'button';
        copyPromptBtn.className = 'anomalous-recipe-prompt-micro-copy';
        const copyTitle = isZh ? '复制提示词' : 'Copy prompt';
        const copiedTitle = isZh ? '已复制' : 'Copied';
        copyPromptBtn.title = copyTitle;
        copyPromptBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
        copyPromptBtn.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(entry.text || '').then(() => {
                copyPromptBtn.classList.add('is-copied');
                copyPromptBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
                copyPromptBtn.title = copiedTitle;
                setTimeout(() => {
                    copyPromptBtn.classList.remove('is-copied');
                    copyPromptBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
                    copyPromptBtn.title = copyTitle;
                }, 1200);
            });
        };
        actionTray.appendChild(copyPromptBtn);
        headerRow.appendChild(actionTray);
        card.appendChild(headerRow);

        // Full-width prompt body
        const body = document.createElement('div');
        body.className = 'anomalous-recipe-prompt-card-body';
        appendValueViewer(body, entry.text, '', { copy: false });
        card.appendChild(body);

        promptList.appendChild(card);
    }
    parent.appendChild(promptList);
}

function renderRecipeParameters(content, owner, recipe, gallery, refreshGallery, parameterState, selectParameterTab) {
    const selectedNotebook = parameterState?.notebooks?.find((item) => item.filename === parameterState.selectedFilename);
    const baseSource = selectedNotebook?.data?.workflow ? selectedNotebook.data : recipe;
    const source = parameterState?.editor?.draft || baseSource;
    const animateSelection = Boolean(parameterState?.switchToken);
    if (animateSelection && !parameterState.switchTokenClearing) {
        parameterState.switchTokenClearing = true;
        Promise.resolve().then(() => {
            parameterState.switchToken = 0;
            parameterState.switchTokenClearing = false;
        });
    }
    const wrapper = document.createElement('div');
    wrapper.className = `anomalous-recipe-detail-parameters${animateSelection ? ' is-switching' : ''}`;

    const layout = document.createElement('div');
    layout.className = 'anomalous-recipe-parameter-notebook-layout';
    const sidebar = document.createElement('aside');
    sidebar.className = 'anomalous-recipe-parameter-notebook-sidebar';
    
    const sidebarHeading = document.createElement('div');
    sidebarHeading.className = 'anomalous-recipe-detail-section-heading';
    sidebarHeading.style.marginBottom = '12px';
    sidebarHeading.style.alignItems = 'center';
    sidebarHeading.style.display = 'flex';
    appendText(sidebarHeading, 'strong', t('recipeParameterSnapshots'));
    
    const refreshSnapshots = document.createElement('button');
    refreshSnapshots.className = 'anomalous-btn-ghost';
    refreshSnapshots.style.padding = '4px 8px';
    refreshSnapshots.title = t('recipeParameterRefresh');
    refreshSnapshots.innerHTML = '↻';
    refreshSnapshots.onclick = () => { void parameterState.refresh?.(true); };
    sidebarHeading.appendChild(refreshSnapshots);
    sidebar.appendChild(sidebarHeading);
    
    const sidebarActions = document.createElement('div');
    sidebarActions.className = 'anomalous-recipe-sidebar-actions';
    sidebarActions.style.display = 'grid';
    sidebarActions.style.gap = '8px';
    sidebarActions.style.marginBottom = '12px';

    const readCurrentHandler = async () => {
        readCurrent.disabled = true;
        readCurrent.classList.add('is-busy');
        const originalLabel = readCurrent.textContent;
        readCurrent.textContent = t('recipeParameterReadCurrentSaving');
        try {
            if (!app.graph?.serialize) throw new Error('recipe_parameter_canvas_unavailable');
            const current = captureRecipeDraft(app.graph);
            assertRecipeSkeleton(recipe.workflow, current.workflow);
            const response = await fetch('/anomalous/save_parameter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `${recipe.name || t('recipeUntitled')} · ${t('recipeParameterReadCurrent')}`,
                    tags: recipe.tags || [],
                    notes: recipe.notes || '',
                    params: current.metadata,
                    workflow: current.workflow,
                    recipe_filename: owner.recipeDetailFilename,
                }),
            });
            if (!response.ok) throw new Error('current parameter note save failed');
            parameterState.editor = null;
            parameterState.status = 'idle';
            parameterState.selectedFilename = null;
            gallery.status = 'idle';
            gallery.images = [];
            gallery.scanned = 0;
            await parameterState.refresh?.(true);
            selectParameterTab?.();
        } catch (error) {
            console.error('Could not read current canvas parameters:', error);
            await anomalousAlert(error.code === 'recipe_parameter_skeleton_mismatch'
                ? t('recipeParameterSkeletonMismatch')
                : t('recipeParameterReadCurrentError'));
        } finally {
            readCurrent.disabled = false;
            readCurrent.classList.remove('is-busy');
            readCurrent.innerHTML = originalLabel;
        }
    };

    const readCurrent = button(sidebarActions, '', 'anomalous-preset-btn-primary');
    readCurrent.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>${t('recipeParameterReadCurrent')}`;
    readCurrent.onclick = readCurrentHandler;

    const newSnapshot = button(sidebarActions, '', 'anomalous-preset-btn-secondary');
    newSnapshot.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>${t('recipeParameterNew')}`;
    newSnapshot.onclick = () => {
        const draft = cloneJson({
            workflow: baseSource.workflow,
            params: baseSource.params || {},
        });
        if (!draft?.workflow) return;
        parameterState.editor = {
            draft,
            name: `${recipe.name || t('recipeUntitled')} · ${t('recipeParameterNew')}`,
        };
        parameterState.selectedFilename = null;
        gallery.status = 'idle';
        gallery.images = [];
        gallery.scanned = 0;
        selectParameterTab?.();
    };

    sidebar.appendChild(sidebarActions);
    appendText(sidebar, 'small', t('recipeParameterSnapshotsHint'), 'anomalous-recipe-detail-muted');
    const snapshotList = document.createElement('div');
    snapshotList.className = 'anomalous-recipe-parameter-notebook-list';
    snapshotList.style.marginTop = '8px';
    if (parameterState?.status === 'loading') {
        appendText(snapshotList, 'p', t('recipeParameterLoading'), 'anomalous-recipe-detail-muted');
    } else if (parameterState?.status === 'error') {
        appendText(snapshotList, 'p', t('recipeParameterLoadError'), 'anomalous-recipe-dialog-error');
    } else if (parameterState?.notebooks?.length) {
        for (const notebook of parameterState.notebooks) {
            const isSelected = notebook.filename === parameterState.selectedFilename;
            const row = document.createElement('div');
            row.className = `anomalous-preset-item-card${isSelected ? ' is-active' : ''}`;
            const notebookName = notebook.name || t('recipeParameterUntitled');

            const main = document.createElement('div');
            main.className = 'anomalous-preset-item-main';
            main.onclick = () => {
                if (parameterState.selectedFilename === notebook.filename) return;
                parameterState.editor = null;
                parameterState.selectedFilename = notebook.filename;
                parameterState.switchToken = (parameterState.switchToken || 0) + 1;
                gallery.status = 'idle';
                gallery.images = [];
                gallery.scanned = 0;
                selectParameterTab?.();
            };

            const titleRow = document.createElement('div');
            titleRow.className = 'anomalous-preset-item-title-row';
            titleRow.style.display = 'flex';
            titleRow.style.alignItems = 'center';
            titleRow.style.gap = '6px';
            titleRow.style.minWidth = '0';

            if (isSelected) {
                const activeDot = document.createElement('span');
                activeDot.className = 'anomalous-preset-active-dot';
                activeDot.title = t('recipeParameterActive') || '当前生效';
                titleRow.appendChild(activeDot);
            }

            const titleEl = appendText(titleRow, 'div', notebookName, 'anomalous-preset-item-title');
            titleEl.title = notebookName;
            main.appendChild(titleRow);

            const meta = document.createElement('div');
            meta.className = 'anomalous-preset-item-meta';
            appendText(meta, 'span', dateText(notebook.timestamp), 'anomalous-preset-item-date');
            main.appendChild(meta);
            row.appendChild(main);

            const actions = document.createElement('div');
            actions.className = 'anomalous-preset-item-actions';

            const saveMaterial = button(actions, '', 'anomalous-preset-item-btn');
            saveMaterial.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
            saveMaterial.title = t('materialSaveNotebookHint');
            saveMaterial.onclick = async (e) => {
                e.stopPropagation();
                await saveParameterMaterial(
                    owner,
                    recipe,
                    { ...parameterState, selectedFilename: notebook.filename },
                    null,
                    `${notebookName} · ${t('materialAllParameters')}`,
                    saveMaterial,
                );
            };

            const rename = button(actions, '', 'anomalous-preset-item-btn');
            rename.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
            rename.title = t('recipeParameterRename');
            rename.onclick = async (e) => {
                e.stopPropagation();
                const newName = await anomalousPrompt(t('recipeParameterRenamePrompt'), notebookName);
                if (newName === null || !newName.trim() || newName.trim() === notebookName) return;
                const trimmedName = newName.trim();
                rename.disabled = true;
                row.classList.add('is-busy');
                try {
                    const response = await fetch('/anomalous/rename_parameter', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename: notebook.filename, name: trimmedName }),
                    });
                    const payload = await response.json();
                    if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'rename failed');
                    notebook.name = trimmedName;
                    await parameterState.refresh?.(true);
                } catch (error) {
                    console.error('Could not rename parameter notebook:', error);
                    rename.disabled = false;
                    row.classList.remove('is-busy');
                    await anomalousAlert(t('recipeParameterRenameError'));
                }
            };

            const remove = button(actions, '', 'anomalous-preset-item-btn is-delete');
            remove.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
            remove.title = t('recipeParameterDelete');
            remove.onclick = async (e) => {
                e.stopPropagation();
                if (!await anomalousConfirm(t('recipeParameterDeleteConfirm', { name: notebookName }))) return;
                remove.disabled = true;
                row.classList.add('is-deleting');
                try {
                    const response = await fetch('/anomalous/delete_parameter', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename: notebook.filename }),
                    });
                    const payload = await response.json();
                    if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'parameter notebook delete failed');
                    if (parameterState.selectedFilename === notebook.filename) parameterState.selectedFilename = null;
                    parameterState.editor = null;
                    parameterState.parameterGalleryRequestId += 1;
                    gallery.status = 'idle';
                    gallery.images = [];
                    gallery.scanned = 0;
                    await parameterState.refresh?.(true);
                } catch (error) {
                    console.error('Could not delete parameter notebook:', error);
                    remove.disabled = false;
                    row.classList.remove('is-deleting');
                    await anomalousAlert(t('recipeParameterDeleteError'));
                }
            };

            row.appendChild(actions);
            snapshotList.appendChild(row);
        }
    } else {
        appendText(snapshotList, 'p', t('recipeParameterNoSnapshots'), 'anomalous-recipe-detail-muted');
    }
    sidebar.appendChild(snapshotList);

    if (parameterState?.editor) {
        renderParameterNotebookEditor(wrapper, owner, recipe, parameterState, source, selectParameterTab);
        layout.append(sidebar, wrapper);
        content.appendChild(layout);
        return;
    }

    const intro = document.createElement('section');
    intro.className = 'anomalous-preset-console-header';

    const consoleInfo = document.createElement('div');
    consoleInfo.className = 'anomalous-preset-console-info';

    const titleRow = document.createElement('div');
    titleRow.className = 'anomalous-preset-console-title-row';

    const currentNotebook = parameterState.notebooks?.find(nb => nb.filename === parameterState.selectedFilename);
    const currentName = currentNotebook?.name || source?.name || t('recipeParameterCurrentRecipe');

    appendText(titleRow, 'h3', currentName, 'anomalous-preset-console-title');
    appendText(titleRow, 'span', t('recipeParameterActive'), 'anomalous-preset-item-badge');
    consoleInfo.appendChild(titleRow);

    appendText(consoleInfo, 'p', t('recipeDetailParametersHint'), 'anomalous-recipe-detail-muted');

    const consoleActions = document.createElement('div');
    consoleActions.className = 'anomalous-preset-console-actions';

    const applyButton = button(consoleActions, '', 'anomalous-preset-btn-primary');
    applyButton.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>${t('recipeParameterApply')}`;
    applyButton.style.padding = '8px 16px';
    applyButton.style.fontSize = '0.88rem';

    const saveAllMaterial = button(consoleActions, t('materialSaveAllParameters'), 'anomalous-preset-btn-secondary');
    saveAllMaterial.onclick = () => saveParameterMaterial(
        owner,
        recipe,
        parameterState,
        null,
        `${currentName} · ${t('materialAllParameters')}`,
        saveAllMaterial,
    );

    if (parameterState?.selectedFilename) {
        const renameHeadingBtn = button(consoleActions, '', 'anomalous-btn-ghost');
        renameHeadingBtn.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>${t('recipeParameterRename')}`;
        renameHeadingBtn.onclick = async () => {
            const newName = await anomalousPrompt(t('recipeParameterRenamePrompt'), currentName);
            if (newName === null || !newName.trim() || newName.trim() === currentName) return;
            const trimmedName = newName.trim();
            renameHeadingBtn.disabled = true;
            try {
                const response = await fetch('/anomalous/rename_parameter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: parameterState.selectedFilename, name: trimmedName }),
                });
                const payload = await response.json();
                if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'rename failed');
                await parameterState.refresh?.(true);
            } catch (error) {
                console.error('Could not rename parameter notebook:', error);
                renameHeadingBtn.disabled = false;
                await anomalousAlert(t('recipeParameterRenameError'));
            }
        };
    }

    const applyStatus = appendText(consoleActions, 'small', '', 'anomalous-recipe-header-status');
    applyButton.onclick = async () => {
        applyButton.disabled = true;
        applyButton.classList.add('is-busy');
        applyStatus.textContent = t('recipeParameterApplying');
        try {
            const result = applyRecipeParametersToCanvas(source);
            applyStatus.textContent = t('recipeParameterApplied').replace('{count}', String(result.widgets));
            setTimeout(() => {
                if (applyStatus.textContent.includes(String(result.widgets))) {
                    applyStatus.textContent = '';
                }
            }, 4000);
        } catch (error) {
            console.error('Could not apply recipe parameter notebook:', error);
            const detailKey = {
                recipe_parameter_skeleton_mismatch: 'recipeParameterSkeletonMismatch',
                recipe_parameter_widget_mismatch: 'recipeParameterWidgetMismatch',
                recipe_parameter_node_unavailable: 'recipeParameterNodeUnavailable',
            }[error.code];
            const errorMessage = error.message || String(error);
            applyStatus.textContent = detailKey
                ? `${t(detailKey)} ${errorMessage}`.trim()
                : `${t('recipeParameterApplyError')} ${errorMessage}`.trim();
            applyStatus.title = errorMessage;
        } finally {
            applyButton.disabled = false;
            applyButton.classList.remove('is-busy');
        }
    };
    consoleInfo.appendChild(consoleActions);
    intro.appendChild(consoleInfo);

    // Compact gallery showcase tile on top right
    if (gallery.status === 'ready' && gallery.images.length) {
        const compactGallery = document.createElement('div');
        compactGallery.className = 'anomalous-preset-compact-gallery';
        compactGallery.title = `${t('recipeParameterGallery')} (${gallery.images.length})`;
        const thumb = document.createElement('img');
        thumb.src = outputImageUrl(gallery.images[0]);
        compactGallery.appendChild(thumb);
        const galleryBadge = appendText(compactGallery, 'span', '', 'anomalous-preset-compact-gallery-badge');
        galleryBadge.innerHTML = `<svg style="width:11px;height:11px;margin-right:3px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>${gallery.images.length}`;
        compactGallery.onclick = () => {
            const dialog = document.createElement('dialog');
            dialog.className = 'anomalous-recipe-gallery-dialog';
            const closeBtn = document.createElement('button');
            closeBtn.className = 'anomalous-dialog-close anomalous-btn-ghost';
            closeBtn.innerHTML = '✕';
            closeBtn.onclick = () => dialog.close();
            dialog.appendChild(closeBtn);
            const heading = document.createElement('h3');
            heading.textContent = `${t('recipeParameterGallery')} (${gallery.images.length})`;
            heading.className = 'anomalous-recipe-gallery-dialog-title';
            dialog.appendChild(heading);
            const grid = document.createElement('div');
            grid.className = 'anomalous-recipe-gallery-grid';
            for (const sourceImage of gallery.images) {
                const card = document.createElement('article');
                card.className = 'anomalous-recipe-gallery-card';
                const url = outputImageUrl(sourceImage);
                const image = document.createElement('img');
                image.src = url;
                image.loading = 'lazy';
                image.onclick = () => owner.showGalleryViewer?.(url);
                card.appendChild(image);
                const actions = document.createElement('div');
                actions.className = 'anomalous-recipe-gallery-card-actions';
                const details = button(actions, '', 'anomalous-btn-primary');
                details.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>${t('materialViewDetails')}`;
                details.onclick = event => {
                    event.stopPropagation();
                    const images = gallery.images;
                    dialog.close();
                    openGalleryImageDetail(owner, images, sourceImage, url);
                };
                card.appendChild(actions);
                grid.appendChild(card);
            }
            dialog.appendChild(grid);
            document.body.appendChild(dialog);
            dialog.addEventListener('close', () => dialog.remove());
            dialog.showModal();
        };
        intro.appendChild(compactGallery);
    }

    const params = source?.params || {};
    const resDisplay = formatRecipeResolution(params.resolution);
    const summary = document.createElement('section');
    summary.className = 'anomalous-recipe-detail-section anomalous-preset-bento-deck';

    const summaryHeader = document.createElement('div');
    summaryHeader.className = 'anomalous-recipe-detail-section-heading';
    summaryHeader.style.display = 'flex';
    summaryHeader.style.justifyContent = 'space-between';
    summaryHeader.style.alignItems = 'center';
    summaryHeader.style.marginBottom = '12px';
    appendText(summaryHeader, 'h5', t('recipeDetailParameterSummary') || '参数概览');
    summary.appendChild(summaryHeader);

    // Bento Grid for core scalar generation parameters
    const bentoGrid = document.createElement('div');
    bentoGrid.className = 'anomalous-recipe-bento-grid';

    const bentoItems = [
        { label: t('recipeDetailSteps') || '步数', val: params.steps, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' },
        { label: t('recipeDetailCFG') || 'CFG Scale', val: params.cfg, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>' },
        { label: t('recipeDetailSampler') || '采样器', val: params.sampler_name || params.samplers, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="8" cy="8" r="1.5"/><circle cx="16" cy="16" r="1.5"/><circle cx="12" cy="12" r="1.5"/></svg>' },
        { label: t('recipeDetailScheduler') || '调度器', val: params.scheduler, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' },
        { label: t('recipeDetailResolution') || '分辨率', val: resDisplay || params.resolution, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>' },
        { label: t('recipeDetailDenoise') || '降噪比', val: params.denoise, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg>' },
        { label: t('recipeDetailSeed') || '随机种子', val: params.seed, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>', isSeed: true },
    ].filter(item => item.val !== undefined && item.val !== null && item.val !== '');

    if (bentoItems.length > 0) {
        for (const item of bentoItems) {
            const tile = document.createElement('div');
            tile.className = 'anomalous-recipe-bento-tile is-interactive';

            const labelRow = document.createElement('div');
            labelRow.className = 'anomalous-recipe-bento-label-row';
            labelRow.style.display = 'flex';
            labelRow.style.justifyContent = 'space-between';
            labelRow.style.alignItems = 'center';

            const bentoLabel = document.createElement('span');
            bentoLabel.className = 'anomalous-recipe-bento-label';
            bentoLabel.innerHTML = `${item.icon}${item.label}`;
            labelRow.appendChild(bentoLabel);

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'anomalous-recipe-prompt-micro-copy';
            copyBtn.title = t('recipeCopyParameter') || '复制参数';
            copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
            
            const doCopy = (e) => {
                if (e) e.stopPropagation();
                navigator.clipboard.writeText(String(item.val)).then(() => {
                    copyBtn.classList.add('is-copied');
                    copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
                    setTimeout(() => {
                        copyBtn.classList.remove('is-copied');
                        copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
                    }, 1200);
                });
            };
            copyBtn.onclick = doCopy;
            labelRow.appendChild(copyBtn);

            tile.appendChild(labelRow);
            const valEl = appendText(tile, 'span', String(item.val), 'anomalous-recipe-bento-val');
            valEl.title = String(item.val);
            tile.onclick = doCopy;
            bentoGrid.appendChild(tile);
        }
        summary.appendChild(bentoGrid);
    }

    // Base Model & LoRA Matrix
    const baseModelVal = params.baseModel || params.baseModels;
    if (baseModelVal || (Array.isArray(params.loras) && params.loras.length > 0)) {
        const modelsDeck = document.createElement('div');
        modelsDeck.className = 'anomalous-recipe-models-bento-deck';
        modelsDeck.style.display = 'grid';
        modelsDeck.style.gap = '8px';
        modelsDeck.style.marginTop = '10px';

        if (baseModelVal) {
            const modelCard = document.createElement('div');
            modelCard.className = 'anomalous-recipe-model-highlight-card';
            modelCard.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><span style="display:inline-flex;align-items:center;color:#dc143c;"><svg style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></span><span style="font-size:0.75rem;color:#94a3b8;text-transform:uppercase;font-weight:600;">${t('recipeDetailBaseModel') || '底模'}</span></div><div style="font-size:0.9rem;font-weight:600;color:#f8fafc;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(String(baseModelVal))}">${escapeHtml(String(baseModelVal))}</div>`;
            modelsDeck.appendChild(modelCard);
        }

        if (Array.isArray(params.loras) && params.loras.length > 0) {
            const loraSection = document.createElement('div');
            loraSection.className = 'anomalous-recipe-lora-stack';
            const loraHeader = appendText(loraSection, 'div', '', 'anomalous-recipe-bento-label');
            loraHeader.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>${t('recipeDetailLoraSummary') || 'LoRA 阵容'} (${params.loras.length})`;

            const loraGrid = document.createElement('div');
            loraGrid.className = 'anomalous-recipe-lora-grid';
            loraGrid.style.display = 'grid';
            loraGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
            loraGrid.style.gap = '8px';
            loraGrid.style.marginTop = '6px';

            for (const lora of params.loras) {
                const loraPill = document.createElement('div');
                loraPill.className = 'anomalous-recipe-lora-pill';
                const loraName = typeof lora === 'object' && lora !== null ? (lora.name || 'Unknown') : String(lora);
                const modelWeight = typeof lora === 'object' && lora !== null && lora.strength_model !== undefined ? lora.strength_model : 1;
                const clipWeight = typeof lora === 'object' && lora !== null && lora.strength_clip !== undefined ? lora.strength_clip : 1;

                const nameEl = document.createElement('div');
                nameEl.className = 'anomalous-recipe-lora-name';
                nameEl.title = String(loraName);
                nameEl.textContent = `🎭 ${loraName}`;

                const weightsEl = document.createElement('div');
                weightsEl.className = 'anomalous-recipe-lora-weights';
                weightsEl.innerHTML = `<span title="Model Strength">M:${escapeHtml(String(modelWeight))}</span><span title="CLIP Strength">C:${escapeHtml(String(clipWeight))}</span>`;

                loraPill.append(nameEl, weightsEl);
                loraPill.title = window.anomalous_browser_lang === 'zh' ? '点击复制 LoRA 名称' : 'Click to copy LoRA name';
                loraPill.style.cursor = 'pointer';
                loraPill.onclick = (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(String(loraName)).then(() => {
                        nameEl.textContent = `✓ ${loraName}`;
                        setTimeout(() => { nameEl.textContent = `🎭 ${loraName}`; }, 1200);
                    });
                };
                loraGrid.appendChild(loraPill);
            }
            loraSection.appendChild(loraGrid);
            modelsDeck.appendChild(loraSection);
        }
        summary.appendChild(modelsDeck);
    }

    if (!bentoItems.length && !baseModelVal && (!Array.isArray(params.loras) || !params.loras.length)) {
        appendText(summary, 'p', t('recipeDetailNoSavedParameters'), 'anomalous-recipe-detail-muted');
    }

    const promptWrap = document.createElement('div');
    promptWrap.style.marginBottom = '14px';
    const saveNamedNodes = (nodeIds, label, actionButton) => saveParameterMaterial(
        owner,
        recipe,
        parameterState,
        nodeIds,
        `${currentName} · ${label}`,
        actionButton,
    );
    renderPromptSection(promptWrap, owner, recipe, source, selectParameterTab, saveNamedNodes);

    const nodesSection = document.createElement('section');
    nodesSection.className = 'anomalous-recipe-detail-section';
    renderRawNodesLazy(nodesSection, source, { onSaveNodes: saveNamedNodes });

    wrapper.append(intro, summary, promptWrap, nodesSection);
    layout.append(sidebar, wrapper);
    content.appendChild(layout);
}


export function showRecipeDetail(owner, { recipe, filename, history = [] }) {
    const returnState = owner.recipeReturnState || null;
    owner.recipeReturnState = null;
    owner.recipeDetailPayload = { recipe, filename, history };
    owner.recipeDetailFilename = filename;
    owner.recipeListContainer.style.display = 'none';
    const topbars = owner.recipeView ? Array.from(owner.recipeView.querySelectorAll('.anomalous-recipe-topbar, .anomalous-recipe-actionbar')) : [];
    topbars.forEach(bar => { bar.style.display = 'none'; });
    const betaNotice = owner.recipeView?.querySelector('.anomalous-recipe-beta-notice');
    if (betaNotice) betaNotice.style.display = 'none';
    if (owner.recipeDetailView) owner.recipeDetailView.remove();

    const view = document.createElement('div');
    view.className = 'anomalous-recipe-detail-view';
    owner.recipeDetailView = view;
    const references = deriveRecipeModelReferences(recipe);
    owner.recipeDetailPreviewState = 'idle';
    let resolveAction;
    let settled = false;
    const result = new Promise((resolve) => { resolveAction = resolve; });
    const finish = (mode) => {
        if (settled) return;
        settled = true;
        view.remove();
        owner.recipeDetailView = null;
        if (!['canvas', 'append', 'model'].includes(mode)) {
            owner.recipeListContainer.style.display = '';
            topbars.forEach(bar => { bar.style.display = ''; });
            if (betaNotice) betaNotice.style.display = '';
        }
        if (owner.recipeDetailFinish === finish) owner.recipeDetailFinish = null;
        if (mode !== 'model') delete owner.recipeDetailPayload;
        resolveAction({ mode });
    };
    owner.recipeDetailFinish = finish;


    const tabs = document.createElement('div');
    tabs.className = 'anomalous-recipe-detail-tabs';
    const content = document.createElement('div');
    content.className = 'anomalous-recipe-detail-content';
    const gallery = { status: 'idle', images: [], scanned: 0 };
    const parameterGallery = { status: 'idle', images: [], scanned: 0 };
    const parameterState = {
        status: 'idle',
        notebooks: [],
        selectedFilename: null,
        switchToken: 0,
        parameterGalleryRequestId: 0,
        refresh: null,
    };
    const galleryTabLabel = () => gallery.status === 'ready'
        ? `${t('recipeGallery')} (${gallery.images.length})`
        : t('recipeGallery');
    const updateGalleryTab = () => {
        const tab = tabs.querySelector('[data-tab="gallery"]');
        if (tab) tab.textContent = galleryTabLabel();
    };
    const refreshGallery = async (force = false) => {
        if (gallery.status === 'loading' || (!force && gallery.status === 'ready')) return;
        gallery.status = 'loading';
        updateGalleryTab();
        if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'gallery') selectTab('gallery');
        try {
            const response = await fetch(`/anomalous/recipe_gallery?filename=${encodeURIComponent(filename)}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('recipe gallery request failed');
            const payload = await response.json();
            gallery.images = Array.isArray(payload.images) ? payload.images : [];
            gallery.scanned = Number(payload.scanned) || 0;
            gallery.status = 'ready';
        } catch (error) {
            console.error('Could not load recipe gallery:', error);
            gallery.status = 'error';
        }
        updateGalleryTab();
        if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'gallery') selectTab('gallery');
    };
    const refreshParameterNotebooks = async (force = false) => {
        if (parameterState.status === 'loading' || (!force && parameterState.status === 'ready')) return;
        parameterState.status = 'loading';
        if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'parameters') selectTab('parameters');
        try {
            const response = await fetch(`/anomalous/parameters?recipe_filename=${encodeURIComponent(filename)}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('recipe parameter notebook request failed');
            const payload = await response.json();
            parameterState.notebooks = Array.isArray(payload.notebooks) ? payload.notebooks : [];
            if (!parameterState.notebooks.some((item) => item.filename === parameterState.selectedFilename)) {
                parameterState.selectedFilename = parameterState.notebooks[0]?.filename || null;
            }
            parameterState.status = 'ready';
        } catch (error) {
            console.error('Could not load recipe parameter notebooks:', error);
            parameterState.status = 'error';
        }
        parameterGallery.status = 'idle';
        parameterGallery.images = [];
        parameterGallery.scanned = 0;
        if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'parameters') {
            selectTab('parameters');
            void refreshParameterGallery();
        }
    };
    parameterState.refresh = refreshParameterNotebooks;
    const refreshParameterGallery = async (force = false) => {
        if (parameterGallery.status === 'loading' || (!force && parameterGallery.status === 'ready')) return;
        parameterGallery.status = 'loading';
        const requestId = ++parameterState.parameterGalleryRequestId;
        if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'parameters') selectTab('parameters');
        try {
            const selectedFilename = parameterState.selectedFilename;
            const endpoint = selectedFilename
                ? `/anomalous/parameter_gallery?filename=${encodeURIComponent(selectedFilename)}`
                : `/anomalous/recipe_parameter_gallery?filename=${encodeURIComponent(filename)}`;
            const response = await fetch(endpoint, { cache: 'no-store' });
            if (!response.ok) throw new Error('recipe parameter gallery request failed');
            const payload = await response.json();
            if (payload.status !== 'success') throw new Error('recipe parameter gallery response failed');
            if (requestId !== parameterState.parameterGalleryRequestId || selectedFilename !== parameterState.selectedFilename) return;
            parameterGallery.images = Array.isArray(payload.images) ? payload.images : [];
            parameterGallery.scanned = Number(payload.scanned) || 0;
            parameterGallery.status = 'ready';
        } catch (error) {
            if (requestId !== parameterState.parameterGalleryRequestId) return;
            console.error('Could not load recipe parameter gallery:', error);
            parameterGallery.status = 'error';
        }
        if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'parameters') selectTab('parameters');
    };
    const tabDefinitions = [
        ['overview', t('recipeDetailOverview'), () => {
            renderOverview(content, owner, recipe, references, finish, {
                applyRecipeToCanvas,
                promptValues,
                renderModelComposition,
            });
        }],
        ['parameters', t('recipeDetailParameters'), () => renderRecipeParameters(
            content,
            owner,
            recipe,
            parameterGallery,
            refreshParameterGallery,
            parameterState,
            () => selectTab('parameters'),
        )],
        ['versions', t('recipeDetailVersions'), () => renderVersions(content, owner, recipe, history, finish)],
        ['gallery', galleryTabLabel(), () => renderRecipeGallery(content, owner, recipe, gallery, refreshGallery)],
    ];
    const selectTab = (active) => {
        owner.recipeDetailActiveTab = active;
        content.replaceChildren();
        for (const [key, label, render] of tabDefinitions) {
            const tab = tabs.querySelector(`[data-tab="${key}"]`);
            tab?.classList.toggle('active', key === active);
        }
        try {
            tabDefinitions.find(([key]) => key === active)?.[2]();
        } catch (tabError) {
            console.error(`Error rendering recipe detail tab "${active}":`, tabError);
            appendText(content, 'p', `Tab render error: ${tabError?.message || tabError}`, 'anomalous-recipe-dialog-error');
        }
        if (active === 'parameters') {
            if (parameterState.status === 'idle') void refreshParameterNotebooks();
            else if (parameterState.status === 'ready' && parameterGallery.status === 'idle') void refreshParameterGallery();
        }
        if (active !== 'overview' || owner.recipeDetailPreviewState !== 'idle') return;
        owner.recipeDetailPreviewState = 'loading';
        void loadCurrentPreviews(owner, references)
            .catch((error) => console.warn('Could not load recipe model previews:', error))
            .finally(() => {
                owner.recipeDetailPreviewState = 'loaded';
                if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'overview') {
                    // Re-render the overview so newly loaded previews become visible.
                    selectTab('overview');
                }
            });
    };
    const backTab = button(tabs, '← ' + t('recipeDetailBack'), 'anomalous-recipe-detail-tab anomalous-recipe-back-tab');
    backTab.style.backgroundColor = 'transparent';
    backTab.style.color = 'var(--descrip-text, #a8a8a8)';
    backTab.onmouseover = () => { backTab.style.color = '#fff'; };
    backTab.onmouseout = () => { backTab.style.color = 'var(--descrip-text, #a8a8a8)'; };
    backTab.onclick = () => finish('back');
    for (const [key, label] of tabDefinitions) {
        const tab = button(tabs, label, 'anomalous-recipe-detail-tab');
        tab.dataset.tab = key;
        tab.onclick = () => selectTab(key);
    }
    view.append(tabs, content);
    owner.recipeView.appendChild(view);
    selectTab(returnState?.activeTab || 'overview');
    void refreshGallery();
    void refreshParameterNotebooks();
    if (returnState?.scrollTop) {
        requestAnimationFrame(() => {
            view.scrollTop = returnState.scrollTop;
            content.scrollTop = returnState.scrollTop;
        });
    }
    return result;
}
