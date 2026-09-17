import { text, jsonResponse } from './ui_dom.js';
/** Shared image metadata and node-parameter inspection for the library and workbench. */
import { translate } from './locales.js';
const t = (key, params) => translate(key, params);

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

const NODE_TITLE_SUFFIX = /\s*(\((?:negative|positive|neg|pos)\)|（(?:负向|正向|反向)）|#\d+)\s*$/i;

function compactNodeToken(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function comfyNodeDefaultTitles(nodeType) {
    const ctor = globalThis.LiteGraph?.registered_node_types?.[nodeType];
    const data = ctor?.nodeData;
    return [nodeType, ctor?.title, ctor?.comfyClass, data?.name, data?.display_name].filter(Boolean);
}

export function materialNodeHeading(block) {
    const type = String(block?.type || '');
    const saved = String(block?.title || '').trim();
    const localized = comfyNodeTitle(type) || type;
    const suffixMatch = saved.match(NODE_TITLE_SUFFIX);
    const suffix = suffixMatch ? ` ${suffixMatch[1]}` : '';
    if (!saved || saved === type) return localized + suffix;

    const core = saved.replace(NODE_TITLE_SUFFIX, '').trim();
    const compactCore = compactNodeToken(core);
    const isDefault = [type, localized, ...comfyNodeDefaultTitles(type)].some(name => {
        const compactName = compactNodeToken(name);
        return core === name || compactCore === compactName || (compactName && compactCore.startsWith(compactName));
    });
    return isDefault ? localized + suffix : saved;
}

function formatMaterialParameterValue(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try { return JSON.stringify(value, null, 2); } catch (error) { return String(value); }
}

function isPromptBlock(block) {
    const type = String(block?.type || '').toLowerCase();
    return (type.includes('cliptextencode') || type.includes('prompt')) &&
        Array.isArray(block.widgets_values) &&
        block.widgets_values.length > 0 &&
        typeof block.widgets_values[0] === 'string';
}

function promptRoleLabel(role) {
    return t({
        positive: 'recipePromptRolePositive',
        negative: 'recipePromptRoleNegative',
        both: 'recipePromptRoleBoth',
        ignored: 'recipePromptRoleIgnored',
        unknown: 'recipePromptRoleUnknown',
    }[role] || 'recipePromptRoleUnknown');
}

export function applyPromptRolesToBlocks(blocks, promptRoles) {
    if (!Array.isArray(blocks) || !promptRoles || typeof promptRoles !== 'object') return blocks;
    for (const block of blocks) {
        const info = promptRoles[String(block?.node_id)];
        if (!info || typeof info !== 'object') continue;
        block.promptRole = info.role;
        block.promptRoleSource = info.source;
        block.promptRoleManual = info.source === 'manual';
        block.promptRoleAutomatic = info.automatic_role || (info.source === 'manual' ? 'unknown' : info.role);
    }
    return blocks;
}

export function mergePromptRoleOverrides(promptRoles, overrides) {
    const roles = { ...(promptRoles || {}) };
    if (!overrides || typeof overrides !== 'object') return roles;
    for (const [nodeId, entry] of Object.entries(overrides)) {
        if (entry?.role) {
            const automatic = roles[String(nodeId)];
            roles[String(nodeId)] = {
                role: entry.role,
                source: 'manual',
                automatic_role: automatic?.automatic_role || automatic?.role || 'unknown',
            };
        }
    }
    return roles;
}

export function promptGroupsFromBlocks(blocks) {
    const positive = [];
    const negative = [];
    for (const block of Array.isArray(blocks) ? blocks : []) {
        const value = (block.widgets_values || []).find(item => typeof item === 'string' && item.trim());
        if (!value) continue;
        const textVal = value.trim();
        if ((block.promptRole === 'positive' || block.promptRole === 'both') && !positive.includes(textVal)) positive.push(textVal);
        if ((block.promptRole === 'negative' || block.promptRole === 'both') && !negative.includes(textVal)) negative.push(textVal);
    }
    return { positive, negative };
}

export function renderMaterialPromptGroups(parent, groups, options = {}) {
    const positive = Array.isArray(groups?.positive) ? groups.positive.filter(Boolean) : [];
    const negative = Array.isArray(groups?.negative) ? groups.negative.filter(Boolean) : [];
    if (!positive.length && !negative.length) return false;

    const renderCard = (titleText, promptStr, tone) => {
        const card = document.createElement('div');
        card.className = tone ? `anomalous-material-prompt-card is-${tone}` : 'anomalous-material-prompt-card';
        const bar = document.createElement('div');
        bar.className = 'anomalous-material-prompt-bar';
        text(bar, 'span', titleText, 'anomalous-material-prompt-bar-label');
        const copyBtn = text(bar, 'button', t('materialCopyPrompt'), 'anomalous-material-mini-btn');
        copyBtn.type = 'button';
        bindCopyButton(copyBtn, () => promptStr, 'materialCopied');
        card.appendChild(bar);
        text(card, 'div', promptStr, 'anomalous-material-prompt-content is-expanded');
        parent.appendChild(card);
    };

    if (positive.length) renderCard(t('materialPositivePrompt'), positive.join('\n\n'), 'positive');
    if (negative.length) renderCard(t('materialNegativePrompt'), negative.join('\n\n'), 'negative');
    if (options.manual) text(parent, 'p', t('materialPromptRoleFromRecipe'), 'anomalous-material-muted');
    return true;
}

function bindCopyButton(button, value, successKey) {
    const label = button.textContent;
    button.onclick = async event => {
        event.stopPropagation();
        try {
            await navigator.clipboard.writeText(value());
            button.textContent = t(successKey);
        } catch (error) {
            button.textContent = t('materialCopyError');
        }
        setTimeout(() => { if (button.isConnected) button.textContent = label; }, 1200);
    };
}

function renderPromptBlock(content, block, widgetValues) {
    const promptWrap = document.createElement('div');
    promptWrap.className = 'anomalous-material-prompt-station';

    const promptText = String(widgetValues[0] ?? '');
    const charCount = promptText.length;

    const bar = document.createElement('div');
    bar.className = 'anomalous-material-prompt-bar';

    const titleSec = document.createElement('div');
    titleSec.className = 'anomalous-material-prompt-title-sec';
    text(titleSec, 'span', `💬 ${t('materialPromptNode') || '提示词'}`, 'anomalous-material-prompt-title');
    text(titleSec, 'span', t('materialChars', { count: charCount }), 'anomalous-material-prompt-count');
    bar.appendChild(titleSec);

    const copyPromptBtn = text(bar, 'button', t('materialCopyPromptText'), 'anomalous-material-copy-prompt-btn');
    copyPromptBtn.type = 'button';
    bindCopyButton(copyPromptBtn, () => promptText, 'materialPromptCopied');
    promptWrap.appendChild(bar);

    const body = document.createElement('div');
    body.className = 'anomalous-material-prompt-body';
    body.textContent = promptText || t('materialNoWidgetParameters');
    promptWrap.appendChild(body);

    content.appendChild(promptWrap);
}

function renderNodeParameterRows(content, block, widgetValues, offset = 0) {
    const labels = comfyWidgetLabels(block.type);
    const volatileIndexes = new Set(Array.isArray(block.volatile_widget_indexes) ? block.volatile_widget_indexes : []);
    if (!widgetValues.length) {
        text(content, 'p', t('materialNoWidgetParameters'), 'anomalous-material-muted');
        return;
    }
    widgetValues.forEach((value, localIndex) => {
        const index = localIndex + offset;
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
}

function renderNodeProperties(content, properties) {
    const props = properties && typeof properties === 'object' ? properties : {};
    if (!Object.keys(props).length) return;
    const row = document.createElement('div');
    row.className = 'anomalous-material-parameter-row';
    const labelWrap = document.createElement('div');
    labelWrap.className = 'anomalous-material-parameter-label';
    text(labelWrap, 'span', t('materialNodeProperties'));
    const propertyValue = document.createElement('pre');
    propertyValue.className = 'anomalous-material-parameter-value';
    propertyValue.textContent = formatMaterialParameterValue(props);
    row.append(labelWrap, propertyValue);
    content.appendChild(row);
}

function renderNodeCardContent(node, block, widgetValues) {
    const content = document.createElement('div');
    content.className = 'anomalous-material-node-parameter-content';

    const meta = document.createElement('div');
    meta.className = 'anomalous-material-node-meta';
    text(meta, 'span', `${t('materialNodeId')}: ${block.node_id ?? '—'}`);
    if (block.mode != null) text(meta, 'span', `${t('materialNodeMode')}: ${block.mode}`);

    const copy = text(meta, 'button', t('materialCopyNodeParameters'), 'anomalous-material-mini-btn');
    copy.type = 'button';
    bindCopyButton(copy, () => JSON.stringify({
        node_id: block.node_id, type: block.type, title: block.title,
        widgets_values: widgetValues, properties: block.properties || {}, mode: block.mode,
    }, null, 2), 'materialCopied');
    const technical = document.createElement('details');
    technical.className = 'anomalous-notebook-fold';
    text(technical, 'summary', t('recipeAdvancedInfo'));
    technical.appendChild(meta);

    if (isPromptBlock(block)) {
        renderPromptBlock(content, block, widgetValues);
        if (widgetValues.length > 1) {
            renderNodeParameterRows(content, block, widgetValues.slice(1), 1);
        }
    } else {
        renderNodeParameterRows(content, block, widgetValues);
    }

    renderNodeProperties(technical, block.properties);
    content.appendChild(technical);
    node.appendChild(content);
}

function renderSingleNodeCard(block, options = {}) {
    const node = document.createElement('details');
    node.className = 'anomalous-material-node-detail';
    const widgetValues = Array.isArray(block.widgets_values) ? block.widgets_values : [];

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
    const renderRoleBadge = () => {
        heading.querySelector('.anomalous-recipe-prompt-role-badge')?.remove();
        if (!block.promptRole) return;
        const badge = text(heading, 'span', promptRoleLabel(block.promptRole), `anomalous-recipe-prompt-role-badge is-${block.promptRole}`);
        badge.title = block.promptRoleManual ? t('recipePromptRoleManual') : t('recipePromptRoleAutomatic');
    };
    renderRoleBadge();
    summary.appendChild(heading);

    text(summary, 'span', t('materialParameterCount', { count: widgetValues.length }), 'anomalous-material-node-count');

    if (isPromptBlock(block) && typeof options.onPromptRoleChange === 'function') {
        const roleSelect = document.createElement('select');
        roleSelect.className = 'anomalous-recipe-prompt-role-select anomalous-material-prompt-role-select';
        roleSelect.setAttribute('aria-label', t('recipePromptRoleChoose'));
        const automaticRole = block.promptRoleAutomatic || (block.promptRoleManual ? 'unknown' : block.promptRole) || 'unknown';
        const choices = [
            ['auto', `${t('recipePromptRoleAutomatic')} · ${promptRoleLabel(automaticRole)}`],
            ['positive', t('recipePromptRolePositive')],
            ['negative', t('recipePromptRoleNegative')],
            ['both', t('recipePromptRoleBoth')],
            ['unknown', t('recipePromptRoleUnknown')],
            ['ignored', t('recipePromptRoleIgnored')],
        ];
        for (const [value, label] of choices) {
            const option = text(roleSelect, 'option', label);
            option.value = value;
        }
        roleSelect.value = block.promptRoleManual ? block.promptRole : 'auto';
        roleSelect.addEventListener('click', event => event.stopPropagation());
        roleSelect.addEventListener('change', async event => {
            event.stopPropagation();
            const previous = block.promptRoleManual ? block.promptRole : 'auto';
            roleSelect.disabled = true;
            try {
                await options.onPromptRoleChange(block, roleSelect.value, roleSelect);
                renderRoleBadge();
            } catch (error) {
                roleSelect.value = previous;
                console.error('Could not update prompt role:', error);
            } finally {
                if (roleSelect.isConnected) roleSelect.disabled = false;
            }
        });
        roleSelect.hidden = true;
        const adjust = text(summary, 'button', t('promptAdjustRole'), 'anomalous-btn-ghost');
        adjust.type = 'button';
        adjust.setAttribute('aria-expanded', 'false');
        adjust.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            roleSelect.hidden = !roleSelect.hidden;
            adjust.setAttribute('aria-expanded', String(!roleSelect.hidden));
            if (!roleSelect.hidden) roleSelect.focus();
        };
        summary.appendChild(roleSelect);
    }

    if (typeof options.onSaveBlock === 'function') {
        const save = text(summary, 'button', t(isPromptBlock(block) ? 'materialSavePromptAction' : 'materialSaveNode'), 'anomalous-material-node-save');
        save.type = 'button';
        save.title = t('materialSaveNodeHint');
        save.addEventListener('click', event => event.stopPropagation());
        save.addEventListener('click', () => options.onSaveBlock(block, save));
    }
    node.appendChild(summary);

    const shouldOpen = !options.selectable && isPromptBlock(block);
    let rendered = false;

    const renderContentIfNeeded = () => {
        if (rendered) return;
        rendered = true;
        renderNodeCardContent(node, block, widgetValues);
    };

    if (shouldOpen) {
        node.open = true;
        renderContentIfNeeded();
    }

    node.addEventListener('toggle', () => {
        if (node.open) renderContentIfNeeded();
    });

    return node;
}

export function renderDetailedNodeCards(parent, blocks, options = {}) {
    const list = document.createElement('div');
    list.className = 'anomalous-material-node-list';
    blocks.forEach(block => {
        list.appendChild(renderSingleNodeCard(block, options));
    });
    parent.appendChild(list);
    return list;
}
