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
    buildWorkbenchHeader,
    setupStagePanZoom,
    buildFilmstripRail,
    preloadAdjacentImages,
} from './ui_image_stage.js';
import { renderImageInspectorContent } from './ui_image_inspector.js';
import {
    fileBaseName,
    parsePngMetadataFromUrl,
    extractWorkflowDetails,
    materialNodeHeading,
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
        const newHeader = buildWorkbenchHeader(
            item,
            index,
            total,
            (newIdx) => loadWorkbenchImage(newIdx),
            { workbench: wb, onDismiss: dismissWorkbench },
        );
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
                        const newRail = buildFilmstripRail(
                            wb.items,
                            wb.currentIndex,
                            (idx) => loadWorkbenchImage(idx),
                            wb,
                        );
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

function renderInspectorContent(data, item) {
    return renderImageInspectorContent({
        workbench: wb,
        saveSelectedBlocks,
        copyToClipboard,
        loadWorkflowToComfyCanvas,
        openMaterialLocalModel,
        renderSaveSnapshotFooter,
    }, data, item);
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
    const headerEl = buildWorkbenchHeader(
        items[currentIndex],
        currentIndex,
        items.length,
        (idx) => loadWorkbenchImage(idx),
        { workbench: wb, onDismiss: dismissWorkbench },
    );
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
    const filmstripRail = buildFilmstripRail(items, currentIndex, (idx) => loadWorkbenchImage(idx), wb);
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
