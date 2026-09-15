import { showMaterialSaved } from './material_feedback.js';
/**
 * ui_gallery_detail.js
 * Professional Image Detail Studio Workbench for ComfyUI.
 * Features:
 * - Studio modal workspace covering most of viewport with blurred backdrop
 * - Prev / Next image navigation (keyboard arrows, floating glass arrows, counter jump)
 * - Collapsible left thumbnail rail with smooth vertical auto-centering
 * - High-speed in-memory LRU metadata cache (imageMetadataCache)
 * - Preloading of adjacent images and AbortController request cancellation
 * - Segmented Bento Inspector: Key Specs Bento grid, Prompts Station, Models & LoRA with weight pills, Node structure
 * - One-click actions: load Workflow and save a full or selected-node Material
 */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { text, jsonResponse } from './ui_dom.js';
import {
    sectionLabel,
    fileBaseName,
    appendLocalPreview,
    modelCustomNotes,
    parsePngMetadataFromUrl,
    extractWorkflowDetails,
    resolveLocalModels,
    lookupLocalModel,
    detailedBlocksFromWorkflow,
    materialNodeHeading,
    renderDetailedNodeCards,
    applyPromptRolesToBlocks,
    mergePromptRoleOverrides,
} from './material_inspector.js';

const t = (key, params) => translate(key, params);

// In-memory LRU metadata cache: key -> { inspectPayload, clientWorkflow, clientDetails, params }
const imageMetadataCache = new Map();
// A workflow can contain large prompt strings and hundreds of nodes. Keep only
// a small navigation window rather than retaining an entire long gallery.
const MAX_METADATA_CACHE = 16;

function getCachedMetadata(key) {
    if (!key || !imageMetadataCache.has(key)) return null;
    const val = imageMetadataCache.get(key);
    // Refresh LRU order
    imageMetadataCache.delete(key);
    imageMetadataCache.set(key, val);
    return val;
}

function setCachedMetadata(key, val) {
    if (!key || !val) return;
    if (imageMetadataCache.size >= MAX_METADATA_CACHE) {
        const oldestKey = imageMetadataCache.keys().next().value;
        imageMetadataCache.delete(oldestKey);
    }
    imageMetadataCache.set(key, val);
}

function compactInspectPayload(payload, hasClientWorkflow) {
    if (!payload || typeof payload !== 'object' || !hasClientWorkflow) return payload || {};
    const compact = { ...payload };
    delete compact.workflow;
    // Older running backends may still return exact values here. The client
    // workflow already owns them, so discard the duplicate before LRU caching.
    if (Array.isArray(compact.node_blocks)) {
        compact.node_blocks = compact.node_blocks.map(block => ({
            node_id: block?.node_id,
            type: block?.type,
            title: block?.title,
            occurrence: block?.occurrence,
            widget_count: block?.widget_count,
            volatile_widget_indexes: block?.volatile_widget_indexes,
        }));
    }
    return compact;
}

// Active singleton workbench state
let wb = null;

/**
 * Copy text to clipboard with button feedback
 */
async function copyToClipboard(str, btn, successLabel, defaultLabel) {
    try {
        await navigator.clipboard.writeText(str);
        if (btn) {
            btn.textContent = successLabel;
            btn.classList.add('is-copied');
            setTimeout(() => {
                btn.textContent = defaultLabel;
                btn.classList.remove('is-copied');
            }, 1500);
        }
    } catch (e) {
        console.warn('Clipboard write failed:', e);
    }
}

function materialSourceImage(item) {
    return item.sourceImage || {
        type: 'output',
        filename: item.filename,
        subfolder: item.subfolder || '',
    };
}

async function saveImageMaterial(item, name, selectedNodeIds = null, tags = []) {
    const owner = wb?.owner;
    const promptRoleOverrides = wb?.promptRoleOverrides;
    const body = {
        source_image: materialSourceImage(item), name: String(name || '').trim().slice(0, 120), tags,
        ...(selectedNodeIds?.length ? { selected_node_ids: selectedNodeIds } : {}),
        ...(owner?.recipeDetailFilename ? { recipe_filename: owner.recipeDetailFilename } : {}),
        ...(promptRoleOverrides && typeof promptRoleOverrides === 'object' ? { promptRoleOverrides } : {}),
    };
    const send = () => fetch('/anomalous/save_image_material', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    let response = await send();
    if (response.status === 409) {
        const duplicate = await response.json();
        if (duplicate.status !== 'duplicate') throw new Error('material save conflict');
        if (!await anomalousConfirm(t('materialDuplicateConfirm', { name: duplicate.name }))) return null;
        body.allow_duplicate = true;
        response = await send();
    }
    const payload = await jsonResponse(response, 'material save failed');
    if (payload.status !== 'success') throw new Error(payload.message || 'material save failed');
    showMaterialSaved(owner, payload.material, dismissWorkbench);
    await owner?.refreshMaterials?.();
    return payload;
}

function selectedMaterialName(baseName, blocks) {
    const base = String(baseName || '').trim();
    const cleanBase = base.replace(/ · (?:快照|Snapshot)$/i, '').trim();
    const suffix = blocks.length === 1
        ? materialNodeHeading(blocks[0])
        : t('materialSelectedNodesName', { count: blocks.length });
    return `${cleanBase ? `${cleanBase} · ` : ''}${suffix}`.slice(0, 120);
}

async function saveSelectedBlocks(item, suggestedName, blocks, button) {
    if (!blocks.length || !button || button.disabled) return;
    const defaultLabel = button.dataset.defaultLabel || (blocks.length === 1
        ? t('materialSaveNode')
        : t('materialSaveSelectedAction', { count: blocks.length }));
    button.disabled = true;
    button.textContent = t('materialSaving');
    try {
        const saved = await saveImageMaterial(
            item,
            selectedMaterialName(suggestedName || fileBaseName(item.filename), blocks),
            blocks.map(block => String(block.node_id)),
        );
        if (!saved) { button.textContent = defaultLabel; button.disabled = false; return; }
        button.textContent = t('materialSaved');
        window.setTimeout(() => {
            if (!button.isConnected) return;
            button.textContent = defaultLabel;
            button.disabled = false;
        }, 1400);
    } catch (error) {
        console.error('Could not save selected material nodes:', error);
        button.textContent = defaultLabel;
        button.disabled = false;
        await anomalousAlert(t('materialSaveError') || '素材快照保存失败。');
    }
}

/**
 * Preload adjacent images for smooth instant transitions
 */
function preloadAdjacentImages(items, currentIndex) {
    const indices = [currentIndex - 1, currentIndex + 1];
    for (const idx of indices) {
        if (idx >= 0 && idx < items.length) {
            const url = items[idx]?.url;
            if (url) {
                const img = new Image();
                img.src = url;
            }
        }
    }
}

/**
 * Build Workbench Header
 */
function buildWorkbenchHeader(item, index, total, onNavigate) {
    const header = document.createElement('div');
    header.className = 'anomalous-workbench-header';

    // Left info
    const leftWrap = document.createElement('div');
    leftWrap.className = 'anomalous-workbench-header-left';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'anomalous-workbench-back-btn';
    backBtn.innerHTML = '‹';
    backBtn.title = `${t('close') || '关闭'} (Esc)`;
    backBtn.onclick = () => dismissWorkbench();
    leftWrap.appendChild(backBtn);

    const titleBox = document.createElement('div');
    titleBox.className = 'anomalous-workbench-title-box';

    const filenameEl = document.createElement('span');
    filenameEl.className = 'anomalous-workbench-title-filename';
    filenameEl.textContent = fileBaseName(item.filename) || 'Image';
    filenameEl.title = item.filename || '';
    titleBox.appendChild(filenameEl);

    const metaTags = document.createElement('div');
    metaTags.className = 'anomalous-workbench-title-tags';
    if (item.subfolder) {
        const folderTag = text(metaTags, 'span', item.subfolder, 'anomalous-workbench-tag');
        folderTag.title = item.subfolder;
    }
    const ext = (item.filename || '').split('.').pop()?.toUpperCase();
    if (ext) text(metaTags, 'span', ext, 'anomalous-workbench-tag is-ext');
    titleBox.appendChild(metaTags);

    leftWrap.appendChild(titleBox);
    header.appendChild(leftWrap);

    // Center image counter & quick switcher
    const centerWrap = document.createElement('div');
    centerWrap.className = 'anomalous-workbench-header-center';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'anomalous-workbench-nav-btn';
    prevBtn.innerHTML = '‹';
    prevBtn.title = t('workbenchPrev') || '上一张 (←)';
    prevBtn.disabled = index <= 0;
    prevBtn.onclick = () => onNavigate(index - 1);

    const counter = document.createElement('span');
    counter.className = 'anomalous-workbench-counter';
    counter.textContent = `${index + 1} / ${total}`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'anomalous-workbench-nav-btn';
    nextBtn.innerHTML = '›';
    nextBtn.title = t('workbenchNext') || '下一张 (→)';
    nextBtn.disabled = index >= total - 1;
    nextBtn.onclick = () => onNavigate(index + 1);

    centerWrap.append(prevBtn, counter, nextBtn);
    header.appendChild(centerWrap);

    // Right Action Buttons
    const rightWrap = document.createElement('div');
    rightWrap.className = 'anomalous-workbench-header-right';

    // Toggle Filmstrip button
    const filmstripToggle = document.createElement('button');
    filmstripToggle.type = 'button';
    filmstripToggle.className = wb?.isFilmstripVisible
        ? 'anomalous-workbench-tool-btn is-active'
        : 'anomalous-workbench-tool-btn';
    filmstripToggle.innerHTML = '🎞️';
    filmstripToggle.title = t('workbenchFilmstrip') || (window.anomalous_browser_lang === 'zh' ? '侧栏缩略图' : 'Thumbnail Rail');
    filmstripToggle.onclick = () => {
        wb.isFilmstripVisible = !wb.isFilmstripVisible;
        filmstripToggle.classList.toggle('is-active', wb.isFilmstripVisible);
        if (wb.filmstripEl) wb.filmstripEl.classList.toggle('is-hidden', !wb.isFilmstripVisible);
    };
    rightWrap.appendChild(filmstripToggle);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'anomalous-workbench-close-btn';
    closeBtn.innerHTML = '×';
    closeBtn.title = `${t('close') || '关闭'} (Esc)`;
    closeBtn.onclick = () => dismissWorkbench();
    rightWrap.appendChild(closeBtn);

    header.appendChild(rightWrap);
    return header;
}

/**
 * Setup pan & zoom interactions on the stage image
 */
function setupStagePanZoom(stage, img) {
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let startX = 0, startY = 0;

    const applyTransform = () => {
        img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        img.style.cursor = scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default';
    };

    const resetTransform = () => {
        scale = 1;
        translateX = 0;
        translateY = 0;
        applyTransform();
    };

    stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        const newScale = Math.min(Math.max(0.2, scale + delta), 8);
        scale = newScale;
        if (scale <= 1) { translateX = 0; translateY = 0; }
        applyTransform();
    }, { passive: false });

    img.addEventListener('mousedown', (e) => {
        if (scale <= 1) return;
        e.preventDefault();
        isDragging = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        applyTransform();
    });

    const onMouseMove = (e) => {
        if (!isDragging) return;
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        applyTransform();
    };

    const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        applyTransform();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // Double click to toggle 1:1 vs fit
    stage.addEventListener('dblclick', (e) => {
        if (e.target !== img) return;
        if (scale === 1) {
            scale = 2;
            translateX = 0;
            translateY = 0;
        } else {
            resetTransform();
        }
        applyTransform();
    });

    return {
        reset: resetTransform,
        zoomIn: () => { scale = Math.min(8, scale + 0.3); applyTransform(); },
        zoomOut: () => { scale = Math.max(0.2, scale - 0.3); applyTransform(); },
        cleanup: () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        }
    };
}

/**
 * Build Left Vertical Filmstrip Rail
 */
function buildFilmstripRail(items, currentIndex, onNavigate) {
    const rail = document.createElement('div');
    rail.className = 'anomalous-workbench-filmstrip';
    if (wb && wb.isFilmstripVisible === false) {
        rail.classList.add('is-hidden');
    }

    const track = document.createElement('div');
    track.className = 'anomalous-workbench-filmstrip-track';

    items.forEach((item, idx) => {
        const thumbWrap = document.createElement('div');
        thumbWrap.className = idx === currentIndex
            ? 'anomalous-workbench-filmstrip-thumb is-active'
            : 'anomalous-workbench-filmstrip-thumb';
        thumbWrap.title = `${idx + 1}. ${fileBaseName(item.filename)}`;

        const thumbImg = document.createElement('img');
        thumbImg.src = item.url;
        thumbImg.loading = 'lazy';
        thumbImg.alt = '';
        thumbWrap.appendChild(thumbImg);

        const badge = document.createElement('span');
        badge.className = 'anomalous-workbench-thumb-index';
        badge.textContent = String(idx + 1);
        thumbWrap.appendChild(badge);

        thumbWrap.onclick = (e) => {
            e.stopPropagation();
            if (idx !== currentIndex) onNavigate(idx);
        };

        track.appendChild(thumbWrap);

        // Auto-center active thumbnail vertically
        if (idx === currentIndex) {
            requestAnimationFrame(() => {
                setTimeout(() => {
                    thumbWrap.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
                }, 40);
            });
        }
    });

    rail.appendChild(track);
    return rail;
}

/**
 * Build Specs Bento Grid
 */
function buildSpecsGrid(params, blocks, item, suggestedName) {
    const grid = document.createElement('div');
    grid.className = 'anomalous-workbench-specs-grid';

    const samplerBlock = (blocks || []).find(block => /^(ksampler|ksampleradvanced)$/i.test(block.type || ''));
    const sizeBlock = (blocks || []).find(block => /^(emptylatentimage|emptylatentimage.*)$/i.test(block.type || ''));

    const addTile = (labelStr, val, options = {}) => {
        if (val == null || val === '') return;
        const card = document.createElement('div');
        card.className = options.wide ? 'anomalous-workbench-spec-card is-wide' : 'anomalous-workbench-spec-card';
        if (options.accent) card.classList.add(`is-${options.accent}`);

        const headerRow = document.createElement('div');
        headerRow.className = 'anomalous-workbench-spec-header';
        text(headerRow, 'span', labelStr, 'anomalous-workbench-spec-label');

        let copyIndicator = null;
        if (options.copyable) {
            card.classList.add('is-copyable');
            card.setAttribute('role', 'button');
            card.tabIndex = 0;
            card.title = t('materialClickToCopy') || '点击复制数值';

            copyIndicator = document.createElement('span');
            copyIndicator.className = 'anomalous-workbench-copy-indicator';
            const renderNormalCopyIcon = () => {
                copyIndicator.innerHTML = `
                    <svg class="anomalous-workbench-spec-copy-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <rect x="5.5" y="5.5" width="8" height="8" rx="1.5"></rect>
                        <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"></path>
                    </svg>
                `;
            };
            renderNormalCopyIcon();
            card.appendChild(copyIndicator);

            const handleCopy = async (e) => {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(String(val));
                    card.classList.remove('is-copy-failed');
                    card.classList.add('is-copied');
                    if (copyIndicator) {
                        copyIndicator.innerHTML = `
                            <svg class="anomalous-workbench-spec-copy-icon is-success" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <polyline points="3.5 8.5 6.5 11.5 12.5 4.5"></polyline>
                            </svg>
                            <span class="anomalous-workbench-copy-badge">${t('materialCopySuccess')}</span>
                        `;
                    }
                    setTimeout(() => {
                        card.classList.remove('is-copied');
                        if (copyIndicator) renderNormalCopyIcon();
                    }, 1500);
                } catch (err) {
                    console.warn('Clipboard copy error:', err);
                    card.classList.remove('is-copied');
                    card.classList.add('is-copy-failed');
                    if (copyIndicator) {
                        copyIndicator.innerHTML = `
                            <svg class="anomalous-workbench-spec-copy-icon is-error" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <circle cx="8" cy="8" r="6"></circle>
                                <line x1="8" y1="5" x2="8" y2="8.5"></line>
                                <line x1="8" y1="11" x2="8.01" y2="11"></line>
                            </svg>
                            <span class="anomalous-workbench-copy-badge is-error">${t('materialCopyFailed')}</span>
                        `;
                    }
                    setTimeout(() => {
                        card.classList.remove('is-copy-failed');
                        if (copyIndicator) renderNormalCopyIcon();
                    }, 2000);
                }
            };

            card.onclick = handleCopy;
            card.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleCopy(e);
                }
            };
        }
        card.appendChild(headerRow);

        const valEl = text(card, 'div', String(val), 'anomalous-workbench-spec-val');
        if (options.mono) valEl.classList.add('is-mono');

        grid.appendChild(card);
    };

    addTile(t('materialParamSeed') || '种子 (Seed)', params.seed, { copyable: true, mono: true, accent: 'seed' });
    addTile(t('recipeCardSpecsSteps') || '采样步数 (Steps)', params.steps != null ? `${params.steps} 步` : null, { });
    addTile('CFG Scale', params.cfg, { });
    addTile(t('materialDenoise') || '重绘降噪 (Denoise)', params.denoise, { });
    addTile(t('recipeCardSpecsSampler') || '采样器 (Sampler)', params.sampler_name, { });
    addTile(t('materialScheduler') || '调度器 (Scheduler)', params.scheduler, { });
    addTile(t('recipeCardSpecsResolution') || '分辨率 (Resolution)', params.resolution, { wide: true, mono: true, accent: 'res' });

    const generationBlocks = [samplerBlock, sizeBlock].filter(Boolean);
    if (generationBlocks.length) {
        const actions = document.createElement('div');
        actions.className = 'anomalous-workbench-generation-save';

        const infoBox = document.createElement('div');
        infoBox.className = 'anomalous-workbench-generation-info';

        const titleEl = document.createElement('div');
        titleEl.className = 'anomalous-workbench-generation-title';
        titleEl.innerHTML = `
            <svg class="anomalous-workbench-generation-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="2" y="2" width="12" height="12" rx="3"></rect>
                <path d="M5 8h6m-3-3v6"></path>
            </svg>
            <span>${t('materialSaveGeneration')}</span>
        `;
        infoBox.appendChild(titleEl);
        text(infoBox, 'div', t('materialGenerationScope'), 'anomalous-workbench-generation-hint');

        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'anomalous-workbench-generation-btn';
        save.textContent = t('materialSaveGenerationAction');
        save.dataset.defaultLabel = save.textContent;
        save.onclick = () => saveSelectedBlocks(item, suggestedName, generationBlocks, save);

        actions.appendChild(infoBox);
        actions.appendChild(save);
        grid.appendChild(actions);
    }

    return grid;
}

/**
 * Build Prompts Station
 */
function buildPromptsStation(blocks, fallbackPrompt, item, suggestedName) {
    const wrap = document.createElement('div');
    wrap.className = 'anomalous-workbench-prompts-wrap';

    const promptBlocks = (blocks || []).filter(block =>
        /cliptextencode/i.test(block.type || '') &&
        (block.widgets_values || []).some(value => typeof value === 'string' && value.trim())
    );
    if (promptBlocks.length) {
        text(wrap, 'p', t('materialPromptRoleHelp'), 'anomalous-workbench-muted');
        renderDetailedNodeCards(wrap, promptBlocks, {
            onSaveBlock: (block, button) => saveSelectedBlocks(item, suggestedName, [block], button),
            onPromptRoleChange: async (block, selectedRole) => {
                const key = String(block.node_id);
                if (!wb.promptRoleOverrides || typeof wb.promptRoleOverrides !== 'object') wb.promptRoleOverrides = {};
                if (selectedRole === 'auto') {
                    delete wb.promptRoleOverrides[key];
                    block.promptRole = block.promptRoleAutomatic || 'unknown';
                    block.promptRoleManual = false;
                    block.promptRoleSource = 'automatic';
                } else {
                    wb.promptRoleOverrides[key] = { role: selectedRole, nodeType: block.type || null };
                    block.promptRole = selectedRole;
                    block.promptRoleManual = true;
                    block.promptRoleSource = 'manual';
                }
            },
        });
    } else if (fallbackPrompt) {
        const card = document.createElement('div');
        card.className = 'anomalous-workbench-prompt-card';
        const topBar = document.createElement('div');
        topBar.className = 'anomalous-workbench-prompt-bar';
        text(topBar, 'span', t('materialPromptText') || '提示词', 'anomalous-workbench-prompt-title');
        const copyBtn = text(topBar, 'button', t('materialCopyPrompt'), 'anomalous-workbench-mini-action-btn');
        copyBtn.type = 'button';
        copyBtn.onclick = () => copyToClipboard(fallbackPrompt, copyBtn, t('materialCopied'), t('materialCopyPrompt'));
        card.appendChild(topBar);
        text(card, 'div', fallbackPrompt, 'anomalous-workbench-prompt-content is-expanded');
        wrap.appendChild(card);
    } else {
        text(wrap, 'div', t('materialNoPromptData'), 'anomalous-workbench-muted');
    }

    return wrap;
}

/**
 * Build Models & LoRAs Section
 */
function buildModelsSection(orderedRefs, groups, onOpenModel) {
    const wrap = document.createElement('div');
    wrap.className = 'anomalous-workbench-models-wrap';

    if (!orderedRefs || !orderedRefs.length) {
        const empty = text(wrap, 'div', '（未检测到模型引用）', 'anomalous-workbench-muted');
        empty.style.padding = '12px';
        return wrap;
    }

    const renderGroup = (title, items, tagClass) => {
        if (!items || !items.length) return;
        const groupEl = document.createElement('div');
        groupEl.className = 'anomalous-workbench-model-group';
        text(groupEl, 'div', title, 'anomalous-workbench-model-group-title');

        for (const item of items) {
            const row = document.createElement('div');
            row.className = 'anomalous-workbench-model-card';

            appendLocalPreview(row, item.localModel?.preview_url, 'anomalous-workbench-model-thumb');

            const info = document.createElement('div');
            info.className = 'anomalous-workbench-model-info';

            const rawVal = String(item.saved_value || item.name || 'Unknown');
            const fileName = fileBaseName(rawVal);
            const nameEl = text(info, 'span', fileName, 'anomalous-workbench-model-name');
            nameEl.title = rawVal;

            if (item.loraWeights) {
                const badge = text(info, 'span', `Model: ${item.loraWeights.strengthModel} · CLIP: ${item.loraWeights.strengthClip}`, 'anomalous-workbench-lora-badge');
                badge.title = 'LoRA Weight & CLIP Strength';
            }

            const notes = modelCustomNotes(item.localModel);
            if (notes) text(info, 'span', notes, 'anomalous-workbench-model-notes');

            row.appendChild(info);

            const actions = document.createElement('div');
            actions.className = 'anomalous-workbench-model-actions';
            text(actions, 'span', item.category || 'model', `anomalous-workbench-model-tag ${tagClass}`);

            if (item.localModel) {
                const viewBtn = document.createElement('button');
                viewBtn.type = 'button';
                viewBtn.className = 'anomalous-workbench-mini-action-btn';
                viewBtn.textContent = '🔎 定位模型';
                viewBtn.onclick = (e) => {
                    e.stopPropagation();
                    onOpenModel(item.localModel);
                };
                actions.appendChild(viewBtn);
            }

            row.appendChild(actions);
            groupEl.appendChild(row);
        }

        wrap.appendChild(groupEl);
    };

    renderGroup(t('materialModelBase') || '主模型 / UNet', groups.base, 'is-base');
    renderGroup(t('materialModelLora') || 'LoRA 微调层', groups.lora, 'is-lora');
    renderGroup(t('materialModelClip') || '文本编码器 (CLIP)', groups.clip, 'is-clip');
    renderGroup(t('materialModelVae') || 'VAE 编码器', groups.vae, 'is-vae');
    renderGroup(t('materialModelOther') || '其它模型组件', groups.other, 'is-other');

    return wrap;
}

/**
 * Build Workflow Nodes Section
 */
function buildWorkflowNodesSection(blocks, clientWorkflow, item, suggestedName) {
    const wrap = document.createElement('div');
    wrap.className = 'anomalous-workbench-nodes-wrap';

    if (!blocks || !blocks.length) {
        text(wrap, 'div', '（无底层节点参数数据）', 'anomalous-workbench-muted');
        return wrap;
    }

    // Node count summary chips
    const typeCounts = {};
    for (const b of blocks) {
        const tName = materialNodeHeading(b) || 'Node';
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
    wrap.appendChild(chipFlow);

    const selectionBar = document.createElement('div');
    selectionBar.className = 'anomalous-workbench-node-selection-bar';
    const selectionText = text(selectionBar, 'span', '', 'anomalous-workbench-node-selection-count');
    const selectAllBtn = text(selectionBar, 'button', t('materialSelectAllNodes'), 'anomalous-workbench-mini-action-btn');
    selectAllBtn.type = 'button';
    const clearBtn = text(selectionBar, 'button', t('materialClearNodeSelection'), 'anomalous-workbench-mini-action-btn');
    clearBtn.type = 'button';
    const saveSelectedBtn = text(selectionBar, 'button', t('materialSaveSelectedAction', { count: 0 }), 'anomalous-workbench-save-selected-btn');
    saveSelectedBtn.type = 'button';
    saveSelectedBtn.disabled = true;
    wrap.appendChild(selectionBar);

    const updateSelection = () => {
        const count = wb?.selectedNodeIds?.size || 0;
        selectionText.textContent = t('materialSelectedNodeCount', { count });
        saveSelectedBtn.textContent = t('materialSaveSelectedAction', { count });
        saveSelectedBtn.disabled = count === 0;
    };

    // Copy full workflow JSON button
    const jsonActionRow = document.createElement('div');
    jsonActionRow.className = 'anomalous-workbench-action-row';

    const copyJsonBtn = document.createElement('button');
    copyJsonBtn.type = 'button';
    copyJsonBtn.className = 'anomalous-workbench-mini-action-btn';
    copyJsonBtn.textContent = `📋 ${t('workbenchCopyWorkflowJson') || '复制完整工作流 JSON'}`;
    copyJsonBtn.onclick = () => {
        if (clientWorkflow) {
            copyToClipboard(JSON.stringify(clientWorkflow, null, 2), copyJsonBtn, '✅ 已复制工作流 JSON', `📋 ${t('workbenchCopyWorkflowJson') || '复制完整工作流 JSON'}`);
        }
    };
    jsonActionRow.appendChild(copyJsonBtn);
    wrap.appendChild(jsonActionRow);

    // Detailed node cards
    const detailedContainer = document.createElement('div');
    detailedContainer.className = 'anomalous-workbench-node-list-box';
    renderDetailedNodeCards(detailedContainer, blocks, {
        selectable: true,
        selectedIds: wb?.selectedNodeIds,
        onSelectionChange: (block, checked) => {
            const key = String(block.node_id);
            if (checked) wb?.selectedNodeIds?.add(key);
            else wb?.selectedNodeIds?.delete(key);
            updateSelection();
        },
        onSaveBlock: (block, button) => saveSelectedBlocks(item, suggestedName, [block], button),
    });
    wrap.appendChild(detailedContainer);

    const setAllSelections = checked => {
        if (!wb?.selectedNodeIds) return;
        wb.selectedNodeIds.clear();
        if (checked) blocks.forEach(block => wb.selectedNodeIds.add(String(block.node_id)));
        detailedContainer.querySelectorAll('.anomalous-material-node-select').forEach(input => {
            input.checked = checked;
            input.closest('.anomalous-material-node-detail')?.classList.toggle('is-selected', checked);
        });
        updateSelection();
    };
    selectAllBtn.onclick = () => setAllSelections(true);
    clearBtn.onclick = () => setAllSelections(false);
    saveSelectedBtn.onclick = () => {
        const selected = blocks.filter(block => wb?.selectedNodeIds?.has(String(block.node_id)));
        return saveSelectedBlocks(item, suggestedName, selected, saveSelectedBtn);
    };
    updateSelection();

    return wrap;
}

/**
 * Dismiss active workbench
 */
function dismissWorkbench() {
    if (!wb) return;
    if (wb.panZoom) wb.panZoom.cleanup();
    if (wb.abortController) wb.abortController.abort();
    if (wb.overlay) wb.overlay.remove();
    if (wb.onKeyDown) window.removeEventListener('keydown', wb.onKeyDown);
    wb = null;
}

/**
 * Load into ComfyUI canvas
 */
async function loadWorkflowToComfyCanvas(workflow) {
    if (!workflow || typeof app.loadGraphData !== 'function') {
        await anomalousAlert(t('materialOpenError') || '无法打开这个素材中的工作流。');
        return;
    }
    try {
        const cloned = JSON.parse(JSON.stringify(workflow));
        await app.loadGraphData(cloned);
        await anomalousAlert(t('workbenchLoadSuccess') || '工作流已成功加载到 ComfyUI 画布！');
    } catch (e) {
        console.error('Failed to load workflow to canvas:', e);
        await anomalousAlert(`${t('workbenchLoadFailed') || '无法加载工作流到画布：'}${e.message || e}`);
    }
}

/**
 * Load and render a specific image in the workbench
 */
async function loadWorkbenchImage(index) {
    if (!wb || !wb.items || index < 0 || index >= wb.items.length) return;

    wb.currentIndex = index;
    wb.selectedNodeIds = new Set();
    const item = wb.items[index];
    const total = wb.items.length;

    // Abort any ongoing fetch
    if (wb.abortController) wb.abortController.abort();
    wb.abortController = new AbortController();
    const signal = wb.abortController.signal;

    // 1. Update Header
    if (wb.headerEl) {
        const newHeader = buildWorkbenchHeader(item, index, total, (newIdx) => loadWorkbenchImage(newIdx));
        wb.headerEl.replaceWith(newHeader);
        wb.headerEl = newHeader;
    }

    // 2. Update Image & reset pan/zoom
    if (wb.stageImg) {
        wb.stageImg.src = item.url;
        if (wb.panZoom) wb.panZoom.reset();
    }

    // 3. Update Filmstrip Active item
    if (wb.filmstripEl) {
        const thumbs = wb.filmstripEl.querySelectorAll('.anomalous-workbench-filmstrip-thumb');
        thumbs.forEach((el, i) => {
            el.classList.toggle('is-active', i === index);
            if (i === index) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            }
        });
    }

    // 4. Preload adjacent images
    preloadAdjacentImages(wb.items, index);

    // 5. Check if infinite load more needed
    if (index >= wb.items.length - 4 && typeof wb.loadMore === 'function') {
        try {
            wb.loadMore().then(newItems => {
                if (Array.isArray(newItems) && newItems.length > wb.items.length) {
                    wb.items = newItems;
                    // Rebuild filmstrip track
                    if (wb.filmstripEl && wb.filmstripEl.parentElement) {
                        const newRail = buildFilmstripRail(wb.items, wb.currentIndex, (idx) => loadWorkbenchImage(idx));
                        wb.filmstripEl.replaceWith(newRail);
                        wb.filmstripEl = newRail;
                    }
                }
            }).catch(() => {});
        } catch (_) {}
    }

    // 6. Check cache or load metadata
    const cacheKey = item.url || (item.subfolder ? `${item.subfolder}/${item.filename}` : item.filename);
    const cached = getCachedMetadata(cacheKey);

    if (cached) {
        renderInspectorContent(cached, item);
        return;
    }

    // Render loading state in side body
    if (wb.sideBodyEl) {
        wb.sideBodyEl.replaceChildren();
        const loadingBox = document.createElement('div');
        loadingBox.className = 'anomalous-workbench-loading-box';
        loadingBox.innerHTML = `
            <div class="anomalous-workbench-spinner"></div>
            <span>${t('materialInspecting') || '正在读取图片中的工作流与参数…'}</span>
        `;
        wb.sideBodyEl.appendChild(loadingBox);
    }

    try {
        const sourceImage = item.sourceImage || {
            type: 'output',
            filename: item.filename,
            subfolder: item.subfolder || '',
        };

        const inspectPayload = await fetch('/anomalous/inspect_image_material', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_image: sourceImage }),
                signal,
            }).then(r => jsonResponse(r, 'material inspection failed')).catch(() => ({}));

        if (signal.aborted) return;

        // Current backends return the already validated workflow, avoiding a
        // second full-image ArrayBuffer in the browser. Direct PNG parsing is
        // retained only as a compatibility fallback before a server restart.
        const clientWorkflow = inspectPayload.workflow
            || await parsePngMetadataFromUrl(item.url, { signal }).catch(() => null);
        if (signal.aborted) return;

        const compactPayload = compactInspectPayload(inspectPayload, Boolean(clientWorkflow));
        const clientDetails = extractWorkflowDetails(clientWorkflow);
        const params = {
            ...(clientDetails.params || {}),
            ...(compactPayload.params || {}),
        };

        const metadataBundle = {
            inspectPayload: compactPayload,
            clientWorkflow,
            clientDetails,
            params,
        };

        setCachedMetadata(cacheKey, metadataBundle);
        renderInspectorContent(metadataBundle, item);
    } catch (err) {
        if (signal.aborted) return;
        console.warn('Workbench metadata fetch error:', err);
        if (wb.sideBodyEl) {
            wb.sideBodyEl.replaceChildren();
            text(wb.sideBodyEl, 'div', t('materialInspectError') || '无法解析此图片的生图参数。', 'anomalous-workbench-error-box');
        }
    }
}

/**
 * Render the Inspector Panel Content
 */
async function renderInspectorContent(data, item) {
    if (!wb || !wb.sideBodyEl) return;

    const { inspectPayload, clientWorkflow, clientDetails, params } = data;
    wb.sideBodyEl.replaceChildren();

    // Group models
    const allModelRefs = Array.isArray(inspectPayload.model_references) ? [...inspectPayload.model_references] : [];
    const addIfNotExists = (refItem) => {
        const clean = (val) => String(val || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
        const target = clean(refItem.saved_value || refItem.name);
        if (!target) return;
        if (!allModelRefs.some(m => clean(m.saved_value || m.name) === target)) {
            allModelRefs.push(refItem);
        }
    };

    if (clientDetails.discoveredModels) {
        for (const c of clientDetails.discoveredModels.checkpoints) addIfNotExists({ saved_value: c.name, category: c.category });
        for (const l of clientDetails.discoveredModels.loras) addIfNotExists({ saved_value: l.name, category: 'lora' });
        for (const tModel of clientDetails.discoveredModels.textEncoders) addIfNotExists({ saved_value: tModel.name, category: 'text_encoder' });
        for (const v of clientDetails.discoveredModels.vaes) addIfNotExists({ saved_value: v.name, category: 'vae' });
    }

    const groups = { base: [], lora: [], clip: [], vae: [], other: [] };
    for (const ref of allModelRefs) {
        const cat = String(ref.category || '').toLowerCase();
        const val = String(ref.saved_value || ref.name || '').toLowerCase();
        const rawVal = String(ref.saved_value || ref.name || '');
        const fileName = fileBaseName(rawVal);
        ref.loraWeights = clientDetails.loraDetailsMap?.get(rawVal) || clientDetails.loraDetailsMap?.get(fileName);

        if (cat === 'checkpoint' || cat === 'unet' || val.includes('checkpoint') || val.includes('unet')) {
            groups.base.push(ref);
        } else if (cat === 'lora' || val.includes('lora')) {
            groups.lora.push(ref);
        } else if (cat === 'text_encoder' || cat === 'clip' || val.includes('clip') || val.includes('t5')) {
            groups.clip.push(ref);
        } else if (cat === 'vae' || val.includes('vae')) {
            groups.vae.push(ref);
        } else {
            groups.other.push(ref);
        }
    }

    const orderedRefs = [...groups.base, ...groups.lora, ...groups.clip, ...groups.vae, ...groups.other];

    const applyResolvedModels = localModels => {
        for (const reference of orderedRefs) {
            reference.localModel = lookupLocalModel(localModels, reference.saved_value || reference.name);
        }
    };
    if (data._localModels) applyResolvedModels(data._localModels);

    const recipe = wb?.owner?.recipeDetailPayload?.recipe;
    const recipeOverrides = recipe?.params?.promptRoleOverrides || recipe?.data?.params?.promptRoleOverrides || {};
    const promptSourceKey = `${item.subfolder || ''}/${item.filename || item.url || ''}`;
    if (wb.promptRoleSourceKey !== promptSourceKey) {
        wb.promptRoleSourceKey = promptSourceKey;
        wb.promptRoleOverrides = JSON.parse(JSON.stringify(recipeOverrides));
    }
    const promptRoles = mergePromptRoleOverrides(
        inspectPayload.prompt_roles,
        wb.promptRoleOverrides,
    );
    const blocks = applyPromptRolesToBlocks(
        detailedBlocksFromWorkflow(clientWorkflow, inspectPayload.node_blocks),
        promptRoles,
    );
    const fallbackPrompt = (Array.isArray(inspectPayload.prompts) && inspectPayload.prompts.length)
        ? inspectPayload.prompts.join('\n\n')
        : (inspectPayload.prompt_excerpt || '');

    // Top Inspector Toolbar: One-click actions
    const toolbar = document.createElement('div');
    toolbar.className = 'anomalous-workbench-inspector-toolbar';

    const loadCanvasBtn = document.createElement('button');
    loadCanvasBtn.type = 'button';
    loadCanvasBtn.className = 'anomalous-workbench-action-btn is-primary';
    loadCanvasBtn.innerHTML = `
        <svg class="anomalous-workbench-action-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="4" height="4" rx="1"></rect>
            <rect x="10" y="3" width="4" height="4" rx="1"></rect>
            <rect x="6" y="9.5" width="4" height="4" rx="1"></rect>
            <path d="M4 7v2a1 1 0 0 0 1 1h1m6-3v2a1 1 0 0 1-1 1H8"></path>
        </svg>
        <span>${t('materialOpenWorkflow')}</span>
    `;
    loadCanvasBtn.title = window.anomalous_browser_lang === 'zh'
        ? '将这张图片中包含的完整工作流直接还原到 ComfyUI 画布'
        : 'Restore the full workflow from this image directly to ComfyUI canvas';
    loadCanvasBtn.onclick = () => loadWorkflowToComfyCanvas(clientWorkflow || inspectPayload.workflow);
    toolbar.appendChild(loadCanvasBtn);

    const saveMaterialBtn = document.createElement('button');
    saveMaterialBtn.type = 'button';
    saveMaterialBtn.className = 'anomalous-workbench-action-btn is-save';
    const cleanSaveLabel = (t('materialSaveSnapshotShort') || '保存到素材库').replace(/^[^\w\u4e00-\u9fa5]+/, '').trim();
    saveMaterialBtn.innerHTML = `
        <svg class="anomalous-workbench-action-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3.5 2.5h9a1 1 0 0 1 1 1v10.5l-5.5-3-5.5 3V3.5a1 1 0 0 1 1-1z"></path>
        </svg>
        <span>${cleanSaveLabel}</span>
    `;
    saveMaterialBtn.title = t('materialSaveSnapshotFocusHint');
    saveMaterialBtn.setAttribute('aria-expanded', 'false');
    saveMaterialBtn.onclick = () => {
        const footer = wb?.sideFooterEl;
        if (!footer) return;
        footer.hidden = !footer.hidden;
        saveMaterialBtn.classList.toggle('is-active', !footer.hidden);
        saveMaterialBtn.setAttribute('aria-expanded', String(!footer.hidden));
        if (footer.hidden) return;
        const nameInput = wb?.sideFooterEl?.querySelector('input[type="text"]');
        wb?.sideFooterEl?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
        nameInput?.focus();
        nameInput?.select();
    };
    toolbar.appendChild(saveMaterialBtn);

    wb.sideBodyEl.appendChild(toolbar);

    // Segmented Tabs
    const tabsBar = document.createElement('div');
    tabsBar.className = 'anomalous-workbench-tabs-bar';

    const tabs = [
        { id: 'specs', label: t('workbenchTabOverview') || '核心参数', icon: '<svg style="width:13px;height:13px;margin-right:5px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>' },
        { id: 'prompts', label: t('workbenchTabPrompts') || '提示词', icon: '<svg style="width:13px;height:13px;margin-right:5px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },
        { id: 'models', label: t('workbenchTabModels') || '模型与LoRA', icon: '<svg style="width:13px;height:13px;margin-right:5px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>' },
        { id: 'nodes', label: t('workbenchTabNodes') || '工作流节点', icon: '<svg style="width:13px;height:13px;margin-right:5px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>' },
    ];

    const tabPanels = {};
    let ensureModelsResolved = () => {};

    tabs.forEach(tDef => {
        const tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.className = (wb.activeTab === tDef.id)
            ? 'anomalous-workbench-tab-btn is-active'
            : 'anomalous-workbench-tab-btn';
        tabBtn.innerHTML = `${tDef.icon}<span>${tDef.label}</span>`;

        tabBtn.onclick = () => {
            wb.activeTab = tDef.id;
            tabsBar.querySelectorAll('.anomalous-workbench-tab-btn').forEach(b => b.classList.remove('is-active'));
            tabBtn.classList.add('is-active');
            Object.values(tabPanels).forEach(p => p.style.display = 'none');
            if (tabPanels[tDef.id]) tabPanels[tDef.id].style.display = 'flex';
            if (tDef.id === 'models') ensureModelsResolved();
        };

        tabsBar.appendChild(tabBtn);
    });

    wb.sideBodyEl.appendChild(tabsBar);

    // Panel 1: Specs Grid
    const specsPanel = document.createElement('div');
    specsPanel.className = 'anomalous-workbench-tab-panel';
    specsPanel.style.display = wb.activeTab === 'specs' ? 'flex' : 'none';
    specsPanel.appendChild(buildSpecsGrid(params, blocks, item, inspectPayload.suggested_name));
    tabPanels.specs = specsPanel;
    wb.sideBodyEl.appendChild(specsPanel);

    // Panel 2: Prompts Station
    const promptsPanel = document.createElement('div');
    promptsPanel.className = 'anomalous-workbench-tab-panel';
    promptsPanel.style.display = wb.activeTab === 'prompts' ? 'flex' : 'none';
    promptsPanel.appendChild(buildPromptsStation(blocks, fallbackPrompt, item, inspectPayload.suggested_name));
    tabPanels.prompts = promptsPanel;
    wb.sideBodyEl.appendChild(promptsPanel);

    // Panel 3: Models & LoRAs
    const modelsPanel = document.createElement('div');
    modelsPanel.className = 'anomalous-workbench-tab-panel';
    modelsPanel.style.display = wb.activeTab === 'models' ? 'flex' : 'none';
    modelsPanel.appendChild(buildModelsSection(orderedRefs, groups, (m) => openMaterialLocalModel(m)));
    tabPanels.models = modelsPanel;
    wb.sideBodyEl.appendChild(modelsPanel);
    ensureModelsResolved = () => {
        if (data._localModels) return;
        if (!data._localModelsPromise) {
            data._localModelsPromise = resolveLocalModels(orderedRefs.map(reference => reference.saved_value || reference.name))
                .then(localModels => {
                    data._localModels = localModels;
                    return localModels;
                })
                .catch(() => ({}));
        }
        data._localModelsPromise.then(localModels => {
            if (!modelsPanel.isConnected) return;
            applyResolvedModels(localModels);
            modelsPanel.replaceChildren(buildModelsSection(orderedRefs, groups, model => openMaterialLocalModel(model)));
        });
    };
    if (wb.activeTab === 'models') ensureModelsResolved();

    // Panel 4: Nodes Section
    const nodesPanel = document.createElement('div');
    nodesPanel.className = 'anomalous-workbench-tab-panel';
    nodesPanel.style.display = wb.activeTab === 'nodes' ? 'flex' : 'none';
    nodesPanel.appendChild(buildWorkflowNodesSection(blocks, clientWorkflow, item, inspectPayload.suggested_name));
    tabPanels.nodes = nodesPanel;
    wb.sideBodyEl.appendChild(nodesPanel);

    // Bottom Snapshot Drawer in Footer
    renderSaveSnapshotFooter(inspectPayload, item);
}

/**
 * Render Save Snapshot form in the sticky footer
 */
function renderSaveSnapshotFooter(inspectPayload, item) {
    if (!wb || !wb.sideFooterEl) return;
    wb.sideFooterEl.replaceChildren();
    wb.sideFooterEl.hidden = true;

    const saveRow = document.createElement('div');
    saveRow.className = 'anomalous-workbench-save-row';

    const inputWrap = document.createElement('div');
    inputWrap.className = 'anomalous-workbench-save-input-wrap';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 120;
    nameInput.placeholder = t('materialName') || '输入素材快照名称…';
    nameInput.value = inspectPayload.suggested_name || fileBaseName(item.filename) || '';
    nameInput.setAttribute('aria-label', t('materialName'));
    inputWrap.appendChild(nameInput);
    const tagsInput = document.createElement('input');
    tagsInput.type = 'text';
    tagsInput.maxLength = 1200;
    tagsInput.placeholder = t('materialTagsHint');
    tagsInput.setAttribute('aria-label', t('materialTags'));
    inputWrap.appendChild(tagsInput);
    text(inputWrap, 'small', t('materialFullSaveHint'), 'anomalous-workbench-save-hint');

    saveRow.appendChild(inputWrap);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'anomalous-workbench-action-btn is-save';
    const snapshotLabel = (t('materialSaveSnapshot') || '保存为素材').replace(/^[^\w\u4e00-\u9fa5]+/, '').trim();
    const renderSaveBtnNormal = () => {
        saveBtn.innerHTML = `
            <svg class="anomalous-workbench-action-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3.5 2.5h9a1 1 0 0 1 1 1v10.5l-5.5-3-5.5 3V3.5a1 1 0 0 1 1-1z"></path>
            </svg>
            <span>${snapshotLabel}</span>
        `;
    };
    renderSaveBtnNormal();

    saveBtn.onclick = async () => {
        const val = nameInput.value.trim();
        if (!val) { nameInput.focus(); return; }
        saveBtn.disabled = true;
        saveBtn.textContent = t('materialSaving');
        try {
            const tags = tagsInput.value.split(/[,，]/).map(value => value.trim()).filter(Boolean);
            const saved = await saveImageMaterial(item, val, null, tags);
            if (!saved) { saveBtn.disabled = false; renderSaveBtnNormal(); return; }
            saveBtn.textContent = t('materialSaved');
            saveBtn.disabled = false;
        } catch (error) {
            console.error('Could not save image material:', error);
            renderSaveBtnNormal();
            saveBtn.disabled = false;
            await anomalousAlert(t('materialSaveError') || '素材快照保存失败。');
        }
    };

    saveRow.appendChild(saveBtn);
    wb.sideFooterEl.appendChild(saveRow);
}

/**
 * Open local model detail safely from workbench
 */
function openMaterialLocalModel(model) {
    if (!model || !wb || typeof wb.owner?.showDetail !== 'function') return;
    const owner = wb.owner;
    wb.overlay.classList.add('is-suspended');
    wb.inspectingModel = true;

    const previousReturn = owner.recipeModelReturn;
    owner.recipeModelReturn = () => {
        owner.recipeModelReturn = previousReturn;
        if (wb) {
            wb.inspectingModel = false;
            wb.overlay.classList.remove('is-suspended');
        }
        if (owner.detailPanel) {
            owner.detailPanel.style.display = 'none';
            owner.stopMediaInContainer?.(owner.detailPanel);
            owner.detailPanel.replaceChildren();
        }
        owner.modal?.classList.add('visible');
    };

    owner.historyStack = [];
    owner.currentType = model.type || owner.currentType;
    owner.currentPathIdx = model.path_idx ?? model.path_index ?? 0;
    owner.currentSubfolder = model.subfolder || '/';
    owner.currentDetailModel = model;
    owner.modal?.classList.add('visible');
    for (const panel of [owner.grid, owner.galleryPanel, owner.doctorPanel, owner.assistantPanel, owner.paramPanel, owner.nbPanel]) {
        if (panel) panel.style.display = 'none';
    }
    owner.showDetail(model);
}

/**
 * Primary public entry point: Show Image Detail Workbench
 * @param {Object} owner - AnomalousBrowser instance
 * @param {Object} sourceImage - { filename, subfolder, type }
 * @param {string} imageUrl - direct URL to output image
 * @param {Object} [options] - { items: Array, currentIndex: number, loadMore: Function }
 */
export async function showImageWorkbench(owner, sourceImage, imageUrl, options = {}) {
    // If existing workbench open, dismiss it first
    dismissWorkbench();

    // Prepare items list
    let items = Array.isArray(options.items) && options.items.length ? [...options.items] : [];
    let currentIndex = typeof options.currentIndex === 'number' ? options.currentIndex : 0;

    // Normalization: Ensure each item has url, filename, subfolder
    if (!items.length) {
        items = [{
            filename: sourceImage?.filename || 'image.png',
            subfolder: sourceImage?.subfolder || '',
            url: imageUrl,
            sourceImage,
        }];
        currentIndex = 0;
    } else {
        // If current index was not specified or out of bounds, locate by url or filename
        if (currentIndex < 0 || currentIndex >= items.length) {
            const foundIdx = items.findIndex(it => (it.url && it.url === imageUrl) || (it.filename && it.filename === sourceImage?.filename));
            currentIndex = foundIdx >= 0 ? foundIdx : 0;
        }
    }

    // Initialize workbench singleton
    wb = {
        owner,
        items,
        currentIndex,
        loadMore: options.loadMore || null,
        activeTab: 'specs',
        isFilmstripVisible: true,
        inspectingModel: false,
        abortController: null,
        selectedNodeIds: new Set(),
    };

    // 1. Overlay container
    const overlay = document.createElement('div');
    overlay.className = 'anomalous-workbench-overlay';
    overlay.id = 'anomalous-workbench-overlay';
    wb.overlay = overlay;

    // 2. Dialog box
    const dialog = document.createElement('div');
    dialog.className = 'anomalous-workbench-dialog';
    wb.dialog = dialog;

    // 3. Header bar (Initial placeholder)
    const headerEl = buildWorkbenchHeader(items[currentIndex], currentIndex, items.length, (idx) => loadWorkbenchImage(idx));
    wb.headerEl = headerEl;
    dialog.appendChild(headerEl);

    // 4. Main Body: Left Stage + Right Inspector
    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'anomalous-workbench-body';

    // 4A. Left Stage Area
    const stageArea = document.createElement('div');
    stageArea.className = 'anomalous-workbench-stage-area';

    const stage = document.createElement('div');
    stage.className = 'anomalous-workbench-stage';
    wb.stage = stage;

    const img = document.createElement('img');
    img.className = 'anomalous-workbench-stage-img';
    img.src = items[currentIndex].url;
    img.alt = 'Workbench Stage';
    wb.stageImg = img;
    stage.appendChild(img);

    // Floating Nav Arrows on canvas edges
    const floatPrev = document.createElement('button');
    floatPrev.type = 'button';
    floatPrev.className = 'anomalous-workbench-float-nav is-prev';
    floatPrev.innerHTML = '‹';
    floatPrev.title = t('workbenchPrev') || '上一张 (←)';
    floatPrev.onclick = (e) => {
        e.stopPropagation();
        if (wb.currentIndex > 0) loadWorkbenchImage(wb.currentIndex - 1);
    };

    const floatNext = document.createElement('button');
    floatNext.type = 'button';
    floatNext.className = 'anomalous-workbench-float-nav is-next';
    floatNext.innerHTML = '›';
    floatNext.title = t('workbenchNext') || '下一张 (→)';
    floatNext.onclick = (e) => {
        e.stopPropagation();
        if (wb.currentIndex < wb.items.length - 1) loadWorkbenchImage(wb.currentIndex + 1);
    };

    stageArea.append(floatPrev, stage, floatNext);

    // Floating Canvas Zoom Toolbar (Bottom-Right of stage)
    const panZoom = setupStagePanZoom(stage, img);
    wb.panZoom = panZoom;

    const zoomBar = document.createElement('div');
    zoomBar.className = 'anomalous-workbench-zoom-bar';

    const fitBtn = document.createElement('button');
    fitBtn.type = 'button';
    fitBtn.textContent = t('workbenchZoomFit') || '适应窗口';
    fitBtn.onclick = () => panZoom.reset();

    const actualBtn = document.createElement('button');
    actualBtn.type = 'button';
    actualBtn.textContent = t('workbenchZoomReset') || '1:1';
    actualBtn.onclick = () => { panZoom.reset(); panZoom.zoomIn(); };

    const zoomInBtn = document.createElement('button');
    zoomInBtn.type = 'button';
    zoomInBtn.textContent = '+';
    zoomInBtn.onclick = () => panZoom.zoomIn();

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.type = 'button';
    zoomOutBtn.textContent = '−';
    zoomOutBtn.onclick = () => panZoom.zoomOut();

    zoomBar.append(fitBtn, actualBtn, zoomOutBtn, zoomInBtn);
    stageArea.appendChild(zoomBar);

    // 4A. Left Vertical Filmstrip Rail
    const filmstripRail = buildFilmstripRail(items, currentIndex, (idx) => loadWorkbenchImage(idx));
    wb.filmstripEl = filmstripRail;
    bodyContainer.appendChild(filmstripRail);

    // 4B. Center Canvas Stage Area
    bodyContainer.appendChild(stageArea);

    // 4C. Right Inspector Panel
    const inspector = document.createElement('div');
    inspector.className = 'anomalous-workbench-inspector';

    const sideBody = document.createElement('div');
    sideBody.className = 'anomalous-workbench-inspector-body';
    wb.sideBodyEl = sideBody;
    inspector.appendChild(sideBody);

    const sideFooter = document.createElement('div');
    sideFooter.className = 'anomalous-workbench-inspector-footer';
    wb.sideFooterEl = sideFooter;
    inspector.appendChild(sideFooter);

    bodyContainer.appendChild(inspector);
    dialog.appendChild(bodyContainer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Keyboard navigation listener
    const onKeyDown = (e) => {
        if (wb.inspectingModel) return;
        if (document.querySelector('.anomalous-dialog-overlay')) return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            dismissWorkbench();
        } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
            e.preventDefault();
            if (wb.currentIndex > 0) loadWorkbenchImage(wb.currentIndex - 1);
        } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
            e.preventDefault();
            if (wb.currentIndex < wb.items.length - 1) loadWorkbenchImage(wb.currentIndex + 1);
        }
    };

    wb.onKeyDown = onKeyDown;
    window.addEventListener('keydown', onKeyDown);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) dismissWorkbench();
    });

    // Start loading current item metadata
    loadWorkbenchImage(currentIndex);
}
