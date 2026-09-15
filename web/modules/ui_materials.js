import { bindMaterialDrag } from './material_drag.js';
import { selectedMaterialNode } from './node_material_actions.js';
import { applyMaterialToSelectedNode, applyMaterialToNode } from './ui_material_application.js';
/** Curated image/workflow and Recipe parameter materials. */

import { app } from '../../../scripts/app.js';
import { translate, resolveLocale } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { showImageWorkbench } from './ui_gallery_detail.js';
import { text, jsonResponse } from './ui_dom.js';
import { escapeHtml } from './safe_dom.js';
import { sectionLabel, fileBaseName, renderDetailedNodeCards, applyPromptRolesToBlocks, renderMaterialPromptGroups, materialNodeHeading } from './material_inspector.js';

const t = (key, params) => translate(key, params);
const isPromptMaterial = material => ['prompt_note_bundle', 'prompt_text'].includes(material.kind);
const promptKindLabel = material => t(material.kind === 'prompt_text' ? 'materialPromptTextKind' : 'materialPromptNoteBundle');

function getMaterialPlaceholderSvg(material, size = 36) {
    if (isPromptMaterial(material) || material?.kind === 'prompt_plan') {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;filter:drop-shadow(0 2px 8px rgba(56,189,248,0.3));"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    }
    if (material?.kind === 'recipe_parameter_selection') {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;filter:drop-shadow(0 2px 8px rgba(45,212,191,0.3));"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`;
}

function materialAssetUrl(filename, asset) {
    if (!filename || !asset) return '';
    return `/anomalous/material_asset?filename=${encodeURIComponent(filename)}&asset=${encodeURIComponent(asset)}`;
}

function hideSiblingWorkspaceViews(owner) {
    if (owner.notebookContainer) owner.notebookContainer.style.display = 'none';
    if (owner.notebookBody) owner.notebookBody.style.display = 'none';
    if (owner.recipeView) owner.recipeView.style.display = 'none';
    if (owner.recipeContainer) owner.recipeContainer.style.display = 'none';
    owner.notebookNotesTab?.classList.remove('active');
    owner.notebookRecipesTab?.classList.remove('active');
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
    if (material?.kind === 'prompt_plan') {
        const plan = payload.data?.plan || {};
        if (plan.positive) {
            sectionLabel(content, window.anomalous_browser_lang === 'zh' ? '正向提示词' : 'Positive Prompt');
            text(content, 'pre', plan.positive, 'anomalous-material-note-text');
            const copy = text(content, 'button', t('materialCopyPrompt'), 'anomalous-btn-ghost');
            copy.type = 'button';
            copy.onclick = async () => {
                try { await navigator.clipboard.writeText(plan.positive); copy.textContent = t('materialCopied'); }
                catch (error) { await anomalousAlert(t('materialCopyError')); }
            };
        }
        if (plan.negative) {
            sectionLabel(content, window.anomalous_browser_lang === 'zh' ? '负向提示词' : 'Negative Prompt');
            text(content, 'pre', plan.negative, 'anomalous-material-note-text');
            const copyNeg = text(content, 'button', t('materialCopyPrompt'), 'anomalous-btn-ghost');
            copyNeg.type = 'button';
            copyNeg.onclick = async () => {
                try { await navigator.clipboard.writeText(plan.negative); copyNeg.textContent = t('materialCopied'); }
                catch (error) { await anomalousAlert(t('materialCopyError')); }
            };
        }
        return;
    }
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
    owner.materialOpenedDetail = null;
    owner.materialDetailController?.abort();
    owner.materialDetailController = null;
    owner.materialDetailView?.remove();
    owner.materialDetailView = null;
    if (owner.materialTopbar) owner.materialTopbar.style.display = 'flex';
    if (owner.materialMainArea) owner.materialMainArea.style.display = 'flex';
    if (owner.materialIntro) owner.materialIntro.style.display = 'flex';
    if (owner.materialList) owner.materialList.style.display = '';
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
    const targetNode = owner.materialTarget || selectedMaterialNode(app);
    if (targetNode) {
        const applyBtn = text(headerActions, 'button', '', 'anomalous-btn-primary anomalous-material-header-apply-btn');
        applyBtn.type = 'button';
        const targetTitle = materialNodeHeading(targetNode);
        const normalLabel = `⚡ ${window.anomalous_browser_lang === 'zh' ? `应用到节点 (${targetTitle})` : `Apply to Node (${targetTitle})`}`;
        applyBtn.textContent = normalLabel;
        applyBtn.title = window.anomalous_browser_lang === 'zh'
            ? `将本素材的参数或提示词应用替换到当前选中的节点 #${targetNode.id}`
            : `Apply parameters or prompts of this material to selected node #${targetNode.id}`;
        applyBtn.onclick = async () => {
            applyBtn.disabled = true;
            applyBtn.textContent = `⏳ ${t('assistantApplying') || '应用中...'}`;
            try {
                await applyLibraryMaterial(owner, material, targetNode);
                applyBtn.textContent = `✅ ${t('assistantApplied') || '已应用'}`;
                setTimeout(() => {
                    if (applyBtn) {
                        applyBtn.disabled = false;
                        applyBtn.textContent = normalLabel;
                    }
                }, 2000);
            } catch (err) {
                console.error('Error applying material to node:', err);
                applyBtn.disabled = false;
                applyBtn.textContent = normalLabel;
            }
        };
    }
    if ((material.capabilities || []).includes('open_workflow')) {
        const open = text(headerActions, 'button', '', 'anomalous-btn-primary');
        open.type = 'button';
        open.innerHTML = `<svg style="width:14px;height:14px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>${t('materialOpenWorkflow')}`;
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
    const remove = text(headerActions, 'button', '', 'anomalous-btn-ghost');
    remove.type = 'button';
    remove.innerHTML = `<svg style="width:14px;height:14px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>${t('materialDelete')}`;
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
        imageStage.innerHTML = getMaterialPlaceholderSvg(material, 56);
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
    owner.materialOpenedDetail = material;
    owner.materialDetailController?.abort();
    owner.materialDetailView?.remove();
    owner.materialDetailView = null;
    if (owner.materialTopbar) owner.materialTopbar.style.display = 'none';
    if (owner.materialMainArea) owner.materialMainArea.style.display = 'none';
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
    const activate = () => showMaterialDetail(owner, material);
    card.onclick = activate;
    if (material.node_types?.length) {
        bindMaterialDrag(card, owner, {
            payload: () => ({ ...material, node_types: [...material.node_types], dragHint: t('materialDragParameters') || '拖拽素材参数至目标节点' }),
            accepts: (node, source) => source.node_types.includes(node.type),
            drop: (node, source, graph) => applyLibraryMaterial(owner, source, node, graph),
        });
    }
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${material.name} — ${t('materialViewDetails')}`);
    card.onkeydown = event => {
        if (event.target === card && ['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            activate();
        }
    };

    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'anomalous-material-card-actions-wrapper';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'anomalous-material-card-action-btn anomalous-material-card-delete';
    remove.innerHTML = '<svg style="width:13px;height:13px;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
    remove.title = t('materialDelete');
    remove.onclick = (e) => {
        e.stopPropagation();
        deleteMaterial(owner, material);
    };
    card.appendChild(remove);
    const removeClone = typeof remove.cloneNode === 'function' ? remove.cloneNode(true) : document.createElement('button');
    actionsWrapper.appendChild(removeClone);
    removeClone.onclick = remove.onclick;

    if (!owner.materialApplyMode && (material.capabilities || []).includes('open_workflow')) {
        const quickOpen = document.createElement('button');
        quickOpen.type = 'button';
        quickOpen.className = 'anomalous-material-card-action-btn anomalous-material-card-quick-load';
        quickOpen.innerHTML = '<svg style="width:13px;height:13px;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
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
        const quickOpenClone = typeof quickOpen.cloneNode === 'function' ? quickOpen.cloneNode(true) : document.createElement('button');
        actionsWrapper.appendChild(quickOpenClone);
        quickOpenClone.onclick = quickOpen.onclick;
    }

    const preview = document.createElement('div');
    preview.className = 'anomalous-material-card-preview';
    const previewUrl = materialAssetUrl(material.filename, material.image?.preview_asset_id || material.image?.source_asset_id);
    if (previewUrl) {
        const image = document.createElement('img');
        image.src = previewUrl;
        image.alt = material.name || t('materialUntitled');
        image.loading = 'lazy';
        image.draggable = false;
        preview.appendChild(image);
    } else {
        if (isPromptMaterial(material) || material.kind === 'prompt_plan') {
            preview.classList.add('is-prompt-fallback');
            preview.innerHTML = getMaterialPlaceholderSvg(material, 28);
            const snippet = document.createElement('div');
            snippet.className = 'anomalous-material-preview-snippet';
            snippet.textContent = material.summary || material.name || 'Prompt Note';
            preview.appendChild(snippet);
        } else if (material.kind === 'recipe_parameter_selection') {
            preview.classList.add('is-params-fallback');
            preview.innerHTML = getMaterialPlaceholderSvg(material, 28);
            const snippet = document.createElement('div');
            snippet.className = 'anomalous-material-preview-snippet';
            snippet.textContent = material.name || 'Parameters Scheme';
            preview.appendChild(snippet);
        } else {
            preview.classList.add('is-workflow-fallback');
            preview.innerHTML = getMaterialPlaceholderSvg(material, 28);
        }
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
    if (owner.materialApplyMode) {
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'anomalous-material-card-apply-btn';
        applyBtn.innerHTML = `<span>⚡</span> <span>${t('assistantApplyScheme') || (window.anomalous_browser_lang === 'zh' ? '应用到节点' : 'Apply to Node')}</span>`;
        applyBtn.title = t('materialApplyCard') || (window.anomalous_browser_lang === 'zh' ? '点击将本方案参数应用替换到当前节点' : 'Click to apply parameters to current node');
        applyBtn.onclick = async (e) => {
            e.stopPropagation();
            applyBtn.disabled = true;
            applyBtn.innerHTML = `<span>⏳</span> <span>${t('assistantApplying') || '应用中...'}</span>`;
            try {
                await applyLibraryMaterial(owner, material);
                applyBtn.innerHTML = `<span>✅</span> <span>${t('assistantApplied') || '已应用'}</span>`;
                setTimeout(() => {
                    if (applyBtn) {
                        applyBtn.disabled = false;
                        applyBtn.innerHTML = `<span>⚡</span> <span>${t('assistantApplyScheme') || (window.anomalous_browser_lang === 'zh' ? '应用到节点' : 'Apply to Node')}</span>`;
                    }
                }, 2000);
            } catch (err) {
                console.error(err);
                applyBtn.disabled = false;
                applyBtn.innerHTML = `<span>⚡</span> <span>${t('assistantApplyScheme') || (window.anomalous_browser_lang === 'zh' ? '应用到节点' : 'Apply to Node')}</span>`;
            }
        };
        body.appendChild(applyBtn);

        const applyBtnClone = applyBtn.cloneNode(true);
        applyBtnClone.onclick = applyBtn.onclick;
        actionsWrapper.insertBefore(applyBtnClone, actionsWrapper.firstChild);
    }
    card.appendChild(body);
    card.appendChild(actionsWrapper);

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

function buildMaterialTopbar(owner) {
    const topbar = text(owner.materialView, 'header', '', 'anomalous-material-topbar');
    owner.materialTopbar = topbar;

    // 1. 左侧微胶囊分类切换
    const left = text(topbar, 'div', '', 'anomalous-material-topbar-left');
    const pills = text(left, 'div', '', 'anomalous-material-pills');
    const categories = [
        { id: 'all', key: 'materialKindPill_all', kind: '' },
        { id: 'workflow', key: 'materialKindPill_workflow', kind: 'image_workflow_snapshot' },
        { id: 'params', key: 'materialKindPill_params', kind: 'recipe_parameter_selection' },
        { id: 'prompts', key: 'materialKindPill_prompts', kind: 'prompt_plan' },
    ];
    owner.materialKindPills = {};
    for (const cat of categories) {
        const pill = text(pills, 'button', t(cat.key) || cat.id, 'anomalous-material-pill');
        pill.type = 'button';
        if ((!owner.materialKindCategory && cat.id === 'all') || owner.materialKindCategory === cat.id) {
            pill.classList.add('is-active');
        }
        pill.onclick = () => {
            for (const p of Object.values(owner.materialKindPills)) p.classList.remove('is-active');
            pill.classList.add('is-active');
            owner.materialKindCategory = cat.id;
            owner.materialKind = '';
            if (cat.id === 'prompts') owner.materialApplyMode = false;
            owner.refreshMaterials(1);
        };
        owner.materialKindPills[cat.id] = pill;
    }

    // 2. 中间紧凑搜索与标签下拉
    const center = text(topbar, 'div', '', 'anomalous-material-topbar-center');
    const searchWrap = text(center, 'div', '', 'anomalous-material-search-wrap');
    const searchIcon = text(searchWrap, 'span', '', 'anomalous-material-search-icon');
    searchIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
    const search = text(searchWrap, 'input', '', 'anomalous-material-search-input');
    search.type = 'search';
    search.placeholder = t('materialSearchHint') || '搜索素材名称或标签...';
    search.value = owner.materialQuery || '';
    search.oninput = () => {
        clearTimeout(owner.materialSearchTimer);
        owner.materialQuery = search.value;
        owner.materialSearchTimer = setTimeout(() => owner.refreshMaterials(1), 250);
    };

    owner.materialTagSelect = text(center, 'select', '', 'anomalous-material-tag-select');
    owner.materialTagSelect.setAttribute('aria-label', t('materialTags'));
    owner.materialTagSelect.onchange = () => {
        owner.materialTag = owner.materialTagSelect.value;
        owner.refreshMaterials(1);
    };

    // 3. 右侧操作组
    const right = text(topbar, 'div', '', 'anomalous-material-topbar-right');

    // 视图切换 (网格 / 列表)
    const viewSwitch = text(right, 'div', '', 'anomalous-material-view-switch');
    const currentMode = owner.materialViewMode || (typeof localStorage !== 'undefined' ? localStorage.getItem('anomalous_material_view_mode') : null) || 'grid';
    owner.materialViewMode = currentMode;

    const gridBtn = text(viewSwitch, 'button', '', `anomalous-material-view-btn${currentMode === 'grid' ? ' is-active' : ''}`);
    gridBtn.type = 'button';
    gridBtn.title = t('materialViewGrid') || '网格视图';
    gridBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`;

    const listBtn = text(viewSwitch, 'button', '', `anomalous-material-view-btn${currentMode === 'list' ? ' is-active' : ''}`);
    listBtn.type = 'button';
    listBtn.title = t('materialViewList') || '列表视图';
    listBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`;

    gridBtn.onclick = () => {
        owner.materialViewMode = 'grid';
        if (typeof localStorage !== 'undefined') localStorage.setItem('anomalous_material_view_mode', 'grid');
        gridBtn.classList.add('is-active');
        listBtn.classList.remove('is-active');
        owner.materialList?.classList.remove('is-list');
        owner.materialList?.classList.add('is-grid');
    };

    listBtn.onclick = () => {
        owner.materialViewMode = 'list';
        if (typeof localStorage !== 'undefined') localStorage.setItem('anomalous_material_view_mode', 'list');
        listBtn.classList.add('is-active');
        gridBtn.classList.remove('is-active');
        owner.materialList?.classList.remove('is-grid');
        owner.materialList?.classList.add('is-list');
    };

    // 刷新按钮
    const refreshBtn = text(right, 'button', '↻', 'anomalous-material-topbar-btn');
    refreshBtn.type = 'button';
    refreshBtn.title = t('refresh');
    refreshBtn.onclick = () => owner.refreshMaterials();

    // 更多/转移中心
    const more = text(right, 'details', '', 'anomalous-secondary-actions');
    text(more, 'summary', '···');
    more.title = t('notebookMore') || '更多';
    const transfer = text(more, 'button', t('materialTransferCenter'), 'anomalous-btn-ghost');
    transfer.onclick = () => showTransferCenter(owner);
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

    if (owner.materialTagSelect) {
        const tags = owner.materialTagSelect;
        tags.replaceChildren();
        text(tags, 'option', t('materialAllTags')).value = '';
        for (const tag of payload.tags || []) text(tags, 'option', tag).value = tag;
        if (owner.materialTag && !(payload.tags || []).includes(owner.materialTag)) text(tags, 'option', owner.materialTag).value = owner.materialTag;
        tags.value = owner.materialTag || '';
    }
}

export async function refreshMaterials(page = this.materialPage || 1) {
    if (!this.materialList) return;
    this.materialListController?.abort();
    const controller = new AbortController();
    this.materialListController = controller;
    this.materialList.replaceChildren();
    text(this.materialList, 'p', t('loading'), 'anomalous-material-empty');
    updateMaterialContext(this);
    for (const [key, pill] of Object.entries(this.materialKindPills || {})) pill.classList.toggle('is-active', key === (this.materialKindCategory || 'all'));
    const query = new URLSearchParams({
        page,
        limit: 48,
        q: this.materialQuery || '',
        tag: this.materialTag || '',
        kind: this.materialKind || '',
        category: this.materialKindCategory || 'all',
    });
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

    this.nbPanel.style.display = 'flex';
    if (!this.materialContainer) {
        this.materialContainer = text(this.nbPanel, 'div', '', 'anomalous-nb-container anomalous-material-container');
        const header = text(this.materialContainer, 'div', '', 'anomalous-nb-header');
        this.materialHeading = text(header, 'h2', t('materialLibrary'));
        const close = text(header, 'button', '×', 'anomalous-btn-ghost');
        close.setAttribute('aria-label', t('close'));
        close.onclick = () => this.closeWorkspace();
    }
    this.materialHeading.textContent = t('materialLibrary');
    this.materialContainer.style.display = 'flex';
    watchMaterialSelection(this);
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

        buildMaterialTopbar(this);

        const mainArea = text(this.materialView, 'div', '', 'anomalous-material-main-area');
        this.materialMainArea = mainArea;

        const contentArea = text(mainArea, 'div', '', 'anomalous-material-content');
        this.materialContentArea = contentArea;

        this.materialContext = text(contentArea, 'div', '', 'anomalous-material-target-context');

        const initialMode = this.materialViewMode || localStorage.getItem('anomalous_material_view_mode') || 'grid';
        this.materialList = document.createElement('div');
        this.materialList.className = `anomalous-material-list is-${initialMode}`;
        contentArea.appendChild(this.materialList);

        this.materialPager = text(contentArea, 'nav', '', 'anomalous-material-pager');
        this.materialPager.setAttribute('aria-label', t('materialPagination'));

        this.materialContainer.appendChild(this.materialView);
    }
    this.materialView.style.display = 'flex';
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
    if (this.materialApplyMode) { this.materialKind = ''; this.materialKindCategory = 'all'; }
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
        toggle.onclick = () => {
            owner.materialApplyMode = !owner.materialApplyMode;
            owner.materialKind = '';
            owner.materialKindCategory = 'all';
            if (owner.materialKindPills) {
                for (const p of Object.values(owner.materialKindPills)) p.classList.remove('is-active');
                owner.materialKindPills.all?.classList.add('is-active');
            }
            if (owner.materialKindInput) owner.materialKindInput.value = '';
            owner.refreshMaterials(1);
        };
    }
    text(owner.materialContext, 'small', t('materialApplyContextHint'));
}

function watchMaterialSelection(owner) {
    if (owner.materialSelectionHooked || !app.canvas) return;
    owner.materialSelectionHooked = true;
    window.addEventListener('anomalous-language-change', async () => {
        if (owner.nbPanel?.style.display !== 'flex' || owner.materialView?.style.display !== 'flex') return;
        const detail = owner.materialOpenedDetail;
        await owner.showMaterials();
        if (detail) await showMaterialDetail(owner, detail);
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
                        owner.materialApplyMode = !!target && !(owner.materialKindCategory === 'prompts' || ['prompt_plan', 'prompt_text', 'prompt_note_bundle'].includes(owner.materialKind));
                        updateMaterialContext(owner);
                        if (!owner.materialDetailView) owner.refreshMaterials(1);
                    }
                });
            }
            return result;
        };
    }
}

async function applyLibraryMaterial(owner, material, droppedNode = null, graph = app.graph) {
    const node = droppedNode || selectedMaterialNode(app);
    if (!node) { await anomalousAlert(t('materialTargetChanged')); return; }
    if (owner.materialApplying) return;
    owner.materialApplying = true;
    try {
        const payload = await fetchMaterial(material.filename);
        if (app.graph !== graph || graph.getNodeById(node.id) !== node || (!droppedNode && selectedMaterialNode(app) !== node)) throw new Error('materialTargetChanged');
        if (owner.nbPanel?.style.display !== 'flex' || owner.materialView?.style.display !== 'flex'
            || (owner.modal && !owner.modal.classList.contains('visible'))) return;
        const blocks = (payload.node_blocks || []).filter(block => block.type === node.type && block.widgets_values?.length);
        if (!blocks.length) throw new Error('materialNoCompatibleValues');
        const apply = droppedNode ? applyMaterialToNode : applyMaterialToSelectedNode;
        if (blocks.length === 1) {
            apply(node, blocks[0], payload.workflow_hashes, owner.materialContext);
        } else {
            owner.materialBlockDialog?.close();
            const dialog = document.createElement('dialog'); dialog.className = 'anomalous-material-choice';
            owner.materialBlockDialog = dialog;
            text(dialog, 'h3', t('materialChooseBlock'));
            const status = text(dialog, 'p', ''); status.setAttribute('role', 'alert');

            const list = document.createElement('div');
            list.className = 'anomalous-material-choice-list';
            list.style.cssText = 'display:flex;flex-direction:column;gap:12px;margin:14px 0;max-height:60vh;overflow-y:auto;padding-right:4px;';
            dialog.appendChild(list);

            for (const block of blocks) {
                const itemCard = document.createElement('div');
                itemCard.className = 'anomalous-material-choice-card';
                itemCard.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:8px;transition:border-color 0.2s;';

                const headerRow = document.createElement('div');
                headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';

                const roleBadge = {
                    positive: `[🟢 ${t('recipePromptRolePositive') || '正向'}] `,
                    negative: `[🔴 ${t('recipePromptRoleNegative') || '负向'}] `,
                    both: `[🟣 ${t('recipePromptRoleBoth') || '混合'}] `,
                }[block.role] || '';

                const heading = document.createElement('div');
                heading.style.cssText = 'font-weight:700;font-size:13px;color:#f3f4f6;display:flex;align-items:center;gap:6px;';
                heading.innerHTML = `${roleBadge}<span>${escapeHtml(materialNodeHeading(block))} <small style="color:#9ca3af;font-size:11px;">#${block.node_id}</small></span>`;
                headerRow.appendChild(heading);
                itemCard.appendChild(headerRow);

                // Find text snippet or parameter summary
                let textContent = '';
                if (Array.isArray(block.widgets_values)) {
                    for (const val of block.widgets_values) {
                        if (typeof val === 'string' && val.trim().length > 0) {
                            textContent = val.trim();
                            break;
                        }
                    }
                }

                if (textContent) {
                    const previewBox = document.createElement('div');
                    previewBox.className = 'anomalous-material-snippet-box';
                    previewBox.style.cssText = 'background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:8px 10px;font-size:11px;color:#d1d5db;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:80px;overflow:hidden;position:relative;transition:max-height 0.25s ease;';

                    const textSpan = document.createElement('span');
                    textSpan.textContent = textContent;
                    previewBox.appendChild(textSpan);
                    itemCard.appendChild(previewBox);

                    if (textContent.length > 80 || textContent.includes('\n')) {
                        const toggleBtn = document.createElement('button');
                        toggleBtn.type = 'button';
                        toggleBtn.style.cssText = 'background:none;border:none;color:#60a5fa;cursor:pointer;font-size:11px;padding:2px 0;align-self:flex-start;text-decoration:underline;';
                        toggleBtn.textContent = t('expandText') || '展开全部 ▾';
                        let expanded = false;
                        toggleBtn.onclick = (e) => {
                            e.stopPropagation();
                            expanded = !expanded;
                            if (expanded) {
                                previewBox.style.maxHeight = '240px';
                                previewBox.style.overflowY = 'auto';
                                toggleBtn.textContent = t('collapseText') || '收起 ▴';
                            } else {
                                previewBox.style.maxHeight = '80px';
                                previewBox.style.overflow = 'hidden';
                                toggleBtn.textContent = t('expandText') || '展开全部 ▾';
                            }
                        };
                        itemCard.appendChild(toggleBtn);
                    }
                } else if (Array.isArray(block.widgets_values) && block.widgets_values.length > 0) {
                    const paramsSummary = document.createElement('div');
                    paramsSummary.style.cssText = 'font-size:11px;color:#9ca3af;background:rgba(0,0,0,0.2);padding:6px 8px;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                    paramsSummary.textContent = block.widgets_values.slice(0, 5).join(' · ');
                    itemCard.appendChild(paramsSummary);
                }

                const choose = document.createElement('button');
                choose.className = 'anomalous-btn-primary';
                choose.style.cssText = 'align-self:flex-end;padding:7px 14px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer;border-radius:6px;';
                choose.textContent = t('materialUseBlock') || (textContent ? '选用此段文本 ➔' : '应用此组参数 ➔');
                choose.onclick = async () => {
                    try {
                        if (app.graph !== graph) throw new Error('materialTargetChanged');
                        apply(node, block, payload.workflow_hashes, owner.materialContext);
                        dialog.close();
                    } catch (error) {
                        status.textContent = t(error.message) === error.message ? t('materialApplyFailed') : t(error.message);
                    }
                };
                itemCard.appendChild(choose);
                list.appendChild(itemCard);
            }

            const close = text(dialog, 'button', t('close'), 'anomalous-btn-ghost');
            close.style.cssText = 'margin-top:10px;align-self:flex-end;';
            close.onclick = () => dialog.close();
            dialog.onclose = () => { dialog.remove(); if (owner.materialBlockDialog === dialog) owner.materialBlockDialog = null; };
            document.body.appendChild(dialog);
            dialog.showModal();
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
            if (plan.format !== 'anomalous-prompt-plan-v1' && plan.format !== 'anomalous-prompt-mixer-v2') throw new Error('format');
            const response = await fetch('/anomalous/save_prompt_plan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: plan.name, tags: plan.tags || [], plan: plan.plan }) });
            if (response.status === 409) { status.textContent = t('promptAlreadyImported'); return; }
            const result = await jsonResponse(response, 'plan import failed');
            if (result.status !== 'success') throw new Error('import failed');
            if (!dialog.open) return;
            dialog.close(); owner.materialApplyMode = false; owner.materialKind = 'prompt_plan'; owner.materialKindCategory = 'prompts'; await owner.showMaterials();
        } catch (error) { status.textContent = t('promptImportError'); }
        finally { file.value = ''; importPlan.disabled = false; }
    };
    text(dialog, 'p', t('promptExportLocation'));
    const close = text(dialog, 'button', t('close'), 'anomalous-btn-ghost'); close.onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove(); document.body.appendChild(dialog); dialog.showModal();
}
