/**
 * ui_notebooks.js
 * Extracted Notebooks methods: modal layout, sidebar quick jump, and persistence.
 */

import { translate } from './locales.js';
import { escapeHtml } from './safe_dom.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { showMaterialSaved } from './material_feedback.js';

const t = (key, params) => translate(key, params);

/**
 * Build sidebar containing notebook list and floor anchor navigation.
 */
function createNotebookSidebar(ctx) {
    const sidebar = document.createElement('div');
    sidebar.className = 'anomalous-nb-sidebar';

    // Notes Group (Top)
    const notesGroup = document.createElement('div');
    notesGroup.className = 'anomalous-nb-sidebar-group anomalous-nb-sidebar-notes-group';

    const btnRow = document.createElement('div');
    btnRow.className = 'anomalous-nb-create-row';
    btnRow.style.padding = '10px';
    btnRow.style.display = 'flex';
    btnRow.style.gap = '5px';

    const createBtn = document.createElement('button');
    const createBtnHtml = `<svg style="width:13px;height:13px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span class="anomalous-nb-create-text">${t('createNotebook') || (window.anomalous_browser_lang === 'zh' ? '新建笔记' : 'New Note')}</span>`;
    createBtn.innerHTML = createBtnHtml;
    createBtn.className = 'anomalous-btn-primary';

    const createInput = document.createElement('input');
    createInput.className = 'anomalous-nb-create-input';
    createInput.type = 'text';
    createInput.placeholder = t('newNotebookName') || (window.anomalous_browser_lang === 'zh' ? '新笔记名称...' : 'New note name...');
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
                ctx.currentNotebook = {
                    filename: name + '.json',
                    name: name,
                    data: { baseModel: '', mainModel: null, loras: [], promptEn: '', promptZh: '' }
                };
                ctx.saveCurrentNotebook();
                ctx.renderNotebookEditor();
                createInput.value = '';
            }
            createInput.style.display = 'none';
            createBtn.innerHTML = createBtnHtml;
        }
    };

    btnRow.append(createInput, createBtn);

    const nbList = document.createElement('div');
    nbList.className = 'anomalous-nb-list';
    notesGroup.append(btnRow, nbList);
    ctx.nbListEl = nbList;

    // Quick Jump Floor Navigation (Bottom)
    const navGroup = document.createElement('div');
    navGroup.className = 'anomalous-nb-sidebar-group anomalous-nb-sidebar-nav-group';

    const navHeader = document.createElement('div');
    navHeader.className = 'anomalous-nb-nav-header';
    navHeader.textContent = `🧭 ${t('nbNavHeading') || (window.anomalous_browser_lang === 'zh' ? '快速直达' : 'Quick Jump')}`;

    const navList = document.createElement('div');
    navList.className = 'anomalous-nb-nav-list';

    const navSections = [
        { id: '#amb-nb-sec-models', icon: '📦', key: 'nbNavModels', zh: '配套模型', en: 'Companion Models' },
        { id: '#amb-nb-sec-prompt', icon: '✍️', key: 'nbNavPrompt', zh: '提示词编辑', en: 'Prompt Editor' },
        { id: '#amb-nb-sec-tools', icon: '🔍', key: 'nbNavTools', zh: '查找替换', en: 'Find & Replace' },
        { id: '#amb-nb-sec-archive', icon: '💾', key: 'nbNavArchive', zh: '素材归档', en: 'Save to Library' },
    ];

    navSections.forEach(sec => {
        const navItem = document.createElement('button');
        navItem.type = 'button';
        navItem.className = 'anomalous-nb-nav-item';
        navItem.dataset.targetId = sec.id;
        const labelText = t(sec.key) || (window.anomalous_browser_lang === 'zh' ? sec.zh : sec.en);
        navItem.title = `${sec.icon} ${labelText}`;
        navItem.setAttribute('aria-label', labelText);
        navItem.innerHTML = `<span class="anomalous-nb-nav-icon">${sec.icon}</span><span class="anomalous-nb-nav-text">${labelText}</span>`;
        navItem.onclick = () => {
            const target = ctx.nbEditor?.querySelector(sec.id);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        };
        navList.appendChild(navItem);
    });

    navGroup.append(navHeader, navList);
    sidebar.append(notesGroup, navGroup);

    // Setup scrollspy listener
    setupNotebookScrollSpy(ctx, navList, navSections);
    return sidebar;
}

/**
 * Setup scrollspy on the editor area to highlight current anchor in sidebar.
 */
function setupNotebookScrollSpy(ctx, navList, navSections) {
    let isSpying = false;
    if (!ctx.nbEditor) return;

    ctx.nbEditor.addEventListener('scroll', () => {
        if (isSpying) return;
        isSpying = true;
        requestAnimationFrame(() => {
            isSpying = false;
            if (!ctx.nbEditor) return;
            const editorRect = ctx.nbEditor.getBoundingClientRect();
            let currentSec = null;
            navSections.forEach(sec => {
                const el = ctx.nbEditor.querySelector(sec.id);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    if (rect.top <= editorRect.top + 160) {
                        currentSec = sec.id;
                    }
                }
            });
            navList.querySelectorAll('.anomalous-nb-nav-item').forEach(btn => {
                if (btn.dataset.targetId === currentSec) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        });
    }, { passive: true });
}

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

    // Editor area created first so scrollspy can attach safely
    this.nbEditor = document.createElement('div');
    this.nbEditor.className = 'anomalous-nb-editor';

    // Sidebar with dual group (notes list + quick jump)
    const sidebar = createNotebookSidebar(this);

    body.append(sidebar, this.nbEditor);
    nbContainer.append(nbHeader, body);
    this.nbPanel.appendChild(nbContainer);

    this.refreshNotebooks(true);
}

export async function refreshNotebooks(autoOpenFirst = false) {
    try {
        const res = await fetch('/anomalous/notebooks');
        const data = await res.json();
        if (!this.nbListEl) return;
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
                    <h3 style="margin:0; color:#f1f5f9; font-size:1.1rem;">${t('promptNotes') || (window.anomalous_browser_lang === 'zh' ? '提示词笔记' : 'Prompt Notes')}</h3>
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
            if (this.nbSaveStatus) this.nbSaveStatus.textContent = t('notebookSaveError') || (window.anomalous_browser_lang === 'zh' ? '保存失败，请重试' : 'Failed to save note');
            return false;
        }
    });
    return this.notebookSaveQueue;
}

export async function deleteCurrentNotebook(skipConfirm = false) {
    if (!this.currentNotebook) return;
    if (!skipConfirm && !confirm((t('deleteNotebook') || '删除笔记') + ' ?')) return;
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
    } catch (e) {
        console.error('[AMB] Error deleting notebook:', e);
    }
}
