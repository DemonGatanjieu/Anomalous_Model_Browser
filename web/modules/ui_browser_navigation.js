/** Main browser panel visibility and recoverable detail cleanup. */

import { stopAudioStudioPlayback } from './ui_audio_studio.js';
import { stopGalleryAudio } from './ui_audio_gallery.js';
import { leaveScanPage } from './ui_scan_page.js';
import { leavePromptPage } from './ui_prompt_composer.js';

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
        ['ai', owner.aiPanel],
        ['prompt', owner.promptPanel],
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
        const bar = this.recipeView?.querySelector('.anomalous-wf-bar');
        if (bar) bar.style.display = '';
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

// The back buttons of the pages one level down: a model's details, one combo, one recipe.
const BACK_BUTTONS = '.anomalous-detail-back, .anomalous-nb-back, .anomalous-wfd-back, .anomalous-sd-tune-back, .anomalous-ai-back';

/**
 * Esc on the browser: a page one level down (a model's details, one combo or one recipe) goes
 * back as its own back button does; any other page closes the browser. Not while one of this
 * plugin's dialogs, overlays or menus, or a ComfyUI dialog, sits above it (they close
 * themselves; a card inside the browser that does says so with `data-anomalous-escape`), and
 * not while a text field has the key (Esc there belongs to the field). It
 * listens first (capture), so a dialog that closes on this same Esc still counts as above.
 * ComfyUI's own keybindings mark Esc as handled, so `defaultPrevented` says nothing here.
 */
export function bindBrowserEscape(owner) {
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !owner.modal?.classList.contains('visible')) return;
        if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        const layered = [...document.body.children, ...(owner.nbPanel?.children || [])]
            .some(el => el !== owner.modal && el.getClientRects().length
                && (el.getAttribute('role') === 'menu' || [...el.classList].some(c => c.startsWith('anomalous-') && c.endsWith('overlay'))));
        if (layered || document.querySelector('dialog[open], .p-dialog-mask')) return;
        if ([...document.querySelectorAll('[data-anomalous-escape]')].some(el => el.getClientRects().length)) return;
        // Voice-over lets go of its picked lines with this Esc (ui_script_director.js).
        if (owner.modal.querySelector('.anomalous-sd-line-card.is-picked')) return;
        // A model's Outputs window lies over its details inside the browser: Esc closes it, as its ✖ does.
        const outputs = document.getElementById('anomalous-generated-gallery-overlay');
        if (outputs?.getClientRects().length) {
            outputs.style.display = 'none';
            return;
        }
        const back = [...owner.modal.querySelectorAll(BACK_BUTTONS)].find(button => button.getClientRects().length);
        if (back) back.click();
        else owner.close();
    }, true);
}

export function hideAllPanels() {
    const abandonedRecipeModel = typeof this.recipeModelReturn === 'function';
    this.recipeModelReturn = null;
    if (abandonedRecipeModel) {
        this.recipeReturnState = null;
        delete this.recipeDetailPayload;
        if (this.recipeListContainer) this.recipeListContainer.style.display = '';
        const bar = this.recipeView?.querySelector('.anomalous-wf-bar');
        if (bar) bar.style.display = '';
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
    if (this.aiPanel) this.aiPanel.style.display = 'none';
    if (this.promptPanel) this.promptPanel.style.display = 'none';
    leavePromptPage();
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
