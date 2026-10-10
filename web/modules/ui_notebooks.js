/**
 * The Combos page (搭配) as a workspace over the current page: the list of combos
 * (ui_combos.js), or one combo in its editor (ui_notebook_editor.js) with Back to the list;
 * saving and deleting a combo (the files under workflows/anomalous_notebooks, which the
 * code still calls notebooks: combos were Prompt Notes before).
 */

import { translate } from './locales.js';
import { renderComboList } from './ui_combos.js';
import { listCombos } from './image_keep.js';

const t = (key, params) => translate(key, params);

function buildComboWorkspace(owner) {
    const container = document.createElement('div');
    container.className = 'anomalous-nb-container';
    const header = document.createElement('div');
    header.className = 'anomalous-nb-header';
    const headerMain = document.createElement('div');
    headerMain.className = 'anomalous-nb-header-main';
    owner.comboBack = document.createElement('button');
    owner.comboBack.type = 'button';
    owner.comboBack.className = 'anomalous-btn-ghost anomalous-nb-back';
    owner.comboBack.onclick = () => owner.showNotebooks();
    owner.comboHeading = document.createElement('h2');
    headerMain.append(owner.comboBack, owner.comboHeading);
    const close = document.createElement('span');
    close.className = 'anomalous-nb-close';
    close.innerHTML = '&times;';
    close.onclick = () => owner.closeWorkspace();
    header.append(headerMain, close);

    const body = document.createElement('div');
    body.className = 'anomalous-nb-body';
    owner.comboList = document.createElement('div');
    owner.comboList.className = 'anomalous-combo-page';
    owner.nbEditor = document.createElement('div');
    owner.nbEditor.className = 'anomalous-nb-editor';
    body.append(owner.comboList, owner.nbEditor);
    container.append(header, body);
    owner.nbPanel.appendChild(container);
    owner.notebookContainer = container;
    owner.notebookBody = body;
}

/**
 * Opens the Combos workspace on its list, or with `editor` on `this.currentNotebook` in the
 * editor.
 */
export async function showNotebooks({ editor = false } = {}) {
    this.recipeDetailFinish?.('closed');
    this.modal?.classList.add('visible');
    if (this.nbPanel && this.nbPanel.style.display !== 'flex' && !this.workspaceReturnState) {
        this.workspaceReturnState = Object.fromEntries([
            ['grid', this.grid], ['detail', this.detailPanel], ['gallery', this.galleryPanel],
            ['doctor', this.doctorPanel], ['assistant', this.assistantPanel], ['home', this.homePanel], ['activity', this.activityPanel],
            ['scan', this.scanPanel],
        ].filter(([, panel]) => panel).map(([key, panel]) => [key, panel.style.display]));
    }
    for (const panel of [this.grid, this.detailPanel, this.galleryPanel, this.doctorPanel, this.assistantPanel, this.homePanel, this.activityPanel, this.scanPanel, this.paramPanel]) {
        if (panel) panel.style.display = 'none';
    }
    if (this.recipeContainer) this.recipeContainer.style.display = 'none';
    if (!this.notebookContainer) buildComboWorkspace(this);
    this.nbPanel.style.display = 'flex';
    this.notebookContainer.style.display = 'flex';
    this.notebookBody.style.display = 'flex';
    this.markWorkspace?.('combos');

    const editing = editor && Boolean(this.currentNotebook);
    this.comboHeading.textContent = t('shellCombos');
    this.comboBack.textContent = t('comboBack');
    this.comboBack.hidden = !editing;
    this.comboList.hidden = editing;
    this.nbEditor.hidden = !editing;
    if (editing) {
        this.renderNotebookEditor();
        return;
    }
    this.currentNotebook = null;
    await renderComboList(this, this.comboList);
}

/** Opens `note` in the editor. */
export function openCombo(note) {
    this.currentNotebook = note;
    return this.showNotebooks({ editor: true });
}

/** Opens the combo saved as `filename` (from a toast after keeping an image as a combo). */
export async function openComboByFilename(filename) {
    this.show?.();
    const note = (await listCombos()).find(item => item.filename === filename);
    if (note) await this.openCombo(note);
    else await this.showNotebooks();
}

/** Draws the list again when it is the view on screen (after a save). */
export async function refreshNotebooks() {
    if (this.comboList && !this.comboList.hidden && this.nbPanel?.style.display === 'flex') {
        await renderComboList(this, this.comboList);
    }
}

export async function saveCurrentNotebook() {
    if (!this.currentNotebook) return false;
    const body = JSON.stringify(this.currentNotebook);
    this.notebookSaveQueue = (this.notebookSaveQueue || Promise.resolve()).then(async () => {
        try {
            const response = await fetch('/anomalous/save_notebook', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
            });
            const result = await response.json();
            if (!response.ok || result.status !== 'success') throw new Error('notebook save failed');
            this.nbSaveStatus?.remove();
            this.nbSaveStatus = null;
            await this.refreshNotebooks();
            return true;
        } catch (error) {
            if (this.nbEditor && !this.nbEditor.hidden && !this.nbSaveStatus?.isConnected) {
                this.nbSaveStatus = document.createElement('p');
                this.nbSaveStatus.setAttribute('role', 'alert');
                this.nbEditor.prepend(this.nbSaveStatus);
            }
            if (this.nbSaveStatus) this.nbSaveStatus.textContent = t('notebookSaveError');
            return false;
        }
    });
    return this.notebookSaveQueue;
}

/** Deletes the open combo (its file goes to the Recycle Bin) and goes back to the list. */
export async function deleteCurrentNotebook() {
    if (!this.currentNotebook) return;
    try {
        await this.notebookSaveQueue;
        const response = await fetch('/anomalous/delete_notebook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: this.currentNotebook.filename }),
        });
        if (!response.ok || (await response.json()).status !== 'success') throw new Error('notebook delete failed');
        await this.showNotebooks();
    } catch (e) {
        console.error('[AMB] Error deleting combo:', e);
    }
}
