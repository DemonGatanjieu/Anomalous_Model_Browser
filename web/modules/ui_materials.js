/** Curated material snapshots: generated image + exact workflow + node blocks. */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';

const t = (key, params) => translate(key, params);

function text(parent, tag, value, className = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value == null ? '' : String(value);
    parent.appendChild(element);
    return element;
}

function materialAssetUrl(filename, asset) {
    if (!filename || !asset) return '';
    return `/anomalous/material_asset?filename=${encodeURIComponent(filename)}&asset=${encodeURIComponent(asset)}`;
}

async function jsonResponse(response, fallbackMessage) {
    let payload = {};
    try { payload = await response.json(); } catch (error) { /* non-JSON server failure */ }
    if (!response.ok) throw new Error(payload.message || fallbackMessage);
    return payload;
}

function hideSiblingWorkspaceViews(owner) {
    if (owner.notebookBody) owner.notebookBody.style.display = 'none';
    if (owner.recipeView) owner.recipeView.style.display = 'none';
    owner.notebookNotesTab?.classList.remove('active');
    owner.notebookRecipesTab?.classList.remove('active');
    owner.notebookMaterialsTab?.classList.add('active');
}

async function fetchMaterial(filename) {
    const response = await fetch(`/anomalous/material_full?filename=${encodeURIComponent(filename)}`, { cache: 'no-store' });
    const payload = await jsonResponse(response, 'material load failed');
    if (payload.status !== 'success') throw new Error(payload.message || 'material load failed');
    return payload;
}

async function openMaterialWorkflow(owner, filename) {
    const payload = await fetchMaterial(filename);
    if (!payload.data?.workflow || typeof app.loadGraphData !== 'function') throw new Error('material workflow unavailable');
    await app.loadGraphData(JSON.parse(JSON.stringify(payload.data.workflow)));
    app.canvas?.setDirty?.(true, true);
    owner.closeWorkspace?.();
    owner.close?.();
    window.setTimeout(() => window.anomalous_resolve_all_missing_nodes?.(true, false), 0);
}

function renderMaterialCard(owner, material) {
    const card = document.createElement('article');
    card.className = 'anomalous-material-card';
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
        preview.textContent = '🖼️';
    }
    card.appendChild(preview);

    const body = document.createElement('div');
    body.className = 'anomalous-material-card-body';
    text(body, 'h3', material.name || t('materialUntitled'));
    text(body, 'p', t('materialNodeSummary', { count: material.node_count || 0 }), 'anomalous-material-muted');
    if (Array.isArray(material.node_types) && material.node_types.length) {
        text(body, 'small', material.node_types.slice(0, 5).join(' · '), 'anomalous-material-types');
    }
    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'anomalous-material-card-actions';
    const open = text(actions, 'button', `🚀 ${t('materialOpenWorkflow')}`, 'anomalous-btn-primary');
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
    const remove = text(actions, 'button', '🗑️', 'anomalous-btn-ghost');
    remove.type = 'button';
    remove.title = t('materialDelete');
    remove.onclick = async () => {
        if (!await anomalousConfirm(t('materialDeleteConfirm'))) return;
        const response = await fetch('/anomalous/delete_material', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: material.filename }),
        });
        if (!response.ok) {
            await anomalousAlert(t('materialDeleteError'));
            return;
        }
        await owner.refreshMaterials?.();
    };
    card.appendChild(actions);
    return card;
}

export async function refreshMaterials() {
    if (!this.materialList) return;
    this.materialList.replaceChildren();
    text(this.materialList, 'p', t('loading'), 'anomalous-material-empty');
    try {
        const response = await fetch('/anomalous/materials', { cache: 'no-store' });
        const payload = await jsonResponse(response, 'material list failed');
        this.materialList.replaceChildren();
        const materials = Array.isArray(payload.materials) ? payload.materials : [];
        if (!materials.length) {
            text(this.materialList, 'p', t('materialEmpty'), 'anomalous-material-empty');
            return;
        }
        for (const material of materials) this.materialList.appendChild(renderMaterialCard(this, material));
    } catch (error) {
        console.error('Could not load materials:', error);
        this.materialList.replaceChildren();
        text(this.materialList, 'p', t('materialLoadError'), 'anomalous-material-empty');
    }
}

export async function showMaterials() {
    if (!this.notebookContainer) {
        this.nbPanel.style.display = 'flex';
        await this.showNotebooks();
    }
    hideSiblingWorkspaceViews(this);
    if (!this.materialView) {
        this.materialView = document.createElement('div');
        this.materialView.className = 'anomalous-material-body';
        const intro = document.createElement('div');
        intro.className = 'anomalous-material-intro';
        const introCopy = document.createElement('div');
        text(introCopy, 'h3', t('materialLibrary'));
        text(introCopy, 'p', t('materialLibraryHint'), 'anomalous-material-muted');
        const refresh = text(intro, 'button', `↻ ${t('refresh')}`, 'anomalous-btn-ghost');
        refresh.type = 'button';
        refresh.onclick = () => this.refreshMaterials();
        intro.prepend(introCopy);
        this.materialView.appendChild(intro);
        this.materialList = document.createElement('div');
        this.materialList.className = 'anomalous-material-list';
        this.materialView.appendChild(this.materialList);
        this.notebookContainer.appendChild(this.materialView);
    }
    this.materialView.style.display = 'flex';
    await this.refreshMaterials();
}

export async function showImageMaterialDetail(owner, sourceImage, imageUrl) {
    const overlay = document.createElement('div');
    overlay.className = 'anomalous-material-detail-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'anomalous-material-detail-dialog';
    const close = text(dialog, 'button', '×', 'anomalous-material-detail-close');
    close.type = 'button';
    close.onclick = () => overlay.remove();
    const media = document.createElement('div');
    media.className = 'anomalous-material-detail-media';
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = t('materialImageDetail');
    media.appendChild(image);
    const side = document.createElement('div');
    side.className = 'anomalous-material-detail-side';
    text(side, 'h2', t('materialImageDetail'));
    const loading = text(side, 'p', t('materialInspecting'), 'anomalous-material-muted');
    dialog.append(media, side);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });

    try {
        const response = await fetch('/anomalous/inspect_image_material', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_image: sourceImage }),
        });
        const payload = await jsonResponse(response, 'material inspection failed');
        if (payload.status !== 'success') throw new Error(payload.message || 'material inspection failed');
        loading.remove();
        text(side, 'p', t('materialSnapshotExplanation'), 'anomalous-material-muted');

        // 1. Key generation parameters (Steps, CFG, Sampler, Resolution)
        const params = payload.params || {};
        const hasSamplingParams = params.steps || params.cfg || params.sampler_name || params.resolution;
        if (hasSamplingParams) {
            const metricGrid = document.createElement('div');
            metricGrid.className = 'anomalous-material-metric-grid';

            const addMetric = (labelStr, val) => {
                if (val == null || val === '') return;
                const card = document.createElement('div');
                card.className = 'anomalous-material-metric-card';
                text(card, 'span', labelStr, 'anomalous-material-metric-label');
                text(card, 'span', String(val), 'anomalous-material-metric-val');
                metricGrid.appendChild(card);
            };

            addMetric(t('recipeCardSpecsSteps') || '步数', params.steps);
            addMetric('CFG', params.cfg);
            const samplerFull = [params.sampler_name, params.scheduler].filter(Boolean).join(' / ');
            addMetric(t('recipeCardSpecsSampler') || '采样', samplerFull);
            addMetric(t('recipeCardSpecsResolution') || '尺寸', params.resolution);

            if (metricGrid.childElementCount) side.appendChild(metricGrid);
        }

        // 2. Prompt Preview Card with copy and expand
        const promptFullText = (Array.isArray(payload.prompts) && payload.prompts.length)
            ? payload.prompts.join('\n\n')
            : (payload.prompt_excerpt || '');

        if (promptFullText) {
            const promptCard = document.createElement('div');
            promptCard.className = 'anomalous-material-prompt-card';

            const bar = document.createElement('div');
            bar.className = 'anomalous-material-prompt-bar';
            text(bar, 'span', t('materialPromptText') || '提示词', 'anomalous-material-prompt-bar-label');

            const btns = document.createElement('div');
            btns.className = 'anomalous-material-prompt-bar-btns';

            if (promptFullText.length > 80 || promptFullText.includes('\n')) {
                const expandBtn = text(btns, 'button', t('materialExpandAll') || '展开', 'anomalous-material-mini-btn');
                expandBtn.type = 'button';
                expandBtn.onclick = () => {
                    const isExp = promptContent.classList.toggle('is-expanded');
                    expandBtn.textContent = isExp ? (t('materialCollapse') || '收起') : (t('materialExpandAll') || '展开');
                };
            }

            const copyBtn = text(btns, 'button', t('materialCopyPrompt') || '📋 复制', 'anomalous-material-mini-btn');
            copyBtn.type = 'button';
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(promptFullText).then(() => {
                    copyBtn.textContent = t('materialCopied') || '✅ 已复制';
                    setTimeout(() => { copyBtn.textContent = t('materialCopyPrompt') || '📋 复制'; }, 1500);
                });
            };

            bar.appendChild(btns);
            promptCard.appendChild(bar);

            const promptContent = text(promptCard, 'div', promptFullText, 'anomalous-material-prompt-content');
            side.appendChild(promptCard);
        }

        // 3. Collapsible: Referenced Models
        const models = Array.isArray(payload.model_references) ? payload.model_references : [];
        if (models.length) {
            const modelDetails = document.createElement('details');
            modelDetails.className = 'anomalous-material-accordion';

            const modelSummary = document.createElement('summary');
            modelSummary.textContent = `📦 ${t('materialReferencedModels', { count: models.length })} ▾`;
            modelDetails.appendChild(modelSummary);

            const modelContent = document.createElement('div');
            modelContent.className = 'anomalous-material-accordion-content';

            for (const ref of models) {
                const row = document.createElement('div');
                row.className = 'anomalous-material-model-row';
                const modelName = String(ref.saved_value || ref.name || 'Unknown').replace(/\\/g, '/').split('/').pop();
                const nameEl = text(row, 'span', modelName, 'anomalous-material-model-name');
                nameEl.title = ref.saved_value || modelName;
                text(row, 'span', ref.category || 'model', 'anomalous-material-model-tag');
                modelContent.appendChild(row);
            }
            modelDetails.appendChild(modelContent);
            side.appendChild(modelDetails);
        }

        // 4. Collapsible: Included Nodes
        const blocks = Array.isArray(payload.node_blocks) ? payload.node_blocks : [];
        if (blocks.length) {
            const nodeDetails = document.createElement('details');
            nodeDetails.className = 'anomalous-material-accordion';

            const nodeSummary = document.createElement('summary');
            nodeSummary.textContent = `⚙️ ${t('materialIncludedNodes', { count: blocks.length })} ▾`;
            nodeDetails.appendChild(nodeSummary);

            const nodeContent = document.createElement('div');
            nodeContent.className = 'anomalous-material-accordion-content';

            const typeCounts = {};
            for (const b of blocks) {
                const tName = b.title || b.type || 'Node';
                typeCounts[tName] = (typeCounts[tName] || 0) + 1;
            }

            const chipFlow = document.createElement('div');
            chipFlow.className = 'anomalous-material-chip-flow';
            for (const [nTitle, cnt] of Object.entries(typeCounts)) {
                const chip = document.createElement('span');
                chip.className = 'anomalous-material-chip';
                text(chip, 'span', nTitle);
                if (cnt > 1) text(chip, 'span', `×${cnt}`, 'anomalous-material-chip-count');
                chipFlow.appendChild(chip);
            }
            nodeContent.appendChild(chipFlow);
            nodeDetails.appendChild(nodeContent);
            side.appendChild(nodeDetails);
        }

        // 5. Name input and save action
        const label = text(side, 'label', t('materialName'));
        const name = document.createElement('input');
        name.type = 'text';
        name.maxLength = 120;
        name.value = payload.suggested_name || '';
        label.appendChild(name);
        const hint = text(side, 'small', t('materialSaveHint'), 'anomalous-material-muted');
        hint.style.marginTop = 'auto';
        const save = text(side, 'button', `💾 ${t('materialSaveSnapshot')}`, 'anomalous-btn-primary');
        save.type = 'button';
        save.onclick = async () => {
            const value = name.value.trim();
            if (!value) { name.focus(); return; }
            save.disabled = true;
            try {
                const saveResponse = await fetch('/anomalous/save_image_material', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source_image: sourceImage, name: value }),
                });
                const savePayload = await jsonResponse(saveResponse, 'material save failed');
                if (savePayload.status !== 'success') throw new Error(savePayload.message || 'material save failed');
                owner?.refreshMaterials?.();
                overlay.remove();
                await anomalousAlert(t('materialSaveSuccess'));
            } catch (error) {
                console.error('Could not save image material:', error);
                await anomalousAlert(t('materialSaveError'));
                save.disabled = false;
            }
        };
        name.focus();
        name.select();
    } catch (error) {
        console.error('Could not inspect image material:', error);
        loading.textContent = t('materialInspectError');
    }
}
