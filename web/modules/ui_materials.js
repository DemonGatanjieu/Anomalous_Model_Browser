/** Curated image/workflow and Recipe parameter materials. */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { showImageWorkbench } from './ui_gallery_detail.js';
import { text, sectionLabel, fileBaseName, jsonResponse, renderDetailedNodeCards, applyPromptRolesToBlocks, renderMaterialPromptGroups } from './material_inspector.js';

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

    renderMaterialPromptGroups(content, payload.prompt_groups, { manual: hasManualRole });

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
    owner.materialDetailController?.abort();
    owner.materialDetailController = null;
    owner.materialDetailView?.remove();
    owner.materialDetailView = null;
    if (owner.materialIntro) owner.materialIntro.style.display = 'flex';
    if (owner.materialList) owner.materialList.style.display = 'grid';
    if (owner.materialToolbar) owner.materialToolbar.style.display = 'flex';
    if (owner.materialPager) owner.materialPager.style.display = 'flex';
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
        imageStage.textContent = isPromptMaterial(material) ? '💬' : material.kind === 'recipe_parameter_selection' ? '🧰' : '🖼️';
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

function renderMaterialCard(owner, material) {
    const card = document.createElement('article');
    card.className = 'anomalous-material-card';
    card.title = t('materialViewDetails') || '点击查看详细参数';
    card.onclick = () => showMaterialDetail(owner, material);
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${material.name} — ${t('materialViewDetails')}`);
    card.onkeydown = event => {
        if (event.target === card && ['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            showMaterialDetail(owner, material);
        }
    };

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

    if ((material.capabilities || []).includes('open_workflow')) {
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
        preview.textContent = isPromptMaterial(material) ? '💬' : material.kind === 'recipe_parameter_selection' ? '🧰' : '🖼️';
    }
    card.appendChild(preview);

    const body = document.createElement('div');
    body.className = 'anomalous-material-card-body';
    const cardTitle = text(body, 'h3', material.name || t('materialUntitled'));
    cardTitle.title = material.name || t('materialUntitled');

    const metadata = document.createElement('div');
    metadata.className = 'anomalous-material-card-meta';
    if (isPromptMaterial(material)) {
        text(metadata, 'span', promptKindLabel(material), 'anomalous-material-scope-badge');
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
    if (!isPromptMaterial(material)) text(metadata, 'span', t('materialNodeSummary', { count: material.node_count || 0 }), 'anomalous-material-meta-pill');
    renderSourceRecipeMark(metadata, material.source_recipe);
    body.appendChild(metadata);

    if (Array.isArray(material.node_types) && material.node_types.length) {
        // ComfyUI registers titles in its active locale; keep type IDs for matching.
        const labels = material.node_types.slice(0, 5).map(type => {
            const registered = globalThis.LiteGraph?.registered_node_types?.[type];
            return registered?.title || registered?.nodeData?.display_name || type;
        });
        const types = text(body, 'small', labels.join(' · '), 'anomalous-material-types');
        types.title = material.node_types.join(' · ');
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
    ]) {
        const option = text(kind, 'option', t(key));
        option.value = value;
    }
    kind.value = owner.materialKind || '';
    kind.onchange = () => { owner.materialKind = kind.value; owner.refreshMaterials(1); };
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
    const query = new URLSearchParams({ page, limit: 48, q: this.materialQuery || '',
        tag: this.materialTag || '', kind: this.materialKind || '' });
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
    hideSiblingWorkspaceViews(this);
    leaveMaterialDetail(this);
    if (!this.materialView) {
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
        buildMaterialFilters(this);
        this.materialList = document.createElement('div');
        this.materialList.className = 'anomalous-material-list';
        this.materialView.appendChild(this.materialList);
        this.materialPager = text(this.materialView, 'nav', '', 'anomalous-material-pager');
        this.materialPager.setAttribute('aria-label', t('materialPagination'));
        this.notebookContainer.appendChild(this.materialView);
    }
    this.materialView.style.display = 'flex';
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
    await showMaterialDetail(this, material);
}
