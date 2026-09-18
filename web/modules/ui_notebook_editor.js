/**
 * ui_notebook_editor.js
 * Prompt Note editor with unfolded cards, sticky toolbar, and compatible-model galleries.
 */

import { translate } from './locales.js';
import { escapeHtml } from './safe_dom.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { showMaterialSaved } from './material_feedback.js';

const t = (key, params) => translate(key, params);

/**
 * Sticky top action toolbar for the active notebook with floating dropdown menu.
 */
function createNotebookToolbar(ctx, notebook) {
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
    titleArea.textContent = notebook.name;
    titleArea.style.margin = '0';
    titleArea.style.fontSize = '1.15rem';
    titleArea.style.fontWeight = '700';
    titleBox.append(titleIcon, titleArea);

    const rightBtns = document.createElement('div');
    rightBtns.className = 'anomalous-notebook-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.innerHTML = `💾 ${t('saveNotebook') || (window.anomalous_browser_lang === 'zh' ? '保存笔记' : 'Save Note')}`;
    saveBtn.className = 'anomalous-btn-primary';
    saveBtn.onclick = async () => {
        const orig = saveBtn.innerHTML;
        saveBtn.innerHTML = '⏳...';
        const saved = await ctx.saveCurrentNotebook();
        if (!saved) { saveBtn.innerHTML = orig; return; }
        saveBtn.innerHTML = '✅';
        saveBtn.style.background = '#2e8b57';
        setTimeout(() => {
            saveBtn.innerHTML = orig;
            saveBtn.style.background = '';
        }, 1500);
    };

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.innerHTML = `🚀 ${t('sendToCanvas') || (window.anomalous_browser_lang === 'zh' ? '发送到画布' : 'Send to Canvas')}`;
    sendBtn.className = 'anomalous-btn-success';
    sendBtn.onclick = () => ctx.sendNotebookToCanvas();

    // Floating More Dropdown Menu
    const moreWrapper = document.createElement('div');
    moreWrapper.className = 'anomalous-nb-dropdown-wrapper';

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'anomalous-nb-more-btn';
    moreBtn.innerHTML = `<span>··· ${t('notebookMore') || (window.anomalous_browser_lang === 'zh' ? '更多' : 'More')}</span> <span style="font-size:0.7rem;margin-left:2px;">▾</span>`;

    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'anomalous-nb-dropdown-menu';

    let delTimer = null;
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'anomalous-nb-dropdown-item anomalous-nb-dropdown-item-danger';
    const normalDelHtml = `<span>🗑️</span> <span>${t('deleteNotebook') || (window.anomalous_browser_lang === 'zh' ? '删除笔记' : 'Delete Note')}</span>`;
    delBtn.innerHTML = normalDelHtml;

    const resetDel = () => {
        clearTimeout(delTimer);
        delBtn.classList.remove('confirming');
        delBtn.innerHTML = normalDelHtml;
    };

    delBtn.onclick = (e) => {
        e.stopPropagation();
        if (!delBtn.classList.contains('confirming')) {
            delBtn.classList.add('confirming');
            const delSureText = (t('delSure') || (window.anomalous_browser_lang === 'zh' ? '确认删除？' : 'Confirm Delete?')).replace(/^⚠️\s*/, '');
            delBtn.innerHTML = `<span>⚠️</span> <span>${delSureText}</span>`;
            delTimer = setTimeout(resetDel, 4000);
        } else {
            resetDel();
            dropdownMenu.classList.remove('show');
            moreBtn.classList.remove('active');
            ctx.deleteCurrentNotebook(true);
        }
    };

    dropdownMenu.appendChild(delBtn);

    moreBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = dropdownMenu.classList.toggle('show');
        moreBtn.classList.toggle('active', isOpen);
        if (!isOpen) resetDel();
    };

    const onDocClick = (e) => {
        if (!moreWrapper.contains(e.target)) {
            dropdownMenu.classList.remove('show');
            moreBtn.classList.remove('active');
            resetDel();
        }
    };
    document.addEventListener('click', onDocClick);

    moreWrapper.append(moreBtn, dropdownMenu);
    rightBtns.append(saveBtn, sendBtn, moreWrapper);
    tb.append(titleBox, rightBtns);
    return tb;
}

/**
 * Flat companion models section (Base model + Checkpoints + LoRAs).
 */
function createCompanionModelsCard(ctx, data) {
    const card = document.createElement('div');
    card.id = 'amb-nb-sec-models';
    card.className = 'anomalous-nb-card anomalous-nb-models-card anomalous-nb-models-fold';
    card.open = true;

    const header = document.createElement('div');
    header.className = 'anomalous-nb-card-header';

    const titleLeft = document.createElement('div');
    titleLeft.style.display = 'flex';
    titleLeft.style.alignItems = 'center';
    titleLeft.style.gap = '8px';

    const titleText = document.createElement('span');
    titleText.textContent = `📦 ${t('notebookCompanionModels') || (window.anomalous_browser_lang === 'zh' ? '配套模型' : 'Companion Models')}`;
    titleText.style.fontWeight = '600';

    const modelsBadge = document.createElement('span');
    modelsBadge.className = 'anomalous-nb-models-badge';
    titleLeft.append(titleText, modelsBadge);
    header.appendChild(titleLeft);

    const mainSelectedBadge = document.createElement('span');
    mainSelectedBadge.className = 'anomalous-nb-selected-badge';
    mainSelectedBadge.style.color = '#c084fc';

    const loraSelectedBadge = document.createElement('span');
    loraSelectedBadge.className = 'anomalous-nb-selected-badge';
    loraSelectedBadge.style.color = '#fbbf24';

    const updateSummary = () => {
        const baseInfo = data.baseModel || 'SDXL';
        const mainInfo = data.mainModel?.filename ? ` · ${data.mainModel.filename}` : '';
        const loraCount = data.loras?.length ? ` · ${data.loras.length} LoRA` : '';
        modelsBadge.textContent = `${baseInfo}${mainInfo}${loraCount}`;
        mainSelectedBadge.textContent = data.mainModel?.filename ? `✓ ${data.mainModel.filename}` : (t('recipeDiffNone') || '未选择');
        loraSelectedBadge.textContent = data.loras?.length ? `✓ ${data.loras.length} LoRA` : (t('recipeDiffNone') || '未选择');
    };
    ctx.updateNotebookModelsSummary = updateSummary;

    // Base model selection
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
    baseTitle.textContent = `${t('baseModel') || (window.anomalous_browser_lang === 'zh' ? '基础模型' : 'Base Model')}:`;
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
        updateSummary();
    };

    if (ctx.baseModelsCache) {
        buildSelect(ctx.baseModelsCache);
    } else {
        const tempBases = ['SD 1.5', 'SD 2.1', 'SDXL', 'SD 3.0', 'SD 3.5', 'Flux.1', 'Pony', 'HunyuanVideo', 'LTX-Video', 'OmniGen'];
        buildSelect(tempBases);
        fetch('/anomalous/base_models').then(r => r.json()).then(d => {
            if (d.base_models && d.base_models.length > 0) {
                ctx.baseModelsCache = d.base_models;
                buildSelect(ctx.baseModelsCache);
            }
        }).catch(() => { });
    }
    if (!data.baseModel) data.baseModel = 'SDXL';
    baseSelect.onchange = () => {
        data.baseModel = baseSelect.value;
        data.mainModel = null;
        data.loras = [];
        ctx.saveCurrentNotebook();
        ctx.renderNotebookEditor();
    };
    baseRow.appendChild(baseSelect);

    // Main Model Gallery
    const mainBox = document.createElement('div');
    mainBox.className = 'anomalous-nb-gallery-box';
    const mainRow = document.createElement('div');
    mainRow.className = 'anomalous-nb-row';
    mainRow.style.display = 'flex';
    mainRow.style.alignItems = 'center';
    mainRow.style.justifyContent = 'space-between';
    mainRow.style.marginBottom = '8px';
    const mainLabel = document.createElement('strong');
    mainLabel.textContent = `🎨 ${t('mainModel') || (window.anomalous_browser_lang === 'zh' ? '主模型' : 'Main Model')}`;
    mainRow.append(mainLabel, mainSelectedBadge);
    const mainGallery = document.createElement('div');
    mainGallery.className = 'anomalous-nb-gallery-wrap';
    mainBox.append(mainRow, mainGallery);

    // LoRA Gallery
    const loraBox = document.createElement('div');
    loraBox.className = 'anomalous-nb-gallery-box';
    const loraRow = document.createElement('div');
    loraRow.className = 'anomalous-nb-row';
    loraRow.style.display = 'flex';
    loraRow.style.alignItems = 'center';
    loraRow.style.justifyContent = 'space-between';
    loraRow.style.marginBottom = '8px';
    const loraLabel = document.createElement('strong');
    loraLabel.textContent = `⚡ ${t('loras') || (window.anomalous_browser_lang === 'zh' ? 'LoRA 模型' : 'LoRA Models')}`;
    loraRow.append(loraLabel, loraSelectedBadge);
    const loraGallery = document.createElement('div');
    loraGallery.className = 'anomalous-nb-gallery-wrap';
    loraBox.append(loraRow, loraGallery);

    card.append(header, baseRow, mainBox, loraBox);
    updateSummary();

    ctx.fillNotebookGalleries(data.baseModel, mainGallery, loraGallery, data);
    return card;
}

/**
 * Prompt composer section with bilingual dual pane and compact inline tools.
 */
function createPromptSection(ctx, data) {
    const card = document.createElement('div');
    card.id = 'amb-nb-sec-prompt';
    card.className = 'anomalous-nb-card anomalous-nb-prompt-card anomalous-nb-prompt-section';

    const header = document.createElement('div');
    header.className = 'anomalous-nb-card-header';

    const title = document.createElement('span');
    title.innerHTML = `✍️ <strong>${t('notebookPromptTitle') || (window.anomalous_browser_lang === 'zh' ? '提示词' : 'Prompt')}</strong>`;

    const rawBtn = document.createElement('button');
    rawBtn.type = 'button';
    rawBtn.className = 'anomalous-btn-primary';
    rawBtn.textContent = t('notebookDoneEditing') || (window.anomalous_browser_lang === 'zh' ? '📑 查看双语分词' : '📑 View Bilingual Tags');
    header.append(title, rawBtn);

    const rawArea = document.createElement('textarea');
    rawArea.className = 'anomalous-nb-textarea';
    rawArea.value = data.promptEn || '';
    rawArea.placeholder = window.anomalous_browser_lang === 'zh'
        ? '在此输入提示词内容（英文词条用逗号分隔，支持自动双语切词翻译）...'
        : 'Enter prompt here (comma-separated for tags, bilingual translation supported)...';

    const dualPane = document.createElement('div');
    dualPane.className = 'anomalous-nb-dual-pane';
    dualPane.style.display = 'none';

    if (!data.translations) data.translations = {};

    let visualDebounceTimer = null;
    const updateVisualTags = () => {
        const txt = rawArea.value;
        data.promptEn = txt;
        ctx.saveCurrentNotebook();
        if (!txt.trim()) {
            dualPane.replaceChildren();
            return;
        }

        const tags = txt.split(',').map(s => s.trim()).filter(Boolean);
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
            tagL.append(txtL, copyL);

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
            tagR.append(txtR, copyR);

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
                    ctx.saveCurrentNotebook();
                    updateVisualTags();
                };
                inp.onblur = finish;
                inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
            };

            tagRow.append(tagL, tagR);
            fragment.appendChild(tagRow);

            if (!data.translations[tag]) {
                fetch('/anomalous/translate', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: tag, target_lang: data.targetLang || 'zh-CN' })
                }).then(r => r.json()).then(d => {
                    if (d.translated) {
                        data.translations[tag] = d.translated;
                        txtR.innerText = d.translated;
                        ctx.saveCurrentNotebook();
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
            rawBtn.textContent = t('notebookDoneEditing') || (window.anomalous_browser_lang === 'zh' ? '📑 查看双语分词' : '📑 View Bilingual Tags');
        } else {
            rawArea.style.display = 'none';
            dualPane.style.display = 'flex';
            rawBtn.textContent = t('editRaw') || (window.anomalous_browser_lang === 'zh' ? '✏️ 编辑原始文本' : '✏️ Edit Raw Prompt');
            updateVisualTags();
        }
    };

    rawArea.oninput = () => {
        clearTimeout(ctx.pTimeout);
        data.promptEn = rawArea.value;
        ctx.pTimeout = setTimeout(() => ctx.saveCurrentNotebook(), 500);

        if (dualPane.style.display !== 'none') {
            clearTimeout(visualDebounceTimer);
            visualDebounceTimer = setTimeout(() => updateVisualTags(), 300);
        }
    };

    const toolsBar = createPromptToolsBar(ctx, data, rawArea, updateVisualTags);
    card.append(header, rawArea, dualPane, toolsBar);
    return card;
}

/**
 * Compact, unfolded single-line toolbar for Find & Replace and Language selection.
 */
function createPromptToolsBar(ctx, data, rawArea, onTagsUpdated) {
    const bar = document.createElement('div');
    bar.id = 'amb-nb-sec-tools';
    bar.className = 'anomalous-nb-tools-bar';

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
        data.translations = {};
        ctx.saveCurrentNotebook();
        onTagsUpdated();
    };

    const findInput = document.createElement('input');
    findInput.className = 'anomalous-nb-select';
    findInput.placeholder = t('findPlaceholder') || (window.anomalous_browser_lang === 'zh' ? '查找词条...' : 'Find tag...');
    findInput.style.flex = '1';

    const replaceInput = document.createElement('input');
    replaceInput.className = 'anomalous-nb-select';
    replaceInput.placeholder = t('replacePlaceholder') || (window.anomalous_browser_lang === 'zh' ? '替换为...' : 'Replace with...');
    replaceInput.style.flex = '1';

    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'anomalous-btn-primary';
    replaceBtn.innerHTML = t('replaceAll') || (window.anomalous_browser_lang === 'zh' ? '全部替换' : 'Replace All');
    replaceBtn.onclick = () => {
        const findStr = findInput.value;
        const repStr = replaceInput.value;
        if (!findStr) return;
        rawArea.value = rawArea.value.split(findStr).join(repStr);
        data.promptEn = rawArea.value;
        ctx.saveCurrentNotebook();
        onTagsUpdated();
    };

    bar.append(langSelect, findInput, replaceInput, replaceBtn);
    return bar;
}

/**
 * Flat Material Library archive card (unfolded bottom card).
 */
function createArchiveCard(ctx, currentNotebook, data) {
    const card = document.createElement('div');
    card.id = 'amb-nb-sec-archive';
    card.className = 'anomalous-nb-card anomalous-nb-archive-card';

    const header = document.createElement('div');
    header.className = 'anomalous-nb-card-header';
    const title = document.createElement('span');
    const rawShort = t('materialSaveSnapshotShort') || (window.anomalous_browser_lang === 'zh' ? '保存到素材库' : 'Save to Library');
    const cleanShort = rawShort.replace(/^💾\s*/, '');
    title.innerHTML = `💾 <strong>${cleanShort}</strong>`;
    header.appendChild(title);

    const hint = document.createElement('p');
    hint.className = 'anomalous-nb-hint';
    hint.textContent = t('materialNoteScopeHint') || (window.anomalous_browser_lang === 'zh'
        ? '将当前笔记归档保存至素材库中，便于随处调用与复用。'
        : 'Archive this prompt note to the material library for quick reuse.');

    const actions = document.createElement('div');
    actions.className = 'anomalous-nb-archive-actions';
    actions.style.display = 'flex';
    actions.style.gap = '10px';
    actions.style.flexWrap = 'wrap';

    const sourceFilename = currentNotebook.filename;
    const sourceName = currentNotebook.name;

    const scopes = [
        ['note', 'materialSaveNoteBundle', '📦 保存整篇笔记 (含配套模型与提示词)', '📦 Save Note Bundle'],
        ['prompt', 'materialSavePromptText', '📝 仅保存提示词文本', '📝 Save Prompt Text Only']
    ];

    for (const [scope, key, defaultZh, defaultEn] of scopes) {
        const saveMaterial = document.createElement('button');
        saveMaterial.type = 'button';
        saveMaterial.className = 'anomalous-btn-primary';
        saveMaterial.textContent = t(key) || (window.anomalous_browser_lang === 'zh' ? defaultZh : defaultEn);
        saveMaterial.onclick = async () => {
            saveMaterial.disabled = true;
            const body = JSON.parse(JSON.stringify({
                notebook_filename: sourceFilename,
                name: String(sourceName || t('notebookPromptTitle')).slice(0, 120),
                scope,
                note: data
            }));
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
                showMaterialSaved(ctx, result.material);
                await ctx.refreshMaterials?.();
            } catch (error) {
                await anomalousAlert(t('materialSaveError') || (window.anomalous_browser_lang === 'zh' ? '保存到素材库失败' : 'Failed to save to material library'));
            } finally {
                saveMaterial.disabled = false;
            }
        };
        actions.appendChild(saveMaterial);
    }

    card.append(header, hint, actions);
    return card;
}

/**
 * Primary notebook editor render entrypoint.
 */
export function renderNotebookEditor() {
    try {
        this.nbEditor.innerHTML = '';
        if (!this.currentNotebook) return;

        const data = this.currentNotebook.data || (this.currentNotebook.data = {});
        if (!data.loras) data.loras = [];

        const tb = createNotebookToolbar(this, this.currentNotebook);
        const modelsCard = createCompanionModelsCard(this, data);
        const promptSec = createPromptSection(this, data);
        const archiveCard = createArchiveCard(this, this.currentNotebook, data);

        this.nbEditor.replaceChildren(tb, modelsCard, promptSec, archiveCard);
    } catch (err) {
        console.error('[AMB] Error rendering notebook editor:', err);
        if (this.nbEditor) {
            this.nbEditor.innerHTML = `<div style="padding:20px; color:#ef4444;">Render error: ${escapeHtml(err?.message || String(err))}</div>`;
        }
    }
}

/**
 * Fill compatible main models and Loras into horizontal galleries.
 */
export function fillNotebookGalleries(baseModel, mainGallery, loraGallery, data) {
    if (!baseModel) return;

    const buildThumbHtml = (m) => {
        if (m.preview_url) {
            const isVid = m.preview_url.match(/\.mp4(?:&|$)/i) || m.preview_url.match(/\.webm(?:&|$)/i);
            if (isVid) return `<video src="${m.preview_url}" muted loop playsinline></video>`;
            return `<img src="${m.preview_url}" />`;
        }
        return `<div style="width:30px; height:30px; background:#222; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#555;">?</div>`;
    };

    fetch(`/anomalous/compatible_models?base_model=${encodeURIComponent(baseModel)}&target_type=checkpoints,unet,diffusion_models`)
        .then(r => r.json()).then(d => {
            const buildMainDOM = (models) => {
                mainGallery.innerHTML = '';
                if (!models || !models.length) {
                    mainGallery.innerHTML = `<span style="color:#666;">${window.anomalous_browser_lang === 'zh' ? '未找到兼容的主模型。' : 'No compatible main models found.'}</span>`;
                } else {
                    models.forEach(m => {
                        const isSelected = (data.mainModel && data.mainModel.filename === m.filename);
                        const card = document.createElement('div');
                        card.className = 'anomalous-nb-minicheck ' + (isSelected ? 'selected' : '');
                        card.innerHTML = `${buildThumbHtml(m)}<div class="anomalous-nb-minicheck-name" title="${escapeHtml(m.filename)}">${escapeHtml(m.filename)}</div>`;

                        if (m.preview_url && (m.preview_url.match(/\.mp4(?:&|$)/i) || m.preview_url.match(/\.webm(?:&|$)/i))) {
                            card.onmouseenter = () => { const v = card.querySelector('video'); if (v) v.play().catch(() => { }); };
                            card.onmouseleave = () => { const v = card.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } };
                        }

                        card.onclick = () => {
                            data.mainModel = (data.mainModel && data.mainModel.filename === m.filename) ? null : m;
                            this.saveCurrentNotebook();
                            this.updateNotebookModelsSummary?.();
                            buildMainDOM(models);
                        };
                        mainGallery.appendChild(card);
                    });
                }
            };
            buildMainDOM(d.models || []);
        }).catch(() => { });

    fetch(`/anomalous/compatible_models?base_model=${encodeURIComponent(baseModel)}&target_type=loras`)
        .then(r => r.json()).then(d => {
            const buildLoraDOM = (models) => {
                loraGallery.innerHTML = '';
                if (!models || !models.length) {
                    loraGallery.innerHTML = `<span style="color:#666;">${window.anomalous_browser_lang === 'zh' ? '未找到兼容的 LoRA。' : 'No compatible Loras found.'}</span>`;
                } else {
                    models.forEach(m => {
                        const loraIndex = data.loras.findIndex(l => l.filename === m.filename);
                        const isSelected = loraIndex !== -1;
                        const card = document.createElement('div');
                        card.className = 'anomalous-nb-minilora ' + (isSelected ? 'selected' : '');
                        card.style.position = 'relative';

                        let badgeHtml = '';
                        if (isSelected) {
                            badgeHtml = `<div style="position:absolute; top:-5px; right:-5px; background:linear-gradient(135deg, #f59e0b, #d97706); color:#180808; border-radius:50%; width:20px; height:20px; font-size:12px; display:flex; align-items:center; justify-content:center; font-weight:bold; z-index:10; box-shadow: 0 2px 8px rgba(0,0,0,0.7), 0 0 6px rgba(245,158,11,0.4); border: 1px solid rgba(255,255,255,0.3);">${loraIndex + 1}</div>`;
                        }

                        card.innerHTML = `${badgeHtml}${buildThumbHtml(m)}<div class="anomalous-nb-minilora-name" title="${escapeHtml(m.filename)}">${escapeHtml(m.filename)}</div>`;

                        if (m.preview_url && (m.preview_url.match(/\.mp4(?:&|$)/i) || m.preview_url.match(/\.webm(?:&|$)/i))) {
                            card.onmouseenter = () => { const v = card.querySelector('video'); if (v) v.play().catch(() => { }); };
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
                            buildLoraDOM(models);
                        };
                        loraGallery.appendChild(card);
                    });
                }
            };
            buildLoraDOM(d.models || []);
        }).catch(() => { });
}
