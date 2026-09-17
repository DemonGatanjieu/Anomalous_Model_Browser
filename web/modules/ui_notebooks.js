/**
 * ui_notebooks.js
 * Extracted Notebooks methods.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';
import { escapeHtml } from './safe_dom.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { showMaterialSaved } from './material_feedback.js';

const t = (key, params) => translate(key, params);

export async function showNotebooks() {
        this.recipeDetailFinish?.('closed');
        this.modal?.classList.add('visible');
        if (typeof this.setActiveHeaderTab === 'function') this.setActiveHeaderTab(null);
        if (this.nbPanel && this.nbPanel.style.display !== 'flex' && !this.workspaceReturnState) {
            this.workspaceReturnState = Object.fromEntries([
                ['grid', this.grid], ['detail', this.detailPanel], ['gallery', this.galleryPanel],
                ['doctor', this.doctorPanel], ['assistant', this.assistantPanel],
            ].filter(([, panel]) => panel).map(([key, panel]) => [key, panel.style.display]));
        }
        for (const panel of [this.grid, this.detailPanel, this.galleryPanel, this.doctorPanel, this.assistantPanel, this.paramPanel]) {
            if (panel) panel.style.display = 'none';
        }
        if (this.materialContainer) this.materialContainer.style.display = 'none';
        if (this.recipeContainer) this.recipeContainer.style.display = 'none';
        if (this.notebookContainer) this.notebookContainer.style.display = 'flex';
        if (this.nbPanel) this.nbPanel.style.display = 'flex';
        if (this.nbInitialized) {
            this.nbPanel.style.display = 'flex';
            if (this.notebookBody) this.notebookBody.style.display = 'flex';
            if (this.recipeView) this.recipeView.style.display = 'none';
            if (this.materialView) this.materialView.style.display = 'none';
            this.notebookNotesTab?.classList.add('active');
            this.notebookRecipesTab?.classList.remove('active');
            this.refreshNotebooks(true);
            return;
        }
        this.nbInitialized = true;

        const nbContainer = document.createElement('div');
        nbContainer.className = 'anomalous-nb-container';

        const nbHeader = document.createElement('div');
        nbHeader.className = 'anomalous-nb-header';
        const headerMain = document.createElement('div');
        headerMain.className = 'anomalous-nb-header-main';
        const heading = document.createElement('h2');
        heading.textContent = t('promptNotes') || (window.anomalous_browser_lang === 'zh' ? '提示词笔记' : 'Prompt Notes');
        headerMain.append(heading);
        nbHeader.appendChild(headerMain);
        const closeNb = document.createElement('span');
        closeNb.className = 'anomalous-nb-close';
        closeNb.innerHTML = '&times;';
        closeNb.onclick = () => this.closeWorkspace();
        nbHeader.appendChild(closeNb);

        const body = document.createElement('div');
        body.className = 'anomalous-nb-body';
        this.notebookBody = body;
        this.notebookContainer = nbContainer;

        // Sidebar for notebooks list
        const sidebar = document.createElement('div');
        sidebar.className = 'anomalous-nb-sidebar';

        const nbList = document.createElement('div');
        nbList.className = 'anomalous-nb-list';

        const btnRow = document.createElement('div');
        btnRow.className = 'anomalous-nb-create-row';
        btnRow.style.padding = '10px';
        btnRow.style.display = 'flex';
        btnRow.style.gap = '5px';

        const createBtn = document.createElement('button');
        const createBtnHtml = `<svg style="width:13px;height:13px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span class="anomalous-nb-create-text">${t('createNotebook')}</span>`;
        createBtn.innerHTML = createBtnHtml;
        createBtn.className = 'anomalous-btn-primary';

        const createInput = document.createElement('input');
        createInput.className = 'anomalous-nb-create-input';
        createInput.type = 'text';
        createInput.placeholder = t('newNotebookName');
        createInput.style.display = 'none';
        createInput.style.flex = '1';
        createInput.style.padding = '4px';
        createInput.style.background = '#222';
        createInput.style.color = '#fff';
        createInput.style.border = '1px solid #555';
        createInput.style.borderRadius = '4px';

        createBtn.onclick = () => {
            if (createInput.style.display === 'none') {
                createInput.style.display = 'block';
                createBtn.innerHTML = '✓';
                createInput.focus();
            } else {
                const name = createInput.value.trim();
                if (name) {
                    this.currentNotebook = { filename: name + '.json', name: name, data: { baseModel: '', mainModel: null, loras: [], promptEn: '', promptZh: '' } };
                    this.saveCurrentNotebook();
                    this.renderNotebookEditor();
                    createInput.value = '';
                }
                createInput.style.display = 'none';
                createBtn.innerHTML = createBtnHtml;
            }
        };

        btnRow.appendChild(createInput);
        btnRow.appendChild(createBtn);
        sidebar.appendChild(btnRow);
        sidebar.appendChild(nbList);

        // Editor area
        this.nbEditor = document.createElement('div');
        this.nbEditor.className = 'anomalous-nb-editor';

        body.appendChild(sidebar);
        body.appendChild(this.nbEditor);

        nbContainer.appendChild(nbHeader);
        nbContainer.appendChild(body);

        this.nbPanel.appendChild(nbContainer);

        this.nbListEl = nbList;
        this.refreshNotebooks(true);
    }



export async function refreshNotebooks(autoOpenFirst = false) {
        try {
            const res = await fetch('/anomalous/notebooks');
            const data = await res.json();
            this.nbListEl.innerHTML = '';

            if (data.notebooks && data.notebooks.length > 0) {
                if (autoOpenFirst) {
                    if (!this.currentNotebook) {
                        this.currentNotebook = data.notebooks[0];
                    }
                    if (this.currentNotebook) {
                        this.renderNotebookEditor();
                    }
                }

                data.notebooks.forEach(nb => {
                    const item = document.createElement('div');
                    item.className = 'anomalous-nb-item';
                    if (this.currentNotebook && this.currentNotebook.filename === nb.filename) {
                        item.classList.add('active');
                    }
                    item.innerHTML = `<span class="anomalous-nb-item-icon"><svg style="width:13px;height:13px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span><span class="anomalous-nb-item-text">${escapeHtml(nb.name)}</span>`;
                    item.onclick = () => {
                        this.currentNotebook = nb;
                        this.renderNotebookEditor();
                        this.refreshNotebooks();
                    };
                    this.nbListEl.appendChild(item);
                });
            } else if (this.nbEditor && (!this.currentNotebook || !data.notebooks?.length)) {
                this.nbEditor.innerHTML = `
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#94a3b8; text-align:center; gap:14px; padding:40px;">
                        <span style="font-size:3.2rem;">📝</span>
                        <h3 style="margin:0; color:#f1f5f9; font-size:1.1rem;">${t('promptNotes') || '提示词笔记'}</h3>
                        <p style="margin:0; font-size:0.88rem; max-width:320px; line-height:1.5;">${window.anomalous_browser_lang === 'zh' ? '暂无笔记。点击左侧「+」按钮即可创建新的提示词笔记，支持模型绑定与提示词整理。' : 'No notebooks found. Click "+" on the left sidebar to create your first prompt note.'}</p>
                    </div>
                `;
            }
        } catch (e) {
            console.error('[AMB] Error refreshing notebooks:', e);
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
            if (this.nbEditor && !this.nbSaveStatus?.isConnected) {
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


export async function deleteCurrentNotebook(skipConfirm = false) {
        if (!this.currentNotebook) return;
        if (!skipConfirm && !confirm(t('deleteNotebook') + ' ?')) return;
        try {
            await this.notebookSaveQueue;
            const response = await fetch('/anomalous/delete_notebook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: this.currentNotebook.filename })
            });
            if (!response.ok || (await response.json()).status !== 'success') throw new Error('notebook delete failed');
            this.currentNotebook = null;
            this.nbEditor.innerHTML = '';
            this.refreshNotebooks();
        } catch (e) { }
    }
