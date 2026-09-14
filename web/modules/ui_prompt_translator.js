/**
 * ui_prompt_translator.js
 * Standalone Prompt Translator modal for Anomalous Model Browser.
 * Provides instant multi-language translation, tag breakdown chips,
 * active ComfyUI node read/write, and direct dispatch into Prompt Studio.
 */

import { app } from '../../../scripts/app.js';
import { translatePromptText, splitPromptTags, normalizePromptFormatting, hasChinese } from './translation_service.js';
import { selectedMaterialNode, promptWidgetTargets, applyNodeMaterialValues } from './node_material_actions.js';
import { appendPromptToStudio } from './ui_prompt_composer.js';

let activeTranslatorModal = null;

function t(zh, en) {
    return window.anomalous_browser_lang === 'zh' ? zh : en;
}

function showTranslatorToast(container, message, isError = false) {
    const existing = container.querySelector('.anomalous-translator-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `anomalous-translator-toast${isError ? ' is-error' : ''}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('is-fade-out');
        setTimeout(() => toast.remove(), 400);
    }, 2000);
}

/**
 * Reads prompt text from the currently selected canvas node.
 * @returns {{ text: string, nodeTitle: string } | null}
 */
function readSelectedNodePrompt() {
    try {
        const node = selectedMaterialNode(app);
        if (!node) return null;

        const targets = promptWidgetTargets(node);
        if (!targets.length) return null;

        const widget = node.widgets[targets[0].index];
        const val = typeof widget?.value === 'string' ? widget.value.trim() : '';
        return {
            text: val,
            nodeTitle: node.title || node.type || 'Node',
        };
    } catch {
        return null;
    }
}

/**
 * Writes translated text into the currently selected canvas node.
 * @param {string} text 
 * @returns {{ success: boolean, message: string }}
 */
function writeToSelectedNode(text) {
    try {
        const node = selectedMaterialNode(app);
        if (!node) {
            return {
                success: false,
                message: t('未选中任何画布节点，请先在 ComfyUI 画布上点击选中目标节点', 'No node selected on canvas. Please click a node first.'),
            };
        }

        const targets = promptWidgetTargets(node);
        if (!targets.length) {
            return {
                success: false,
                message: t(`节点【${node.title || node.type}】没有可写入的提示词文本输入框`, `Node [${node.title || node.type}] has no text widget.`),
            };
        }

        const targetWidget = targets[0];
        applyNodeMaterialValues(app, node, [{ index: targetWidget.index, value: text }]);
        return {
            success: true,
            message: t(`✓ 已成功写入节点【${node.title || node.type}】的 ${targetWidget.name} 框`, `✓ Written to [${node.title || node.type}] (${targetWidget.name})`),
        };
    } catch (err) {
        return {
            success: false,
            message: t(`写入失败: ${err.message}`, `Write failed: ${err.message}`),
        };
    }
}

/**
 * Opens the standalone Prompt Translator modal.
 * @param {Object} owner - AnomalousBrowser instance
 */
export function openPromptTranslator(owner) {
    if (activeTranslatorModal) {
        activeTranslatorModal.remove();
        activeTranslatorModal = null;
    }

    // Modal Overlay
    const overlay = document.createElement('div');
    overlay.className = 'anomalous-translator-overlay';
    activeTranslatorModal = overlay;

    // Modal Window
    const modal = document.createElement('div');
    modal.className = 'anomalous-translator-modal';
    overlay.appendChild(modal);

    // 1. Header
    const header = document.createElement('div');
    header.className = 'anomalous-translator-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'anomalous-translator-title-group';
    titleGroup.innerHTML = `
        <span class="anomalous-translator-icon">🌐</span>
        <h3 class="anomalous-translator-title">${t('提示词翻译助手', 'Prompt Translation Assistant')}</h3>
    `;
    header.appendChild(titleGroup);

    const headerRight = document.createElement('div');
    headerRight.className = 'anomalous-translator-header-right';

    // Target Language Selector
    const langSelectWrap = document.createElement('label');
    langSelectWrap.className = 'anomalous-translator-lang-wrap';
    langSelectWrap.innerHTML = `<span>${t('目标语言', 'Target')}:</span>`;

    const langSelect = document.createElement('select');
    langSelect.className = 'anomalous-translator-select';
    [
        { val: 'auto', labelZh: '⚡ 智能自动互译', labelEn: '⚡ Smart Auto' },
        { val: 'en', labelZh: 'English (英文)', labelEn: 'English' },
        { val: 'zh-CN', labelZh: '简体中文 (Chinese)', labelEn: 'Chinese (Simplified)' },
        { val: 'ja', labelZh: '日本語 (Japanese)', labelEn: 'Japanese' },
        { val: 'ko', labelZh: '한국어 (Korean)', labelEn: 'Korean' },
    ].forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.val;
        opt.textContent = window.anomalous_browser_lang === 'zh' ? item.labelZh : item.labelEn;
        langSelect.appendChild(opt);
    });
    langSelectWrap.appendChild(langSelect);
    headerRight.appendChild(langSelectWrap);

    // Close Button
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'anomalous-translator-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = () => {
        overlay.remove();
        activeTranslatorModal = null;
    };
    headerRight.appendChild(closeBtn);
    header.appendChild(headerRight);
    modal.appendChild(header);

    // 2. Body Area (Split pane: Source Input / Translated Output)
    const body = document.createElement('div');
    body.className = 'anomalous-translator-body';

    // --- Left / Top Pane: Source Prompt ---
    const sourcePane = document.createElement('div');
    sourcePane.className = 'anomalous-translator-pane';

    const sourceLabelBar = document.createElement('div');
    sourceLabelBar.className = 'anomalous-translator-pane-label';
    sourceLabelBar.innerHTML = `<span>${t('源提示词 (支持中/英文或自然描述)', 'Source Prompt (Text or tags)')}</span>`;
    sourcePane.appendChild(sourceLabelBar);

    const sourceTextarea = document.createElement('textarea');
    sourceTextarea.className = 'anomalous-translator-textarea';
    sourceTextarea.placeholder = t('输入需要翻译的提示词、词组标签或中文画面构思...', 'Enter prompts, comma-separated tags, or Chinese ideas to translate...');
    sourcePane.appendChild(sourceTextarea);

    // Source Action Bar
    const sourceActions = document.createElement('div');
    sourceActions.className = 'anomalous-translator-action-bar';

    const sourceLeftGroup = document.createElement('div');
    sourceLeftGroup.className = 'anomalous-translator-action-group';

    const readNodeBtn = document.createElement('button');
    readNodeBtn.type = 'button';
    readNodeBtn.className = 'anomalous-btn-ghost anomalous-btn-sm';
    readNodeBtn.innerHTML = `📥 ${t('读取选中节点', 'Read Node')}`;
    readNodeBtn.title = t('从 ComfyUI 画布当前选中的节点读取提示词', 'Read prompt from selected canvas node');
    readNodeBtn.onclick = () => {
        const res = readSelectedNodePrompt();
        if (res && res.text) {
            sourceTextarea.value = res.text;
            showTranslatorToast(modal, t(`✓ 已读取【${res.nodeTitle}】提示词`, `✓ Read prompt from [${res.nodeTitle}]`));
        } else {
            showTranslatorToast(modal, t('未检测到包含文本的选中节点', 'No text found in selected node'), true);
        }
    };

    const sourceCleanBtn = document.createElement('button');
    sourceCleanBtn.type = 'button';
    sourceCleanBtn.className = 'anomalous-btn-ghost anomalous-btn-sm';
    sourceCleanBtn.innerHTML = `🧹 ${t('规范化', 'Normalize')}`;
    sourceCleanBtn.title = t('将源提示词中的顿号、中文标点清洗为标准英文逗号 (, )', 'Normalize source prompt punctuation to standard commas');
    sourceCleanBtn.onclick = () => {
        const raw = sourceTextarea.value.trim();
        if (!raw) return;
        sourceTextarea.value = normalizePromptFormatting(raw);
        showTranslatorToast(modal, t('✓ 源文本已规范化为标准逗号格式', '✓ Normalized source prompt'));
    };

    const sourceWriteBtn = document.createElement('button');
    sourceWriteBtn.type = 'button';
    sourceWriteBtn.className = 'anomalous-btn-ghost anomalous-btn-sm';
    sourceWriteBtn.innerHTML = `✏️ ${t('规范并写回节点', 'Format & Write Back')}`;
    sourceWriteBtn.title = t('将源文本直接清洗规范后写回选中节点（无需翻译，一键替换节点格式）', 'Normalize source text and write directly back to canvas node');
    sourceWriteBtn.onclick = () => {
        let raw = sourceTextarea.value.trim();
        if (!raw) {
            showTranslatorToast(modal, t('源提示词为空', 'Source prompt is empty'), true);
            return;
        }
        raw = normalizePromptFormatting(raw);
        sourceTextarea.value = raw;
        const res = writeToSelectedNode(raw);
        showTranslatorToast(modal, res.message, !res.success);
    };

    sourceLeftGroup.append(readNodeBtn, sourceCleanBtn, sourceWriteBtn);

    const sourceRightGroup = document.createElement('div');
    sourceRightGroup.className = 'anomalous-translator-action-group';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'anomalous-btn-ghost anomalous-btn-sm';
    clearBtn.textContent = t('清空', 'Clear');
    clearBtn.onclick = () => {
        sourceTextarea.value = '';
        sourceTextarea.focus();
    };

    const translateBtn = document.createElement('button');
    translateBtn.type = 'button';
    translateBtn.className = 'anomalous-btn-primary anomalous-btn-sm anomalous-translator-btn-run';
    translateBtn.innerHTML = `🌐 ${t('一键翻译', 'Translate')}`;

    sourceRightGroup.append(clearBtn, translateBtn);
    sourceActions.append(sourceLeftGroup, sourceRightGroup);
    sourcePane.appendChild(sourceActions);
    body.appendChild(sourcePane);

    // --- Middle Bar: Swap Content & Direction ---
    const midBar = document.createElement('div');
    midBar.className = 'anomalous-translator-mid-bar';

    const swapBtn = document.createElement('button');
    swapBtn.type = 'button';
    swapBtn.className = 'anomalous-translator-swap-btn';
    swapBtn.innerHTML = `⇅ ${t('互换内容与语言', 'Swap Content & Language')}`;
    swapBtn.title = t('对调上下两框文本，并反转翻译目标语言', 'Swap source and target text, and invert translation direction');
    swapBtn.onclick = () => {
        const tempText = sourceTextarea.value;
        sourceTextarea.value = targetTextarea.value;
        targetTextarea.value = tempText;
        updateTagChips(targetTextarea.value);

        if (langSelect.value === 'en') {
            langSelect.value = 'zh-CN';
        } else if (langSelect.value === 'zh-CN') {
            langSelect.value = 'en';
        }
        showTranslatorToast(modal, t('✓ 已互换源文本与译文', '✓ Swapped source and target'));
    };
    midBar.appendChild(swapBtn);
    body.appendChild(midBar);

    // --- Right / Bottom Pane: Translated Output ---
    const targetPane = document.createElement('div');
    targetPane.className = 'anomalous-translator-pane';

    const targetLabelBar = document.createElement('div');
    targetLabelBar.className = 'anomalous-translator-pane-label';
    targetLabelBar.innerHTML = `<span>${t('翻译结果与标签预览', 'Translation & Tag Breakdown')}</span>`;
    targetPane.appendChild(targetLabelBar);

    const targetTextarea = document.createElement('textarea');
    targetTextarea.className = 'anomalous-translator-textarea is-target';
    targetTextarea.placeholder = t('译文将在此显示，可直接编辑...', 'Translated text will appear here...');
    targetPane.appendChild(targetTextarea);

    // Tag breakdown chips container
    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'anomalous-translator-chips-wrap';
    targetPane.appendChild(chipsWrap);

    function updateTagChips(text) {
        chipsWrap.replaceChildren();
        const tags = splitPromptTags(text);
        if (!tags.length) {
            chipsWrap.style.display = 'none';
            return;
        }
        chipsWrap.style.display = 'flex';
        tags.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'anomalous-translator-chip';
            chip.textContent = tag;
            chip.title = t('点击复制此标签', 'Click to copy tag');
            chip.onclick = async () => {
                await navigator.clipboard.writeText(tag);
                showTranslatorToast(modal, t(`✓ 已复制标签: ${tag}`, `✓ Copied tag: ${tag}`));
            };
            chipsWrap.appendChild(chip);
        });
    }

    // Target Action Bar
    const targetActions = document.createElement('div');
    targetActions.className = 'anomalous-translator-action-bar';

    const targetLeftGroup = document.createElement('div');
    targetLeftGroup.className = 'anomalous-translator-action-group';

    const cleanBtn = document.createElement('button');
    cleanBtn.type = 'button';
    cleanBtn.className = 'anomalous-btn-ghost anomalous-btn-sm';
    cleanBtn.innerHTML = `🧹 ${t('规范化标签', 'Normalize Tags')}`;
    cleanBtn.title = t('将顿号、中文全角逗号等标点统一规范化为标准的英文逗号与空格 (tag, tag)', 'Normalize commas, Chinese enumeration marks, and semicolons to standard tags');
    cleanBtn.onclick = () => {
        const raw = targetTextarea.value.trim();
        if (!raw) return;
        const cleaned = normalizePromptFormatting(raw);
        targetTextarea.value = cleaned;
        updateTagChips(cleaned);
        showTranslatorToast(modal, t('✓ 已规范化为标准标签格式 (, )', '✓ Normalized to standard tags (, )'));
    };

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'anomalous-btn-ghost anomalous-btn-sm';
    copyBtn.innerHTML = `📋 ${t('复制译文', 'Copy')}`;
    copyBtn.onclick = async () => {
        const out = targetTextarea.value.trim();
        if (!out) return;
        await navigator.clipboard.writeText(out);
        showTranslatorToast(modal, t('✓ 译文已复制到剪贴板', '✓ Translation copied to clipboard'));
    };

    const sendToStudioBtn = document.createElement('button');
    sendToStudioBtn.type = 'button';
    sendToStudioBtn.className = 'anomalous-btn-ghost anomalous-btn-sm';
    sendToStudioBtn.innerHTML = `🎛️ ${t('发送到提示词工坊', 'Send to Studio')}`;
    sendToStudioBtn.title = t('将译文发送到提示词工坊拼装组装', 'Send translated text as block to Prompt Studio');
    sendToStudioBtn.onclick = () => {
        let out = targetTextarea.value.trim();
        if (!out) return;
        if (/[，、;；|｜]/.test(out) && !hasChinese(out)) {
            out = normalizePromptFormatting(out);
        }
        overlay.remove();
        activeTranslatorModal = null;
        if (typeof owner?.openPromptStudio === 'function') {
            owner.openPromptStudio();
        }
        appendPromptToStudio(owner, out, true, t('翻译结果', 'Translated Prompt'));
    };

    targetLeftGroup.append(cleanBtn, copyBtn, sendToStudioBtn);

    const targetRightGroup = document.createElement('div');
    targetRightGroup.className = 'anomalous-translator-action-group';

    // Direct Write to Node button
    const writeNodeBtn = document.createElement('button');
    writeNodeBtn.type = 'button';
    writeNodeBtn.className = 'anomalous-btn-ghost anomalous-btn-sm';
    writeNodeBtn.innerHTML = `✏️ ${t('直接写入节点', 'Write Directly')}`;
    writeNodeBtn.title = t('将当前文本原样写入选中的画布节点', 'Write current text directly to active ComfyUI node');

    // Translate to EN & Write button (The ultimate shortcut for prompt workflows!)
    const translateAndWriteBtn = document.createElement('button');
    translateAndWriteBtn.type = 'button';
    translateAndWriteBtn.className = 'anomalous-btn-primary anomalous-btn-sm';
    translateAndWriteBtn.innerHTML = `🌐 ${t('译为英文并写入节点', 'Translate to EN & Write')}`;
    translateAndWriteBtn.title = t('一键将当前内容反向翻译为规范英文，并直接替换写入选中的画布节点', 'Translate current content into clean English tags and write to canvas node');
    translateAndWriteBtn.onclick = async () => {
        let out = targetTextarea.value.trim();
        if (!out) {
            showTranslatorToast(modal, t('请先输入或翻译文本', 'No text to translate and write'), true);
            return;
        }

        if (!hasChinese(out)) {
            out = normalizePromptFormatting(out);
            targetTextarea.value = out;
            updateTagChips(out);
            const res = writeToSelectedNode(out);
            showTranslatorToast(modal, res.message, !res.success);
            return;
        }

        translateAndWriteBtn.disabled = true;
        translateAndWriteBtn.innerHTML = `⏳ ${t('反译写入中...', 'Translating & Writing...')}`;

        try {
            const res = await translatePromptText(out, { targetLang: 'en' });
            if (res.ok && res.translated) {
                const enTags = normalizePromptFormatting(res.translated);
                const writeRes = writeToSelectedNode(enTags);
                if (writeRes.success) {
                    showTranslatorToast(modal, t('✓ 已反译为英文并成功写入节点！', '✓ Translated to EN & written to node!'));
                    sourceTextarea.value = enTags;
                } else {
                    showTranslatorToast(modal, writeRes.message, true);
                }
            } else {
                showTranslatorToast(modal, t(`反译失败: ${res.error || '网络错误'}`, `Translation failed`), true);
            }
        } catch (err) {
            showTranslatorToast(modal, t(`反译异常: ${err.message}`, `Error: ${err.message}`), true);
        } finally {
            translateAndWriteBtn.disabled = false;
            translateAndWriteBtn.innerHTML = `🌐 ${t('译为英文并写入节点', 'Translate to EN & Write')}`;
        }
    };

    writeNodeBtn.onclick = () => {
        let out = targetTextarea.value.trim();
        if (!out) {
            showTranslatorToast(modal, t('请先翻译或输入文本', 'No text to write'), true);
            return;
        }

        if (hasChinese(out)) {
            const confirmEn = confirm(t(
                '检测到当前文本包含中文。ComfyUI 生图模型通常需要英文提示词。\n\n点击【确定】：自动翻译为英文并规范写入\n点击【取消】：仍直接写入当前中文内容',
                'Current text contains Chinese. ComfyUI models usually require English prompts.\n\nClick [OK] to translate to English and write.\nClick [Cancel] to write Chinese directly.'
            ));
            if (confirmEn) {
                translateAndWriteBtn.click();
                return;
            }
        }

        if (/[，、;；|｜]/.test(out) && !hasChinese(out)) {
            out = normalizePromptFormatting(out);
            targetTextarea.value = out;
            updateTagChips(out);
        }
        const res = writeToSelectedNode(out);
        showTranslatorToast(modal, res.message, !res.success);
    };

    targetRightGroup.append(writeNodeBtn, translateAndWriteBtn);
    targetActions.append(targetLeftGroup, targetRightGroup);
    targetPane.appendChild(targetActions);
    body.appendChild(targetPane);

    modal.appendChild(body);

    // Translation Handler
    async function doTranslate() {
        const raw = sourceTextarea.value.trim();
        if (!raw) {
            sourceTextarea.focus();
            return;
        }

        const selectedLang = langSelect.value;
        const options = {};
        if (selectedLang !== 'auto') {
            options.targetLang = selectedLang;
        }

        translateBtn.disabled = true;
        translateBtn.innerHTML = `⏳ ${t('翻译中...', 'Translating...')}`;

        try {
            const res = await translatePromptText(raw, options);
            if (res.ok && res.translated) {
                targetTextarea.value = res.translated;
                updateTagChips(res.translated);
                showTranslatorToast(modal, t('✓ 翻译完成', '✓ Translated'));
            } else {
                showTranslatorToast(modal, t(`翻译失败: ${res.error || '网络错误'}`, `Failed: ${res.error || 'Network error'}`), true);
            }
        } catch (err) {
            showTranslatorToast(modal, t(`翻译异常: ${err.message}`, `Error: ${err.message}`), true);
        } finally {
            translateBtn.disabled = false;
            translateBtn.innerHTML = `🌐 ${t('一键翻译', 'Translate')}`;
        }
    }

    translateBtn.onclick = doTranslate;
    sourceTextarea.onkeydown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            doTranslate();
        }
    };
    targetTextarea.oninput = () => {
        updateTagChips(targetTextarea.value);
    };

    // Auto-load prompt from selected canvas node if any
    const initialNode = readSelectedNodePrompt();
    if (initialNode && initialNode.text) {
        sourceTextarea.value = initialNode.text;
    }

    // Close on clicking backdrop
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            overlay.remove();
            activeTranslatorModal = null;
        }
    };

    // Close on Escape key
    const onKeyDown = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            activeTranslatorModal = null;
            document.removeEventListener('keydown', onKeyDown);
        }
    };
    document.addEventListener('keydown', onKeyDown);

    document.body.appendChild(overlay);
    sourceTextarea.focus();
}
