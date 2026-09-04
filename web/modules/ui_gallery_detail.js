/**
 * ui_gallery_detail.js
 * Professional Image Detail Studio Workbench for ComfyUI.
 * Features:
 * - Fullscreen studio workspace / windowed modal toggle
 * - Prev / Next image navigation (keyboard arrows, floating glass arrows, counter jump)
 * - Collapsible bottom thumbnail filmstrip with smooth auto-centering
 * - High-speed in-memory LRU metadata cache (imageMetadataCache)
 * - Preloading of adjacent images and AbortController request cancellation
 * - Segmented Bento Inspector: Key Specs Bento grid, Prompts Station, Models & LoRA with weight pills, Node structure
 * - One-click actions: Load Workflow to ComfyUI canvas (app.loadGraphData), Copy Civitai format params, Save Material snapshot
 */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import {
    text,
    sectionLabel,
    fileBaseName,
    appendLocalPreview,
    modelCustomNotes,
    jsonResponse,
    parsePngMetadataFromUrl,
    extractWorkflowDetails,
    resolveLocalModels,
    lookupLocalModel,
    detailedBlocksFromWorkflow,
    materialNodeHeading,
    renderDetailedNodeCards
} from './ui_materials.js';

const t = (key, params) => translate(key, params);

// In-memory LRU metadata cache: key -> { inspectPayload, clientWorkflow, clientDetails, params }
const imageMetadataCache = new Map();
const MAX_METADATA_CACHE = 120;

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

// Active singleton workbench state
let wb = null;

/**
 * Format generation parameters into Civitai / WebUI standard prompt text for 1-click copy
 */
function formatGenerationParamsText(posPrompt, negPrompt, params, allModelRefs) {
    const lines = [];
    if (posPrompt) lines.push(posPrompt.trim());
    if (negPrompt) lines.push(`Negative prompt: ${negPrompt.trim()}`);

    const parts = [];
    if (params.steps != null) parts.push(`Steps: ${params.steps}`);
    if (params.sampler_name) parts.push(`Sampler: ${params.sampler_name}`);
    if (params.scheduler) parts.push(`Schedule type: ${params.scheduler}`);
    if (params.cfg != null) parts.push(`CFG scale: ${params.cfg}`);
    if (params.seed != null) parts.push(`Seed: ${params.seed}`);
    if (params.resolution) {
        const cleanRes = String(params.resolution).replace(/\s*×\s*/, 'x').replace(/\s+/g, '');
        parts.push(`Size: ${cleanRes}`);
    }
    if (params.denoise != null) parts.push(`Denoise: ${params.denoise}`);

    // Add main model name if found
    const baseModel = (allModelRefs || []).find(m => {
        const cat = String(m.category || '').toLowerCase();
        return cat === 'checkpoint' || cat === 'unet';
    });
    if (baseModel) {
        parts.push(`Model: ${fileBaseName(baseModel.saved_value || baseModel.name)}`);
    }

    if (parts.length) lines.push(parts.join(', '));
    return lines.join('\n\n');
}

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

/**
 * Preload adjacent images for smooth instant transitions
 */
function preloadAdjacentImages(items, currentIndex) {
    const indices = [currentIndex - 1, currentIndex + 1, currentIndex + 2];
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
    filmstripToggle.title = t('workbenchFilmstrip') || '底栏缩略图';
    filmstripToggle.onclick = () => {
        wb.isFilmstripVisible = !wb.isFilmstripVisible;
        filmstripToggle.classList.toggle('is-active', wb.isFilmstripVisible);
        if (wb.filmstripEl) wb.filmstripEl.classList.toggle('is-hidden', !wb.isFilmstripVisible);
    };
    rightWrap.appendChild(filmstripToggle);

    // Fullscreen / Windowed toggle
    const fsToggle = document.createElement('button');
    fsToggle.type = 'button';
    fsToggle.className = 'anomalous-workbench-tool-btn';
    fsToggle.innerHTML = wb?.isFullscreen ? '⛶' : '🗖';
    fsToggle.title = wb?.isFullscreen
        ? (t('workbenchWindowed') || '窗口模式')
        : (t('workbenchFullscreen') || '全屏工作台');
    fsToggle.onclick = () => toggleWorkbenchFullscreen(fsToggle);
    rightWrap.appendChild(fsToggle);

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
 * Build Bottom Filmstrip Rail
 */
function buildFilmstripRail(items, currentIndex, onNavigate) {
    const rail = document.createElement('div');
    rail.className = 'anomalous-workbench-filmstrip';

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

        thumbWrap.onclick = (e) => {
            e.stopPropagation();
            if (idx !== currentIndex) onNavigate(idx);
        };

        track.appendChild(thumbWrap);

        // Auto-center active thumbnail
        if (idx === currentIndex) {
            requestAnimationFrame(() => {
                thumbWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            });
        }
    });

    rail.appendChild(track);
    return rail;
}

/**
 * Build Specs Bento Grid
 */
function buildSpecsGrid(params) {
    const grid = document.createElement('div');
    grid.className = 'anomalous-workbench-specs-grid';

    const addTile = (labelStr, val, options = {}) => {
        if (val == null || val === '') return;
        const card = document.createElement('div');
        card.className = options.wide ? 'anomalous-workbench-spec-card is-wide' : 'anomalous-workbench-spec-card';
        if (options.accent) card.classList.add(`is-${options.accent}`);

        const headerRow = document.createElement('div');
        headerRow.className = 'anomalous-workbench-spec-header';
        text(headerRow, 'span', labelStr, 'anomalous-workbench-spec-label');

        if (options.copyable) {
            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'anomalous-workbench-spec-copy';
            copyBtn.innerHTML = '📋';
            copyBtn.title = t('copy') || '复制';
            copyBtn.onclick = (e) => {
                e.stopPropagation();
                copyToClipboard(String(val), copyBtn, '✅', '📋');
            };
            headerRow.appendChild(copyBtn);
        }
        card.appendChild(headerRow);

        const valEl = text(card, 'div', String(val), 'anomalous-workbench-spec-val');
        if (options.mono) valEl.classList.add('is-mono');

        grid.appendChild(card);
    };

    addTile(t('materialParamSeed') || '种子 (Seed)', params.seed, { copyable: true, mono: true, accent: 'seed' });
    addTile(t('recipeCardSpecsSteps') || '采样步数 (Steps)', params.steps != null ? `${params.steps} 步` : null);
    addTile('CFG Scale', params.cfg);
    addTile(t('materialDenoise') || '重绘降噪 (Denoise)', params.denoise);
    addTile(t('recipeCardSpecsSampler') || '采样器 (Sampler)', params.sampler_name);
    addTile(t('materialScheduler') || '调度器 (Scheduler)', params.scheduler);
    addTile(t('recipeCardSpecsResolution') || '分辨率 (Resolution)', params.resolution, { wide: true, mono: true, accent: 'res' });

    return grid;
}

/**
 * Build Prompts Station
 */
function buildPromptsStation(posText, negText, fallbackPrompt) {
    const wrap = document.createElement('div');
    wrap.className = 'anomalous-workbench-prompts-wrap';

    const renderCard = (titleText, promptStr, tone = '') => {
        if (!promptStr || !promptStr.trim()) return null;
        const card = document.createElement('div');
        card.className = tone ? `anomalous-workbench-prompt-card is-${tone}` : 'anomalous-workbench-prompt-card';

        const topBar = document.createElement('div');
        topBar.className = 'anomalous-workbench-prompt-bar';

        const titleSection = document.createElement('div');
        titleSection.className = 'anomalous-workbench-prompt-title-section';
        text(titleSection, 'span', titleText, 'anomalous-workbench-prompt-title');

        const charCount = promptStr.length;
        text(titleSection, 'span', `${charCount} 字符`, 'anomalous-workbench-prompt-count');
        topBar.appendChild(titleSection);

        const btns = document.createElement('div');
        btns.className = 'anomalous-workbench-prompt-btns';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'anomalous-workbench-mini-action-btn';
        copyBtn.textContent = `📋 ${t('materialCopyPrompt') || '复制'}`;
        copyBtn.onclick = () => copyToClipboard(promptStr, copyBtn, `✅ ${t('materialCopied') || '已复制'}`, `📋 ${t('materialCopyPrompt') || '复制'}`);
        btns.appendChild(copyBtn);

        if (promptStr.length > 120 || promptStr.includes('\n')) {
            const expandBtn = document.createElement('button');
            expandBtn.type = 'button';
            expandBtn.className = 'anomalous-workbench-mini-action-btn';
            expandBtn.textContent = t('materialExpandAll') || '展开';
            expandBtn.onclick = () => {
                const isExp = contentEl.classList.toggle('is-expanded');
                expandBtn.textContent = isExp ? (t('materialCollapse') || '收起') : (t('materialExpandAll') || '展开');
            };
            btns.appendChild(expandBtn);
        }

        topBar.appendChild(btns);
        card.appendChild(topBar);

        const contentEl = text(card, 'div', promptStr, 'anomalous-workbench-prompt-content');
        return card;
    };

    if (posText || negText) {
        if (posText) {
            const posCard = renderCard(t('materialPositivePrompt') || '正向提示词 (Positive)', posText, 'positive');
            if (posCard) wrap.appendChild(posCard);
        }
        if (negText) {
            const negCard = renderCard(t('materialNegativePrompt') || '负向提示词 (Negative)', negText, 'negative');
            if (negCard) wrap.appendChild(negCard);
        }
    } else if (fallbackPrompt) {
        const card = renderCard(t('materialPromptText') || '提示词', fallbackPrompt);
        if (card) wrap.appendChild(card);
    } else {
        const empty = text(wrap, 'div', '（无嵌入提示词数据）', 'anomalous-workbench-muted');
        empty.style.padding = '12px';
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

    renderGroup(t('materialModelBase') || '🎯 主模型 / UNet', groups.base, 'is-base');
    renderGroup(t('materialModelLora') || '🎨 LoRA 微调层', groups.lora, 'is-lora');
    renderGroup(t('materialModelClip') || '👁️ 文本编码器 (CLIP)', groups.clip, 'is-clip');
    renderGroup(t('materialModelVae') || '🖼️ VAE 编码器', groups.vae, 'is-vae');
    renderGroup(t('materialModelOther') || '⚡ 其它模型组件', groups.other, 'is-other');

    return wrap;
}

/**
 * Build Workflow Nodes Section
 */
function buildWorkflowNodesSection(blocks, clientWorkflow) {
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
    renderDetailedNodeCards(detailedContainer, blocks);
    wrap.appendChild(detailedContainer);

    return wrap;
}

/**
 * Toggle Fullscreen vs Windowed modal
 */
function toggleWorkbenchFullscreen(btnEl) {
    if (!wb || !wb.overlay) return;
    wb.isFullscreen = !wb.isFullscreen;
    wb.overlay.classList.toggle('is-windowed', !wb.isFullscreen);
    if (btnEl) {
        btnEl.innerHTML = wb.isFullscreen ? '⛶' : '🗖';
        btnEl.title = wb.isFullscreen
            ? (t('workbenchWindowed') || '窗口模式')
            : (t('workbenchFullscreen') || '全屏工作台');
    }
    try {
        localStorage.setItem('anomalous_workbench_fullscreen', wb.isFullscreen ? '1' : '0');
    } catch (_) {}
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
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
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

        const [inspectPayload, clientWorkflow] = await Promise.all([
            fetch('/anomalous/inspect_image_material', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_image: sourceImage }),
                signal,
            }).then(r => jsonResponse(r, 'material inspection failed')).catch(() => ({})),
            parsePngMetadataFromUrl(item.url).catch(() => null),
        ]);

        if (signal.aborted) return;

        const clientDetails = extractWorkflowDetails(clientWorkflow);
        const params = {
            ...(clientDetails.params || {}),
            ...(inspectPayload.params || {}),
        };

        const metadataBundle = {
            inspectPayload,
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

    // Asynchronously resolve local models for thumbnails
    if (!data._localModelsResolved) {
        data._localModelsResolved = true;
        resolveLocalModels(orderedRefs.map(r => r.saved_value || r.name)).then(localModels => {
            for (const r of orderedRefs) {
                r.localModel = lookupLocalModel(localModels, r.saved_value || r.name);
            }
            // If user is currently looking at models tab, refresh it
            if (wb?.activeTab === 'models' || wb?.activeTab === 'all') {
                const modelsContainer = wb.sideBodyEl.querySelector('.anomalous-workbench-models-wrap');
                if (modelsContainer) {
                    const fresh = buildModelsSection(orderedRefs, groups, (m) => openMaterialLocalModel(m));
                    modelsContainer.replaceWith(fresh);
                }
            }
        }).catch(() => {});
    }

    const posText = clientDetails.positivePrompts.join('\n\n');
    const negText = clientDetails.negativePrompts.join('\n\n');
    const fallbackPrompt = (Array.isArray(inspectPayload.prompts) && inspectPayload.prompts.length)
        ? inspectPayload.prompts.join('\n\n')
        : (inspectPayload.prompt_excerpt || '');

    // Top Inspector Toolbar: One-click actions
    const toolbar = document.createElement('div');
    toolbar.className = 'anomalous-workbench-inspector-toolbar';

    const loadCanvasBtn = document.createElement('button');
    loadCanvasBtn.type = 'button';
    loadCanvasBtn.className = 'anomalous-workbench-action-btn is-primary';
    loadCanvasBtn.innerHTML = '⚡ 加载到画布';
    loadCanvasBtn.title = '将这张图片中包含的完整工作流直接还原到 ComfyUI 画布';
    loadCanvasBtn.onclick = () => loadWorkflowToComfyCanvas(clientWorkflow || inspectPayload.workflow);
    toolbar.appendChild(loadCanvasBtn);

    const copyParamsBtn = document.createElement('button');
    copyParamsBtn.type = 'button';
    copyParamsBtn.className = 'anomalous-workbench-action-btn';
    copyParamsBtn.innerHTML = '📋 复制生图参数';
    copyParamsBtn.title = '复制标准 Civitai/WebUI 格式生图参数（含提示词、种子、采样器等）';
    copyParamsBtn.onclick = () => {
        const formatted = formatGenerationParamsText(posText, negText, params, allModelRefs);
        copyToClipboard(formatted, copyParamsBtn, '✅ 参数已复制', '📋 复制生图参数');
    };
    toolbar.appendChild(copyParamsBtn);

    wb.sideBodyEl.appendChild(toolbar);

    // Segmented Tabs
    const tabsBar = document.createElement('div');
    tabsBar.className = 'anomalous-workbench-tabs-bar';

    const tabs = [
        { id: 'specs', label: `📊 ${t('workbenchTabOverview') || '核心参数'}` },
        { id: 'prompts', label: `💬 ${t('workbenchTabPrompts') || '提示词'}` },
        { id: 'models', label: `🧩 ${t('workbenchTabModels') || '模型与LoRA'}` },
        { id: 'nodes', label: `⚙️ ${t('workbenchTabNodes') || '工作流节点'}` },
    ];

    const tabPanels = {};

    tabs.forEach(tDef => {
        const tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.className = (wb.activeTab === tDef.id)
            ? 'anomalous-workbench-tab-btn is-active'
            : 'anomalous-workbench-tab-btn';
        tabBtn.textContent = tDef.label;

        tabBtn.onclick = () => {
            wb.activeTab = tDef.id;
            tabsBar.querySelectorAll('.anomalous-workbench-tab-btn').forEach(b => b.classList.remove('is-active'));
            tabBtn.classList.add('is-active');
            Object.values(tabPanels).forEach(p => p.style.display = 'none');
            if (tabPanels[tDef.id]) tabPanels[tDef.id].style.display = 'flex';
        };

        tabsBar.appendChild(tabBtn);
    });

    wb.sideBodyEl.appendChild(tabsBar);

    // Panel 1: Specs Grid
    const specsPanel = document.createElement('div');
    specsPanel.className = 'anomalous-workbench-tab-panel';
    specsPanel.style.display = wb.activeTab === 'specs' ? 'flex' : 'none';
    specsPanel.appendChild(buildSpecsGrid(params));
    tabPanels.specs = specsPanel;
    wb.sideBodyEl.appendChild(specsPanel);

    // Panel 2: Prompts Station
    const promptsPanel = document.createElement('div');
    promptsPanel.className = 'anomalous-workbench-tab-panel';
    promptsPanel.style.display = wb.activeTab === 'prompts' ? 'flex' : 'none';
    promptsPanel.appendChild(buildPromptsStation(posText, negText, fallbackPrompt));
    tabPanels.prompts = promptsPanel;
    wb.sideBodyEl.appendChild(promptsPanel);

    // Panel 3: Models & LoRAs
    const modelsPanel = document.createElement('div');
    modelsPanel.className = 'anomalous-workbench-tab-panel';
    modelsPanel.style.display = wb.activeTab === 'models' ? 'flex' : 'none';
    modelsPanel.appendChild(buildModelsSection(orderedRefs, groups, (m) => openMaterialLocalModel(m)));
    tabPanels.models = modelsPanel;
    wb.sideBodyEl.appendChild(modelsPanel);

    // Panel 4: Nodes Section
    const blocks = detailedBlocksFromWorkflow(clientWorkflow, inspectPayload.node_blocks);
    const nodesPanel = document.createElement('div');
    nodesPanel.className = 'anomalous-workbench-tab-panel';
    nodesPanel.style.display = wb.activeTab === 'nodes' ? 'flex' : 'none';
    nodesPanel.appendChild(buildWorkflowNodesSection(blocks, clientWorkflow));
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

    const saveRow = document.createElement('div');
    saveRow.className = 'anomalous-workbench-save-row';

    const inputWrap = document.createElement('div');
    inputWrap.className = 'anomalous-workbench-save-input-wrap';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 120;
    nameInput.placeholder = t('materialName') || '输入素材快照名称…';
    nameInput.value = inspectPayload.suggested_name || fileBaseName(item.filename) || '';
    inputWrap.appendChild(nameInput);

    saveRow.appendChild(inputWrap);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'anomalous-workbench-action-btn is-save';
    saveBtn.innerHTML = `💾 ${t('materialSaveSnapshot') || '保存为素材'}`;

    saveBtn.onclick = async () => {
        const val = nameInput.value.trim();
        if (!val) { nameInput.focus(); return; }
        saveBtn.disabled = true;
        saveBtn.textContent = '💾 正在保存…';
        try {
            const sourceImage = item.sourceImage || {
                type: 'output',
                filename: item.filename,
                subfolder: item.subfolder || '',
            };
            const saveResponse = await fetch('/anomalous/save_image_material', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_image: sourceImage, name: val }),
            });
            const savePayload = await jsonResponse(saveResponse, 'material save failed');
            if (savePayload.status !== 'success') throw new Error(savePayload.message || 'material save failed');
            wb.owner?.refreshMaterials?.();
            saveBtn.textContent = '✅ 已保存素材';
            await anomalousAlert(t('materialSaveSuccess') || '素材快照已保存！');
        } catch (error) {
            console.error('Could not save image material:', error);
            saveBtn.textContent = `💾 ${t('materialSaveSnapshot') || '保存为素材'}`;
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

    // Determine initial fullscreen state from preferences
    let isFullscreen = true;
    try {
        const savedFs = localStorage.getItem('anomalous_workbench_fullscreen');
        if (savedFs === '0') isFullscreen = false;
    } catch (_) {}

    // Initialize workbench singleton
    wb = {
        owner,
        items,
        currentIndex,
        loadMore: options.loadMore || null,
        activeTab: 'specs',
        isFullscreen,
        isFilmstripVisible: true,
        inspectingModel: false,
        abortController: null,
    };

    // 1. Overlay container
    const overlay = document.createElement('div');
    overlay.className = isFullscreen ? 'anomalous-workbench-overlay' : 'anomalous-workbench-overlay is-windowed';
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

    // Bottom Filmstrip
    const filmstripRail = buildFilmstripRail(items, currentIndex, (idx) => loadWorkbenchImage(idx));
    wb.filmstripEl = filmstripRail;
    stageArea.appendChild(filmstripRail);

    bodyContainer.appendChild(stageArea);

    // 4B. Right Inspector Panel
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
        } else if (e.key === 'f' || e.key === 'F') {
            e.preventDefault();
            toggleWorkbenchFullscreen();
        }
    };

    wb.onKeyDown = onKeyDown;
    window.addEventListener('keydown', onKeyDown);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay && !wb.isFullscreen) dismissWorkbench();
    });

    // Start loading current item metadata
    loadWorkbenchImage(currentIndex);
}
