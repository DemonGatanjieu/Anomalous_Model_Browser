import { selectedMaterialNode } from './node_material_actions.js';
import { applyMaterialToSelectedNode } from './ui_material_application.js';
import { showPromptComposer, addPromptToDraft } from './ui_prompt_composer.js';
/** Curated image/workflow and Recipe parameter materials. */

import { app } from '../../../scripts/app.js';
import { translate, resolveLocale } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { showImageWorkbench } from './ui_gallery_detail.js';
import { text, sectionLabel, fileBaseName, jsonResponse, renderDetailedNodeCards, applyPromptRolesToBlocks, renderMaterialPromptGroups, materialNodeHeading } from './material_inspector.js';

const t = (key, params) => translate(key, params);
const isPromptMaterial = material => ['prompt_note_bundle', 'prompt_text'].includes(material.kind);
const promptKindLabel = material => t(material.kind === 'prompt_text' ? 'materialPromptTextKind' : 'materialPromptNoteBundle');

function materialAssetUrl(filename, asset) {
    if (!filename || !asset) return '';
    return `/anomalous/material_asset?filename=${encodeURIComponent(filename)}&asset=${encodeURIComponent(asset)}`;
}

function hideSiblingWorkspaceViews(owner) {
    if (owner.notebookBody) owner.notebookBody.style.display = 'none';
    if (owner.recipeView) owner.recipeView.style.display = 'none';
    owner.notebookNotesTab?.classList.remove('active');
    owner.notebookRecipesTab?.classList.remove('active');
    owner.notebookMaterialsTab?.classList.add('active');
}

async function fetchMaterial(filename, options = {}) {
    const query = new URLSearchParams({ filename, include_workflow: options.includeWorkflow ? '1' : '0' });
    const response = await fetch(`/anomalous/material_full?${query}`, {
        cache: 'no-store',
        signal: options.signal,
    });
    const payload = await jsonResponse(response, 'material load failed');
    if (payload.status !== 'success') throw new Error(payload.message || 'material load failed');
    return payload;
}

function renderSourceRecipeMark(parent, info, className = '') {
    if (!info?.filename) return null;
    const status = info.status === 'missing' || info.status === 'modified' ? info.status : 'current';
    const name = info.name || info.filename;
    const key = status === 'missing'
        ? 'materialSourceRecipeMissing'
        : status === 'modified'
            ? 'materialSourceRecipeModified'
            : 'materialSourceRecipeCurrent';
    return text(parent, 'span', t(key, { name }), `anomalous-material-source-mark is-${status}${className ? ` ${className}` : ''}`);
}

async function updateMaterialPromptRole(owner, material, payload, block, selectedRole) {
    const overrides = { ...(payload.data?.promptRoleOverrides || {}) };
    const key = String(block.node_id);
    if (selectedRole === 'auto') delete overrides[key];
    else overrides[key] = { role: selectedRole, nodeType: block.type || null };

    const response = await fetch('/anomalous/update_material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filename: material.filename,
            name: payload.data?.name || material.name,
            tags: payload.data?.tags || material.tags || [],
            promptRoleOverrides: overrides,
        }),
    });
    const result = await jsonResponse(response, 'material prompt role update failed');
    if (result.status !== 'success') throw new Error(result.message || 'material prompt role update failed');
    Object.assign(material, result.material);
    await showMaterialDetail(owner, material);
}

function renderMaterialInspector(content, payload, owner, material) {
    if (isPromptMaterial(material)) {
        const note = payload.data?.note || {};
        sectionLabel(content, t('notebookPromptTitle'));
        const prompt = text(content, 'pre', note.promptEn || '', 'anomalous-material-note-text');
        const copy = text(content, 'button', t('materialCopyPrompt'), 'anomalous-btn-ghost');
        copy.type = 'button';
        copy.disabled = !note.promptEn;
        copy.onclick = async () => {
            try { await navigator.clipboard.writeText(prompt.textContent); copy.textContent = t('materialCopied'); }
            catch (error) { await anomalousAlert(t('materialCopyError')); }
        };
        const add = text(content, 'button', t('promptAddToDraft'), 'anomalous-btn-ghost');
        add.onclick = () => addPromptToDraft(owner, material.name, note.promptEn || '');
        const models = [note.mainModel, ...(note.loras || [])].filter(Boolean);
        if (models.length) {
            sectionLabel(content, t('notebookCompanionModels'));
            models.forEach(model => text(content, 'p', model.filename || model.name || t('materialUntitled')));
        }
        text(content, 'p', t('materialRestoreNoteHint'), 'anomalous-material-muted');
        const restore = text(content, 'button', t('materialRestoreNote'), 'anomalous-btn-primary');
        restore.type = 'button';
        restore.onclick = async () => {
            restore.disabled = true;
            try {
                clearTimeout(owner.pTimeout);
                if (owner.currentNotebook && !await owner.saveCurrentNotebook()) throw new Error('pending note save failed');
                const data = JSON.parse(JSON.stringify(note));
                const name = t('materialNoteCopyName', { name: material.name }).slice(0, 120);
                const notebook = { filename: `nb_${crypto.randomUUID()}.json`,
                    name, data: { ...data, name } };
                const response = await fetch('/anomalous/save_notebook', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(notebook),
                });
                const result = await jsonResponse(response, 'notebook restore failed');
                if (result.status !== 'success') throw new Error('notebook restore failed');
                leaveMaterialDetail(owner);
                owner.currentNotebook = notebook;
                await owner.showNotebooks();
                owner.renderNotebookEditor();
            } catch (error) { await anomalousAlert(t('notebookSaveError')); }
            finally { restore.disabled = false; }
        };
        return;
    }
    const references = Array.isArray(payload.data?.model_references) ? payload.data.model_references : [];
    const blocks = applyPromptRolesToBlocks(
        Array.isArray(payload.node_blocks) ? payload.node_blocks : [],
        payload.prompt_roles,
    );
    const promptRoles = payload.prompt_roles || {};
    const hasManualRole = Object.values(promptRoles).some(info => info?.source === 'manual');

    renderSourceRecipeMark(content, payload.source_recipe || payload.data?.source_recipe, 'is-detail');

    if (payload.data?.selection?.scope === 'nodes') {
        text(content, 'p', t('materialUseFromNodeAssistant'), 'anomalous-material-muted');
    }

    if (renderMaterialPromptGroups(content, payload.prompt_groups, { manual: hasManualRole })) {
        const add = text(content, 'button', t('promptAddToDraft'), 'anomalous-btn-ghost');
        add.onclick = () => addPromptToDraft(owner, material.name,
            (payload.prompt_groups.positive || []).join('\n'), (payload.prompt_groups.negative || []).join('\n'));
    }

    if (references.length) {
        sectionLabel(content, t('materialModelReferences'));
        const models = document.createElement('div');
        models.className = 'anomalous-material-expanded-models';
        for (const reference of references) {
            const item = document.createElement('div');
            item.className = 'anomalous-material-expanded-model';
            const rawValue = reference.saved_value || reference.name || t('materialUntitled');
            const name = text(item, 'span', fileBaseName(rawValue));
            name.title = String(rawValue);
            text(item, 'small', reference.category || 'model');
            models.appendChild(item);
        }
        content.appendChild(models);
    }

    const blocksHeader = document.createElement('div');
    blocksHeader.className = 'anomalous-material-blocks-header';
    sectionLabel(blocksHeader, t('materialDetailedNodeParameters', { count: blocks.length }));

    content.appendChild(blocksHeader);

    if (blocks.length) {
        const list = renderDetailedNodeCards(content, blocks, {
            onPromptRoleChange: async (block, selectedRole) => {
                try {
                    await updateMaterialPromptRole(owner, material, payload, block, selectedRole);
                } catch (error) {
                    console.error('Could not update material prompt role:', error);
                    await anomalousAlert(t('recipePromptRoleSaveError'));
                    throw error;
                }
            },
        });
        if (blocks.length > 1) {
            const cards = Array.from(list.children);
            const toggleAllBtn = text(blocksHeader, 'button', '', 'anomalous-material-toggle-all-btn');
            toggleAllBtn.type = 'button';
            const updateToggle = () => {
                toggleAllBtn.textContent = t(cards.every(card => card.open) ? 'materialCollapseAll' : 'materialExpandAllNodes');
            };
            toggleAllBtn.onclick = () => {
                const open = cards.some(card => !card.open);
                cards.forEach(card => { card.open = open; });
                updateToggle();
            };
            list.addEventListener('toggle', updateToggle, true);
            updateToggle();
        }
    } else {
        text(content, 'p', t('materialNoNodeParameters'), 'anomalous-material-muted');
    }
}

function leaveMaterialDetail(owner) {
    owner.materialOpenedDetail = null;
    owner.materialDetailController?.abort();
    owner.materialDetailController = null;
    owner.materialDetailView?.remove();
    owner.materialDetailView = null;
    if (owner.materialIntro) owner.materialIntro.style.display = 'flex';
    if (owner.materialList) owner.materialList.style.display = 'grid';
    if (owner.materialToolbar) owner.materialToolbar.style.display = 'flex';
    if (owner.materialPager) owner.materialPager.style.display = 'flex';
    if (owner.materialContext) owner.materialContext.style.display = '';
}

async function deleteMaterial(owner, material) {
    if (!await anomalousConfirm(t('materialDeleteConfirm'))) return false;
    const response = await fetch('/anomalous/delete_material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: material.filename }),
    });
    if (!response.ok) {
        await anomalousAlert(t('materialDeleteError'));
        return false;
    }
    leaveMaterialDetail(owner);
    await owner.refreshMaterials?.();
    return true;
}

async function openMaterialWorkflow(owner, filename) {
    const payload = await fetchMaterial(filename, { includeWorkflow: true });
    if (!payload.data?.workflow || typeof app.loadGraphData !== 'function') throw new Error('material workflow unavailable');
    await app.loadGraphData(JSON.parse(JSON.stringify(payload.data.workflow)));
    app.canvas?.setDirty?.(true, true);
    owner.closeWorkspace?.();
    owner.close?.();
    window.setTimeout(() => window.anomalous_resolve_all_missing_nodes?.(true, false), 0);
}

function buildMaterialDetailHeader(owner, material) {
    const header = document.createElement('header');
    header.className = 'anomalous-library-detail-header';

    const back = text(header, 'button', `← ${t('materialBackToLibrary')}`, 'anomalous-library-detail-back');
    back.type = 'button';
    back.onclick = () => leaveMaterialDetail(owner);

    const heading = document.createElement('div');
    heading.className = 'anomalous-library-detail-heading';
    const title = text(heading, 'h2', material.name || t('materialUntitled'));
    title.title = material.name || t('materialUntitled');
    const scopeLabel = isPromptMaterial(material) ? promptKindLabel(material) : material.kind === 'recipe_parameter_selection'
        ? t('materialRecipeParameterMaterial')
        : material.selection?.scope === 'nodes'
            ? t('materialSelectedNodeMaterial')
            : t('materialFullWorkflowMaterial');
    text(heading, 'span', scopeLabel, 'anomalous-material-scope-badge');
    header.appendChild(heading);

    const headerActions = document.createElement('div');
    headerActions.className = 'anomalous-library-detail-actions';
    if ((material.capabilities || []).includes('open_workflow')) {
        const open = text(headerActions, 'button', `🚀 ${t('materialOpenWorkflow')}`, 'anomalous-btn-primary');
        open.type = 'button';
        open.onclick = async () => {
            open.disabled = true;
            try {
                await openMaterialWorkflow(owner, material.filename);
            } catch (error) {
                console.error('Could not open material workflow:', error);
                await anomalousAlert(t('materialOpenError'));
                open.disabled = false;
            }
        };
    }
    const edit = text(headerActions, 'button', t('materialEditDetails'), 'anomalous-btn-ghost');
    edit.type = 'button';
    edit.onclick = () => toggleMaterialEditor(owner, material, header);
    const remove = text(headerActions, 'button', `🗑️ ${t('materialDelete')}`, 'anomalous-btn-ghost');
    remove.type = 'button';
    remove.onclick = () => deleteMaterial(owner, material);
    header.appendChild(headerActions);

    return header;
}

function buildMaterialMediaStage(owner, material, sourceNameElement) {
    const media = document.createElement('aside');
    media.className = 'anomalous-library-detail-media';
    const previewUrl = materialAssetUrl(material.filename, material.image?.preview_asset_id || material.image?.source_asset_id);
    const sourceUrl = materialAssetUrl(material.filename, material.image?.source_asset_id || material.image?.preview_asset_id);

    const imageStage = document.createElement('button');
    imageStage.className = 'anomalous-library-detail-image-stage';
    imageStage.type = 'button';
    imageStage.title = t('materialOpenSourceImage');

    if (previewUrl) {
        const image = document.createElement('img');
        image.src = previewUrl;
        image.alt = material.name || t('materialUntitled');
        image.decoding = 'async';
        imageStage.appendChild(image);
        imageStage.onclick = () => owner.showGalleryViewer?.(sourceUrl);
    } else {
        imageStage.textContent = (isPromptMaterial(material) || material.kind === 'prompt_plan') ? '💬' : material.kind === 'recipe_parameter_selection' ? '🧰' : '🖼️';
        imageStage.disabled = true;
    }
    media.appendChild(imageStage);

    const sourceMeta = document.createElement('div');
    sourceMeta.className = 'anomalous-library-detail-source';
    const sourceCopy = document.createElement('div');
    sourceCopy.className = 'anomalous-library-detail-source-copy';
    text(sourceCopy, 'span', isPromptMaterial(material) ? t('materialPromptNoteBundle') : material.kind === 'recipe_parameter_selection'
        ? t('materialSourceParameters')
        : t('materialSourceImage'));
    sourceCopy.appendChild(sourceNameElement);
    sourceMeta.appendChild(sourceCopy);

    if (sourceUrl) {
        const openSource = text(sourceMeta, 'button', t('materialOpenSourceImage'), 'anomalous-library-detail-source-open');
        openSource.type = 'button';
        openSource.onclick = () => owner.showGalleryViewer?.(sourceUrl);
        sourceMeta.appendChild(openSource);
    }

    media.appendChild(sourceMeta);
    return media;
}

async function showMaterialDetail(owner, material) {
    if (material.kind === 'prompt_plan') return showPromptComposer(owner, material);
    owner.materialOpenedDetail = material;
    owner.materialDetailController?.abort();
    owner.materialDetailView?.remove();
    owner.materialDetailView = null;
    if (owner.materialIntro) owner.materialIntro.style.display = 'none';
    if (owner.materialList) owner.materialList.style.display = 'none';
    if (owner.materialToolbar) owner.materialToolbar.style.display = 'none';
    if (owner.materialPager) owner.materialPager.style.display = 'none';

    const detail = document.createElement('section');
    detail.className = 'anomalous-library-detail-view';
    owner.materialDetailView = detail;

    const sourceNameElement = document.createElement('strong');
    sourceNameElement.textContent = t('loading');

    const header = buildMaterialDetailHeader(owner, material);
    detail.appendChild(header);

    const layout = document.createElement('div');
    layout.className = 'anomalous-library-detail-layout';
    if (material.kind === 'recipe_parameter_selection' || isPromptMaterial(material)) layout.classList.add('is-parameter');

    const media = buildMaterialMediaStage(owner, material, sourceNameElement);
    layout.appendChild(media);

    const inspector = document.createElement('main');
    inspector.className = 'anomalous-library-detail-inspector';
    text(inspector, 'p', t('loading'), 'anomalous-material-muted');
    layout.appendChild(inspector);

    detail.appendChild(layout);
    owner.materialView.appendChild(detail);

    const controller = new AbortController();
    owner.materialDetailController = controller;
    try {
        const payload = await fetchMaterial(material.filename, { signal: controller.signal });
        if (owner.materialDetailView !== detail) return;
        const sourceImage = payload.data?.source?.image || {};
        const materialSource = payload.data?.source || {};
        const sourceName = sourceImage.filename || materialSource.parameter_name
            || materialSource.recipe_name || materialSource.notebook_name || material.name || t('materialUntitled');
        sourceNameElement.textContent = sourceName;
        sourceNameElement.title = sourceName;
        inspector.replaceChildren();
        renderMaterialInspector(inspector, payload, owner, material);
    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error('Could not load material detail:', error);
        inspector.replaceChildren();
        text(inspector, 'p', t('materialDetailLoadError'), 'anomalous-material-empty');
    } finally {
        if (owner.materialDetailController === controller) owner.materialDetailController = null;
    }
}

function startInlineTitleEdit(owner, material, titleRow, cardTitle, editBtn) {
    if (titleRow.querySelector('.anomalous-material-inline-input')) return;
    const originalName = material.name || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'anomalous-material-inline-input';
    input.value = originalName;
    input.maxLength = 120;
    input.placeholder = t('materialName') || '输入短标题…';

    cardTitle.style.display = 'none';
    editBtn.style.display = 'none';
    titleRow.appendChild(input);
    input.focus();
    input.select();

    let isSaving = false;
    const finish = async (shouldSave) => {
        if (isSaving) return;
        const newName = input.value.trim();
        if (shouldSave && newName && newName !== originalName) {
            isSaving = true;
            input.disabled = true;
            try {
                const response = await fetch('/anomalous/update_material', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: material.filename,
                        name: newName,
                        tags: material.tags || [],
                    }),
                });
                const payload = await jsonResponse(response, 'material update failed');
                if (payload.status === 'success' && payload.material) {
                    Object.assign(material, payload.material);
                    cardTitle.textContent = material.name;
                    cardTitle.title = material.name;
                }
            } catch (err) {
                console.warn('Failed to update title:', err);
            }
        }
        input.remove();
        cardTitle.style.display = '';
        editBtn.style.display = '';
    };

    input.onclick = (e) => e.stopPropagation();
    input.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            finish(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
        }
    };
    input.onblur = () => finish(true);
}

function renderMaterialCard(owner, material) {
    const card = document.createElement('article');
    card.className = 'anomalous-material-card';
    card.title = t('materialViewDetails') || '点击查看详细参数';
    const activate = () => owner.materialApplyMode ? applyLibraryMaterial(owner, material) : showMaterialDetail(owner, material);
    card.onclick = activate;
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${material.name} — ${t('materialViewDetails')}`);
    card.onkeydown = event => {
        if (event.target === card && ['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            activate();
        }
    };

    if (owner.materialApplyMode) {
        card.title = t('materialApplyCard');
        card.setAttribute('aria-label', `${material.name} — ${t('materialApplyCard')}`);
        const inspect = text(card, 'button', t('materialViewDetails'), 'anomalous-material-inspect-action');
        inspect.onclick = event => { event.stopPropagation(); showMaterialDetail(owner, material); };
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'anomalous-material-card-delete';
    remove.innerHTML = '🗑️';
    remove.title = t('materialDelete');
    remove.onclick = (e) => {
        e.stopPropagation();
        deleteMaterial(owner, material);
    };
    card.appendChild(remove);

    if (!owner.materialApplyMode && (material.capabilities || []).includes('open_workflow')) {
        const quickOpen = document.createElement('button');
        quickOpen.type = 'button';
        quickOpen.className = 'anomalous-material-card-quick-load';
        quickOpen.innerHTML = '🚀';
        quickOpen.title = t('materialOpenWorkflow');
        quickOpen.onclick = async (e) => {
            e.stopPropagation();
            try {
                await openMaterialWorkflow(owner, material.filename);
            } catch (error) {
                await anomalousAlert(t('materialOpenError'));
            }
        };
        card.appendChild(quickOpen);
    }

    const preview = document.createElement('div');
    preview.className = 'anomalous-material-card-preview';
    const previewUrl = materialAssetUrl(material.filename, material.image?.preview_asset_id || material.image?.source_asset_id);
    if (previewUrl) {
        const image = document.createElement('img');
        image.src = previewUrl;
        image.alt = material.name || t('materialUntitled');
        image.loading = 'lazy';
        preview.appendChild(image);
    } else {
        preview.textContent = (isPromptMaterial(material) || material.kind === 'prompt_plan') ? '💬' : material.kind === 'recipe_parameter_selection' ? '🧰' : '🖼️';
    }
    card.appendChild(preview);

    const body = document.createElement('div');
    body.className = 'anomalous-material-card-body';

    const titleRow = document.createElement('div');
    titleRow.className = 'anomalous-material-card-title-row';

    const cardTitle = document.createElement('h3');
    cardTitle.className = 'anomalous-material-card-title-text';
    cardTitle.textContent = material.name || t('materialUntitled');
    cardTitle.title = material.name || t('materialUntitled');
    titleRow.appendChild(cardTitle);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'anomalous-material-card-edit-btn';
    editBtn.title = t('materialQuickEditTitle') || '修改短标题';
    editBtn.innerHTML = `
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z"></path>
        </svg>
    `;
    editBtn.onclick = (e) => {
        e.stopPropagation();
        startInlineTitleEdit(owner, material, titleRow, cardTitle, editBtn);
    };
    titleRow.appendChild(editBtn);
    body.appendChild(titleRow);

    const metadata = document.createElement('div');
    metadata.className = 'anomalous-material-card-meta';
    if (material.kind === 'prompt_plan') {
        text(metadata, 'span', t('promptPlan'), 'anomalous-material-scope-badge');
    } else if (isPromptMaterial(material)) {
        text(metadata, 'span', promptKindLabel(material), 'anomalous-material-scope-badge is-prompt');
    } else if (material.kind === 'recipe_parameter_selection') {
        text(metadata, 'span', t('materialRecipeParameterMaterial'), 'anomalous-material-scope-badge is-nodes');
    } else if (material.selection?.scope === 'nodes') {
        const isPromptOnly = Array.isArray(material.node_types) &&
            material.node_types.length > 0 &&
            material.node_types.every(tp => /cliptextencode/i.test(tp));
        const badgeText = isPromptOnly
            ? `💬 ${t('materialPromptNode') || '提示词'}`
            : t('materialSelectedNodeMaterial');
        text(metadata, 'span', badgeText, 'anomalous-material-scope-badge is-nodes');
    } else {
        text(metadata, 'span', t('materialFullWorkflowMaterial'), 'anomalous-material-scope-badge is-workflow');
    }
    if (!isPromptMaterial(material) && material.kind !== 'prompt_plan') text(metadata, 'span', t('materialNodeSummary', { count: material.node_count || 0 }), 'anomalous-material-meta-pill');
    body.appendChild(metadata);

    const secondaryRow = document.createElement('div');
    secondaryRow.className = 'anomalous-material-card-subinfo';
    if (material.timestamp) {
        const dateStr = new Date(material.timestamp).toLocaleDateString();
        text(secondaryRow, 'span', dateStr, 'anomalous-material-card-date');
    }
    renderSourceRecipeMark(secondaryRow, material.source_recipe);
    if (secondaryRow.hasChildNodes()) {
        body.appendChild(secondaryRow);
    }

    if (Array.isArray(material.node_types) && material.node_types.length) {
        const displayLimit = 2;
        const shownTypes = material.node_types.slice(0, displayLimit);
        const labels = shownTypes.map(type => materialNodeHeading({ type }));
        const remaining = material.node_types.length - shownTypes.length;
        let summaryText = labels.join(' · ');
        if (remaining > 0) {
            summaryText += t('materialOtherNodeTypes', { count: remaining });
        }
        const types = text(body, 'small', summaryText, 'anomalous-material-types');
        types.title = material.node_types.map(type => materialNodeHeading({ type })).join(' · ');
    }
    if (material.tags?.length) {
        const tags = text(body, 'div', '', 'anomalous-material-tags');
        material.tags.forEach(tag => text(tags, 'span', tag, 'anomalous-material-tag'));
    }
    card.appendChild(body);

    return card;
}

function toggleMaterialEditor(owner, material, header) {
    const existing = header.querySelector('.anomalous-material-editor');
    if (existing) { existing.remove(); return; }
    const form = text(header, 'form', '', 'anomalous-material-editor');
    const nameLabel = text(form, 'label', t('materialName'));
    const name = text(nameLabel, 'input', '');
    name.value = material.name || '';
    name.maxLength = 120;
    name.required = true;
    const tagsLabel = text(form, 'label', t('materialTags'));
    const tags = text(tagsLabel, 'input', '');
    tags.value = (material.tags || []).join(', ');
    tags.placeholder = t('materialTagsHint');
    tags.maxLength = 1200;
    const save = text(form, 'button', t('materialSaveDetails'), 'anomalous-btn-primary');
    save.type = 'submit';
    const status = text(form, 'span', '', 'anomalous-material-muted');
    status.setAttribute('role', 'status');
    form.onsubmit = async event => {
        event.preventDefault();
        save.disabled = true;
        try {
            const response = await fetch('/anomalous/update_material', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: material.filename, name: name.value.trim(),
                    tags: tags.value.split(/[,，]/).map(value => value.trim()).filter(Boolean) }),
            });
            const payload = await jsonResponse(response, 'material update failed');
            if (payload.status !== 'success') throw new Error('material update failed');
            Object.assign(material, payload.material);
            header.querySelector('h2').textContent = material.name;
            header.querySelector('h2').title = material.name;
            const preview = owner.materialDetailView?.querySelector('.anomalous-library-detail-image-stage img');
            if (preview) preview.alt = material.name;
            await owner.refreshMaterials?.();
            form.remove();
        } catch (error) {
            status.textContent = t('materialUpdateError');
            save.disabled = false;
        }
    };
    name.focus();
}

function buildMaterialFilters(owner) {
    const toolbar = text(owner.materialView, 'div', '', 'anomalous-material-toolbar');
    owner.materialToolbar = toolbar;
    const search = text(toolbar, 'input', '');
    search.type = 'search';
    search.placeholder = t('materialSearchHint');
    search.setAttribute('aria-label', t('materialSearchHint'));
    search.maxLength = 200;
    search.value = owner.materialQuery || '';
    search.oninput = () => {
        clearTimeout(owner.materialSearchTimer);
        owner.materialQuery = search.value;
        owner.materialSearchTimer = setTimeout(() => owner.refreshMaterials(1), 250);
    };
    const kind = text(toolbar, 'select', '');
    kind.setAttribute('aria-label', t('materialFilterKind'));
    for (const [value, key] of [
        ['', 'materialAllKinds'],
        ['image_workflow_snapshot', 'materialFullWorkflowMaterial'],
        ['image_node_selection', 'materialSelectedNodeMaterial'],
        ['recipe_parameter_selection', 'materialRecipeParameterMaterial'],
        ['prompt_note_bundle', 'materialPromptNoteBundle'],
        ['prompt_text', 'materialPromptTextKind'],
        ['prompt_plan', 'promptPlan'],
    ]) {
        const option = text(kind, 'option', t(key));
        option.value = value;
    }
    owner.materialKindInput = kind;
    kind.value = owner.materialKind || '';
    kind.onchange = () => {
        owner.materialKind = kind.value;
        if (['prompt_plan', 'prompt_text', 'prompt_note_bundle'].includes(kind.value)) owner.materialApplyMode = false;
        owner.refreshMaterials(1);
    };
    owner.materialTagSelect = text(toolbar, 'select', '');
    owner.materialTagSelect.setAttribute('aria-label', t('materialTags'));
    owner.materialTagSelect.onchange = () => { owner.materialTag = owner.materialTagSelect.value; owner.refreshMaterials(1); };
}

function renderMaterialPagination(owner, payload) {
    owner.materialPager.replaceChildren();
    const previous = text(owner.materialPager, 'button', t('materialPrevious'), 'anomalous-btn-ghost');
    previous.type = 'button';
    previous.disabled = payload.page <= 1;
    previous.onclick = () => owner.refreshMaterials(payload.page - 1);
    text(owner.materialPager, 'span', t('materialPageSummary', { page: payload.page, pages: payload.pages, count: payload.total }));
    const next = text(owner.materialPager, 'button', t('materialNext'), 'anomalous-btn-ghost');
    next.type = 'button';
    next.disabled = payload.page >= payload.pages;
    next.onclick = () => owner.refreshMaterials(payload.page + 1);
    const tags = owner.materialTagSelect;
    tags.replaceChildren();
    text(tags, 'option', t('materialAllTags')).value = '';
    for (const tag of payload.tags || []) text(tags, 'option', tag).value = tag;
    if (owner.materialTag && !(payload.tags || []).includes(owner.materialTag)) text(tags, 'option', owner.materialTag).value = owner.materialTag;
    tags.value = owner.materialTag || '';
}

export async function refreshMaterials(page = this.materialPage || 1) {
    if (!this.materialList) return;
    this.materialListController?.abort();
    const controller = new AbortController();
    this.materialListController = controller;
    this.materialList.replaceChildren();
    text(this.materialList, 'p', t('loading'), 'anomalous-material-empty');
    updateMaterialContext(this);
    const query = new URLSearchParams({ page, limit: 48, q: this.materialQuery || '',
        tag: this.materialTag || '', kind: this.materialKind || '' });
    if (this.materialApplyMode && this.materialTarget) query.set('node_type', this.materialTarget.type);
    try {
        const response = await fetch(`/anomalous/materials?${query}`, { cache: 'no-store', signal: controller.signal });
        const payload = await jsonResponse(response, 'material list failed');
        if (this.materialListController !== controller) return;
        this.materialPage = payload.page;
        this.materialList.replaceChildren();
        renderMaterialPagination(this, payload);
        const materials = Array.isArray(payload.materials) ? payload.materials : [];
        if (!materials.length) {
            text(this.materialList, 'p', t(this.materialQuery || this.materialTag || this.materialKind ? 'materialNoMatches' : 'materialEmpty'), 'anomalous-material-empty');
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const material of materials) fragment.appendChild(renderMaterialCard(this, material));
        this.materialList.appendChild(fragment);
    } catch (error) {
        if (error?.name === 'AbortError' || this.materialListController !== controller) return;
        console.error('Could not load materials:', error);
        this.materialList.replaceChildren();
        text(this.materialList, 'p', t('materialLoadError'), 'anomalous-material-empty');
    } finally {
        if (this.materialListController === controller) this.materialListController = null;
    }
}

export async function showMaterials() {
    if (!this.notebookContainer) {
        this.nbPanel.style.display = 'flex';
        await this.showNotebooks();
    }
    watchMaterialSelection(this);
    this.promptComposerView?.remove();
    this.promptComposerView = null;
    this.refreshPromptTarget = null;
    hideSiblingWorkspaceViews(this);
    leaveMaterialDetail(this);
    if (this.materialView && this.materialViewLocale !== resolveLocale()) {
        this.materialView.remove();
        this.materialView = null;
    }
    if (!this.materialView) {
        this.materialViewLocale = resolveLocale();
        this.materialView = document.createElement('div');
        this.materialView.className = 'anomalous-material-body';
        const intro = document.createElement('div');
        intro.className = 'anomalous-material-intro';
        this.materialIntro = intro;
        const introCopy = document.createElement('div');
        text(introCopy, 'h3', t('materialLibrary'));
        text(introCopy, 'p', t('materialLibraryHint'), 'anomalous-material-muted');
        const refresh = text(intro, 'button', `↻ ${t('refresh')}`, 'anomalous-btn-ghost');
        refresh.type = 'button';
        refresh.onclick = () => this.refreshMaterials();
        intro.prepend(introCopy);
        this.materialView.appendChild(intro);
        const actions = text(introCopy, 'div', '', 'anomalous-prompt-actions');
        const compose = text(actions, 'button', t('promptCombinations'), 'anomalous-btn-primary');
        compose.onclick = () => showPromptComposer(this);
        const plans = text(actions, 'button', t('promptSavedPlans'), 'anomalous-btn-ghost');
        plans.onclick = () => { this.materialApplyMode = false; this.materialKind = 'prompt_plan'; this.materialKindInput.value = 'prompt_plan'; this.refreshMaterials(1); };
        const more = text(actions, 'details', '', 'anomalous-secondary-actions');
        text(more, 'summary', t('notebookMore'));
        const transfer = text(more, 'button', t('materialTransferCenter'), 'anomalous-btn-ghost');
        transfer.onclick = () => showTransferCenter(this);
        this.materialContext = text(this.materialView, 'div', '', 'anomalous-material-target-context');
        buildMaterialFilters(this);
        this.materialList = document.createElement('div');
        this.materialList.className = 'anomalous-material-list';
        this.materialView.appendChild(this.materialList);
        this.materialPager = text(this.materialView, 'nav', '', 'anomalous-material-pager');
        this.materialPager.setAttribute('aria-label', t('materialPagination'));
        this.notebookContainer.appendChild(this.materialView);
    }
    this.materialView.style.display = 'flex';
    this.materialKindInput.value = this.materialKind || '';
    updateMaterialContext(this);
    await this.refreshMaterials();
}

/**
 * Direct client-side PNG chunk parser to safely extract embedded ComfyUI metadata
 * without requiring a server reboot or server-side re-encoding.
 */
export async function showImageMaterialDetail(owner, sourceImage, imageUrl, options = {}) {
    return showImageWorkbench(owner, sourceImage, imageUrl, options);
}

export async function openSavedMaterial(material) {
    this.recipeDetailFinish?.('closed');
    this.modal?.classList.add('visible');
    if (this.nbPanel.style.display !== 'flex' && !this.workspaceReturnState) {
        this.workspaceReturnState = Object.fromEntries([
            ['grid', this.grid], ['detail', this.detailPanel], ['gallery', this.galleryPanel],
            ['doctor', this.doctorPanel], ['assistant', this.assistantPanel],
        ].filter(([, panel]) => panel).map(([key, panel]) => [key, panel.style.display]));
    }
    this.nbPanel.style.display = 'flex';
    for (const panel of [this.grid, this.detailPanel, this.galleryPanel, this.doctorPanel, this.assistantPanel, this.paramPanel]) {
        if (panel) panel.style.display = 'none';
    }
    await showMaterials.call(this);
    if (material) await showMaterialDetail(this, material);
}


export async function openMaterialLibrary() {
    this.materialApplyMode = !!selectedMaterialNode(app);
    this.materialTarget = selectedMaterialNode(app);
    if (this.materialApplyMode) this.materialKind = '';
    await openSavedMaterial.call(this, null);
}

function updateMaterialContext(owner) {
    const node = selectedMaterialNode(app);
    owner.materialTarget = node;
    if (!node) owner.materialApplyMode = false;
    if (!owner.materialContext) return;
    owner.materialContext.replaceChildren();
    text(owner.materialContext, 'strong', node
        ? t(owner.materialApplyMode ? 'materialApplyingTo' : 'materialSelectedTarget', { name: materialNodeHeading(node), id: node.id })
        : t('materialSelectOneNode'));
    if (node) {
        const toggle = text(owner.materialContext, 'button', t(owner.materialApplyMode ? 'materialBrowseAll' : 'materialShowCompatible'), 'anomalous-btn-ghost');
        toggle.onclick = () => { owner.materialApplyMode = !owner.materialApplyMode; owner.materialKind = ''; owner.materialKindInput.value = ''; owner.refreshMaterials(1); };
    }
    text(owner.materialContext, 'small', t('materialApplyContextHint'));
}

function watchMaterialSelection(owner) {
    if (owner.materialSelectionHooked || !app.canvas) return;
    owner.materialSelectionHooked = true;
    window.addEventListener('anomalous-language-change', async () => {
        if (owner.nbPanel?.style.display !== 'flex' || owner.materialView?.style.display !== 'flex') return;
        const detail = owner.materialOpenedDetail;
        const composing = !!owner.promptComposerView;
        await owner.showMaterials();
        if (composing) await showPromptComposer(owner);
        else if (detail) await showMaterialDetail(owner, detail);
    });
    let scheduled = false;
    for (const key of ['onNodeSelected', 'onNodeDeselected']) {
        const previous = app.canvas[key];
        app.canvas[key] = function (...args) {
            const result = previous?.apply(this, args);
            if (!scheduled) {
                scheduled = true;
                queueMicrotask(() => {
                    scheduled = false;
                    if (owner.nbPanel?.style.display === 'none' || owner.materialView?.style.display !== 'flex') return;
                    const target = selectedMaterialNode(app);
                    if (target !== owner.materialTarget) {
                        owner.materialTarget = target;
                        owner.materialApplyMode = !!target && !['prompt_plan', 'prompt_text', 'prompt_note_bundle'].includes(owner.materialKind);
                        updateMaterialContext(owner);
                        owner.refreshPromptTarget?.();
                        if (!owner.promptComposerView && !owner.materialDetailView) owner.refreshMaterials(1);
                    }
                });
            }
            return result;
        };
    }
}

async function applyLibraryMaterial(owner, material) {
    const node = selectedMaterialNode(app);
    if (!node) { await anomalousAlert(t('materialTargetChanged')); return; }
    if (owner.materialApplying) return;
    owner.materialApplying = true;
    try {
        const payload = await fetchMaterial(material.filename);
        if (selectedMaterialNode(app) !== node) throw new Error('materialTargetChanged');
        if (owner.nbPanel?.style.display !== 'flex' || owner.materialView?.style.display !== 'flex'
            || (owner.modal && !owner.modal.classList.contains('visible'))) return;
        const blocks = (payload.node_blocks || []).filter(block => block.type === node.type && block.widgets_values?.length);
        if (!blocks.length) throw new Error('materialNoCompatibleValues');
        if (blocks.length === 1) {
            applyMaterialToSelectedNode(node, blocks[0], payload.workflow_hashes, owner.materialContext);
        } else {
            owner.materialBlockDialog?.close();
            const dialog = document.createElement('dialog'); dialog.className = 'anomalous-material-choice';
            owner.materialBlockDialog = dialog;
            text(dialog, 'h3', t('materialChooseBlock'));
            const status = text(dialog, 'p', ''); status.setAttribute('role', 'alert');
            for (const block of blocks) {
                const choose = text(dialog, 'button', `${materialNodeHeading(block)} #${block.node_id}`, 'anomalous-btn-primary');
                choose.onclick = async () => {
                    try { applyMaterialToSelectedNode(node, block, payload.workflow_hashes, owner.materialContext); dialog.close(); }
                    catch (error) { status.textContent = t(error.message) === error.message ? t('materialApplyFailed') : t(error.message); }
                };
            }
            const close = text(dialog, 'button', t('close'), 'anomalous-btn-ghost'); close.onclick = () => dialog.close();
            dialog.onclose = () => { dialog.remove(); if (owner.materialBlockDialog === dialog) owner.materialBlockDialog = null; };
            document.body.appendChild(dialog); dialog.showModal();
        }
    } catch (error) { await anomalousAlert(t(error.message) === error.message ? t('materialApplyFailed') : t(error.message)); }
    finally { owner.materialApplying = false; }
}

function showTransferCenter(owner) {
    const dialog = document.createElement('dialog'); dialog.className = 'anomalous-material-choice';
    text(dialog, 'h3', t('materialTransferCenter'));
    const status = text(dialog, 'p', ''); status.setAttribute('role', 'alert');
    const workflow = text(dialog, 'button', t('materialTransferWorkflow'), 'anomalous-btn-primary');
    workflow.onclick = async () => {
        if (!window.AMB_WorkflowShare) { status.textContent = t('sidebarModuleNotLoaded'); return; }
        dialog.close(); window.AMB_WorkflowShare.showUnifiedModal();
    };
    const recipe = text(dialog, 'button', t('materialTransferRecipes'), 'anomalous-btn-ghost');
    recipe.onclick = () => { dialog.close(); owner.showRecipes?.(); };
    const importPlan = text(dialog, 'button', t('promptImportPlan'), 'anomalous-btn-ghost');
    const file = text(dialog, 'input', ''); file.type = 'file'; file.accept = '.json'; file.hidden = true;
    importPlan.onclick = () => file.click();
    file.onchange = async () => {
        const source = file.files?.[0]; if (!source) return;
        importPlan.disabled = true;
        try {
            if (source.size > 2 * 1024 * 1024) throw new Error('oversize');
            const plan = JSON.parse(await source.text());
            if (!dialog.open) return;
            if (plan.format !== 'anomalous-prompt-plan-v1') throw new Error('format');
            const response = await fetch('/anomalous/save_prompt_plan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: plan.name, tags: plan.tags || [], plan: plan.plan }) });
            if (response.status === 409) { status.textContent = t('promptAlreadyImported'); return; }
            const result = await jsonResponse(response, 'plan import failed');
            if (result.status !== 'success') throw new Error('import failed');
            if (!dialog.open) return;
            dialog.close(); owner.materialApplyMode = false; owner.materialKind = 'prompt_plan'; await owner.showMaterials();
        } catch (error) { status.textContent = t('promptImportError'); }
        finally { file.value = ''; importPlan.disabled = false; }
    };
    text(dialog, 'p', t('promptExportLocation'));
    const close = text(dialog, 'button', t('close'), 'anomalous-btn-ghost'); close.onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove(); document.body.appendChild(dialog); dialog.showModal();
}
