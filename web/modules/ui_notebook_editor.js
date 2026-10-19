/**
 * ui_notebook_editor.js
 * A combo's (搭配) editor: its head (ui_combo_hero.js: picture, name with Rename, chips, Put on
 * canvas), its models (ui_combo_models.js: the chosen ones, Change / Add open a grid of the
 * compatible ones) and its prompt with the bilingual tag view. Every change saves itself.
 * A node-structure combo gets the same head over its own editor (ui_combo_structure.js).
 */

import { translate } from './locales.js';
import { escapeHtml } from './safe_dom.js';
import { STRUCTURED } from './combo_slots.js';
import { renderStructuredCombo } from './ui_combo_structure.js';
import { createComboHero } from './ui_combo_hero.js';
import { createComboModels } from './ui_combo_models.js';

const t = (key, params) => translate(key, params);

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
    rawArea.placeholder = t('notebookPromptPlaceholder');

    const dualPane = document.createElement('div');
    dualPane.className = 'anomalous-nb-dual-pane';
    dualPane.style.display = 'none';

    if (!data.translations) data.translations = {};

    let visualDebounceTimer = null;
    // One save after a burst (typing, or every tag's translation arriving), not one per change.
    const saveSoon = () => {
        clearTimeout(ctx.pTimeout);
        ctx.pTimeout = setTimeout(() => ctx.saveCurrentNotebook(), 500);
    };
    const updateVisualTags = () => {
        const txt = rawArea.value;
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
                    rawArea.value = tags.filter(Boolean).join(', ');
                    data.promptEn = rawArea.value; // a tag changed in the bilingual view is the prompt's too
                    saveSoon();
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
                        saveSoon();
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
        data.promptEn = rawArea.value;
        saveSoon();

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
 * Primary notebook editor render entrypoint.
 */
export function renderNotebookEditor() {
    try {
        this.nbEditor.innerHTML = '';
        if (!this.currentNotebook) return;

        const data = this.currentNotebook.data || (this.currentNotebook.data = {});
        const hero = createComboHero(this, this.currentNotebook);
        if (data.kind === STRUCTURED) return renderStructuredCombo(this, this.nbEditor, this.currentNotebook, hero);
        this.nbEditor.replaceChildren(hero, createComboModels(this, data), createPromptSection(this, data));
    } catch (err) {
        console.error('[AMB] Error rendering notebook editor:', err);
        if (this.nbEditor) {
            this.nbEditor.innerHTML = `<div style="padding:20px; color:#ef4444;">Render error: ${escapeHtml(err?.message || String(err))}</div>`;
        }
    }
}
