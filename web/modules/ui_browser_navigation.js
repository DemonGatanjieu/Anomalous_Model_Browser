/** Main browser panel visibility and recoverable detail cleanup. */

function restoreWorkspaceReturnPanel(owner) {
    const state = owner.workspaceReturnState;
    owner.workspaceReturnState = null;
    const panels = [
        ['grid', owner.grid],
        ['detail', owner.detailPanel],
        ['gallery', owner.galleryPanel],
        ['doctor', owner.doctorPanel],
        ['assistant', owner.assistantPanel],
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
    clearTimeout(this.materialSearchTimer);
    this.materialListController?.abort();
    this.materialListController = null;
    this.materialDetailController?.abort();
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
    if (this.materialView) this.materialView.style.display = 'none';
    if (this.notebookBody) this.notebookBody.style.display = 'none';
    if (this.materialContainer) this.materialContainer.style.display = 'none';
    if (this.recipeContainer) this.recipeContainer.style.display = 'none';
    if (this.nbPanel) this.nbPanel.style.display = 'none';
    restoreWorkspaceReturnPanel(this);
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
    if (this.currentDetailObserver) {
        this.currentDetailObserver.disconnect();
        this.currentDetailObserver = null;
    }
    const tbModal = document.getElementById('anomalous-toolbox-modal');
    if (tbModal) tbModal.style.display = 'none';
    const setModal = document.getElementById('anomalous-settings-hub-modal');
    if (setModal) setModal.style.display = 'none';
}
