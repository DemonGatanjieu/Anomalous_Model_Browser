/** Main browser panel visibility and recoverable detail cleanup. */

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
