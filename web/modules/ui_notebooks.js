/**
 * ui_notebooks.js
 * Extracted Notebooks methods.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';
import { escapeHtml } from './safe_dom.js';

const t = (key, params) => translate(key, params);

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
    if (this.nbPanel) this.nbPanel.style.display = 'none';
    restoreWorkspaceReturnPanel(this);
}



export async function showNotebooks() {
        if (this.nbInitialized) {
            this.nbPanel.style.display = 'flex';
            if (this.notebookBody) this.notebookBody.style.display = 'flex';
            if (this.recipeView) this.recipeView.style.display = 'none';
            this.notebookNotesTab?.classList.add('active');
            this.notebookRecipesTab?.classList.remove('active');
            this.refreshNotebooks(true);
            return;
        }
        this.nbInitialized = true;

        this.nbPanel.innerHTML = '';

        const nbContainer = document.createElement('div');
        nbContainer.className = 'anomalous-nb-container';

        const nbHeader = document.createElement('div');
        nbHeader.className = 'anomalous-nb-header';
        const headerMain = document.createElement('div');
        headerMain.className = 'anomalous-nb-header-main';
        const heading = document.createElement('h2');
        heading.textContent = t('workspaceTitle');
        const sectionTabs = document.createElement('div');
        sectionTabs.className = 'anomalous-nb-section-tabs';
        const notesTab = document.createElement('button');
        notesTab.type = 'button';
        notesTab.className = 'anomalous-nb-section-tab active';
        notesTab.textContent = t('promptNotes');
        const recipesTab = document.createElement('button');
        recipesTab.type = 'button';
        recipesTab.className = 'anomalous-nb-section-tab';
        recipesTab.textContent = t('recipeTitle');
        sectionTabs.append(notesTab, recipesTab);
        headerMain.append(heading, sectionTabs);
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
        this.notebookNotesTab = notesTab;
        this.notebookRecipesTab = recipesTab;

        notesTab.onclick = () => {
            this.notebookBody.style.display = 'flex';
            if (this.recipeView) this.recipeView.style.display = 'none';
            notesTab.classList.add('active');
            recipesTab.classList.remove('active');
            this.refreshNotebooks(true);
        };
        recipesTab.onclick = () => this.showRecipes();

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
        createBtn.innerHTML = `➕ <span class="anomalous-nb-create-text">${t('createNotebook')}</span>`;
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
                createBtn.innerHTML = `➕ <span class="anomalous-nb-create-text">${t('createNotebook')}</span>`;
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
                    item.innerHTML = `<span class="anomalous-nb-item-icon">📄&nbsp;</span><span class="anomalous-nb-item-text">${escapeHtml(nb.name)}</span>`;
                    item.onclick = () => {
                        this.currentNotebook = nb;
                        this.renderNotebookEditor();
                        this.refreshNotebooks();
                    };
                    this.nbListEl.appendChild(item);
                });
            }
        } catch (e) { }
    }



export async function saveCurrentNotebook() {
        if (!this.currentNotebook) return;
        try {
            await fetch('/anomalous/save_notebook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.currentNotebook)
            });
            this.refreshNotebooks();
        } catch (e) { }
    }



export async function deleteCurrentNotebook(skipConfirm = false) {
        if (!this.currentNotebook) return;
        if (!skipConfirm && !confirm(t('deleteNotebook') + ' ?')) return;
        try {
            await fetch('/anomalous/delete_notebook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: this.currentNotebook.filename })
            });
            this.currentNotebook = null;
            this.nbEditor.innerHTML = '';
            this.refreshNotebooks();
        } catch (e) { }
    }



export function renderNotebookEditor() {
        this.nbEditor.innerHTML = '';
        if (!this.currentNotebook) return;

        const data = this.currentNotebook.data || {};
        if (!data.loras) data.loras = [];

        // Toolbar
        const tb = document.createElement('div');
        tb.className = 'anomalous-nb-toolbar';

        const titleArea = document.createElement('h3');
        titleArea.textContent = this.currentNotebook.name;
        titleArea.style.margin = '0';

        const rightBtns = document.createElement('div');

        const saveBtn = document.createElement('button');
        saveBtn.innerHTML = t('saveNotebook');
        saveBtn.className = 'anomalous-btn-primary';
        saveBtn.onclick = async () => {
            const orig = saveBtn.innerHTML;
            saveBtn.innerHTML = '⏳...';
            await this.saveCurrentNotebook();
            saveBtn.innerHTML = '✅';
            saveBtn.style.background = '#2e8b57';
            setTimeout(() => {
                saveBtn.innerHTML = orig;
                saveBtn.style.background = '';
            }, 1500);
        };

        let delTimer = null;
        const delContainer = document.createElement('span');
        delContainer.style.display = 'inline-flex';
        delContainer.style.alignItems = 'center';

        const delBtn = document.createElement('button');
        delBtn.innerHTML = t('deleteNotebook');
        delBtn.className = 'anomalous-btn-danger';

        const cancelDelBtn = document.createElement('button');
        cancelDelBtn.innerHTML = '✕';
        cancelDelBtn.className = 'anomalous-btn-danger';
        cancelDelBtn.style.display = 'none';
        cancelDelBtn.style.background = '#555';
        cancelDelBtn.style.marginLeft = '2px';
        cancelDelBtn.style.padding = '6px 8px';

        delContainer.appendChild(delBtn);
        delContainer.appendChild(cancelDelBtn);

        const resetDel = () => {
            clearTimeout(delTimer);
            delBtn.innerHTML = t('deleteNotebook');
            delBtn.style.background = '';
            cancelDelBtn.style.display = 'none';
        };

        delBtn.onclick = () => {
            if (delBtn.innerHTML === t('deleteNotebook')) {
                delBtn.innerHTML = t('delSure');
                delBtn.style.background = '#800';
                cancelDelBtn.style.display = 'block';
                delTimer = setTimeout(resetDel, 4000);
            } else {
                resetDel();
                this.deleteCurrentNotebook(true);
            }
        };

        cancelDelBtn.onclick = resetDel;

        const sendBtn = document.createElement('button');
        sendBtn.innerHTML = t('sendToCanvas');
        sendBtn.className = 'anomalous-btn-success';
        sendBtn.onclick = () => this.sendNotebookToCanvas();

        rightBtns.appendChild(saveBtn);
        rightBtns.appendChild(sendBtn);
        rightBtns.appendChild(delContainer);

        tb.appendChild(titleArea);
        tb.appendChild(rightBtns);

        // Settings / Models
        const modelSection = document.createElement('div');
        modelSection.className = 'anomalous-nb-section';

        // Base Model
        const baseRow = document.createElement('div');
        baseRow.className = 'anomalous-nb-row';
        baseRow.innerHTML = `<strong>${t('baseModel')}</strong>`;
        const baseSelect = document.createElement('select');
        baseSelect.className = 'anomalous-nb-select';
        const buildSelect = (bases) => {
            baseSelect.innerHTML = '';
            bases.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b; opt.text = b;
                if (data.baseModel === b) opt.selected = true;
                baseSelect.appendChild(opt);
            });
            if (!data.baseModel && bases.length > 0) data.baseModel = bases[0];
        };

        if (this.baseModelsCache) {
            buildSelect(this.baseModelsCache);
        } else {
            const tempBases = ['SD 1.5', 'SD 2.1', 'SDXL', 'SD 3.0', 'SD 3.5', 'Flux.1', 'Pony', 'HunyuanVideo', 'LTX-Video', 'OmniGen'];
            buildSelect(tempBases);
            fetch('/anomalous/base_models').then(r => r.json()).then(d => {
                if (d.base_models && d.base_models.length > 0) {
                    this.baseModelsCache = d.base_models;
                    buildSelect(this.baseModelsCache);
                }
            }).catch(e => { });
        }
        if (!data.baseModel) data.baseModel = 'SDXL';
        baseSelect.onchange = () => {
            data.baseModel = baseSelect.value;
            data.mainModel = null;
            data.loras = [];
            this.saveCurrentNotebook();
            this.renderNotebookEditor();
        };
        baseRow.appendChild(baseSelect);

        // Main Model (Card Selection)
        const mainBox = document.createElement('div');
        mainBox.className = 'anomalous-nb-gallery-box';
        const mainRow = document.createElement('div');
        mainRow.className = 'anomalous-nb-row';
        mainRow.innerHTML = `<strong>${t('mainModel')}</strong>`;

        const mainGallery = document.createElement('div');
        mainGallery.className = 'anomalous-nb-gallery-wrap';

        mainBox.appendChild(mainRow);
        mainBox.appendChild(mainGallery);

        // Loras (Card Selection)
        const loraBox = document.createElement('div');
        loraBox.className = 'anomalous-nb-gallery-box';
        const loraRow = document.createElement('div');
        loraRow.className = 'anomalous-nb-row';
        loraRow.innerHTML = `<strong>Loras</strong>`;

        const loraGallery = document.createElement('div');
        loraGallery.className = 'anomalous-nb-gallery-wrap';

        loraBox.appendChild(loraRow);
        loraBox.appendChild(loraGallery);

        modelSection.appendChild(baseRow);
        modelSection.appendChild(mainBox);
        modelSection.appendChild(loraBox);

        // Prompt Section
        const promptSec = document.createElement('div');
        promptSec.className = 'anomalous-nb-section';

        // Toolbar
        const pToolbar = document.createElement('div');
        pToolbar.className = 'anomalous-nb-prompt-toolbar';

        const langSelect = document.createElement('select');
        langSelect.className = 'anomalous-nb-select';
        const langs = [
            { v: 'zh-CN', l: '🇨🇳 中文 (zh-CN)' }, { v: 'en', l: '🇬🇧 English (en)' },
            { v: 'ja', l: '🇯🇵 日本语 (ja)' }, { v: 'ko', l: '🇰🇷 한국어 (ko)' },
            { v: 'fr', l: '🇫🇷 Français (fr)' }, { v: 'de', l: '🇩🇪 Deutsch (de)' },
            { v: 'es', l: '🇪🇸 Español (es)' }, { v: 'ru', l: '🇷🇺 Русский (ru)' }
        ];
        langs.forEach(lg => {
            const opt = document.createElement('option');
            opt.value = lg.v; opt.text = lg.l;
            if ((data.targetLang || 'zh-CN') === lg.v) opt.selected = true;
            langSelect.appendChild(opt);
        });
        langSelect.onchange = () => {
            data.targetLang = langSelect.value;
            data.translations = {}; // Clear translation cache on lang change
            this.saveCurrentNotebook();
            updateVisualTags();
        };

        const findInput = document.createElement('input');
        findInput.className = 'anomalous-nb-select';
        findInput.placeholder = t('findPlaceholder');
        findInput.style.flex = '1';

        const replaceInput = document.createElement('input');
        replaceInput.className = 'anomalous-nb-select';
        replaceInput.placeholder = t('replacePlaceholder');
        replaceInput.style.flex = '1';

        const replaceBtn = document.createElement('button');
        replaceBtn.className = 'anomalous-btn-primary';
        replaceBtn.innerHTML = t('replaceAll');

        pToolbar.appendChild(langSelect);
        pToolbar.appendChild(findInput);
        pToolbar.appendChild(replaceInput);
        pToolbar.appendChild(replaceBtn);

        // Raw Input Toggle
        const toggleRow = document.createElement('div');
        toggleRow.style.display = 'flex';
        toggleRow.style.justifyContent = 'space-between';
        toggleRow.style.marginBottom = '5px';
        toggleRow.innerHTML = `<strong>Prompt Editor</strong>`;
        const rawBtn = document.createElement('button');
        rawBtn.className = 'anomalous-btn-primary';
        rawBtn.innerHTML = t('editRaw');
        toggleRow.appendChild(rawBtn);

        // Raw Textarea
        const rawArea = document.createElement('textarea');
        rawArea.className = 'anomalous-nb-textarea';
        rawArea.value = data.promptEn || '';
        rawArea.style.display = 'none';
        rawArea.style.height = '150px';

        // Visual Dual Pane
        const dualPane = document.createElement('div');
        dualPane.className = 'anomalous-nb-dual-pane';

        if (!data.translations) data.translations = {};

        const updateVisualTags = () => {
            dualPane.innerHTML = '';
            const txt = rawArea.value;
            data.promptEn = txt;
            this.saveCurrentNotebook();
            if (!txt.trim()) return;

            const tags = txt.split(',').map(s => s.trim()).filter(s => s);
            tags.forEach((tag, idx) => {
                const tagRow = document.createElement('div');
                tagRow.className = 'anomalous-nb-tag-row';

                const tagL = document.createElement('div');
                tagL.className = 'anomalous-nb-visual-tag';
                tagL.style.flex = '1';
                tagL.style.justifyContent = 'space-between';
                const txtL = document.createElement('span');
                txtL.innerText = tag;
                const copyL = document.createElement('span');
                copyL.className = 'anomalous-nb-copy-btn';
                copyL.innerHTML = '📋';
                copyL.onclick = (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(tag).then(() => { copyL.innerHTML = '✅'; setTimeout(() => copyL.innerHTML = '📋', 1000); });
                };
                tagL.appendChild(txtL);
                tagL.appendChild(copyL);

                const tagR = document.createElement('div');
                tagR.className = 'anomalous-nb-visual-tag';
                tagR.style.flex = '1';
                tagR.style.justifyContent = 'space-between';
                const transTxt = data.translations[tag] ? data.translations[tag] : '...';
                const txtR = document.createElement('span');
                txtR.innerText = transTxt;
                const copyR = document.createElement('span');
                copyR.className = 'anomalous-nb-copy-btn';
                copyR.innerHTML = '📋';
                copyR.onclick = (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(txtR.innerText).then(() => { copyR.innerHTML = '✅'; setTimeout(() => copyR.innerHTML = '📋', 1000); });
                };
                tagR.appendChild(txtR);
                tagR.appendChild(copyR);

                tagL.onmouseenter = () => { tagL.classList.add('hover'); tagR.classList.add('hover'); };
                tagL.onmouseleave = () => { tagL.classList.remove('hover'); tagR.classList.remove('hover'); };
                tagR.onmouseenter = () => { tagL.classList.add('hover'); tagR.classList.add('hover'); };
                tagR.onmouseleave = () => { tagL.classList.remove('hover'); tagR.classList.remove('hover'); };

                tagL.onclick = () => {
                    const inp = document.createElement('input');
                    inp.value = tag; inp.className = 'anomalous-nb-tag-edit';
                    tagL.innerHTML = ''; tagL.appendChild(inp); inp.focus();
                    const finish = () => {
                        tags[idx] = inp.value.trim();
                        rawArea.value = tags.join(', ');
                        updateVisualTags();
                    };
                    inp.onblur = finish;
                    inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
                };

                tagR.onclick = () => {
                    const inp = document.createElement('input');
                    inp.value = data.translations[tag] || ''; inp.className = 'anomalous-nb-tag-edit';
                    tagR.innerHTML = ''; tagR.appendChild(inp); inp.focus();
                    const finish = () => {
                        data.translations[tag] = inp.value.trim();
                        this.saveCurrentNotebook();
                        updateVisualTags();
                    };
                    inp.onblur = finish;
                    inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
                };

                tagRow.appendChild(tagL);
                tagRow.appendChild(tagR);
                dualPane.appendChild(tagRow);

                if (!data.translations[tag]) {
                    fetch('/anomalous/translate', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: tag, target_lang: data.targetLang || 'zh-CN' })
                    }).then(r => r.json()).then(d => {
                        if (d.translated) {
                            data.translations[tag] = d.translated;
                            txtR.innerText = d.translated;
                            this.saveCurrentNotebook();
                        }
                    }).catch(() => { });
                }
            });
        };

        rawBtn.onclick = () => {
            if (rawArea.style.display === 'none') {
                rawArea.style.display = 'block';
                dualPane.style.display = 'none';
                rawBtn.innerHTML = '👁️ Done Editing';
                pToolbar.style.display = 'none';
            } else {
                rawArea.style.display = 'none';
                dualPane.style.display = 'flex';
                rawBtn.innerHTML = '📝 Edit Raw / Paste';
                pToolbar.style.display = 'flex';
                updateVisualTags();
            }
        };

        replaceBtn.onclick = () => {
            const findStr = findInput.value;
            const repStr = replaceInput.value;
            if (!findStr) return;
            const newTxt = rawArea.value.split(findStr).join(repStr);
            rawArea.value = newTxt;
            updateVisualTags();
        };

        rawArea.oninput = () => {
            clearTimeout(this.pTimeout);
            this.pTimeout = setTimeout(() => { data.promptEn = rawArea.value; this.saveCurrentNotebook(); }, 500);
        };

        updateVisualTags();

        promptSec.appendChild(pToolbar);
        promptSec.appendChild(toggleRow);
        promptSec.appendChild(rawArea);
        promptSec.appendChild(dualPane);

        this.nbEditor.appendChild(tb);
        this.nbEditor.appendChild(modelSection);
        this.nbEditor.appendChild(promptSec);

        // Fetch compatible models and fill galleries
        this.fillNotebookGalleries(data.baseModel, mainGallery, loraGallery, data);
    }



export function fillNotebookGalleries(baseModel, mainGallery, loraGallery, data) {
        if (!baseModel) return;

        const buildThumbHtml = (m) => {
            let thumb = '';
            if (m.preview_url) {
                const isVid = m.preview_url.match(/\.mp4(?:&|$)/i) || m.preview_url.match(/\.webm(?:&|$)/i);
                if (isVid) thumb = `<video src="${m.preview_url}" muted loop playsinline></video>`;
                else thumb = `<img src="${m.preview_url}" />`;
            } else {
                thumb = `<div style="width:30px; height:30px; background:#222; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#555;">?</div>`;
            }
            return thumb;
        };

        fetch(`/anomalous/compatible_models?base_model=${encodeURIComponent(baseModel)}&target_type=checkpoints,unet,diffusion_models`)
            .then(r => r.json()).then(d => {
                const buildMainDOM = (models) => {
                    mainGallery.innerHTML = '';
                    if (!models || !models.length) {
                        mainGallery.innerHTML = '<span style="color:#666;">No compatible main models found.</span>';
                    } else {
                        models.forEach(m => {
                            const isSelected = (data.mainModel && data.mainModel.filename === m.filename);
                            const card = document.createElement('div');
                            card.className = 'anomalous-nb-minicheck ' + (isSelected ? 'selected' : '');
                            card.innerHTML = `${buildThumbHtml(m)}<div class="anomalous-nb-minicheck-name" title="${escapeHtml(m.filename)}">${escapeHtml(m.filename)}</div>`;

                            if (m.preview_url && (m.preview_url.match(/\.mp4(?:&|$)/i) || m.preview_url.match(/\.webm(?:&|$)/i))) {
                                card.onmouseenter = () => { const v = card.querySelector('video'); if (v) v.play().catch(e => { }); };
                                card.onmouseleave = () => { const v = card.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } };
                            }

                            card.onclick = () => {
                                data.mainModel = m;
                                this.saveCurrentNotebook();
                                buildMainDOM(models); // re-render just the main gallery
                            };
                            mainGallery.appendChild(card);
                        });
                    }
                };
                buildMainDOM(d.models || []);
            });

        fetch(`/anomalous/compatible_models?base_model=${encodeURIComponent(baseModel)}&target_type=loras`)
            .then(r => r.json()).then(d => {
                const buildLoraDOM = (models) => {
                    loraGallery.innerHTML = '';
                    if (!models || !models.length) {
                        loraGallery.innerHTML = '<span style="color:#666;">No compatible Loras found.</span>';
                    } else {
                        models.forEach(m => {
                            const loraIndex = data.loras.findIndex(l => l.filename === m.filename);
                            const isSelected = loraIndex !== -1;
                            const card = document.createElement('div');
                            card.className = 'anomalous-nb-minilora ' + (isSelected ? 'selected' : '');
                            card.style.position = 'relative'; // for badge positioning

                            let badgeHtml = '';
                            if (isSelected) {
                                badgeHtml = `<div style="position:absolute; top:-5px; right:-5px; background:#00ffcc; color:#000; border-radius:50%; width:20px; height:20px; font-size:12px; display:flex; align-items:center; justify-content:center; font-weight:bold; z-index:10; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">${loraIndex + 1}</div>`;
                            }

                            card.innerHTML = `${badgeHtml}${buildThumbHtml(m)}<div class="anomalous-nb-minilora-name" title="${escapeHtml(m.filename)}">${escapeHtml(m.filename)}</div>`;

                            if (m.preview_url && (m.preview_url.match(/\.mp4(?:&|$)/i) || m.preview_url.match(/\.webm(?:&|$)/i))) {
                                card.onmouseenter = () => { const v = card.querySelector('video'); if (v) v.play().catch(e => { }); };
                                card.onmouseleave = () => { const v = card.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } };
                            }

                            card.onclick = () => {
                                if (isSelected) {
                                    data.loras = data.loras.filter(l => l.filename !== m.filename);
                                } else {
                                    data.loras.push(m);
                                }
                                this.saveCurrentNotebook();
                                buildLoraDOM(models); // re-render just the lora gallery
                            };
                            loraGallery.appendChild(card);
                        });
                    }
                };
                buildLoraDOM(d.models || []);
            });
    }



export function sendNotebookToCanvas() {
        if (!this.currentNotebook) return;
        const data = this.currentNotebook.data || {};
        if (!data.mainModel) {
            alert(t('notebookSelectMain'));
            return;
        }

        const groupNodes = [];
        const isUnet = data.mainModel.type === 'unet' || data.mainModel.type === 'diffusion_models';

        const ckptNode = LiteGraph.createNode(isUnet ? "UNETLoader" : "CheckpointLoaderSimple");
        app.graph.add(ckptNode);
        groupNodes.push({ node: ckptNode, relX: 0, relY: 0 });

        const sub = data.mainModel.subfolder.replace(/^\/+/, '').replace(/\/+$/, '');
        const relPath = sub ? `${sub}/${data.mainModel.filename}` : data.mainModel.filename;
        this.setWidgetValuePath(ckptNode, relPath);

        let lastNode = ckptNode;
        let lastModelSlot = isUnet ? 0 : 0;
        let lastClipSlot = isUnet ? null : 1;

        let relX = 350;
        let relY = 0;

        data.loras.forEach((lora, idx) => {
            const loraNode = LiteGraph.createNode("LoraLoader");
            app.graph.add(loraNode);
            groupNodes.push({ node: loraNode, relX: relX, relY: relY });

            const lsub = lora.subfolder.replace(/^\/+/, '').replace(/\/+$/, '');
            const lrelPath = lsub ? `${lsub}/${lora.filename}` : lora.filename;
            this.setWidgetValuePath(loraNode, lrelPath);

            lastNode.connect(lastModelSlot, loraNode, 0);
            if (lastClipSlot !== null) lastNode.connect(lastClipSlot, loraNode, 1);

            lastNode = loraNode;
            lastModelSlot = 0;
            lastClipSlot = 1;
            relX += 350;
        });

        if (data.promptEn) {
            const posNode = LiteGraph.createNode("CLIPTextEncode");
            posNode.title = "CLIP Text Encode (Positive)";
            app.graph.add(posNode);
            groupNodes.push({ node: posNode, relX: relX, relY: 0 });

            if (posNode.widgets && posNode.widgets.length > 0) {
                const tw = posNode.widgets.find(w => w.name === 'text' || w.type === 'customtext');
                if (tw) tw.value = data.promptEn;
            }
            if (lastClipSlot !== null) {
                lastNode.connect(lastClipSlot, posNode, 0);
            }

            const negNode = LiteGraph.createNode("CLIPTextEncode");
            negNode.title = "CLIP Text Encode (Negative)";
            app.graph.add(negNode);
            groupNodes.push({ node: negNode, relX: relX, relY: 250 });

            if (negNode.widgets && negNode.widgets.length > 0) {
                const tw = negNode.widgets.find(w => w.name === 'text' || w.type === 'customtext');
                if (tw) tw.value = "text, watermark, ugly, bad anatomy";
            }
            if (lastClipSlot !== null) {
                lastNode.connect(lastClipSlot, negNode, 0);
            }
        }

        this.nbPanel.style.display = 'none';
        this.close();

        // Magnetic Sticking Logic
        let isSticking = true;
        const stickHandler = (e) => {
            if (!isSticking || !app.canvas) return;
            const canvas = app.canvas;

            let canvasX, canvasY;
            if (canvas.convertEventToCanvasOffset) {
                const pos = canvas.convertEventToCanvasOffset(e);
                canvasX = pos[0];
                canvasY = pos[1];
            } else {
                const rect = canvas.canvas.getBoundingClientRect();
                canvasX = (e.clientX - rect.left - canvas.ds.offset[0]) / canvas.ds.scale;
                canvasY = (e.clientY - rect.top - canvas.ds.offset[1]) / canvas.ds.scale;
            }

            groupNodes.forEach(item => {
                const w = (item.node.size && item.node.size[0]) ? item.node.size[0] : 200;
                item.node.pos = [canvasX - (w / 2) + item.relX, canvasY - 20 + item.relY];
            });
            canvas.setDirty(true, true);
        };

        const dropHandler = (e) => {
            if (!isSticking) return;
            isSticking = false;
            window.removeEventListener('mousemove', stickHandler, true);
            window.removeEventListener('pointerdown', dropHandler, true);
            window.removeEventListener('mousedown', dropHandler, true);
            window.removeEventListener('click', dropHandler, true);
            e.preventDefault();
            e.stopPropagation();
        };

        window.addEventListener('mousemove', stickHandler, true);
        setTimeout(() => {
            window.addEventListener('pointerdown', dropHandler, true);
            window.addEventListener('mousedown', dropHandler, true);
            window.addEventListener('click', dropHandler, true);
        }, 100);
    }
