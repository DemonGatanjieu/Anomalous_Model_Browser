/** Material Library detail view and detail editing. */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { text, jsonResponse } from './ui_dom.js';
import {
    sectionLabel,
    fileBaseName,
    renderDetailedNodeCards,
    applyPromptRolesToBlocks,
    renderMaterialPromptGroups,
    materialNodeHeading,
} from './material_inspector.js';
import { selectedMaterialNode } from './node_material_actions.js';
import { fetchMaterial, applyLibraryMaterial } from './ui_material_application.js';

const t = (key, params) => translate(key, params);
export const isPromptMaterial = material => ['prompt_note_bundle', 'prompt_text'].includes(material?.kind);
export const promptKindLabel = material => t(material?.kind === 'prompt_text' ? 'materialPromptTextKind' : 'materialPromptNoteBundle');

export function getMaterialPromptInfo(material) {
    const isZh = window.anomalous_browser_lang === 'zh';
    let text = '';
    let role = 'positive';

    const note = material?.data?.note || material?.note;
    if (note) {
        text = (isZh && note.promptZh) ? note.promptZh : (note.promptEn || note.promptZh || '');
    }

    if (!text) {
        const plan = material?.data?.plan || material?.plan;
        if (plan) {
            if (plan.negative && !plan.positive) {
                text = plan.negative;
                role = 'negative';
            } else if (plan.positive) {
                text = plan.positive;
                role = 'positive';
            }
        }
    }

    if (!text && Array.isArray(material?.node_blocks)) {
        for (const block of material.node_blocks) {
            if (Array.isArray(block.widgets_values)) {
                for (const val of block.widgets_values) {
                    if (typeof val === 'string' && val.trim()) {
                        text = val.trim();
                        if (block.promptRole === 'negative') role = 'negative';
                        break;
                    }
                }
            }
            if (text) break;
        }
    }

    if (!text) {
        text = material?.summary || material?.name || '';
    }

    if (role !== 'negative') {
        const lowerName = String(material?.name || '').toLowerCase();
        const tags = Array.isArray(material?.tags) ? material.tags.map(t => String(t).toLowerCase()) : [];
        if (lowerName.includes('negative') || lowerName.includes('负向') || lowerName.includes('反向')
            || tags.some(t => t.includes('negative') || t.includes('负向') || t.includes('反向'))) {
            role = 'negative';
        }
    }

    return { text: text.trim(), role };
}

export function getMaterialPlaceholderSvg(material, size = 36) {
    if (isPromptMaterial(material) || material?.kind === 'prompt_plan') {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;filter:drop-shadow(0 2px 8px rgba(56,189,248,0.3));"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    }
    if (material?.kind === 'recipe_parameter_selection') {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;filter:drop-shadow(0 2px 8px rgba(45,212,191,0.3));"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`;
}

export function materialAssetUrl(filename, asset) {
    if (!filename || !asset) return '';
    return `/anomalous/material_asset?filename=${encodeURIComponent(filename)}&asset=${encodeURIComponent(asset)}`;
}

export function renderSourceRecipeMark(parent, info, className = '') {
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

export function leaveMaterialDetail(owner) {
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

export async function deleteMaterial(owner, material) {
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

export async function openMaterialWorkflow(owner, filename) {
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

export async function showMaterialDetail(owner, material) {
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
