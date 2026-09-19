import { showDetail } from './ui_detail.js';
import { showEditModal } from './ui_model_editor.js';
import { _openAdvancedModelSelector, setWidgetValuePath } from './ui_model_selector.js';
import { loadModels, applyModelToCanvas, stopMediaInContainer } from './ui_grid.js';
import { createDOM, renderSidebar, loadFolders } from './ui_sidebar.js';
import { closeWorkspace, hideAllPanels } from './ui_browser_navigation.js';
import { openScanWizard, triggerDirectModelScan } from './ui_scan_wizard.js';
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
import { openPromptTranslator } from './ui_prompt_translator.js';
import { closeUpdateGuide } from './ui_update_guide.js';
import { showImageWorkbench } from './ui_gallery_detail.js';
import { initDoctorPanel, diagnoseNode, renderGlobalDashboard, openLoraInsertionPicker, runGlobalDoctorScan } from './ui_doctor.js';
import { initAssistantPanel, renderAssistantModelCard, _loadAssistantHistory } from './ui_node_assistant.js';
import { _openGalleryReplacer } from './ui_node_model_picker.js';

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
        if (!this.foldersData) {
            this.loadFolders();
        } else {
            this.loadModels();
        }
    }

    close() {
        closeUpdateGuide(this);
        this.modal.classList.remove('visible');
        this.setTriggerVisible(true);
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
        }, 90000);
    }

    setTriggerVisible(visible) {
        const trigger = this.triggerButton || document.getElementById('anomalous-trigger-btn');
        trigger?.classList.toggle('anomalous-trigger-hidden', !visible || this.entryMode !== 'floating');
    }
}

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
AnomalousBrowser.prototype.showMaterials = showMaterials;
AnomalousBrowser.prototype.openSavedMaterial = openSavedMaterial;
AnomalousBrowser.prototype.openMaterialLibrary = openMaterialLibrary;
AnomalousBrowser.prototype.openPromptStudio = openPromptStudio;
AnomalousBrowser.prototype.openPromptTranslator = function() { openPromptTranslator(this); };
AnomalousBrowser.prototype.refreshMaterials = refreshMaterials;

AnomalousBrowser.prototype.loadGalleryImages = loadGalleryImages;
AnomalousBrowser.prototype.refreshGalleryImages = refreshGalleryImages;
AnomalousBrowser.prototype.showGeneratedGallery = showGeneratedGallery;
AnomalousBrowser.prototype.showGallerySelectMode = showGallerySelectMode;
AnomalousBrowser.prototype.showGalleryViewer = showGalleryViewer;
AnomalousBrowser.prototype.showImageWorkbench = showImageWorkbench;

AnomalousBrowser.prototype.createDOM = createDOM;
AnomalousBrowser.prototype.openScanWizard = openScanWizard;
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
