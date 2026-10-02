import { showDetail } from './ui_detail.js';
import { showEditModal } from './ui_model_editor.js';
import { _openAdvancedModelSelector, setWidgetValuePath } from './ui_model_selector.js';
import { loadModels, applyModelToCanvas, stopMediaInContainer } from './ui_grid.js';
import { createDOM, renderSidebar, loadFolders } from './ui_sidebar.js';
import { closeWorkspace, hideAllPanels } from './ui_browser_navigation.js';
import { triggerDirectModelScan } from './scan_runner.js';
import { openScanPage, renderScanPage, leaveScanPage } from './ui_scan_page.js';
import { openFolderManager } from './ui_folder_manager.js';
import { showHelp } from './ui_help.js';
import { loadGalleryImages, refreshGalleryImages, showGeneratedGallery, showGallerySelectMode, showGalleryViewer } from './ui_gallery.js';
import { showNotebooks, refreshNotebooks, saveCurrentNotebook, deleteCurrentNotebook } from './ui_notebooks.js';
import { renderNotebookEditor, fillNotebookGalleries } from './ui_notebook_editor.js';
import { sendNotebookToCanvas } from './notebook_canvas.js';
import { showRecipes, refreshRecipes } from './ui_recipe_catalog.js';
import { renderRecipeList, handleSaveRecipe } from './ui_recipes.js';
import { showMaterials, refreshMaterials, openSavedMaterial, openMaterialLibrary } from './ui_materials.js';
import { openPromptStudio } from './ui_prompt_composer.js';
import { closeUpdateGuide } from './ui_update_guide.js';
import { showImageWorkbench } from './ui_gallery_detail.js';
import { openDoctorPage } from './ui_doctor.js';
import { showModelSources } from './ui_model_sources.js';
import { initAssistantPanel, renderAssistantModelCard, _loadAssistantHistory, diagnoseNode, openCurrentNode, openLoraInsertionPicker } from './ui_node_assistant.js';
import { _openGalleryReplacer } from './ui_node_model_picker.js';
import { renderAudioStudio, stopAudioStudioPlayback } from './ui_audio_studio.js';
import { renderAudioGallery, stopGalleryAudio } from './ui_audio_gallery.js';
import { renderScriptPage } from './ui_script_page.js';
import { getActiveAudioFilter, setActiveAudioFilter, syncAudioSidebarSelection } from './ui_audio_sidebar.js';
import { voiceGroupKey } from './audio_engines.js';
import { getActiveDomain } from './ui_domain_switcher.js';
import { startPage } from './ui_shell_nav.js';

export class AnomalousBrowser {
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
        this.entryMode = 'floating';
        this.createDOM();
    }

    show() {
        if (this._idleReleaseTimer) {
            clearTimeout(this._idleReleaseTimer);
            this._idleReleaseTimer = null;
        }
        this.setTriggerVisible(false);
        this.modal.classList.add('visible');
        if (!this.currentShellPage()) {
            this.goTo(startPage());
            return;
        }
        // Opened again: stay on the page, refresh what may have changed meanwhile.
        if (getActiveDomain() === 'audio') {
            const audioTabs = { 'audio-gallery': 'gallery', script: 'script' };
            this.switchAudioTab(audioTabs[this.currentShellPage()] || 'presets');
        } else if (!this.foldersData) {
            this.loadFolders();
        } else {
            this.loadModels();
        }
        if (this.currentShellPage() === 'gallery') void this.refreshGalleryImages();
        if (this.currentShellPage() === 'scan') void renderScanPage(this, this.scanPanel);
    }

    /** The image / audio switch: the first page of that side. */
    handleDomainChange(domain) {
        this.goTo(domain === 'audio' ? 'voices' : 'models');
    }

    /** Single entry for audio-domain navigation: the rail, the audio list's entries and the domain switch. */
    switchAudioTab(tabName, filter = null) {
        this.hideAllPanels();
        if (tabName === 'gallery') {
            setActiveAudioFilter({ type: 'gallery', value: null });
            this.markShellPage?.('audio-gallery');
            this.audioGalleryPanel.style.display = 'block';
            renderAudioGallery(this.audioGalleryPanel);
        } else if (tabName === 'script') {
            this.markShellPage?.('script');
            this.scriptPanel.style.display = 'flex';
            const character = this.pendingScriptCharacter;
            this.pendingScriptCharacter = null;
            renderScriptPage(this.scriptPanel, this, { character });
        } else {
            if (filter) setActiveAudioFilter(filter);
            else if (getActiveAudioFilter().type === 'gallery') setActiveAudioFilter(null);
            this.markShellPage?.('voices');
            this.audioStudioPanel.style.display = 'block';
            renderAudioStudio(this.audioStudioPanel, { owner: this });
        }
        syncAudioSidebarSelection(this);
    }

    /** One character's voice card: the Anomalous_TTS node's "import or edit characters". */
    openVoice(character) {
        const filter = character ? { type: 'group', value: voiceGroupKey(character), character } : null;
        if (this.currentShellPage() === 'voices') {
            this.switchAudioTab('presets', filter);
            return;
        }
        if (filter) setActiveAudioFilter(filter);
        this.goTo('voices'); // keeps the filter just set
    }

    /** The Voice-over page, with `group` (a voice group key) chosen when given: a character card's button. */
    openScript(group = null) {
        this.pendingScriptCharacter = group;
        if (this.currentShellPage() === 'script') this.switchAudioTab('script');
        else this.goTo('script');
    }

    close() {
        this.flushCanvasActivity?.();
        closeUpdateGuide(this);
        leaveScanPage(); // a running scan's progress floats over the canvas
        this.modal.classList.remove('visible');
        this.setTriggerVisible(true);
        stopAudioStudioPlayback();
        stopGalleryAudio();
        const canvas = document.getElementById('graph-canvas');
        if (canvas instanceof HTMLElement) canvas.focus({ preventScroll: true });
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
            // The output gallery reloads its first page when opened again.
            this.galleryGrid.querySelectorAll('.anomalous-gallery-card').forEach(card => card.remove());
            this.galleryImagesList = [];
        }, 90000);
    }

    setTriggerVisible(visible) {
        const trigger = this.triggerButton || document.getElementById('anomalous-trigger-btn');
        trigger?.classList.toggle('anomalous-trigger-hidden', !visible || this.entryMode !== 'floating');
    }
}

AnomalousBrowser.prototype.openDoctorPage = function () { openDoctorPage(this); };
AnomalousBrowser.prototype.showModelSources = function (scope) { showModelSources(this, scope); };
AnomalousBrowser.prototype.diagnoseNode = diagnoseNode;
AnomalousBrowser.prototype.openCurrentNode = function () { openCurrentNode(this); };
AnomalousBrowser.prototype.initAssistantPanel = initAssistantPanel;
AnomalousBrowser.prototype.renderAssistantModelCard = renderAssistantModelCard;
AnomalousBrowser.prototype._loadAssistantHistory = _loadAssistantHistory;
AnomalousBrowser.prototype._openGalleryReplacer = _openGalleryReplacer;
AnomalousBrowser.prototype.openLoraInsertionPicker = openLoraInsertionPicker;

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
AnomalousBrowser.prototype.showMaterials = showMaterials;
AnomalousBrowser.prototype.openSavedMaterial = openSavedMaterial;
AnomalousBrowser.prototype.openMaterialLibrary = openMaterialLibrary;
AnomalousBrowser.prototype.openPromptStudio = openPromptStudio;
AnomalousBrowser.prototype.refreshMaterials = refreshMaterials;

AnomalousBrowser.prototype.loadGalleryImages = loadGalleryImages;
AnomalousBrowser.prototype.refreshGalleryImages = refreshGalleryImages;
AnomalousBrowser.prototype.showGeneratedGallery = showGeneratedGallery;
AnomalousBrowser.prototype.showGallerySelectMode = showGallerySelectMode;
AnomalousBrowser.prototype.showGalleryViewer = showGalleryViewer;
AnomalousBrowser.prototype.showImageWorkbench = showImageWorkbench;

AnomalousBrowser.prototype.createDOM = createDOM;
AnomalousBrowser.prototype.openScanPage = function (view) { openScanPage(this, view); };
AnomalousBrowser.prototype.scanSingleModel = triggerDirectModelScan;
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
