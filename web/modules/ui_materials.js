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

/**
 * Direct client-side PNG chunk parser to safely extract embedded ComfyUI metadata
 * without requiring a server reboot or server-side re-encoding.
 */
async function parsePngMetadataFromUrl(url) {
    if (!url) return null;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const buffer = await response.arrayBuffer();
        const view = new DataView(buffer);
        if (view.byteLength < 32) return null;
        // PNG magic bytes: 137, 80, 78, 71, 13, 10, 26, 10
        if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) return null;

        let offset = 8;
        const utf8 = new TextDecoder('utf-8');
        const latin1 = new TextDecoder('iso-8859-1');
        const result = {};

        while (offset + 8 <= buffer.byteLength) {
            const length = view.getUint32(offset);
            const type = String.fromCharCode(
                view.getUint8(offset + 4),
                view.getUint8(offset + 5),
                view.getUint8(offset + 6),
                view.getUint8(offset + 7),
            );
            const dataOffset = offset + 8;
            if (type === 'IDAT') break; // Reached image raster data, text metadata is prior

            if (dataOffset + length > buffer.byteLength) break;

            if (type === 'tEXt') {
                const bytes = new Uint8Array(buffer, dataOffset, length);
                const nullIdx = bytes.indexOf(0);
                if (nullIdx > -1) {
                    const key = latin1.decode(bytes.subarray(0, nullIdx));
                    const val = latin1.decode(bytes.subarray(nullIdx + 1));
                    try { result[key] = JSON.parse(val); } catch { result[key] = val; }
                }
            } else if (type === 'iTXt') {
                const bytes = new Uint8Array(buffer, dataOffset, length);
                const nullIdx = bytes.indexOf(0);
                if (nullIdx > -1) {
                    const key = latin1.decode(bytes.subarray(0, nullIdx));
                    let ptr = nullIdx + 1;
                    const compFlag = bytes[ptr++];
                    const compMethod = bytes[ptr++];
                    while (ptr < bytes.length && bytes[ptr] !== 0) ptr++;
                    ptr++;
                    while (ptr < bytes.length && bytes[ptr] !== 0) ptr++;
                    ptr++;
                    if (compFlag === 0 && ptr <= bytes.length) {
                        const val = utf8.decode(bytes.subarray(ptr));
                        try { result[key] = JSON.parse(val); } catch { result[key] = val; }
                    }
                }
            }
            offset += 12 + length;
        }
        return result.workflow || result.prompt || null;
    } catch (e) {
        console.warn('Client-side PNG metadata read skipped:', e);
        return null;
    }
}

/**
 * Extract generation parameters, full prompts, and categorized model references with details (e.g. LoRA strengths)
 * directly from the workflow.
 */
function extractWorkflowDetails(workflow) {
    const params = {};
    const positivePrompts = [];
    const negativePrompts = [];
    const allPrompts = [];
    const loraDetailsMap = new Map();
    const discoveredModels = {
        checkpoints: [],
        loras: [],
        textEncoders: [],
        vaes: [],
        others: [],
    };

    if (!workflow || typeof workflow !== 'object') {
        return { params, positivePrompts, negativePrompts, allPrompts, loraDetailsMap, discoveredModels };
    }

    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];

    for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const ntype = String(node.type || '').trim();
        const ntypeLower = ntype.toLowerCase();
        const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];

        // 1. Sampling parameters
        if (ntypeLower === 'ksampler' || ntypeLower === 'ksampleradvanced') {
            const isAdv = ntypeLower === 'ksampleradvanced';
            const offset = isAdv ? 1 : 0;
            if (widgets[2 + offset] != null && params.steps == null) params.steps = widgets[2 + offset];
            if (widgets[3 + offset] != null && params.cfg == null) params.cfg = widgets[3 + offset];
            if (widgets[4 + offset] != null && params.sampler_name == null) params.sampler_name = widgets[4 + offset];
            if (widgets[5 + offset] != null && params.scheduler == null) params.scheduler = widgets[5 + offset];
            if (widgets[6 + offset] != null && params.denoise == null) params.denoise = widgets[6 + offset];
        } else if (ntypeLower === 'emptylatentimage') {
            if (widgets[0] && widgets[1] && params.resolution == null) {
                params.resolution = `${widgets[0]} × ${widgets[1]}`;
            }
        }

        // 2. Full un-truncated prompts
        if (ntypeLower.includes('cliptextencode') || ntypeLower.includes('prompt')) {
            const nodeTitle = String(node.title || ntype).toLowerCase();
            for (const val of widgets) {
                if (typeof val === 'string' && val.trim()) {
                    const textVal = val.trim();
                    if (!allPrompts.includes(textVal)) allPrompts.push(textVal);
                    if (nodeTitle.includes('neg') || nodeTitle.includes('负向')) {
                        if (!negativePrompts.includes(textVal)) negativePrompts.push(textVal);
                    } else {
                        if (!positivePrompts.includes(textVal)) positivePrompts.push(textVal);
                    }
                }
            }
        }

        // 3. Categorized model references & LoRA weights
        if (ntypeLower.includes('checkpoint') || ntypeLower === 'unetloader' || ntypeLower.includes('diffusionmodel')) {
            if (widgets[0] && typeof widgets[0] === 'string') {
                const name = widgets[0];
                if (!discoveredModels.checkpoints.some(c => c.name === name)) {
                    discoveredModels.checkpoints.push({
                        name,
                        category: ntypeLower.includes('unet') ? 'unet' : 'checkpoint',
                    });
                }
            }
        } else if (ntypeLower.includes('lora')) {
            if (widgets[0] && typeof widgets[0] === 'string') {
                const name = widgets[0];
                const strengthModel = widgets[1] != null ? Number(widgets[1]) : 1.0;
                const strengthClip = widgets[2] != null ? Number(widgets[2]) : strengthModel;
                loraDetailsMap.set(name, { strengthModel, strengthClip });
                const baseName = name.replace(/\\/g, '/').split('/').pop();
                loraDetailsMap.set(baseName, { strengthModel, strengthClip });
                if (!discoveredModels.loras.some(l => l.name === name)) {
                    discoveredModels.loras.push({ name, strengthModel, strengthClip, category: 'lora' });
                }
            }
        } else if (ntypeLower.includes('vaeloader') || (ntypeLower.includes('vae') && !ntypeLower.includes('encode') && !ntypeLower.includes('decode'))) {
            if (widgets[0] && typeof widgets[0] === 'string') {
                const name = widgets[0];
                if (!discoveredModels.vaes.some(v => v.name === name)) {
                    discoveredModels.vaes.push({ name, category: 'vae' });
                }
            }
        } else if (ntypeLower.includes('cliploader') || ntypeLower.includes('dualcliploader') || ntypeLower.includes('textencoder')) {
            for (const w of widgets) {
                if (typeof w === 'string' && (w.endsWith('.safetensors') || w.endsWith('.bin') || w.endsWith('.pt') || w.endsWith('.sft'))) {
                    if (!discoveredModels.textEncoders.some(t => t.name === w)) {
                        discoveredModels.textEncoders.push({ name: w, category: 'text_encoder' });
                    }
                }
            }
        }
    }

    return { params, positivePrompts, negativePrompts, allPrompts, loraDetailsMap, discoveredModels };
}

export async function showImageMaterialDetail(owner, sourceImage, imageUrl) {
    const overlay = document.createElement('div');
    overlay.className = 'anomalous-material-detail-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'anomalous-material-detail-dialog';

    const close = text(dialog, 'button', '×', 'anomalous-material-detail-close');
    close.type = 'button';
    close.onclick = () => overlay.remove();

    // 1. Left Media Stage
    const media = document.createElement('div');
    media.className = 'anomalous-material-detail-media';
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = t('materialImageDetail');
    media.appendChild(image);

    const mediaBar = document.createElement('div');
    mediaBar.className = 'anomalous-material-media-bar';
    const mediaResText = text(mediaBar, 'span', sourceImage?.filename || 'PNG Image');
    const fullViewBtn = text(mediaBar, 'button', t('materialViewOriginal') || '🔍 查看大图', 'anomalous-material-mini-btn');
    fullViewBtn.type = 'button';
    fullViewBtn.onclick = () => owner?.showGalleryViewer?.(imageUrl);
    media.appendChild(mediaBar);

    // 2. Right Inspector Panel with 3-Tier Layout
    const side = document.createElement('div');
    side.className = 'anomalous-material-detail-side';

    // Tier 1: Fixed Header
    const sideHeader = document.createElement('div');
    sideHeader.className = 'anomalous-material-side-header';
    text(sideHeader, 'h2', t('materialImageDetail'));
    text(sideHeader, 'p', t('materialSnapshotExplanation'));
    side.appendChild(sideHeader);

    // Tier 2: Scrollable Body (Independent scroll container)
    const sideBody = document.createElement('div');
    sideBody.className = 'anomalous-material-side-body';
    const loading = text(sideBody, 'p', t('materialInspecting'), 'anomalous-material-muted');
    side.appendChild(sideBody);

    // Tier 3: Sticky Footer
    const sideFooter = document.createElement('div');
    sideFooter.className = 'anomalous-material-side-footer';

    const label = text(sideFooter, 'label', t('materialName'));
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 120;
    nameInput.placeholder = t('materialName');
    label.appendChild(nameInput);

    text(sideFooter, 'small', t('materialSaveHint'), 'anomalous-material-muted');
    const saveBtn = text(sideFooter, 'button', `💾 ${t('materialSaveSnapshot')}`, 'anomalous-btn-primary');
    saveBtn.type = 'button';
    saveBtn.disabled = true;
    side.appendChild(sideFooter);

    dialog.append(media, side);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });

    // Load data: parallel fetch from backend inspection AND direct PNG client-side parse
    try {
        const [inspectPayload, clientWorkflow] = await Promise.all([
            fetch('/anomalous/inspect_image_material', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_image: sourceImage }),
            }).then(r => jsonResponse(r, 'material inspection failed')),
            parsePngMetadataFromUrl(imageUrl).catch(() => null),
        ]);

        loading.remove();
        saveBtn.disabled = false;

        const clientDetails = extractWorkflowDetails(clientWorkflow);

        // Merge generation parameters
        const params = {
            ...(clientDetails.params || {}),
            ...(inspectPayload.params || {}),
        };

        if (params.resolution) {
            mediaResText.textContent = `${params.resolution} · ${sourceImage?.filename || 'PNG'}`;
        }

        // Section A: Essential Metric Grid
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
            if (params.denoise != null) addMetric(t('materialDenoise') || '降噪', params.denoise);
            addMetric(t('recipeCardSpecsResolution') || '尺寸', params.resolution);

            if (metricGrid.childElementCount) sideBody.appendChild(metricGrid);
        }

        // Section B: Prompts (Full, un-truncated prompts)
        const renderPromptCard = (titleText, promptStr) => {
            if (!promptStr || !promptStr.trim()) return;
            const promptCard = document.createElement('div');
            promptCard.className = 'anomalous-material-prompt-card';

            const bar = document.createElement('div');
            bar.className = 'anomalous-material-prompt-bar';
            text(bar, 'span', titleText, 'anomalous-material-prompt-bar-label');

            const btns = document.createElement('div');
            btns.className = 'anomalous-material-prompt-bar-btns';

            if (promptStr.length > 90 || promptStr.includes('\n')) {
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
                navigator.clipboard.writeText(promptStr).then(() => {
                    copyBtn.textContent = t('materialCopied') || '✅ 已复制';
                    setTimeout(() => { copyBtn.textContent = t('materialCopyPrompt') || '📋 复制'; }, 1500);
                });
            };

            bar.appendChild(btns);
            promptCard.appendChild(bar);

            const promptContent = text(promptCard, 'div', promptStr, 'anomalous-material-prompt-content');
            sideBody.appendChild(promptCard);
        };

        const posText = clientDetails.positivePrompts.join('\n\n');
        const negText = clientDetails.negativePrompts.join('\n\n');

        if (posText || negText) {
            if (posText) renderPromptCard(t('materialPositivePrompt') || '正向提示词', posText);
            if (negText) renderPromptCard(t('materialNegativePrompt') || '负向提示词', negText);
        } else {
            const fallbackText = (Array.isArray(inspectPayload.prompts) && inspectPayload.prompts.length)
                ? inspectPayload.prompts.join('\n\n')
                : (inspectPayload.prompt_excerpt || '');
            if (fallbackText) renderPromptCard(t('materialPromptText') || '提示词', fallbackText);
        }

        // Section C: Categorized Referenced Models (Grouped, Detailed, Never mixed)
        const allModelRefs = Array.isArray(inspectPayload.model_references) ? [...inspectPayload.model_references] : [];

        const addIfNotExists = (item) => {
            const clean = (val) => String(val || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
            const target = clean(item.saved_value || item.name);
            if (!target) return;
            if (!allModelRefs.some(m => clean(m.saved_value || m.name) === target)) {
                allModelRefs.push(item);
            }
        };

        if (clientDetails.discoveredModels) {
            for (const c of clientDetails.discoveredModels.checkpoints) addIfNotExists({ saved_value: c.name, category: c.category });
            for (const l of clientDetails.discoveredModels.loras) addIfNotExists({ saved_value: l.name, category: 'lora' });
            for (const tModel of clientDetails.discoveredModels.textEncoders) addIfNotExists({ saved_value: tModel.name, category: 'text_encoder' });
            for (const v of clientDetails.discoveredModels.vaes) addIfNotExists({ saved_value: v.name, category: 'vae' });
        }

        const groups = {
            base: [],
            lora: [],
            clip: [],
            vae: [],
            other: [],
        };

        for (const ref of allModelRefs) {
            const cat = String(ref.category || '').toLowerCase();
            const val = String(ref.saved_value || ref.name || '').toLowerCase();
            if (cat === 'checkpoint' || cat === 'unet' || val.includes('checkpoint') || val.includes('anima') || val.includes('unet')) {
                groups.base.push(ref);
            } else if (cat === 'lora' || val.includes('lora')) {
                groups.lora.push(ref);
            } else if (cat === 'text_encoder' || cat === 'clip' || val.includes('clip') || val.includes('qwen_3_06b') || val.includes('t5')) {
                groups.clip.push(ref);
            } else if (cat === 'vae' || val.includes('vae')) {
                groups.vae.push(ref);
            } else {
                groups.other.push(ref);
            }
        }

        const totalModelCount = allModelRefs.length;
        if (totalModelCount > 0) {
            const modelDetails = document.createElement('details');
            modelDetails.className = 'anomalous-material-accordion';
            modelDetails.open = true; // 默认展开，让用户一眼看清分类与详细参数

            const modelSummary = document.createElement('summary');
            modelSummary.textContent = `📦 ${t('materialReferencedModels', { count: totalModelCount })} ▾`;
            modelDetails.appendChild(modelSummary);

            const modelContent = document.createElement('div');
            modelContent.className = 'anomalous-material-accordion-content';

            const renderModelGroup = (titleText, items, tagClass, defaultTag) => {
                if (!items.length) return;
                const groupDiv = document.createElement('div');
                groupDiv.className = 'anomalous-material-model-group';

                text(groupDiv, 'div', titleText, 'anomalous-material-model-group-title');

                for (const item of items) {
                    const row = document.createElement('div');
                    row.className = 'anomalous-material-model-card-item';

                    const info = document.createElement('div');
                    info.className = 'anomalous-material-model-info';

                    const rawVal = String(item.saved_value || item.name || 'Unknown');
                    const fileName = rawVal.replace(/\\/g, '/').split('/').pop();
                    const nameEl = text(info, 'span', fileName, 'anomalous-material-model-filename');
                    nameEl.title = rawVal;

                    // Show LoRA weights (Strength & CLIP) if available
                    const loraWeights = clientDetails.loraDetailsMap?.get(rawVal) || clientDetails.loraDetailsMap?.get(fileName);
                    if (loraWeights) {
                        const paramText = `${t('materialLoraStrength') || '权重'}: ${loraWeights.strengthModel} · CLIP: ${loraWeights.strengthClip}`;
                        text(info, 'span', paramText, 'anomalous-material-model-params');
                    }

                    row.appendChild(info);
                    text(row, 'span', item.category || defaultTag, `anomalous-material-model-tag-badge ${tagClass}`);
                    groupDiv.appendChild(row);
                }
                modelContent.appendChild(groupDiv);
            };

            renderModelGroup(t('materialModelBase') || '🎯 主模型 / UNet', groups.base, 'anomalous-tag-base', 'unet');
            renderModelGroup(t('materialModelLora') || '🎨 LoRA 微调层', groups.lora, 'anomalous-tag-lora', 'lora');
            renderModelGroup(t('materialModelClip') || '👁️ 文本编码器 (CLIP)', groups.clip, 'anomalous-tag-clip', 'clip');
            renderModelGroup(t('materialModelVae') || '🖼️ VAE 编码器', groups.vae, 'anomalous-tag-vae', 'vae');
            renderModelGroup(t('materialModelOther') || '⚡ 其它模型组件', groups.other, 'anomalous-tag-other', 'model');

            modelDetails.appendChild(modelContent);
            sideBody.appendChild(modelDetails);
        }

        // Section D: Included Nodes (Collapsible)
        const blocks = Array.isArray(inspectPayload.node_blocks) ? inspectPayload.node_blocks : [];
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
            sideBody.appendChild(nodeDetails);
        }

        // Tier 3 Setup: Name Input & Save
        nameInput.value = inspectPayload.suggested_name || '';
        saveBtn.onclick = async () => {
            const val = nameInput.value.trim();
            if (!val) { nameInput.focus(); return; }
            saveBtn.disabled = true;
            try {
                const saveResponse = await fetch('/anomalous/save_image_material', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source_image: sourceImage, name: val }),
                });
                const savePayload = await jsonResponse(saveResponse, 'material save failed');
                if (savePayload.status !== 'success') throw new Error(savePayload.message || 'material save failed');
                owner?.refreshMaterials?.();
                overlay.remove();
                await anomalousAlert(t('materialSaveSuccess'));
            } catch (error) {
                console.error('Could not save image material:', error);
                await anomalousAlert(t('materialSaveError'));
                saveBtn.disabled = false;
            }
        };

        nameInput.focus();
        nameInput.select();
    } catch (error) {
        console.error('Could not inspect image material:', error);
        loading.textContent = t('materialInspectError');
    }
}
