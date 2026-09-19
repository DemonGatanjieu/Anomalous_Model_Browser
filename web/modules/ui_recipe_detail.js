import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousPrompt } from './ui_dialog.js';
import {
    deriveRecipeModelReferences,
    formatIdentitySize,
    normaliseIdentity,
} from './recipe_identity.js';
import {
    appendRecipeToCanvas,
} from './recipe_actions.js';
import {
    appendCopyButton,
    appendText,
    button,
} from './ui_recipe_detail_dom.js';
import { renderVersions } from './ui_recipe_versions.js';
import { renderRecipeGallery } from './ui_recipe_gallery.js';
import { updateRecipeMetadata as updateInlineRecipeMetadata } from './ui_recipe_metadata.js';
import { renderOverview } from './ui_recipe_overview.js';
import { promptValues, renderRecipeParameters } from './ui_recipe_parameters.js';
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
            syncRecipeReferencesToCatalog(owner, owner.recipeDetailFilename, references);
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

function syncRecipeReferencesToCatalog(owner, filename, references) {
    if (!owner || !filename || !Array.isArray(references)) return;
    const record = (owner.recipeRecords || []).find((r) => r?.filename === filename);
    if (record?.data?.params) {
        record.data.params.model_references = references.map((r) => ({
            ...r,
            currentAvailability: r.currentAvailability || (r.localModel ? 'available' : undefined),
        }));
    }
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
        syncRecipeReferencesToCatalog(owner, filename, references);
        if (!['canvas', 'append', 'model'].includes(mode)) {
            owner.recipeListContainer.style.display = '';
            topbars.forEach(bar => { bar.style.display = ''; });
            if (betaNotice) betaNotice.style.display = '';
            owner.renderRecipeList?.(owner.recipeRecords || []);
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
                syncRecipeReferencesToCatalog(owner, filename, references);
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
