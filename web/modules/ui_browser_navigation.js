/** Main browser panel visibility and recoverable detail cleanup. */

import { stopAudioStudioPlayback } from './ui_audio_studio.js';
import { stopGalleryAudio } from './ui_audio_gallery.js';
import { leaveScanPage } from './ui_scan_page.js';

function restoreWorkspaceReturnPanel(owner) {
    const state = owner.workspaceReturnState;
    owner.workspaceReturnState = null;
    const panels = [
        ['grid', owner.grid],
        ['detail', owner.detailPanel],
        ['gallery', owner.galleryPanel],
        ['doctor', owner.doctorPanel],
        ['assistant', owner.assistantPanel],
        ['audioStudio', owner.audioStudioPanel],
        ['script', owner.scriptPanel],
        ['audioGallery', owner.audioGalleryPanel],
        ['home', owner.homePanel],
        ['activity', owner.activityPanel],
        ['scan', owner.scanPanel],
        ['settings', owner.settingsPanel],
    ];
    if (state) {
        for (const [key, panel] of panels) {
            if (panel && Object.prototype.hasOwnProperty.call(state, key)) panel.style.display = state[key];
        }
    }
    const hasVisiblePanel = panels.some(([, panel]) => panel && panel.style.display !== 'none');
    if (!hasVisiblePanel && owner.grid) owner.grid.style.display = 'grid';
}

export function closeWorkspace() {
    this.recipeDetailFinish?.('closed');
    const abandonedRecipeModel = typeof this.recipeModelReturn === 'function';
    this.recipeModelReturn = null;
    if (abandonedRecipeModel) {
        this.recipeReturnState = null;
        delete this.recipeDetailPayload;
        if (this.recipeListContainer) this.recipeListContainer.style.display = '';
        const actionbar = this.recipeView?.querySelector('.anomalous-recipe-actionbar');
        if (actionbar) actionbar.style.display = '';
        if (this.detailPanel) {
            this.stopMediaInContainer?.(this.detailPanel);
            this.detailPanel.replaceChildren();
            this.detailPanel.style.display = 'none';
        }
        this.currentDetailModel = null;
        this.historyStack = [];
    }
    if (this.paramPanel) this.paramPanel.style.display = 'none';
    if (this.recipeView) this.recipeView.style.display = 'none';
    if (this.notebookBody) this.notebookBody.style.display = 'none';
    if (this.recipeContainer) this.recipeContainer.style.display = 'none';
    if (this.nbPanel) this.nbPanel.style.display = 'none';
    restoreWorkspaceReturnPanel(this);
}

/**
 * Esc on the recipe / combo workspace does what a click beside it does:
 * `closeWorkspace()`. Not while one of this plugin's dialogs or a ComfyUI dialog sits
 * above it, and not while a text field has the key (Esc there belongs to the field).
 * ComfyUI's own keybindings mark Esc as handled, so `defaultPrevented` says nothing here.
 */
export function bindWorkspaceEscape(owner) {
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!owner.modal?.classList.contains('visible') || owner.nbPanel?.style.display !== 'flex') return;
        if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        const layered = [...document.body.children, ...owner.nbPanel.children]
            .some(el => [...el.classList].some(c => c.startsWith('anomalous-') && c.endsWith('overlay')) && el.getClientRects().length);
        if (layered || document.querySelector('dialog[open], .p-dialog-mask')) return;
        owner.closeWorkspace();
    });
}

export function hideAllPanels() {
    const abandonedRecipeModel = typeof this.recipeModelReturn === 'function';
    this.recipeModelReturn = null;
    if (abandonedRecipeModel) {
        this.recipeReturnState = null;
        delete this.recipeDetailPayload;
        if (this.recipeListContainer) this.recipeListContainer.style.display = '';
        const actionbar = this.recipeView?.querySelector('.anomalous-recipe-actionbar');
        if (actionbar) actionbar.style.display = '';
        if (this.detailPanel) {
            this.stopMediaInContainer?.(this.detailPanel);
            this.detailPanel.replaceChildren();
        }
        this.currentDetailModel = null;
        this.historyStack = [];
    }
    this.grid.style.display = 'none';
    this.detailPanel.style.display = 'none';
    if (this.galleryPanel) this.galleryPanel.style.display = 'none';
    if (this.nbPanel) this.nbPanel.style.display = 'none';
    if (this.doctorPanel) this.doctorPanel.style.display = 'none';
    if (this.assistantPanel) this.assistantPanel.style.display = 'none';
    if (this.paramPanel) this.paramPanel.style.display = 'none';
    if (this.audioStudioPanel) this.audioStudioPanel.style.display = 'none';
    if (this.scriptPanel) this.scriptPanel.style.display = 'none';
    if (this.audioGalleryPanel) this.audioGalleryPanel.style.display = 'none';
    if (this.homePanel) this.homePanel.style.display = 'none';
    if (this.activityPanel) this.activityPanel.style.display = 'none';
    if (this.scanPanel) this.scanPanel.style.display = 'none';
    if (this.settingsPanel) this.settingsPanel.style.display = 'none';
    document.getElementById('anomalous-global-settings-btn')?.classList.remove('is-active');
    leaveScanPage();
    stopAudioStudioPlayback();
    stopGalleryAudio();
    if (this.currentDetailObserver) {
        this.currentDetailObserver.disconnect();
        this.currentDetailObserver = null;
    }
}
