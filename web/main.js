import { showDetail, showEditModal, _openAdvancedModelSelector, setWidgetValuePath } from './modules/ui_detail.js';
import { loadModels, applyModelToCanvas, stopMediaInContainer } from './modules/ui_grid.js';
import { createDOM, renderSidebar, loadFolders, showHelp, hideAllPanels, openFolderManager } from './modules/ui_sidebar.js';
import { loadGalleryImages, refreshGalleryImages, showGeneratedGallery, showGallerySelectMode, showGalleryViewer } from './modules/ui_gallery.js';
import { showNotebooks, closeWorkspace, refreshNotebooks, saveCurrentNotebook, deleteCurrentNotebook, renderNotebookEditor, fillNotebookGalleries, sendNotebookToCanvas } from './modules/ui_notebooks.js';
import { showRecipes, refreshRecipes, renderRecipeList, handleSaveRecipe } from './modules/ui_recipes.js';
import { initDoctorPanel, diagnoseNode, renderGlobalDashboard, initAssistantPanel, renderAssistantModelCard, _loadAssistantHistory, _openGalleryReplacer, openLoraInsertionPicker, runGlobalDoctorScan } from './modules/ui_doctor.js';
import { app } from "../../scripts/app.js";
import { normalizeLocale, resolveLocale, translate } from './modules/locales.js';
// ============================================================================
// TABLE OF CONTENTS (TOC)
// 1. App Registration & Entry     (Search for "app.registerExtension")
// 2. State & Class Constructor    (Search for "class AnomalousBrowser")
// 3. UI - Sidebar                 (Search for "createDOM")
// 4. UI - Main Grid               (Search for "renderGrid")
// 5. UI - Detail Panel            (Search for "showDetail")
// 6. UI - Gallery Viewer          (Search for "createGalleryViewer")
// 7. UI - Doctor Panel            (Search for "createDoctorPanel")
// 8. Notebooks & Workflow Recipes (Search for "Notebook" or "Recipes")
// ============================================================================

let defaultLang = 'zh';
try {
    let comfyDetected = false;
    const aglLang = localStorage.getItem('Comfy.Settings.AIGODLIKE-COMFYUI-TRANSLATION.Language');
    if (aglLang) {
        defaultLang = aglLang.toLowerCase().includes('en') ? 'en' : 'zh';
        comfyDetected = true;
    } else {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.toLowerCase().includes('lang') || key.toLowerCase().includes('locale'))) {
                const val = localStorage.getItem(key);
                if (typeof val === 'string') {
                    const lowerVal = val.toLowerCase();
                    if (lowerVal.includes('zh') || lowerVal.includes('chinese')) {
                        defaultLang = 'zh';
                        comfyDetected = true;
                        break;
                    } else if (lowerVal.includes('en') || lowerVal.includes('english')) {
                        defaultLang = 'en';
                        comfyDetected = true;
                        break;
                    }
                }
            }
        }
    }

    if (!comfyDetected && navigator.language && !navigator.language.toLowerCase().startsWith('zh')) {
        defaultLang = 'en';
    }
} catch (e) {
    if (navigator.language && !navigator.language.toLowerCase().startsWith('zh')) {
        defaultLang = 'en';
    }
}
let currentLang = resolveLocale(localStorage.getItem('anomalous_lang') || defaultLang);
window.anomalous_browser_lang = currentLang;
const t = (key, params) => translate(key, params, window.anomalous_browser_lang || currentLang);

class AnomalousBrowser {
    constructor() {
        this.modal = null;
        this.sidebar = null;
        this.grid = null;
        this.detailPanel = null;
        this.currentType = 'loras';
        this.currentPathIdx = 0;
        this.currentSubfolder = '/';
        this.foldersData = null;
        this.expandedFolders = new Set(['/', 'checkpoints', 'loras', 'unet', 'diffusion_models']);
        this.energySaving = localStorage.getItem('anomalous_energy_saving') === 'true';
        this.cardThumbnailMode = localStorage.getItem('anomalous_card_thumbnail_mode') === 'original'
            ? 'original'
            : 'balanced';
        this.createDOM();
    }
    // [EXTRACTED] createDOM
    // [EXTRACTED] showHelp
    // [EXTRACTED] loadFolders
    // [EXTRACTED] renderSidebar
    // [EXTRACTED] loadModels
    // [EXTRACTED] applyModelToCanvas
    // [EXTRACTED] stopMediaInContainer
    // [EXTRACTED] showDetail

    show() {
        if (this._idleReleaseTimer) {
            clearTimeout(this._idleReleaseTimer);
            this._idleReleaseTimer = null;
        }
        this.setTriggerVisible(false);
        this.modal.classList.add('visible');
        if (!this.foldersData) {
            this.loadFolders();
        } else {
            this.loadModels();
        }
    }

    close() {
        this.modal.classList.remove('visible');
        this.setTriggerVisible(true);
        if (this._modelLoadController) this._modelLoadController.abort();
        if (this._modelMediaObserver) this._modelMediaObserver.disconnect();
        this.modal.querySelectorAll('video, audio').forEach(media => media.pause());
        this.stopMediaInContainer(this.grid);
        if (this._idleReleaseTimer) clearTimeout(this._idleReleaseTimer);
        this._idleReleaseTimer = setTimeout(() => {
            if (this.modal.classList.contains('visible')) return;
            this.stopMediaInContainer(this.grid);
            this.grid.replaceChildren();
            this.models = [];
        }, 90000);
    }

    setTriggerVisible(visible) {
        const trigger = this.triggerButton || document.getElementById('anomalous-trigger-btn');
        trigger?.classList.toggle('anomalous-trigger-hidden', !visible);
    }
    // [EXTRACTED] showNotebooks

    async translateText(text) {
        if (!text || !text.trim()) return "";
        try {
            const res = await fetch('/anomalous/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, target_lang: window.anomalous_browser_lang === 'zh' ? 'zh-CN' : 'en' })
            });
            const data = await res.json();
            return data.translated || text;
        } catch (e) { return text; }
    }
    // [EXTRACTED] loadGalleryImages
    // [EXTRACTED] showEditModal
    // [EXTRACTED] showGeneratedGallery
    // [EXTRACTED] showGallerySelectMode
    // [EXTRACTED] showGalleryViewer
    // [EXTRACTED] refreshNotebooks
    // [EXTRACTED] saveCurrentNotebook
    // [EXTRACTED] deleteCurrentNotebook
    // [EXTRACTED] renderNotebookEditor
    // [EXTRACTED] fillNotebookGalleries
    // [EXTRACTED] sendNotebookToCanvas
    // [EXTRACTED] setWidgetValuePath
    // [EXTRACTED] hideAllPanels

    // [Doctor & Assistant Panel methods extracted to ui_doctor.js]

    showPreflightImportModal() {
        let overlay = document.getElementById('anomalous-import-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'anomalous-import-overlay';
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100vw';
            overlay.style.height = '100vh';
            overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
            overlay.style.zIndex = '9999999';
            overlay.style.display = 'flex';
            overlay.style.justifyContent = 'center';
            overlay.style.alignItems = 'center';

            const modal = document.createElement('div');
            modal.style.width = '600px';
            modal.style.maxWidth = '90vw';
            modal.style.background = '#222';
            modal.style.borderRadius = '12px';
            modal.style.padding = '20px';
            modal.style.border = '1px solid rgba(255,255,255,0.1)';
            modal.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
            modal.style.display = 'flex';
            modal.style.flexDirection = 'column';
            modal.style.gap = '15px';

            const header = document.createElement('h2');
            header.style.margin = '0';
            header.style.color = '#fff';
            header.textContent = t('mainPreflightTitle');
            modal.appendChild(header);

            const desc = document.createElement('div');
            desc.style.color = '#aaa';
            desc.style.fontSize = '14px';
            desc.textContent = t('mainPreflightDesc');
            modal.appendChild(desc);

            const textarea = document.createElement('textarea');
            textarea.id = 'anomalous-import-textarea';
            textarea.style.width = '100%';
            textarea.style.height = '150px';
            textarea.style.background = '#111';
            textarea.style.color = '#fff';
            textarea.style.border = '1px solid #444';
            textarea.style.borderRadius = '6px';
            textarea.style.padding = '10px';
            textarea.style.fontFamily = 'monospace';
            textarea.style.resize = 'vertical';
            textarea.style.boxSizing = 'border-box';
            textarea.placeholder = '{"last_node_id": ...}';
            modal.appendChild(textarea);

            const resultArea = document.createElement('div');
            resultArea.id = 'anomalous-import-result';
            resultArea.style.maxHeight = '300px';
            resultArea.style.overflowY = 'auto';
            resultArea.style.display = 'none';
            resultArea.style.flexDirection = 'column';
            resultArea.style.gap = '10px';
            resultArea.style.background = 'rgba(0,0,0,0.2)';
            resultArea.style.padding = '15px';
            resultArea.style.borderRadius = '8px';
            modal.appendChild(resultArea);

            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.justifyContent = 'flex-end';
            btnRow.style.gap = '10px';

            const closeBtn = document.createElement('button');
            closeBtn.textContent = t('mainCancel');
            closeBtn.style.padding = '8px 16px';
            closeBtn.style.background = 'transparent';
            closeBtn.style.color = '#ccc';
            closeBtn.style.border = '1px solid #555';
            closeBtn.style.borderRadius = '6px';
            closeBtn.style.cursor = 'pointer';
            closeBtn.onclick = () => { overlay.style.display = 'none'; };

            const analyzeBtn = document.createElement('button');
            analyzeBtn.id = 'anomalous-import-analyze-btn';
            analyzeBtn.textContent = t('mainAnalyzePreflight');
            analyzeBtn.style.padding = '8px 16px';
            analyzeBtn.style.background = '#1a73e8';
            analyzeBtn.style.color = '#fff';
            analyzeBtn.style.border = 'none';
            analyzeBtn.style.borderRadius = '6px';
            analyzeBtn.style.cursor = 'pointer';

            const loadBtn = document.createElement('button');
            loadBtn.id = 'anomalous-import-load-btn';
            loadBtn.textContent = t('mainForceLoad');
            loadBtn.style.padding = '8px 16px';
            loadBtn.style.background = '#28a745';
            loadBtn.style.color = '#fff';
            loadBtn.style.border = 'none';
            loadBtn.style.borderRadius = '6px';
            loadBtn.style.cursor = 'pointer';
            loadBtn.style.display = 'none';

            let parsedGraphData = null;

            analyzeBtn.onclick = async () => {
                try {
                    const jsonStr = textarea.value.trim();
                    if (!jsonStr) return;
                    parsedGraphData = JSON.parse(jsonStr);

                    try {
                        const res = await fetch('/anomalous/all_hashes');
                        const hData = await res.json();
                        const hObj = hData.hashes ? hData.hashes : hData;
                        Object.assign(window.anomalous_hash_cache, hObj);
                    } catch (e) { }

                    const models = [];
                    if (parsedGraphData.nodes) {
                        for (const node of parsedGraphData.nodes) {
                            if (node.widgets_values) {
                                for (const v of node.widgets_values) {
                                    if (typeof v === 'string' && (v.endsWith('.safetensors') || v.endsWith('.ckpt') || v.endsWith('.pt') || v.endsWith('.sft') || v.endsWith('.bin'))) {
                                        models.push({ nodeType: node.type, value: v });
                                    }
                                }
                            }
                        }
                    }

                    textarea.style.display = 'none';
                    resultArea.style.display = 'flex';
                    analyzeBtn.style.display = 'none';
                    loadBtn.style.display = 'block';

                    if (models.length === 0) {
                        const noDependencies = document.createElement('div');
                        noDependencies.style.color = '#28a745';
                        noDependencies.textContent = t('mainNoDependencies');
                        resultArea.replaceChildren(noDependencies);
                        return;
                    }

                    const detectedHeader = document.createElement('div');
                    detectedHeader.style.color = '#fff';
                    detectedHeader.style.fontWeight = 'bold';
                    detectedHeader.style.marginBottom = '10px';
                    detectedHeader.textContent = t('mainDetectedModels', { count: models.length });
                    resultArea.replaceChildren(detectedHeader);

                    for (const m of models) {
                        const val = m.value;
                        const parts = val.split(/[\\/]/);
                        const basename = parts[parts.length - 1];

                        let isHealthy = false;
                        let cacheHit = window.anomalous_hash_cache[val] || window.anomalous_hash_cache[basename];

                        const fetchRes = await fetch(`/anomalous/resolve_hash?hash=unknown&size=&filename=${encodeURIComponent(val)}`);
                        const fetchData = await fetchRes.json();
                        if (fetchData.found) {
                            isHealthy = true;
                        } else if (cacheHit) {
                            const resolveRes = await fetch(`/anomalous/resolve_hash?hash=${encodeURIComponent(cacheHit.hash || cacheHit)}&size=`);
                            const resolveData = await resolveRes.json();
                            if (resolveData.found) isHealthy = true;
                        }

                        const item = document.createElement('div');
                        item.style.display = 'flex';
                        item.style.alignItems = 'center';
                        item.style.justifyContent = 'space-between';
                        item.style.padding = '8px';
                        item.style.background = 'rgba(255,255,255,0.05)';
                        item.style.borderRadius = '4px';

                        const left = document.createElement('div');
                        left.style.display = 'flex';
                        left.style.alignItems = 'center';
                        left.style.gap = '8px';

                        const icon = document.createElement('span');
                        icon.innerText = isHealthy ? '✅' : '⚠️';

                        const text = document.createElement('span');
                        text.innerText = `[${m.nodeType}] ${basename}`;
                        text.style.color = isHealthy ? '#ccc' : '#ff6b6b';
                        text.style.fontSize = '14px';

                        left.appendChild(icon);
                        left.appendChild(text);
                        item.appendChild(left);

                        if (!isHealthy) {
                            const right = document.createElement('a');
                            const normVal = val.replace(/\\/g, '/');
                            const winVal = val.replace(/\//g, '\\');
                            let workflowHash = null;
                            if (app.graph && app.graph.extra && app.graph.extra.anomalous_hashes) {
                                const hData = app.graph.extra.anomalous_hashes[`${m.nodeId || ''}_${val}`] ||
                                              app.graph.extra.anomalous_hashes[`${m.nodeId || ''}_${normVal}`] ||
                                              app.graph.extra.anomalous_hashes[`${m.nodeId || ''}_${winVal}`] ||
                                              app.graph.extra.anomalous_hashes[val] ||
                                              app.graph.extra.anomalous_hashes[normVal] ||
                                              app.graph.extra.anomalous_hashes[winVal];
                                if (hData) workflowHash = typeof hData === 'string' ? hData : hData.hash;
                            }
                            const searchHash = workflowHash || (cacheHit ? (typeof cacheHit === 'string' ? cacheHit : cacheHit.hash) : null);
                            const searchStr = basename.replace('.safetensors', '').replace('.ckpt', '').replace('.pt', '').replace('.sft', '');
                            right.href = `https://civitai.com/search/models?sortBy=models_v9&query=${encodeURIComponent(searchHash || searchStr)}`;
                            right.target = '_blank';
                            right.textContent = t('mainDownloadCivitai');
                            right.style.color = '#1a73e8';
                            right.style.fontSize = '12px';
                            right.style.textDecoration = 'none';
                            right.style.cursor = 'pointer';

                            if (searchHash) {
                                right.onclick = async (e) => {
                                    e.preventDefault();
                                    const prevText = right.textContent;
                                    right.textContent = '⏳...';
                                    try {
                                        const res = await fetch(`https://civitai.com/api/v1/model-versions/by-hash/${encodeURIComponent(searchHash)}`);
                                        if (res.ok) {
                                            const data = await res.json();
                                            if (data && data.modelId) {
                                                const nsfwLevel = data.nsfwLevel || 1;
                                                const isNsfw = (data.model && data.model.nsfw) || (nsfwLevel > 1);
                                                const domain = isNsfw ? 'civitai.red' : 'civitai.com';
                                                let targetUrl = `https://${domain}/models/${data.modelId}`;
                                                if (data.id) targetUrl += `?modelVersionId=${data.id}`;
                                                window.open(targetUrl, '_blank');
                                                right.textContent = prevText;
                                                return;
                                            }
                                        }
                                    } catch (err) {
                                        console.warn("[Anomalous] Civitai by-hash lookup failed:", err);
                                    }
                                    right.textContent = prevText;
                                    window.open(`https://civitai.com/search/models?sortBy=models_v9&query=${encodeURIComponent(searchStr)}`, '_blank');
                                };
                            }
                            item.appendChild(right);
                        } else {
                            const right = document.createElement('span');
                            right.textContent = t('mainReady');
                            right.style.color = '#28a745';
                            right.style.fontSize = '12px';
                            item.appendChild(right);
                        }

                        resultArea.appendChild(item);
                    }
                } catch (e) {
                    alert(t('mainInvalidJson') + ' ' + e.message);
                }
            };

            loadBtn.onclick = () => {
                if (parsedGraphData && app) {
                    app.loadGraphData(parsedGraphData);
                    overlay.style.display = 'none';
                }
            };

            btnRow.appendChild(closeBtn);
            btnRow.appendChild(analyzeBtn);
            btnRow.appendChild(loadBtn);
            modal.appendChild(btnRow);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        }

        if (textarea) {
            textarea.value = '';
            textarea.style.display = 'block';
        }
        if (resultArea) {
            resultArea.style.display = 'none';
            resultArea.innerHTML = '';
        }
        if (analyzeBtn) analyzeBtn.style.display = 'block';
        if (loadBtn) loadBtn.style.display = 'none';

        overlay.style.display = 'flex';
    }
    // [EXTRACTED] _openAdvancedModelSelector

}


// --- Extracted Module Bindings ---
AnomalousBrowser.prototype.initDoctorPanel = initDoctorPanel;
AnomalousBrowser.prototype.diagnoseNode = diagnoseNode;
AnomalousBrowser.prototype.renderGlobalDashboard = renderGlobalDashboard;
AnomalousBrowser.prototype.initAssistantPanel = initAssistantPanel;
AnomalousBrowser.prototype.renderAssistantModelCard = renderAssistantModelCard;
AnomalousBrowser.prototype._loadAssistantHistory = _loadAssistantHistory;
AnomalousBrowser.prototype._openGalleryReplacer = _openGalleryReplacer;
AnomalousBrowser.prototype.openLoraInsertionPicker = openLoraInsertionPicker;
AnomalousBrowser.prototype.runGlobalDoctorScan = runGlobalDoctorScan;

AnomalousBrowser.prototype.showNotebooks = showNotebooks;
AnomalousBrowser.prototype.closeWorkspace = closeWorkspace;
AnomalousBrowser.prototype.refreshNotebooks = refreshNotebooks;
AnomalousBrowser.prototype.saveCurrentNotebook = saveCurrentNotebook;
AnomalousBrowser.prototype.deleteCurrentNotebook = deleteCurrentNotebook;
AnomalousBrowser.prototype.renderNotebookEditor = renderNotebookEditor;
AnomalousBrowser.prototype.fillNotebookGalleries = fillNotebookGalleries;
AnomalousBrowser.prototype.sendNotebookToCanvas = sendNotebookToCanvas;

AnomalousBrowser.prototype.showRecipes = showRecipes;
AnomalousBrowser.prototype.refreshRecipes = refreshRecipes;
AnomalousBrowser.prototype.renderRecipeList = renderRecipeList;
AnomalousBrowser.prototype.handleSaveRecipe = handleSaveRecipe;

AnomalousBrowser.prototype.loadGalleryImages = loadGalleryImages;
AnomalousBrowser.prototype.refreshGalleryImages = refreshGalleryImages;
AnomalousBrowser.prototype.showGeneratedGallery = showGeneratedGallery;
AnomalousBrowser.prototype.showGallerySelectMode = showGallerySelectMode;
AnomalousBrowser.prototype.showGalleryViewer = showGalleryViewer;

AnomalousBrowser.prototype.createDOM = createDOM;
AnomalousBrowser.prototype.openFolderManager = openFolderManager;
AnomalousBrowser.prototype.renderSidebar = renderSidebar;
AnomalousBrowser.prototype.loadFolders = loadFolders;
AnomalousBrowser.prototype.showHelp = showHelp;
AnomalousBrowser.prototype.hideAllPanels = hideAllPanels;

AnomalousBrowser.prototype.loadModels = loadModels;
AnomalousBrowser.prototype.applyModelToCanvas = applyModelToCanvas;
AnomalousBrowser.prototype.stopMediaInContainer = stopMediaInContainer;

AnomalousBrowser.prototype.showDetail = showDetail;
AnomalousBrowser.prototype.showEditModal = showEditModal;
AnomalousBrowser.prototype._openAdvancedModelSelector = _openAdvancedModelSelector;
AnomalousBrowser.prototype.setWidgetValuePath = setWidgetValuePath;

app.registerExtension({
    name: 'Anomalous.ModelBrowser',
    async setup() {
        const cssUrl = '/extensions/Anomalous_Model_Browser/styles.css?v=' + Date.now();
        if (!document.querySelector(`link[href^="/extensions/Anomalous_Model_Browser/styles.css"]`)) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.type = "text/css";
            link.href = cssUrl;
            document.head.appendChild(link);
        }
        if (!localStorage.getItem('anomalous_lang')) {
            try {
                if (app && app.ui && app.ui.settings) {
                    const locale = app.ui.settings.getSettingValue('Comfy.Locale') || app.ui.settings.getSettingValue('Comfy.Locale.Language');
                    if (locale) {
                        currentLang = normalizeLocale(locale) || defaultLang;
                        window.anomalous_browser_lang = currentLang;
                    }
                }
            } catch (e) { }
        }

        let browser = null;
        const btn = document.createElement('button');
        btn.id = 'anomalous-trigger-btn';
        btn.textContent = '📦';
        btn.setAttribute('aria-label', 'Anomalous Model Browser');

        const ensureBrowser = () => {
            if (browser) return browser;
            try {
                browser = new AnomalousBrowser();
                browser.triggerButton = btn;
                window.anomalousBrowserInstance = browser;
                btn.classList.remove('anomalous-trigger-error');
                return browser;
            } catch (error) {
                console.error('[Anomalous Model Browser] UI initialization failed:', error);
                btn.classList.add('anomalous-trigger-error');
                btn.title = currentLang === 'zh' ? t('mainRetryInit') : t('mainRetryInitEn');
                btn.setAttribute('aria-label', btn.title);
                return null;
            }
        };
        btn.title = t('mainOpenTitle');
        let isDragging = false;
        let startX, startY, initialX, initialY;

        btn.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = btn.getBoundingClientRect();
            initialX = rect.left; initialY = rect.top;
            btn.style.transition = 'none';
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            let newX = initialX + (e.clientX - startX);
            let newY = initialY + (e.clientY - startY);
            if (newX < 0) newX = 0;
            if (newY < 0) newY = 0;
            if (newX > window.innerWidth - 60) newX = window.innerWidth - 60;
            if (newY > window.innerHeight - 60) newY = window.innerHeight - 60;
            btn.style.left = newX + 'px';
            btn.style.top = newY + 'px';
            btn.style.right = 'auto'; btn.style.bottom = 'auto';
        });
        window.addEventListener('mouseup', (e) => {
            if (isDragging) {
                isDragging = false;
                btn.style.transition = 'transform 0.15s, box-shadow 0.15s';
                localStorage.setItem('anomalous_btn_x', btn.style.left);
                localStorage.setItem('anomalous_btn_y', btn.style.top);
                if (Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5) {
                    ensureBrowser()?.show();
                }
            }
        });

        const savedX = localStorage.getItem('anomalous_btn_x');
        const savedY = localStorage.getItem('anomalous_btn_y');

        const updateBtnBounds = () => {
            let numX = parseInt(btn.style.left || savedX);
            let numY = parseInt(btn.style.top || savedY);
            if (isNaN(numX)) numX = window.innerWidth - 90;
            if (isNaN(numY)) numY = window.innerHeight - 90;

            if (numX < 0) numX = 0;
            if (numY < 0) numY = 0;
            if (numX > window.innerWidth - 60) numX = window.innerWidth - 60;
            if (numY > window.innerHeight - 60) numY = window.innerHeight - 60;
            btn.style.left = numX + 'px';
            btn.style.top = numY + 'px';
        };

        if (savedX && savedY && savedX !== 'NaN' && savedY !== 'NaN') {
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
            btn.style.left = savedX;
            btn.style.top = savedY;
        }

        // Always trigger an update slightly after load to ensure it's in bounds
        setTimeout(updateBtnBounds, 200);

        window.addEventListener('resize', () => {
            if (btn.style.left) updateBtnBounds();
        });

        document.body.appendChild(btn);
        // Keep the entry point visible even when a panel regression prevents
        // the full browser UI from being constructed.
        ensureBrowser();

        // Pre-create a lightweight, translucent, and aesthetic drag ghost image for huge Hires Fix images
        window.anomalousDragGhostImg = new Image();
        window.anomalousDragGhostImg.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='76' height='76' x='2' y='2' fill='%231a1a1a' fill-opacity='0.6' rx='16' stroke='%2300ffcc' stroke-width='2'/><text x='40' y='50' font-family='sans-serif' font-size='32' font-weight='bold' fill='%2300ffcc' text-anchor='middle'>W</text></svg>";
    }
});


// --- INJECTED WORKFLOW SHARE MODULE ---
// Workflow Share and Preview Modal for Anomalous_Model_Browser

const AMB_WorkflowShare = {
    // ----------------------------------------------------------------------
    // 1. Data Compression & Base64 Utils
    // ----------------------------------------------------------------------
    strToU8(str) {
        return new TextEncoder().encode(str);
    },
    u8ToStr(u8) {
        return new TextDecoder().decode(u8);
    },
    u8ToBase64(u8) {
        let binary = '';
        const len = u8.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(u8[i]);
        }
        return window.btoa(binary);
    },
    base64ToU8(b64) {
        const binary = window.atob(b64);
        const len = binary.length;
        const u8 = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            u8[i] = binary.charCodeAt(i);
        }
        return u8;
    },
    async compress(str) {
        const stream = new Blob([this.strToU8(str)]).stream();
        const compressedStream = stream.pipeThrough(new CompressionStream('deflate-raw'));
        const response = new Response(compressedStream);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        return new Uint8Array(buffer);
    },
    async decompress(u8) {
        const stream = new Blob([u8]).stream();
        const decompressedStream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
        const response = new Response(decompressedStream);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        return this.u8ToStr(new Uint8Array(buffer));
    },

    // ----------------------------------------------------------------------
    // 2. Skeleton Generation (Strip visual / default data)
    // ----------------------------------------------------------------------
    skeletonize(workflowJson) {
        const wf = JSON.parse(JSON.stringify(workflowJson)); // deep copy
        
        // ComfyUI workflow JSON format has "nodes" array
        if (wf.nodes && Array.isArray(wf.nodes)) {
            wf.nodes.forEach(node => {
                // Delete layout coords and styles
                delete node.pos;
                delete node.size;
                delete node.color;
                delete node.bgcolor;
                delete node.shape;
                delete node.flags;
                // Delete empty properties
                if (node.properties && Object.keys(node.properties).length === 0) {
                    delete node.properties;
                }
            });
        }
        
        // Remove view metadata
        if (wf.extra) {
            delete wf.extra.ds; // scale/offset
        }
        
        return wf;
    },

    // ----------------------------------------------------------------------
    // 3. Auto-Layout Algorithm
    // ----------------------------------------------------------------------
    autoLayout(workflowJson) {
        if (!workflowJson.nodes || !Array.isArray(workflowJson.nodes)) return workflowJson;
        
        const nodes = workflowJson.nodes;
        
        // 1. Build adjacency list and in-degrees
        const adj = new Map();
        const inDegree = new Map();
        
        nodes.forEach(n => {
            adj.set(n.id, []);
            if (!inDegree.has(n.id)) inDegree.set(n.id, 0);
        });
        
        // Check links
        if (workflowJson.links) {
            workflowJson.links.forEach(link => {
                if (!link) return;
                const fromId = link[1];
                const toId = link[3];
                if (adj.has(fromId) && adj.has(toId)) {
                    adj.get(fromId).push(toId);
                    inDegree.set(toId, inDegree.get(toId) + 1);
                }
            });
        }
        
        // 2. Topological sort with depth levels
        const depthMap = new Map(); // id -> depth
        const queue = [];
        
        nodes.forEach(n => {
            if (inDegree.get(n.id) === 0) {
                queue.push(n.id);
                depthMap.set(n.id, 0);
            }
        });
        
        while (queue.length > 0) {
            const curr = queue.shift();
            const currDepth = depthMap.get(curr);
            
            const neighbors = adj.get(curr);
            if (neighbors) {
                neighbors.forEach(nxt => {
                    // Reduce in-degree
                    const ind = inDegree.get(nxt) - 1;
                    inDegree.set(nxt, ind);
                    
                    // Update depth to be max(existing depth, currDepth + 1)
                    const existingDepth = depthMap.get(nxt) || 0;
                    depthMap.set(nxt, Math.max(existingDepth, currDepth + 1));
                    
                    if (ind === 0) {
                        queue.push(nxt);
                    }
                });
            }
        }
        
        // Handle cycles (nodes not reached)
        nodes.forEach(n => {
            if (!depthMap.has(n.id)) {
                depthMap.set(n.id, 0);
            }
        });
        
        // 3. Assign X, Y coordinates
        const nodesByDepth = {};
        nodes.forEach(n => {
            const d = depthMap.get(n.id);
            if (!nodesByDepth[d]) nodesByDepth[d] = [];
            nodesByDepth[d].push(n);
        });
        
        // Spacing constants
        const X_SPACING = 400;
        const Y_SPACING = 300;
        
        Object.keys(nodesByDepth).forEach(d => {
            const levelNodes = nodesByDepth[d];
            const depth = parseInt(d);
            levelNodes.forEach((n, idx) => {
                // Approximate size
                n.pos = [
                    depth * X_SPACING,
                    idx * Y_SPACING
                ];
            });
        });
        
        return workflowJson;
    },

    // ----------------------------------------------------------------------
    // 4. Encode / Decode
    // ----------------------------------------------------------------------
    async encodeShareCode(workflowJson, isSkeleton) {
        let targetJson = workflowJson;
        if (isSkeleton) {
            targetJson = this.skeletonize(workflowJson);
        }
        
        const jsonStr = JSON.stringify(targetJson);
        const compressedU8 = await this.compress(jsonStr);
        const base64Str = this.u8ToBase64(compressedU8);
        
        const prefix = isSkeleton ? 'AMB1-' : 'AMB0-';
        return prefix + base64Str;
    },
    
    async decodeShareCode(shareCode) {
        if (!shareCode.startsWith('AMB0-') && !shareCode.startsWith('AMB1-')) {
            throw new Error('Invalid Share Code Format.');
        }
        
        const isSkeleton = shareCode.startsWith('AMB1-');
        const base64Str = shareCode.substring(5);
        
        const compressedU8 = this.base64ToU8(base64Str);
        const jsonStr = await this.decompress(compressedU8);
        
        let workflowJson = JSON.parse(jsonStr);
        
        if (isSkeleton) {
            workflowJson = this.autoLayout(workflowJson);
        }
        
        return workflowJson;
    },
    
    // ----------------------------------------------------------------------
    // 5. UI Modals
    // ----------------------------------------------------------------------
    showToast(message, color) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed; bottom: 30px; right: 30px; background: #2a2a2b; color: ${color || '#fff'};
            padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            font-family: Arial, sans-serif; font-size: 14px; z-index: 9999999;
            opacity: 0; transition: opacity 0.3s ease; border-left: 4px solid ${color || '#fff'};
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.style.opacity = '1', 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    showExportModal() {
        const overlay = document.createElement('div');
        overlay.id = 'amb-export-modal';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            z-index: 999999; display: flex; justify-content: center; align-items: center;
            font-family: Arial, sans-serif;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2b; color: #fff; padding: 30px; border-radius: 12px;
            width: 500px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; gap: 20px;
        `;
        
        const title = document.createElement('h2');
        title.style.margin = '0';
        title.textContent = t('mainExportTitle');
        
        const typeSelectContainer = document.createElement('div');
        typeSelectContainer.innerHTML = `
            <label style="display: block; margin-bottom: 8px; cursor: pointer;">
                <input type="radio" name="amb-share-type" value="skeleton" checked />
                ${t('mainSkeletonOption')}
            </label>
            <label style="display: block; cursor: pointer;">
                <input type="radio" name="amb-share-type" value="full" />
                ${t('mainFullOption')}
            </label>
        `;
        
        const textArea = document.createElement('textarea');
        textArea.style.cssText = `
            width: 100%; height: 150px; background: #1e1e1f; color: #eee;
            border: 1px solid #444; border-radius: 6px; padding: 10px;
            font-family: monospace; font-size: 12px; resize: none; box-sizing: border-box;
        `;
        textArea.readOnly = true;
        
        const btnGroup = document.createElement('div');
        btnGroup.style.cssText = `display: flex; gap: 10px; justify-content: flex-end;`;
        
        const generateBtn = document.createElement('button');
        generateBtn.textContent = t('mainGenerate');
        generateBtn.style.cssText = `padding: 8px 16px; background: #4a90e2; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        const copyBtn = document.createElement('button');
        copyBtn.textContent = t('mainCopyClipboard');
        copyBtn.style.cssText = `padding: 8px 16px; background: #5cb85c; color: #fff; border: none; border-radius: 6px; cursor: pointer; display: none;`;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = t('mainClose');
        closeBtn.style.cssText = `padding: 8px 16px; background: #555; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        closeBtn.onclick = () => overlay.remove();
        
        generateBtn.onclick = async () => {
            const isSkeleton = document.querySelector('input[name="amb-share-type"]:checked').value === 'skeleton';
            
            // Get current workflow from app graph
            const p = await app.graphToPrompt();
            const workflowJson = p.workflow;
            
            try {
                const code = await AMB_WorkflowShare.encodeShareCode(workflowJson, isSkeleton);
                textArea.value = code;
                copyBtn.style.display = 'block';
            } catch (err) {
                textArea.value = 'Error generating code: ' + err.message;
            }
        };
        
        copyBtn.onclick = () => {
            textArea.select();
            document.execCommand('copy');
            AMB_WorkflowShare.showToast(t('mainCopied'), '#5cb85c');
        };
        
        btnGroup.appendChild(generateBtn);
        btnGroup.appendChild(copyBtn);
        btnGroup.appendChild(closeBtn);
        
        content.appendChild(title);
        content.appendChild(typeSelectContainer);
        content.appendChild(textArea);
        content.appendChild(btnGroup);
        overlay.appendChild(content);
        
        document.body.appendChild(overlay);
    },
    
    showImportModal() {
        const overlay = document.createElement('div');
        overlay.id = 'amb-import-modal';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            z-index: 999999; display: flex; justify-content: center; align-items: center;
            font-family: Arial, sans-serif;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2b; color: #fff; padding: 30px; border-radius: 12px;
            width: 600px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; gap: 20px;
        `;
        
        const title = document.createElement('h2');
        title.style.margin = '0';
        title.textContent = t('mainImportTitle');
        
        const inputArea = document.createElement('textarea');
        inputArea.placeholder = t('mainSharePlaceholder');
        inputArea.style.cssText = `
            width: 100%; height: 100px; background: #1e1e1f; color: #eee;
            border: 1px solid #444; border-radius: 6px; padding: 10px;
            font-family: monospace; font-size: 12px; resize: none; box-sizing: border-box;
        `;
        
        const btnGroup = document.createElement('div');
        btnGroup.style.cssText = `display: flex; gap: 10px; justify-content: flex-end;`;
        
        const loadBtn = document.createElement('button');
        loadBtn.textContent = t('mainImportLoad');
        loadBtn.style.cssText = `padding: 8px 16px; background: #e07a5f; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = t('mainCancel');
        closeBtn.style.cssText = `padding: 8px 16px; background: #555; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        closeBtn.onclick = () => overlay.remove();
        
        loadBtn.onclick = async () => {
            const code = inputArea.value.trim();
            if (!code) {
                AMB_WorkflowShare.showToast(t('mainShareEmpty'), '#ff6b6b');
                return;
            }
            try {
                const pendingWorkflow = await AMB_WorkflowShare.decodeShareCode(code);
                app.loadGraphData(pendingWorkflow);
                overlay.remove();
                
                const nodesCount = pendingWorkflow.nodes ? pendingWorkflow.nodes.length : 0;
                AMB_WorkflowShare.showToast(t('mainImportedNodes', { count: nodesCount }), '#5cb85c');
                
                // Auto close the main browser panel
                const mainCloseBtn = document.getElementById('anomalous-close');
                if (mainCloseBtn) mainCloseBtn.click();
            } catch (err) {
                AMB_WorkflowShare.showToast(t('mainDecodeFailed') + err.message, '#ff6b6b');
            }
        };
        
        btnGroup.appendChild(loadBtn);
        btnGroup.appendChild(closeBtn);
        
        content.appendChild(title);
        content.appendChild(inputArea);
        content.appendChild(btnGroup);
        overlay.appendChild(content);
        
        document.body.appendChild(overlay);
    },
    showUnifiedModal() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            z-index: 999999; display: flex; justify-content: center; align-items: center;
            font-family: Arial, sans-serif;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2b; color: #fff; padding: 30px; border-radius: 12px;
            width: 400px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; gap: 20px; text-align: center;
        `;
        
        const title = document.createElement('h2');
        title.style.margin = '0';
        title.textContent = t('mainUnifiedTitle');
        
        const exportBtn = document.createElement('button');
        exportBtn.textContent = t('mainExportWorkflow');
        exportBtn.style.cssText = `padding: 12px; background: #4a90e2; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;`;
        exportBtn.onclick = () => { overlay.remove(); this.showExportModal(); };
        
        const importBtn = document.createElement('button');
        importBtn.textContent = t('mainImportWorkflow');
        importBtn.style.cssText = `padding: 12px; background: #e07a5f; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;`;
        importBtn.onclick = () => { overlay.remove(); this.showImportModal(); };
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = t('mainClose');
        closeBtn.style.cssText = `padding: 8px; background: #555; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; margin-top: 10px;`;
        closeBtn.onclick = () => overlay.remove();
        
        content.appendChild(title);
        content.appendChild(exportBtn);
        content.appendChild(importBtn);
        content.appendChild(closeBtn);
        overlay.appendChild(content);
        
        document.body.appendChild(overlay);
    }
};

window.AMB_WorkflowShare = AMB_WorkflowShare;
