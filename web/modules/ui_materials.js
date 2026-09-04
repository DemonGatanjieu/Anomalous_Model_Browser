/** Curated material snapshots: generated image + exact workflow + node blocks. */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { showImageWorkbench } from './ui_gallery_detail.js';

const t = (key, params) => translate(key, params);

export function text(parent, tag, value, className = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value == null ? '' : String(value);
    parent.appendChild(element);
    return element;
}

export function sectionLabel(parent, value) {
    return text(parent, 'div', value, 'anomalous-material-section-label');
}

export function fileBaseName(value) {
    return String(value || '').replace(/\\/g, '/').split('/').pop();
}

function previewIsVideo(url) {
    return /\.(?:mp4|webm)(?:$|\?|&|#)/i.test(url || '');
}

export function modelCustomNotes(model) {
    return String(model?.metadata?.custom_notes || '').trim();
}

function bindHoverPreviewVideo(video) {
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.onpointerenter = () => video.play().catch(() => {});
    video.onpointerleave = () => {
        video.pause();
        video.currentTime = 0;
    };
}

export function appendLocalPreview(parent, url, className) {
    if (!url) return null;
    const wrap = document.createElement('div');
    wrap.className = className;
    if (previewIsVideo(url)) {
        const video = document.createElement('video');
        video.src = url;
        bindHoverPreviewVideo(video);
        wrap.appendChild(video);
    } else {
        const image = document.createElement('img');
        image.src = url;
        image.alt = '';
        image.loading = 'lazy';
        wrap.appendChild(image);
    }
    parent.appendChild(wrap);
    return wrap;
}

export async function resolveLocalModels(paths) {
    const unique = [...new Set((paths || []).filter(Boolean))];
    if (!unique.length) return {};
    const response = await fetch('/anomalous/resolve_paths_to_previews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: unique, exact_only: false }),
    });
    const payload = await jsonResponse(response, 'preview resolve failed');
    return payload.models || {};
}

export function lookupLocalModel(localModels, path) {
    if (!path || !localModels) return null;
    return localModels[path] || localModels[fileBaseName(path)] || null;
}

function materialAssetUrl(filename, asset) {
    if (!filename || !asset) return '';
    return `/anomalous/material_asset?filename=${encodeURIComponent(filename)}&asset=${encodeURIComponent(asset)}`;
}

export async function jsonResponse(response, fallbackMessage) {
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

async function fetchMaterial(filename, options = {}) {
    const response = await fetch(`/anomalous/material_full?filename=${encodeURIComponent(filename)}`, {
        cache: 'no-store',
        signal: options.signal,
    });
    const payload = await jsonResponse(response, 'material load failed');
    if (payload.status !== 'success') throw new Error(payload.message || 'material load failed');
    return payload;
}

function renderExpandedMaterial(content, payload) {
    const references = Array.isArray(payload.data?.model_references) ? payload.data.model_references : [];
    if (references.length) {
        sectionLabel(content, t('materialModelSummary', { count: references.length }));
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

    const blocks = Array.isArray(payload.node_blocks) ? payload.node_blocks : [];
    sectionLabel(content, t('materialDetailedNodeParameters', { count: blocks.length }));
    if (blocks.length) {
        renderDetailedNodeCards(content, blocks);
    } else {
        text(content, 'p', t('materialNoNodeParameters'), 'anomalous-material-muted');
    }
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
    if (material.selection?.scope === 'nodes') {
        text(body, 'span', t('materialSelectedNodeMaterial'), 'anomalous-material-scope-badge');
    }
    text(body, 'p', t('materialNodeSummary', { count: material.node_count || 0 }), 'anomalous-material-muted');
    if (Array.isArray(material.node_types) && material.node_types.length) {
        text(body, 'small', material.node_types.slice(0, 5).join(' · '), 'anomalous-material-types');
    }
    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'anomalous-material-card-actions';
    if ((material.capabilities || []).includes('open_workflow')) {
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
    } else {
        text(actions, 'span', t('materialUseFromNodeAssistant'), 'anomalous-material-card-use-hint');
    }
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

    const details = document.createElement('details');
    details.className = 'anomalous-material-card-details';
    const summary = document.createElement('summary');
    summary.textContent = `⚙️ ${t('materialViewParameters')}`;
    details.appendChild(summary);
    const detailContent = document.createElement('div');
    detailContent.className = 'anomalous-material-card-detail-content';
    details.appendChild(detailContent);

    let requestController = null;
    details.addEventListener('toggle', async () => {
        card.classList.toggle('is-expanded', details.open);
        if (!details.open) {
            requestController?.abort();
            requestController = null;
            detailContent.replaceChildren();
            return;
        }

        const controller = new AbortController();
        requestController = controller;
        detailContent.replaceChildren();
        text(detailContent, 'p', t('loading'), 'anomalous-material-muted');
        try {
            const payload = await fetchMaterial(material.filename, { signal: controller.signal });
            if (!details.open) return;
            detailContent.replaceChildren();
            renderExpandedMaterial(detailContent, payload);
        } catch (error) {
            if (error?.name === 'AbortError') return;
            console.error('Could not expand material parameters:', error);
            detailContent.replaceChildren();
            text(detailContent, 'p', t('materialDetailLoadError'), 'anomalous-material-muted');
        } finally {
            if (requestController === controller) requestController = null;
        }
    });
    card.appendChild(details);
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
export async function parsePngMetadataFromUrl(url, options = {}) {
    if (!url) return null;
    try {
        const response = await fetch(url, { cache: 'force-cache', signal: options.signal });
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
        if (e?.name === 'AbortError') return null;
        console.warn('Client-side PNG metadata read skipped:', e);
        return null;
    }
}

/**
 * Extract generation parameters, full prompts, and categorized model references with details (e.g. LoRA strengths)
 * directly from the workflow.
 */
export function extractWorkflowDetails(workflow) {
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
            if (widgets[offset] != null && params.seed == null) params.seed = widgets[offset];
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

export function detailedBlocksFromWorkflow(workflow, serverBlocks = []) {
    const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
    if (!nodes.length) return Array.isArray(serverBlocks) ? serverBlocks : [];
    const serverById = new Map((serverBlocks || []).map(block => [String(block?.node_id), block]));
    const occurrences = {};
    return nodes.filter(node => node && typeof node === 'object' && node.type).map(node => {
        const nodeType = String(node.type);
        occurrences[nodeType] = (occurrences[nodeType] || 0) + 1;
        const server = serverById.get(String(node.id)) || {};
        const lower = nodeType.toLowerCase();
        const volatile = lower === 'ksampler' ? [0] : lower === 'ksampleradvanced' ? [1] : [];
        return {
            node_id: node.id,
            type: nodeType,
            title: node.title || server.title || nodeType,
            occurrence: occurrences[nodeType],
            widget_count: Array.isArray(node.widgets_values) ? node.widgets_values.length : 0,
            widgets_values: Array.isArray(node.widgets_values) ? node.widgets_values : [],
            volatile_widget_indexes: Array.isArray(server.volatile_widget_indexes)
                ? server.volatile_widget_indexes
                : volatile,
            properties: node.properties && typeof node.properties === 'object' ? node.properties : {},
            mode: node.mode,
        };
    });
}

function materialWidgetLabels(nodeType) {
    const type = String(nodeType || '').toLowerCase();
    if (type === 'ksampler') return [
        t('materialParamSeed'), t('materialParamSeedControl'), t('recipeCardSpecsSteps'),
        'CFG', t('recipeCardSpecsSampler'), t('materialScheduler'), t('materialDenoise'),
    ];
    if (type === 'ksampleradvanced') return [
        t('materialParamAddNoise'), t('materialParamSeed'), t('materialParamSeedControl'),
        t('recipeCardSpecsSteps'), 'CFG', t('recipeCardSpecsSampler'), t('materialScheduler'),
        t('materialParamStartStep'), t('materialParamEndStep'), t('materialParamLeftoverNoise'),
    ];
    if (type === 'emptylatentimage') return [t('materialParamWidth'), t('materialParamHeight'), t('materialParamBatchSize')];
    if (/checkpointloader(simple)?$/.test(type)) return [t('materialParamCheckpoint')];
    if (type.endsWith('unetloader')) return [t('materialParamUnet'), t('materialParamWeightDtype')];
    if (type.includes('loraloader')) return [t('materialParamLora'), t('materialParamModelStrength'), t('materialParamClipStrength')];
    if (type.endsWith('vaeloader')) return [t('materialParamVae')];
    if (type.includes('cliptextencode')) return [t('materialPromptText')];
    if (type.endsWith('clipvisionloader')) return [t('materialParamClipVision')];
    if (type.endsWith('controlnetloader')) return [t('materialParamControlNet')];
    if (type.endsWith('dualcliploader')) return [t('materialParamClipOne'), t('materialParamClipTwo'), t('materialParamClipType')];
    if (type.endsWith('triplecliploader')) return [t('materialParamClipOne'), t('materialParamClipTwo'), t('materialParamClipThree')];
    if (type.endsWith('cliploader')) return [t('materialParamClipOne'), t('materialParamClipType')];
    if (type === 'saveimage') return [t('materialParamFilenamePrefix')];
    return [];
}

const comfyWidgetLabelCache = new Map();

function comfyNodeTitle(nodeType) {
    const ctor = globalThis.LiteGraph?.registered_node_types?.[nodeType];
    return (ctor && ctor.title) || nodeType;
}

function comfyWidgetLabels(nodeType) {
    if (comfyWidgetLabelCache.has(nodeType)) return comfyWidgetLabelCache.get(nodeType);
    let labels = [];
    try {
        const node = globalThis.LiteGraph?.createNode?.(nodeType);
        if (node?.widgets?.length) labels = node.widgets.map(widget => widget.label || widget.name || '');
    } catch (error) { /* some node types cannot be instantiated off-canvas */ }
    if (!labels.length) labels = materialWidgetLabels(nodeType);
    comfyWidgetLabelCache.set(nodeType, labels);
    return labels;
}

export function materialNodeHeading(block) {
    const type = block.type || '';
    const saved = block.title || '';
    if (saved && saved !== type) return saved;
    return comfyNodeTitle(type) || saved || type;
}

function formatMaterialParameterValue(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try { return JSON.stringify(value, null, 2); } catch (error) { return String(value); }
}

export function renderDetailedNodeCards(parent, blocks, options = {}) {
    const list = document.createElement('div');
    list.className = 'anomalous-material-node-list';

    for (const block of blocks) {
        const node = document.createElement('details');
        node.className = 'anomalous-material-node-detail';
        const summary = document.createElement('summary');
        if (options.selectable) {
            const select = document.createElement('input');
            select.type = 'checkbox';
            select.className = 'anomalous-material-node-select';
            select.dataset.nodeId = String(block.node_id);
            select.checked = options.selectedIds?.has(String(block.node_id)) || false;
            select.title = t('materialSelectNodeForSaving');
            select.setAttribute('aria-label', t('materialSelectNodeForSaving'));
            select.addEventListener('click', event => event.stopPropagation());
            select.addEventListener('change', () => {
                options.onSelectionChange?.(block, select.checked);
                node.classList.toggle('is-selected', select.checked);
            });
            node.classList.toggle('is-selected', select.checked);
            summary.appendChild(select);
        }
        const heading = document.createElement('span');
        heading.className = 'anomalous-material-node-heading';
        text(heading, 'strong', materialNodeHeading(block));
        text(heading, 'small', block.type || t('recipeUnknownNode'));
        const widgetValues = Array.isArray(block.widgets_values) ? block.widgets_values : [];
        text(summary, 'span', t('materialParameterCount', { count: widgetValues.length }), 'anomalous-material-node-count');
        if (typeof options.onSaveBlock === 'function') {
            const save = text(summary, 'button', t('materialSaveNode'), 'anomalous-material-node-save');
            save.type = 'button';
            save.title = t('materialSaveNodeHint');
            save.addEventListener('click', event => event.stopPropagation());
            save.addEventListener('click', () => options.onSaveBlock(block, save));
        }
        summary.prepend(heading);
        node.appendChild(summary);

        let rendered = false;
        node.addEventListener('toggle', () => {
            if (!node.open || rendered) return;
            rendered = true;
            const content = document.createElement('div');
            content.className = 'anomalous-material-node-parameter-content';

            const meta = document.createElement('div');
            meta.className = 'anomalous-material-node-meta';
            text(meta, 'span', `${t('materialNodeId')}: ${block.node_id ?? '—'}`);
            if (block.mode != null) text(meta, 'span', `${t('materialNodeMode')}: ${block.mode}`);
            const copy = text(meta, 'button', t('materialCopyNodeParameters'), 'anomalous-material-mini-btn');
            copy.type = 'button';
            copy.onclick = () => {
                const snapshot = {
                    node_id: block.node_id,
                    type: block.type,
                    title: block.title,
                    widgets_values: widgetValues,
                    properties: block.properties || {},
                    mode: block.mode,
                };
                navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2)).then(() => {
                    copy.textContent = t('materialCopied');
                    setTimeout(() => { copy.textContent = t('materialCopyNodeParameters'); }, 1200);
                });
            };
            content.appendChild(meta);

            const labels = comfyWidgetLabels(block.type);
            const volatileIndexes = new Set(Array.isArray(block.volatile_widget_indexes) ? block.volatile_widget_indexes : []);
            if (!widgetValues.length) {
                text(content, 'p', t('materialNoWidgetParameters'), 'anomalous-material-muted');
            }
            widgetValues.forEach((value, index) => {
                const row = document.createElement('div');
                row.className = 'anomalous-material-parameter-row';
                const labelWrap = document.createElement('div');
                labelWrap.className = 'anomalous-material-parameter-label';
                text(labelWrap, 'span', labels[index] || t('materialWidgetIndex', { index: index + 1 }));
                text(labelWrap, 'code', `#${index}`);
                if (volatileIndexes.has(index)) {
                    text(labelWrap, 'span', t('materialVolatileParameter'), 'anomalous-material-volatile-badge');
                }
                const valueText = text(row, 'pre', formatMaterialParameterValue(value), 'anomalous-material-parameter-value');
                valueText.title = t('materialParameterFullValue');
                row.prepend(labelWrap);
                content.appendChild(row);
            });

            const properties = block.properties && typeof block.properties === 'object' ? block.properties : {};
            if (Object.keys(properties).length) {
                const row = document.createElement('div');
                row.className = 'anomalous-material-parameter-row';
                const labelWrap = document.createElement('div');
                labelWrap.className = 'anomalous-material-parameter-label';
                text(labelWrap, 'span', t('materialNodeProperties'));
                const propertyValue = document.createElement('pre');
                propertyValue.className = 'anomalous-material-parameter-value';
                propertyValue.textContent = formatMaterialParameterValue(properties);
                row.append(labelWrap, propertyValue);
                content.appendChild(row);
            }
            node.appendChild(content);
        });
        list.appendChild(node);
    }
    parent.appendChild(list);
}

export async function showImageMaterialDetail(owner, sourceImage, imageUrl, options = {}) {
    return showImageWorkbench(owner, sourceImage, imageUrl, options);
}

