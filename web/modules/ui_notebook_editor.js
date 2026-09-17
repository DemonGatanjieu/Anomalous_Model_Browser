/** Prompt Note editor and compatible-model galleries. */

import { translate } from './locales.js';
import { escapeHtml } from './safe_dom.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { showMaterialSaved } from './material_feedback.js';

const t = (key, params) => translate(key, params);

export function renderNotebookEditor() {
    try {
        this.nbEditor.innerHTML = '';
        if (!this.currentNotebook) return;

        const data = this.currentNotebook.data || {};
        if (!data.loras) data.loras = [];

        // Toolbar
        const tb = document.createElement('div');
        tb.className = 'anomalous-nb-toolbar';

        const titleBox = document.createElement('div');
        titleBox.style.display = 'flex';
        titleBox.style.alignItems = 'center';
        titleBox.style.gap = '8px';
        const titleIcon = document.createElement('span');
        titleIcon.textContent = '📝';
        titleIcon.style.fontSize = '1.2rem';
        const titleArea = document.createElement('h3');
        titleArea.textContent = this.currentNotebook.name;
        titleArea.style.margin = '0';
        titleArea.style.fontSize = '1.2rem';
        titleArea.style.fontWeight = '700';
        titleBox.append(titleIcon, titleArea);

        const rightBtns = document.createElement('div');
        rightBtns.className = 'anomalous-notebook-actions';

        const saveBtn = document.createElement('button');
        saveBtn.innerHTML = t('saveNotebook');
        saveBtn.className = 'anomalous-btn-primary';
        saveBtn.onclick = async () => {
            const orig = saveBtn.innerHTML;
            saveBtn.innerHTML = '⏳...';
            const saved = await this.saveCurrentNotebook();
            if (!saved) { saveBtn.innerHTML = orig; return; }
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
        const moreActions = document.createElement('details');
        moreActions.className = 'anomalous-secondary-actions';
        const moreSummary = document.createElement('summary');
        moreSummary.textContent = t('notebookMore');
        moreActions.append(moreSummary, delContainer);
        rightBtns.appendChild(moreActions);

        tb.appendChild(titleBox);
        tb.appendChild(rightBtns);

        // Settings / Models
        const modelSection = document.createElement('div');
        modelSection.className = 'anomalous-nb-section';
        const modelsFold = document.createElement('details');
        modelsFold.className = 'anomalous-notebook-fold anomalous-nb-models-fold';
        modelsFold.open = true;

        const modelsLabel = document.createElement('summary');
        modelsLabel.className = 'anomalous-nb-fold-summary';

        const modelsTitleLeft = document.createElement('div');
        modelsTitleLeft.style.display = 'flex';
        modelsTitleLeft.style.alignItems = 'center';
        modelsTitleLeft.style.gap = '8px';

        const modelsTitleText = document.createElement('span');
        modelsTitleText.textContent = `📦 ${t('notebookCompanionModels')}`;
        modelsTitleText.style.fontWeight = '600';

        const modelsBadge = document.createElement('span');
        modelsBadge.className = 'anomalous-nb-models-badge';

        modelsTitleLeft.append(modelsTitleText, modelsBadge);

        const arrowIcon = document.createElement('span');
        arrowIcon.className = 'anomalous-nb-fold-arrow';

        modelsLabel.append(modelsTitleLeft, arrowIcon);
        modelsFold.append(modelsLabel, modelSection);

        // Badges for main model and loras
        const mainSelectedBadge = document.createElement('span');
        mainSelectedBadge.className = 'anomalous-nb-selected-badge';
        mainSelectedBadge.style.fontSize = '0.8rem';
        mainSelectedBadge.style.color = '#c084fc';

        const loraSelectedBadge = document.createElement('span');
        loraSelectedBadge.className = 'anomalous-nb-selected-badge';
        loraSelectedBadge.style.fontSize = '0.8rem';
        loraSelectedBadge.style.color = '#fbbf24';

        const updateModelsSummary = () => {
            const arrow = modelsFold.open ? '▾' : '▸';
            arrowIcon.textContent = arrow;
            const baseInfo = data.baseModel || 'SDXL';
            const mainInfo = data.mainModel?.filename ? ` · ${data.mainModel.filename}` : '';
            const loraCount = data.loras?.length ? ` · ${data.loras.length} LoRA` : '';
            modelsBadge.textContent = `${baseInfo}${mainInfo}${loraCount}`;
            if (mainSelectedBadge) {
                mainSelectedBadge.textContent = data.mainModel?.filename ? `✓ ${data.mainModel.filename}` : (t('recipeDiffNone') || '未选择');
            }
            if (loraSelectedBadge) {
                loraSelectedBadge.textContent = data.loras?.length ? `✓ ${data.loras.length} LoRA` : (t('recipeDiffNone') || '未选择');
            }
        };
        this.updateNotebookModelsSummary = updateModelsSummary;

        // Base Model
        const baseRow = document.createElement('div');
        baseRow.className = 'anomalous-nb-row anomalous-nb-base-row';
        baseRow.style.display = 'flex';
        baseRow.style.alignItems = 'center';
        baseRow.style.gap = '10px';
        baseRow.style.marginBottom = '12px';

        const baseTitle = document.createElement('span');
        baseTitle.style.fontWeight = '600';
        baseTitle.style.fontSize = '0.88rem';
        baseTitle.style.color = '#cbd5e1';
        baseTitle.textContent = `${t('baseModel')}:`;
        baseRow.appendChild(baseTitle);

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
            updateModelsSummary();
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
        mainRow.style.display = 'flex';
        mainRow.style.alignItems = 'center';
        mainRow.style.justifyContent = 'space-between';
        mainRow.style.marginBottom = '8px';

        const mainLabel = document.createElement('strong');
        mainLabel.textContent = `🎨 ${t('mainModel')}`;
        mainRow.append(mainLabel, mainSelectedBadge);

        const mainGallery = document.createElement('div');
        mainGallery.className = 'anomalous-nb-gallery-wrap';

        mainBox.appendChild(mainRow);
        mainBox.appendChild(mainGallery);

        // Loras (Card Selection)
        const loraBox = document.createElement('div');
        loraBox.className = 'anomalous-nb-gallery-box';
        const loraRow = document.createElement('div');
        loraRow.className = 'anomalous-nb-row';
        loraRow.style.display = 'flex';
        loraRow.style.alignItems = 'center';
        loraRow.style.justifyContent = 'space-between';
        loraRow.style.marginBottom = '8px';

        const loraLabel = document.createElement('strong');
        loraLabel.textContent = `⚡ LoRA ${t('loras') || '模型'}`;
        loraRow.append(loraLabel, loraSelectedBadge);

        const loraGallery = document.createElement('div');
        loraGallery.className = 'anomalous-nb-gallery-wrap';

        loraBox.appendChild(loraRow);
        loraBox.appendChild(loraGallery);

        modelSection.appendChild(baseRow);
        modelSection.appendChild(mainBox);
        modelSection.appendChild(loraBox);

        updateModelsSummary();

        // Prompt Section
        const promptSec = document.createElement('div');
        promptSec.className = 'anomalous-nb-section anomalous-nb-prompt-section';

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
        toggleRow.innerHTML = `<strong>${t('notebookPromptTitle')}</strong>`;
        const rawBtn = document.createElement('button');
        rawBtn.className = 'anomalous-btn-primary';
        rawBtn.textContent = t('notebookDoneEditing');
        toggleRow.appendChild(rawBtn);

        // Raw Textarea
        const rawArea = document.createElement('textarea');
        rawArea.className = 'anomalous-nb-textarea';
        rawArea.value = data.promptEn || '';
        rawArea.style.display = 'block';
        rawArea.setAttribute('aria-label', t('notebookPromptTitle'));
        rawArea.style.height = '150px';

        // Visual Dual Pane
        const dualPane = document.createElement('div');
        dualPane.className = 'anomalous-nb-dual-pane';
        dualPane.style.display = 'none';

        if (!data.translations) data.translations = {};

        let visualDebounceTimer = null;
        const updateVisualTags = () => {
            const txt = rawArea.value;
            data.promptEn = txt;
            this.saveCurrentNotebook();
            if (!txt.trim()) {
                dualPane.replaceChildren();
                return;
            }

            const tags = txt.split(',').map(s => s.trim()).filter(s => s);
            const fragment = document.createDocumentFragment();
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
                fragment.appendChild(tagRow);

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
            dualPane.replaceChildren(fragment);
        };

        rawBtn.onclick = () => {
            if (rawArea.style.display === 'none') {
                rawArea.style.display = 'block';
                dualPane.style.display = 'none';
                rawBtn.textContent = t('notebookDoneEditing');
            } else {
                rawArea.style.display = 'none';
                dualPane.style.display = 'flex';
                rawBtn.textContent = t('editRaw');
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
            data.promptEn = rawArea.value;
            this.pTimeout = setTimeout(() => this.saveCurrentNotebook(), 500);

            if (dualPane.style.display !== 'none') {
                clearTimeout(visualDebounceTimer);
                visualDebounceTimer = setTimeout(() => {
                    updateVisualTags();
                }, 300);
            }
        };

        const promptTools = document.createElement('details');
        promptTools.className = 'anomalous-notebook-fold anomalous-nb-tools-fold';
        const toolsLabel = document.createElement('summary');
        toolsLabel.textContent = `🔍 ${t('recipeSearchAndReplace') || (window.anomalous_browser_lang === 'zh' ? '词条替换与目标语言' : 'Find, Replace & Language')} ▾`;
        promptTools.append(toolsLabel, pToolbar);

        const capture = document.createElement('details');
        capture.className = 'anomalous-notebook-fold anomalous-nb-capture-fold';
        const captureLabel = document.createElement('summary');
        captureLabel.textContent = `💾 ${t('materialSaveSnapshotShort')} ▾`;
        const captureContent = document.createElement('div');
        captureContent.className = 'anomalous-nb-capture-content';
        const captureHint = document.createElement('p');
        captureHint.style.margin = '0 0 10px 0';
        captureHint.style.color = '#94a3b8';
        captureHint.style.fontSize = '0.82rem';
        captureHint.textContent = t('materialNoteScopeHint');
        captureContent.append(captureHint);
        const sourceFilename = this.currentNotebook.filename;
        const sourceName = this.currentNotebook.name;
        for (const [scope, key] of [['note', 'materialSaveNoteBundle'], ['prompt', 'materialSavePromptText']]) {
            const saveMaterial = document.createElement('button');
            saveMaterial.type = 'button';
            saveMaterial.className = 'anomalous-btn-ghost';
            saveMaterial.textContent = t(key);
            saveMaterial.onclick = async () => {
                saveMaterial.disabled = true;
                // Capture immediately, including text entered before the autosave timer fires.
                const body = JSON.parse(JSON.stringify({ notebook_filename: sourceFilename,
                    name: String(sourceName || t('notebookPromptTitle')).slice(0, 120), scope, note: data }));
                const send = () => fetch('/anomalous/save_prompt_note_material', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
                });
                try {
                    let response = await send();
                    if (response.status === 409) {
                        const duplicate = await response.json();
                        if (duplicate.status !== 'duplicate') throw new Error('material conflict');
                        if (!await anomalousConfirm(t('materialDuplicateConfirm', { name: duplicate.name }))) return;
                        body.allow_duplicate = true;
                        response = await send();
                    }
                    const result = await response.json();
                    if (!response.ok || result.status !== 'success') throw new Error('material save failed');
                    showMaterialSaved(this, result.material);
                    await this.refreshMaterials?.();
                } catch (error) {
                    await anomalousAlert(t('materialSaveError'));
                } finally { saveMaterial.disabled = false; }
            };
            captureContent.appendChild(saveMaterial);
        }
        capture.append(captureLabel, captureContent);

        promptSec.appendChild(toggleRow);
        promptSec.appendChild(rawArea);
        promptSec.appendChild(dualPane);
        promptSec.appendChild(promptTools);

        // Put companion models at the very top under the toolbar
        this.nbEditor.replaceChildren(tb, modelsFold, promptSec, capture);

        // Fetch compatible models and fill galleries
        let modelsLoaded = false;
        const loadModels = () => {
            if (modelsLoaded) return;
            modelsLoaded = true;
            this.fillNotebookGalleries(data.baseModel, mainGallery, loraGallery, data);
        };
        modelsFold.ontoggle = () => {
            if (this.updateNotebookModelsSummary) this.updateNotebookModelsSummary();
            if (modelsFold.open) loadModels();
        };
        if (modelsFold.open) {
            loadModels();
        }
    } catch (err) {
        console.error('[AMB] Error rendering notebook editor:', err);
        if (this.nbEditor) {
            this.nbEditor.innerHTML = `<div style="padding:20px; color:#ef4444;">Render error: ${escapeHtml(err?.message || String(err))}</div>`;
        }
    }
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
                                data.mainModel = (data.mainModel && data.mainModel.filename === m.filename) ? null : m;
                                this.saveCurrentNotebook();
                                this.updateNotebookModelsSummary?.();
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
                                badgeHtml = `<div style="position:absolute; top:-5px; right:-5px; background:linear-gradient(135deg, #f59e0b, #d97706); color:#180808; border-radius:50%; width:20px; height:20px; font-size:12px; display:flex; align-items:center; justify-content:center; font-weight:bold; z-index:10; box-shadow: 0 2px 8px rgba(0,0,0,0.7), 0 0 6px rgba(245,158,11,0.4); border: 1px solid rgba(255,255,255,0.3);">${loraIndex + 1}</div>`;
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
                                this.updateNotebookModelsSummary?.();
                                buildLoraDOM(models); // re-render just the lora gallery
                            };
                            loraGallery.appendChild(card);
                        });
                    }
                };
                buildLoraDOM(d.models || []);
            });
    }
