import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { text, jsonResponse } from './ui_dom.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { joinPromptText, categorizePromptSnippet, smartSortPromptBlocks, workbenchDraftToSavedPlan } from './prompt_composition.js';
import { applyNodeMaterialValues, promptWidgetTargets, selectedMaterialNode } from './node_material_actions.js';
import { showMaterialApplication } from './ui_material_application.js';
import { showMaterialSaved } from './material_feedback.js';
import { translatePromptText } from './translation_service.js';
import { CATEGORY_META, newDraft, normalizeBlock, syncDraftSynthesizedText } from './prompt_studio_data.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { openPromptInspectorModal } from './ui_prompt_inspector.js';
import { createPromptSourceDeck } from './ui_prompt_source_deck.js';

export function createPromptWorkbench(owner, container, scope, options) {
    const view = text(container, 'section', '', 'anomalous-prompt-composer anomalous-prompt-workbench is-side-studio');

    let draft = owner.promptPlanDraft ||= newDraft();
    draft.plan ||= { version: 2, parts: [], positive: '', negative: '' };
    draft.plan.parts ||= [];

    // Migrate existing text if parts are empty
    if (!draft.plan.parts.length) {
        if (draft.plan.positive?.trim()) {
            draft.plan.parts.push(normalizeBlock({
                title: window.anomalous_browser_lang === 'zh' ? '基础正向词' : 'Positive Base',
                content: draft.plan.positive,
                role: 'positive',
                category: categorizePromptSnippet(draft.plan.positive),
            }, 0));
        }
        if (draft.plan.negative?.trim()) {
            draft.plan.parts.push(normalizeBlock({
                title: window.anomalous_browser_lang === 'zh' ? '通用负向过滤' : 'Negative Filter',
                content: draft.plan.negative,
                role: 'negative',
                category: 'base',
            }, 1));
        }
    }
    syncDraftSynthesizedText(draft);

    let activeTab = 'positive'; // 'positive' | 'negative'
    let draggedBlockId = null;

    // Local in-memory source prompt cards (merged starters + materials + user custom)

    // 1. Studio Topbar (Streamlined with inline preset name input)
    const topbar = text(view, 'header', '', 'anomalous-prompt-topbar');
    const topLeft = text(topbar, 'div', '', 'anomalous-prompt-topbar-left');
    text(topLeft, 'h3', window.anomalous_browser_lang === 'zh' ? '🎛️ 提示词工坊' : '🎛️ Prompt Studio');

    // Inline Preset Name Input
    const nameInput = text(topLeft, 'input', '', 'anomalous-prompt-name-input');
    nameInput.placeholder = window.anomalous_browser_lang === 'zh' ? '方案名称...' : 'Preset name...';
    nameInput.title = window.anomalous_browser_lang === 'zh' ? '输入组合方案名称' : 'Enter preset name';
    nameInput.maxLength = 120;
    nameInput.value = draft.name || '';
    nameInput.oninput = () => { draft.name = nameInput.value; };

    const topActions = text(topbar, 'div', '', 'anomalous-prompt-topbar-actions');

    // Quick Extract from Selected Canvas Node
    const extractQuickBtn = text(topActions, 'button', '', 'anomalous-btn-ghost anomalous-btn-sm');
    extractQuickBtn.innerHTML = '🎯';
    extractQuickBtn.title = window.anomalous_browser_lang === 'zh'
        ? '从画布选中节点一键吸取提示词'
        : 'Extract prompt from selected node';
    extractQuickBtn.onclick = () => sourceDeck.extractSelected(true);

    // Dock Side Switch (Left / Right)
    if (typeof options.onToggleDockSide === 'function') {
        const dockSideBtn = text(topActions, 'button', '', 'anomalous-btn-ghost anomalous-btn-sm');
        const isLeft = () => container?.classList.contains('is-dock-left');
        const updateDockBtn = () => {
            dockSideBtn.innerHTML = isLeft()
                ? `<svg style="width:13px;height:13px;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`
                : `<svg style="width:13px;height:13px;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>`;
            dockSideBtn.title = isLeft()
                ? (window.anomalous_browser_lang === 'zh' ? '停靠至右侧' : 'Dock to Right')
                : (window.anomalous_browser_lang === 'zh' ? '停靠至左侧' : 'Dock to Left');
        };
        updateDockBtn();
        dockSideBtn.onclick = () => {
            options.onToggleDockSide();
            updateDockBtn();
        };
    }

    // "More" Dropdown Menu (holds Save, New Draft, Tags)
    const moreWrap = text(topActions, 'div', '', 'anomalous-prompt-more-wrap');
    const moreBtn = text(moreWrap, 'button', window.anomalous_browser_lang === 'zh' ? '··· 更多' : '··· More', 'anomalous-btn-ghost anomalous-btn-sm anomalous-prompt-more-btn');
    const moreMenu = text(moreWrap, 'div', '', 'anomalous-prompt-more-menu');

    const closeMoreMenu = () => {
        moreMenu.classList.remove('is-open');
        moreBtn.classList.remove('is-active');
    };
    scope.listen(document, 'click', closeMoreMenu);

    moreWrap.onclick = (e) => e.stopPropagation();

    moreBtn.onclick = (e) => {
        e.stopPropagation();
        const willOpen = !moreMenu.classList.contains('is-open');
        moreMenu.classList.toggle('is-open', willOpen);
        moreBtn.classList.toggle('is-active', willOpen);
    };

    const saveBtn = text(moreMenu, 'button', `💾 ${t('promptSavePlan')}`, 'anomalous-prompt-more-item');
    saveBtn.title = t('promptSavePlan') || '保存方案至素材库';

    const newBtn = text(moreMenu, 'button', `✨ ${t('promptNewDraft')}`, 'anomalous-prompt-more-item');

    const tagsBtn = text(moreMenu, 'button', `🏷️ ${window.anomalous_browser_lang === 'zh' ? '设置标签' : 'Edit Tags'}`, 'anomalous-prompt-more-item');
    tagsBtn.onclick = () => {
        closeMoreMenu();
        const current = (draft.tags || []).join(', ');
        const val = prompt(window.anomalous_browser_lang === 'zh' ? '输入方案标签（用逗号或空格分隔）：' : 'Enter preset tags (comma separated):', current);
        if (val !== null) {
            draft.tags = val.split(/[\s,，\n\r]+/).map(v => v.trim()).filter(Boolean);
            showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? `已更新标签 (${draft.tags.length})` : `Tags updated (${draft.tags.length})`);
        }
    };

    const closeBtn = text(topActions, 'button', '✕', 'anomalous-btn-ghost anomalous-btn-sm anomalous-prompt-close-btn');
    closeBtn.title = t('close') || '关闭';
    closeBtn.onclick = () => {
        options.onClose();
    };

    // Insertion preference lives with the other secondary actions.
    const posWrap = document.createElement('label');
    posWrap.className = 'anomalous-prompt-insert-pos anomalous-prompt-more-pos';
    const posSelect = text(posWrap, 'select', '', 'anomalous-prompt-pos-select');
    for (const value of ['after', 'before']) {
        text(posSelect, 'option', t(`promptInsert_${value}`)).value = value;
    }
    posSelect.value = owner.promptInsertPosition || 'after';
    posSelect.setAttribute('aria-label', t('promptInsertPosition'));
    moreMenu.appendChild(posWrap);
    posSelect.onchange = () => {
        owner.promptInsertPosition = posSelect.value;
        closeMoreMenu();
    };

    // Two-Column Split Grid (Adapts to vertical dual-zone in sidebar mode)
    const workbenchGrid = text(view, 'div', '', 'anomalous-prompt-workbench-grid');

    // =========================================================================
    // LEFT COLUMN: Ready-to-use Prompt Cards (词卡库)
    // =========================================================================
    const sourceDeck = createPromptSourceDeck(workbenchGrid, container, scope, addSourceCardToMixer, () => activeTab);

    // =========================================================================
    // RIGHT COLUMN: Assembler & Arranger Stage (顺序拼装调音台)
    // =========================================================================
    const rightPanel = text(workbenchGrid, 'section', '', 'anomalous-workbench-right-panel');
    const rightHeader = text(rightPanel, 'div', '', 'anomalous-workbench-col-header');

    // Role switch tabs (Positive / Negative)
    const rightTabs = text(rightHeader, 'div', '', 'anomalous-mixer-tabs');

    const rightActions = text(rightHeader, 'div', '', 'anomalous-mixer-actions');

    // Right quick extract: suck into right mixer directly
    const rightSuckNodeBtn = text(rightActions, 'button', '', 'anomalous-btn-ghost anomalous-btn-sm');
    rightSuckNodeBtn.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>${t('promptReadSelectedNode')}`;
    rightSuckNodeBtn.title = window.anomalous_browser_lang === 'zh' ? '直接将画布选中节点的提示词作为积木吸入当前拼装台' : 'Extract node prompt directly into current mixer track';

    const smartSortBtn = text(rightActions, 'button', '', 'anomalous-mixer-smart-sort-btn');
    smartSortBtn.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${t('promptSortByCategory')}`;
    smartSortBtn.title = window.anomalous_browser_lang === 'zh' ? '按 [通用底模 ➔ 风格氛围 ➔ 主体内容 ➔ LoRA/触发词] 自动排序' : 'Auto sort: [Base ➔ Style ➔ Subject ➔ Trigger]';

    const clearRightBtn = text(rightActions, 'button', '', 'anomalous-btn-ghost');
    clearRightBtn.innerHTML = '<svg style="width:13px;height:13px;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    clearRightBtn.title = window.anomalous_browser_lang === 'zh' ? '清空当前拼装池' : 'Clear current track';

    // Blocks Container & Dropzone
    const blocksContainer = text(rightPanel, 'div', '', 'anomalous-mixer-blocks-container anomalous-assembly-track');

    blocksContainer.ondragover = (e) => {
        e.preventDefault();
        const snapDock = blocksContainer.querySelector('.anomalous-assembly-snap-dock');
        if (snapDock && (e.target === blocksContainer || e.target.closest('.anomalous-assembly-snap-dock'))) {
            snapDock.classList.add('is-drag-over');
            blocksContainer.classList.add('is-drag-over-end');
        }
    };
    blocksContainer.ondragleave = (e) => {
        if (!blocksContainer.contains(e.relatedTarget)) {
            const snapDock = blocksContainer.querySelector('.anomalous-assembly-snap-dock');
            snapDock?.classList.remove('is-drag-over');
            blocksContainer.classList.remove('is-drag-over-end');
        }
    };
    blocksContainer.ondrop = (e) => {
        if (e.target === blocksContainer || e.target.closest('.anomalous-assembly-snap-dock')) {
            e.preventDefault();
            const snapDock = blocksContainer.querySelector('.anomalous-assembly-snap-dock');
            snapDock?.classList.remove('is-drag-over');
            blocksContainer.classList.remove('is-drag-over-end');
            const jsonStr = e.dataTransfer.getData('application/json');
            if (jsonStr) {
                try {
                    addSourceCardToMixer(JSON.parse(jsonStr));
                    return;
                } catch (err) {}
            }
            if (draggedBlockId) {
                const fromIndex = draft.plan.parts.findIndex(p => p.id === draggedBlockId);
                if (fromIndex >= 0) {
                    const [moved] = draft.plan.parts.splice(fromIndex, 1);
                    draft.plan.parts.push(moved);
                    syncDraftSynthesizedText(draft);
                    renderBlocksList();
                    updateOutputPreview();
                }
            }
        }
    };

    // -------------------------------------------------------------------------
    // Node Direct Write Handler
    // -------------------------------------------------------------------------
    const applyPromptToCurrentNode = async (role, promptContent, triggerBtn = null) => {
        const node = selectedMaterialNode(app);
        if (!node) {
            anomalousAlert(window.anomalous_browser_lang === 'zh'
                ? '💡 请先在 ComfyUI 画布上点击选中一个提示词节点（例如 CLIPTextEncode）！'
                : '💡 Please select a prompt node (e.g. CLIPTextEncode) on the ComfyUI canvas first!');
            return;
        }
        const targets = promptWidgetTargets(node);
        if (!targets.length) {
            anomalousAlert(window.anomalous_browser_lang === 'zh'
                ? '⚠️ 选中的节点中未找到可写入的提示词文本输入！'
                : '⚠️ No writable prompt text widget found in selected node!');
            return;
        }
        const widgetIndex = targets[0].index;
        try {
            const value = joinPromptText(node.widgets[widgetIndex].value, promptContent, posSelect.value);
            showMaterialApplication(view, applyNodeMaterialValues(app, node, [{ index: widgetIndex, value }]), node);
            if (triggerBtn) {
                const orig = triggerBtn.textContent;
                triggerBtn.textContent = '✅ ' + (window.anomalous_browser_lang === 'zh' ? '已写入' : 'Written');
                setTimeout(() => { if (triggerBtn.isConnected) triggerBtn.textContent = orig; }, 1200);
            } else {
                showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? '✅ 提示词已成功写入节点！' : '✅ Prompt written to node!');
            }
            return true;
        } catch (error) {
            await anomalousAlert(t(error.message) === error.message ? t('materialApplyFailed') : t(error.message));
        }
    };

    // -------------------------------------------------------------------------
    // Floating Action Dock (Minimalist & Slides Up Only When Content Exists)
    // -------------------------------------------------------------------------
    const floatingDock = text(rightPanel, 'div', '', 'anomalous-floating-action-dock');
    floatingDock.style.display = 'none'; // Initially zero-height, hidden until content is added

    const dockLeft = text(floatingDock, 'div', '', 'anomalous-floating-dock-left');
    const dockStats = text(dockLeft, 'span', '', 'anomalous-dock-stats-text');

    const dockRight = text(floatingDock, 'div', '', 'anomalous-floating-dock-right');

    // 1. Write Node Button
    const writeNodeBtn = text(dockRight, 'button', `🚀 ${window.anomalous_browser_lang === 'zh' ? '写入节点' : 'Write Node'}`, 'anomalous-btn-primary anomalous-btn-sm');
    writeNodeBtn.title = window.anomalous_browser_lang === 'zh' ? '将当前合成提示词写入选中的 ComfyUI 节点' : 'Write assembled prompt to selected node';
    writeNodeBtn.onclick = async () => {
        syncDraftSynthesizedText(draft);
        const compiledText = (draft.plan[activeTab] || '').trim();
        if (!compiledText) return;
        await applyPromptToCurrentNode(activeTab, compiledText, writeNodeBtn);
    };

    // 2. Quick Copy Button
    const copyOutputBtn = text(dockRight, 'button', '📋', 'anomalous-btn-ghost anomalous-btn-sm');
    copyOutputBtn.title = window.anomalous_browser_lang === 'zh' ? '复制当前合成的提示词' : 'Copy assembled prompt text';
    // 3. Popout Full Inspector Modal Button
    let closeInspector = null;
    scope.onDispose(() => closeInspector?.());
    const popoutBtn = text(dockRight, 'button', '⛶', 'anomalous-btn-ghost anomalous-btn-sm');
    popoutBtn.title = window.anomalous_browser_lang === 'zh' ? '弹出独立大弹窗全览与精修' : 'Pop out full inspector modal';
    popoutBtn.onclick = () => {
        closeInspector?.();
        closeInspector = openPromptInspectorModal(draft, activeTab, async (role, textVal) => {
            return applyPromptToCurrentNode(role, textVal);
        }, () => {
            updateRightTabsUI();
            renderBlocksList();
            updateOutputPreview();
        });
    };


    // -------------------------------------------------------------------------
    // FEATURE IMPLEMENTATIONS: Node Extraction & Material Sync
    // -------------------------------------------------------------------------

    rightSuckNodeBtn.onclick = () => sourceDeck.extractSelected(true);

    function updateRightTabsUI() {
        rightTabs.replaceChildren();
        const posCount = draft.plan.parts.filter(p => (p.track || p.role) === 'positive').length;
        const negCount = draft.plan.parts.filter(p => (p.track || p.role) === 'negative').length;

        const tabs = [
            {
                key: 'positive',
                label: `⊕ ${window.anomalous_browser_lang === 'zh' ? '正向拼装台' : 'Positive'} (${posCount})`,
                cls: 'is-role-positive',
            },
            {
                key: 'negative',
                label: `⊖ ${window.anomalous_browser_lang === 'zh' ? '负向拼装台' : 'Negative'} (${negCount})`,
                cls: 'is-role-negative',
            },
        ];

        for (const tab of tabs) {
            const btn = text(rightTabs, 'button', tab.label, `anomalous-mixer-tab-btn ${tab.cls}${activeTab === tab.key ? ' is-active' : ''}`);
            btn.onclick = () => {
                activeTab = tab.key;
                updateRightTabsUI();
                renderBlocksList();
                updateOutputPreview();
            };
        }
    }

    function addSourceCardToMixer(cardData, targetIndex = null) {
        const cardRole = cardData.role || 'positive';
        const isCrossRole = cardRole !== activeTab;

        const newBlock = normalizeBlock({
            title: cardData.title,
            content: cardData.content,
            role: cardRole,
            track: activeTab,
            category: cardData.category,
            enabled: true,
        }, draft.plan.parts.length);
        newBlock._justAdded = true;

        if (targetIndex !== null && targetIndex >= 0) {
            draft.plan.parts.splice(targetIndex, 0, newBlock);
        } else if (isCrossRole) {
            // Cross-role cards (e.g. negative prompt on positive track) default to the tail ("扔到后面")
            draft.plan.parts.push(newBlock);
        } else {
            // Same-role cards: insert before any tail cross-role blocks on this track, or at the end
            const firstCrossIdx = draft.plan.parts.findIndex(p => (p.track || p.role) === activeTab && (p.role || 'positive') !== activeTab);
            if (firstCrossIdx >= 0) {
                draft.plan.parts.splice(firstCrossIdx, 0, newBlock);
            } else {
                draft.plan.parts.push(newBlock);
            }
        }

        syncDraftSynthesizedText(draft);
        updateRightTabsUI();
        renderBlocksList();
        updateOutputPreview();

        const count = draft.plan.parts.filter(p => (p.track || p.role) === activeTab).length;
        const crossNotice = isCrossRole
            ? (window.anomalous_browser_lang === 'zh'
                ? `（${cardRole === 'negative' ? '负向' : '正向'}词已默认置于末尾）`
                : ` (${cardRole} prompt placed at tail)`)
            : '';
        showWorkbenchToast(window.anomalous_browser_lang === 'zh'
            ? `已加入【${activeTab === 'positive' ? '正向' : '负向'}】拼装台${crossNotice}（共 ${count} 块）`
            : `Added to ${activeTab} track${crossNotice} (${count} blocks)`);
    }

    function renderBlocksList() {
        blocksContainer.replaceChildren();
        const currentRoleParts = draft.plan.parts.filter(p => (p.track || p.role) === activeTab);

        if (!currentRoleParts.length) {
            const dropzoneNotice = text(blocksContainer, 'div', '', 'anomalous-assembly-dropzone');
            dropzoneNotice.innerHTML = `
                <div style="margin-bottom: 12px; opacity: 0.65;">
                    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>
                    </svg>
                </div>
                <div style="font-size: 0.88rem; font-weight: 600; color: #f1f5f9;">${window.anomalous_browser_lang === 'zh' ? '点击词卡或拖拽到这里拼装' : 'Click cards or drag here to assemble'}</div>
                <div style="font-size: 0.74rem; color: #64748b; margin-top: 5px;">${window.anomalous_browser_lang === 'zh' ? '支持自由拖拽调换次序，点击【智能排序】一键理顺' : 'Reorder freely anytime, or click Smart Sort.'}</div>
            `;
            // Accept drops on empty dropzone
            setupDropzoneListeners(dropzoneNotice);
            return;
        }

        currentRoleParts.forEach((block, index) => {
            const isJustAdded = !!block._justAdded;
            if (isJustAdded) delete block._justAdded;
            const isCrossRole = (block.role || 'positive') !== activeTab;

            const blockEl = text(blocksContainer, 'article', '', `anomalous-mixer-block${!block.enabled ? ' is-bypassed' : ''} is-role-${block.role}${isCrossRole ? ' is-cross-role' : ''}${isJustAdded ? ' is-just-added' : ''}`);
            blockEl.setAttribute('draggable', 'true');
            blockEl.dataset ||= {};
            blockEl.dataset.blockId = block.id;

            if (isJustAdded) {
                requestAnimationFrame(() => {
                    blockEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                });
            }

            // Reorder Drag Listeners
            blockEl.ondragstart = (e) => {
                draggedBlockId = block.id;
                blockEl.classList.add('is-dragging');
                e.dataTransfer.setData('text/plain', block.content);
                e.dataTransfer.effectAllowed = 'move';
            };

            blockEl.ondragend = () => {
                draggedBlockId = null;
                blockEl.classList.remove('is-dragging');
                blocksContainer.querySelectorAll('.anomalous-mixer-block').forEach(el => {
                    el.classList.remove('is-drag-over-top', 'is-drag-over-bottom');
                });
            };

            blockEl.ondragover = (e) => {
                e.preventDefault();
                const rect = blockEl.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                if (e.clientY < mid) {
                    blockEl.classList.add('is-drag-over-top');
                    blockEl.classList.remove('is-drag-over-bottom');
                } else {
                    blockEl.classList.add('is-drag-over-bottom');
                    blockEl.classList.remove('is-drag-over-top');
                }
            };

            blockEl.ondragleave = () => {
                blockEl.classList.remove('is-drag-over-top', 'is-drag-over-bottom');
            };

            blockEl.ondrop = (e) => {
                e.preventDefault();
                blockEl.classList.remove('is-drag-over-top', 'is-drag-over-bottom');

                // Case 1: Drop from Left Source Card
                const jsonStr = e.dataTransfer.getData('application/json');
                if (jsonStr) {
                    try {
                        const parsed = JSON.parse(jsonStr);
                        const toIndex = draft.plan.parts.findIndex(p => p.id === block.id);
                        const insertAfter = e.clientY >= (blockEl.getBoundingClientRect().top + blockEl.offsetHeight / 2);
                        addSourceCardToMixer(parsed, insertAfter ? toIndex + 1 : toIndex);
                        return;
                    } catch (err) {}
                }

                // Case 2: Reorder inside Right Track
                if (!draggedBlockId || draggedBlockId === block.id) return;
                const fromIndex = draft.plan.parts.findIndex(p => p.id === draggedBlockId);
                if (fromIndex < 0) return;

                const [moved] = draft.plan.parts.splice(fromIndex, 1);
                const currentTargetIndex = draft.plan.parts.findIndex(p => p.id === block.id);
                if (currentTargetIndex < 0) {
                    draft.plan.parts.push(moved);
                } else {
                    const rect = blockEl.getBoundingClientRect();
                    const insertAfter = e.clientY >= (rect.top + rect.height / 2);
                    const finalIndex = insertAfter ? currentTargetIndex + 1 : currentTargetIndex;
                    draft.plan.parts.splice(finalIndex, 0, moved);
                }

                syncDraftSynthesizedText(draft);
                renderBlocksList();
                updateOutputPreview();
            };

            // Header
            const blockHeader = text(blockEl, 'div', '', 'anomalous-mixer-block-header');
            const headerLeft = text(blockHeader, 'div', '', 'anomalous-mixer-block-header-left');

            const dragHandle = text(headerLeft, 'span', '⠿', 'anomalous-mixer-drag-handle');
            dragHandle.title = window.anomalous_browser_lang === 'zh' ? '抓取按住上下拖拽排序' : 'Drag to reorder';

            // A/B Bypass Checkbox
            const toggleWrap = text(headerLeft, 'label', '', 'anomalous-mixer-block-toggle');
            const checkbox = text(toggleWrap, 'input', '');
            checkbox.type = 'checkbox';
            checkbox.checked = !!block.enabled;
            checkbox.title = window.anomalous_browser_lang === 'zh' ? '勾选参与拼装，取消勾选即旁路跳过（做A/B对比）' : 'Include or bypass in assembly';
            checkbox.onchange = () => {
                block.enabled = checkbox.checked;
                blockEl.classList.toggle('is-bypassed', !block.enabled);
                syncDraftSynthesizedText(draft);
                updateOutputPreview();
            };

            // Unified Role Badge with Prominent Indicator and Click-to-toggle
            const roleBadge = text(headerLeft, 'span', '', `anomalous-mixer-role-badge is-${block.role}${isCrossRole ? ' is-cross-role' : ''}`);
            const roleText = block.role === 'negative'
                ? (isCrossRole
                    ? (window.anomalous_browser_lang === 'zh' ? '⊖ 负向 (末尾)' : '⊖ Neg (Tail)')
                    : (window.anomalous_browser_lang === 'zh' ? '⊖ 负向' : '⊖ Negative'))
                : (isCrossRole
                    ? (window.anomalous_browser_lang === 'zh' ? '⊕ 正向 (末尾)' : '⊕ Pos (Tail)')
                    : (window.anomalous_browser_lang === 'zh' ? '⊕ 正向' : '⊕ Positive'));
            roleBadge.textContent = roleText;
            roleBadge.title = window.anomalous_browser_lang === 'zh'
                ? `当前属性：${block.role === 'negative' ? '负向' : '正向'}${isCrossRole ? '（跨角色默认置于末尾）' : ''}。点击切换正负属性。`
                : `Role: ${block.role}${isCrossRole ? ' (Cross-role at tail)' : ''}. Click to toggle.`;
            roleBadge.onclick = () => {
                block.role = block.role === 'negative' ? 'positive' : 'negative';
                syncDraftSynthesizedText(draft);
                renderBlocksList();
                updateOutputPreview();
                showWorkbenchToast(window.anomalous_browser_lang === 'zh'
                    ? `已将词块属性切换为【${block.role === 'positive' ? '正向' : '负向'}】`
                    : `Role changed to ${block.role}`);
            };

            // Category Badge
            const catMeta = CATEGORY_META[block.category] || CATEGORY_META.subject;
            const catBadge = text(headerLeft, 'span', window.anomalous_browser_lang === 'zh' ? catMeta.zh : catMeta.en, 'anomalous-mixer-cat-badge');
            catBadge.style.color = catMeta.color;
            catBadge.style.backgroundColor = catMeta.bg;
            catBadge.style.borderColor = catMeta.border;
            catBadge.title = window.anomalous_browser_lang === 'zh' ? '点击切换词性分类' : 'Cycle category';
            catBadge.onclick = () => {
                const cats = ['base', 'style', 'subject', 'trigger'];
                const nextIdx = (cats.indexOf(block.category) + 1) % cats.length;
                block.category = cats[nextIdx];
                renderBlocksList();
            };

            // Editable title
            const titleInput = text(headerLeft, 'input', '', 'anomalous-mixer-block-title-input');
            titleInput.value = block.title || '';
            titleInput.oninput = () => { block.title = titleInput.value; };

            // Weight Adjustment Pill with Mouse Wheel & Click
            let currentWeight = block.weight !== undefined ? block.weight : 1.0;
            const weightPill = text(headerLeft, 'span', '', 'anomalous-block-weight-pill');
            weightPill.title = window.anomalous_browser_lang === 'zh'
                ? '滚轮上下滑动调节权重，或点击加减'
                : 'Scroll wheel or click +/- to adjust weight';

            const decBtn = text(weightPill, 'button', '-', 'anomalous-block-weight-btn');
            const weightVal = text(weightPill, 'span', currentWeight.toFixed(2));
            const incBtn = text(weightPill, 'button', '+', 'anomalous-block-weight-btn');

            const applyBlockWeight = (newW) => {
                newW = Math.round(Math.max(0.1, Math.min(3.0, newW)) * 100) / 100;
                currentWeight = newW;
                block.weight = newW;
                weightVal.textContent = newW.toFixed(2);
                let clean = block.content.replace(/^\((.+):[0-9.]+\)$/, '$1').replace(/^\((.+)\)$/, '$1').trim();
                if (newW !== 1.0) {
                    block.content = `(${clean}:${newW.toFixed(2)})`;
                } else {
                    block.content = clean;
                }
                const txtArea = blockEl.querySelector('.anomalous-mixer-block-textarea');
                if (txtArea) txtArea.value = block.content;
                syncDraftSynthesizedText(draft);
                updateOutputPreview();
            };

            decBtn.onclick = (e) => { e.stopPropagation(); applyBlockWeight(currentWeight - 0.05); };
            incBtn.onclick = (e) => { e.stopPropagation(); applyBlockWeight(currentWeight + 0.05); };

            weightPill.onwheel = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const delta = e.deltaY < 0 ? 0.05 : -0.05;
                applyBlockWeight(currentWeight + delta);
            };

            // Right Action micro buttons
            const headerRight = text(blockHeader, 'div', '', 'anomalous-mixer-block-header-right');

            const transferBtn = text(headerRight, 'button', '⇄', 'anomalous-mixer-block-btn is-transfer');
            const targetTrack = activeTab === 'positive' ? 'negative' : 'positive';
            transferBtn.title = window.anomalous_browser_lang === 'zh'
                ? `移至${targetTrack === 'positive' ? '正向' : '负向'}拼装台`
                : `Move to ${targetTrack} track`;
            transferBtn.onclick = () => {
                block.track = targetTrack;
                syncDraftSynthesizedText(draft);
                updateRightTabsUI();
                renderBlocksList();
                updateOutputPreview();
                showWorkbenchToast(window.anomalous_browser_lang === 'zh'
                    ? `已将词块移至【${targetTrack === 'positive' ? '正向' : '负向'}】拼装台`
                    : `Moved block to ${targetTrack} track`);
            };

            const transBtn = text(headerRight, 'button', '🌐', 'anomalous-mixer-block-btn is-translate');
            transBtn.title = window.anomalous_browser_lang === 'zh' ? '一键翻译此块提示词' : 'Translate this block';
            transBtn.onclick = async () => {
                const raw = block.content || '';
                if (!raw.trim()) return;
                const orig = transBtn.textContent;
                transBtn.textContent = '⏳';
                try {
                    const res = await translatePromptText(raw, { signal: scope.signal });
                    if (scope.signal.aborted || !draft.plan.parts.includes(block) || block.content !== raw) return;
                    if (res.ok && res.translated) {
                        block.content = res.translated;
                        textarea.value = res.translated;
                        syncDraftSynthesizedText(draft);
                        updateOutputPreview();
                        showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? `✓ 词块已翻译为${res.targetLang === 'en' ? '英文' : '中文'}` : `✓ Block translated to ${res.targetLang}`);
                    } else {
                        showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? `翻译失败: ${res.error || '网络错误'}` : `Translation failed: ${res.error || 'Network error'}`);
                    }
                } finally {
                    transBtn.textContent = orig;
                }
            };

            const upBtn = text(headerRight, 'button', '▲', 'anomalous-mixer-block-btn');
            upBtn.title = window.anomalous_browser_lang === 'zh' ? '上移' : 'Move up';
            upBtn.disabled = index === 0;
            upBtn.onclick = () => {
                const trackBlocks = draft.plan.parts.filter(p => (p.track || p.role) === activeTab);
                const myTrackIdx = trackBlocks.findIndex(p => p.id === block.id);
                if (myTrackIdx > 0) {
                    const prevBlock = trackBlocks[myTrackIdx - 1];
                    const realIdx = draft.plan.parts.findIndex(p => p.id === block.id);
                    const prevRealIdx = draft.plan.parts.findIndex(p => p.id === prevBlock.id);
                    if (realIdx >= 0 && prevRealIdx >= 0) {
                        const temp = draft.plan.parts[realIdx];
                        draft.plan.parts[realIdx] = draft.plan.parts[prevRealIdx];
                        draft.plan.parts[prevRealIdx] = temp;
                        syncDraftSynthesizedText(draft);
                        renderBlocksList();
                        updateOutputPreview();
                    }
                }
            };

            const downBtn = text(headerRight, 'button', '▼', 'anomalous-mixer-block-btn');
            downBtn.title = window.anomalous_browser_lang === 'zh' ? '下移' : 'Move down';
            downBtn.disabled = index === currentRoleParts.length - 1;
            downBtn.onclick = () => {
                const trackBlocks = draft.plan.parts.filter(p => (p.track || p.role) === activeTab);
                const myTrackIdx = trackBlocks.findIndex(p => p.id === block.id);
                if (myTrackIdx >= 0 && myTrackIdx < trackBlocks.length - 1) {
                    const nextBlock = trackBlocks[myTrackIdx + 1];
                    const realIdx = draft.plan.parts.findIndex(p => p.id === block.id);
                    const nextRealIdx = draft.plan.parts.findIndex(p => p.id === nextBlock.id);
                    if (realIdx >= 0 && nextRealIdx >= 0) {
                        const temp = draft.plan.parts[realIdx];
                        draft.plan.parts[realIdx] = draft.plan.parts[nextRealIdx];
                        draft.plan.parts[nextRealIdx] = temp;
                        syncDraftSynthesizedText(draft);
                        renderBlocksList();
                        updateOutputPreview();
                    }
                }
            };

            const delBtn = text(headerRight, 'button', '✕', 'anomalous-mixer-block-btn is-delete');
            delBtn.title = window.anomalous_browser_lang === 'zh' ? '移除此块' : 'Remove block';
            delBtn.onclick = () => {
                const realIdx = draft.plan.parts.findIndex(p => p.id === block.id);
                if (realIdx >= 0) {
                    draft.plan.parts.splice(realIdx, 1);
                    syncDraftSynthesizedText(draft);
                    updateRightTabsUI();
                    renderBlocksList();
                    updateOutputPreview();
                }
            };

            // Body
            const blockBody = text(blockEl, 'div', '', 'anomalous-mixer-block-body');
            const textarea = text(blockBody, 'textarea', '', 'anomalous-mixer-block-textarea');
            textarea.value = block.content || '';
            textarea.rows = 1;
            textarea.oninput = () => {
                block.content = textarea.value;
                syncDraftSynthesizedText(draft);
                updateOutputPreview();
            };
        });

        // Interactive Auto-snap Dock at end of track
        const snapDock = text(blocksContainer, 'div', '', 'anomalous-assembly-snap-dock');
        snapDock.innerHTML = `
            <div class="anomalous-snap-dock-content">
                <svg class="anomalous-snap-icon" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                <span class="anomalous-snap-dock-text">${window.anomalous_browser_lang === 'zh' ? '拖拽卡片至此自动贴合至末尾' : 'Drop card here to snap to bottom'}</span>
            </div>
        `;
        setupDropzoneListeners(snapDock);
        snapDock.onclick = () => {
            leftSearch?.focus?.();
            showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? '点击左侧词卡即可直接加入此处' : 'Click any card on left to add here');
        };
    }

    function setupDropzoneListeners(el) {
        el.ondragover = (e) => {
            e.preventDefault();
            el.classList.add('is-drag-over');
        };
        el.ondragleave = () => {
            el.classList.remove('is-drag-over');
        };
        el.ondrop = (e) => {
            e.preventDefault();
            el.classList.remove('is-drag-over');
            const jsonStr = e.dataTransfer.getData('application/json');
            if (jsonStr) {
                try {
                    addSourceCardToMixer(JSON.parse(jsonStr));
                    return;
                } catch (err) {}
            }
            if (draggedBlockId) {
                const fromIndex = draft.plan.parts.findIndex(p => p.id === draggedBlockId);
                if (fromIndex >= 0) {
                    const [moved] = draft.plan.parts.splice(fromIndex, 1);
                    draft.plan.parts.push(moved);
                    syncDraftSynthesizedText(draft);
                    renderBlocksList();
                    updateOutputPreview();
                }
            }
        };
    }

    function updateOutputPreview() {
        syncDraftSynthesizedText(draft);
        const compiledText = (draft.plan[activeTab] || '').trim();
        const currentRoleParts = draft.plan.parts.filter(p => (p.track || p.role) === activeTab);

        if (!currentRoleParts.length && !compiledText) {
            floatingDock.style.display = 'none';
        } else {
            floatingDock.style.display = 'flex';
            const words = compiledText.split(/[,，\s\n]+/).filter(Boolean).length;
            const roleIcon = activeTab === 'negative' ? '⊖' : '⊕';
            const roleName = activeTab === 'negative' ? (window.anomalous_browser_lang === 'zh' ? '负向' : 'Negative') : (window.anomalous_browser_lang === 'zh' ? '正向' : 'Positive');
            dockStats.innerHTML = `${roleIcon} <strong>${currentRoleParts.length}</strong> ${window.anomalous_browser_lang === 'zh' ? '块' : 'blocks'} · ~<strong>${words}</strong> ${window.anomalous_browser_lang === 'zh' ? '词' : 'words'}`;
            dockStats.title = `${roleIcon} ${roleName}: ${compiledText.length} ${window.anomalous_browser_lang === 'zh' ? '字符' : 'chars'}, ${currentRoleParts.length} ${window.anomalous_browser_lang === 'zh' ? '块积木' : 'blocks'}`;
        }
    }

    // Smart Sort
    smartSortBtn.onclick = () => {
        if (!draft.plan.parts.length) return;
        const trackParts = draft.plan.parts.filter(p => (p.track || p.role) === activeTab);
        const otherParts = draft.plan.parts.filter(p => (p.track || p.role) !== activeTab);
        const sorted = smartSortPromptBlocks(trackParts, activeTab);
        draft.plan.parts = [...sorted, ...otherParts];

        syncDraftSynthesizedText(draft);
        renderBlocksList();
        updateOutputPreview();

        smartSortBtn.classList.add('is-animating');
        setTimeout(() => smartSortBtn.classList.remove('is-animating'), 500);
    };

    // Clear track
    clearRightBtn.onclick = async () => {
        const msg = window.anomalous_browser_lang === 'zh'
            ? `确定清空当前【${activeTab === 'positive' ? '⊕ 正向' : '⊖ 负向'}】拼装池吗？`
            : `Clear ${activeTab} mixer track?`;
        if (await anomalousConfirm(msg) && !scope.signal.aborted) {
            draft.plan.parts = draft.plan.parts.filter(p => (p.track || p.role) !== activeTab);
            syncDraftSynthesizedText(draft);
            updateRightTabsUI();
            renderBlocksList();
            updateOutputPreview();
        }
    };

    // Copy preview text
    copyOutputBtn.onclick = async (e) => {
        e?.stopPropagation?.();
        const textToCopy = (draft.plan[activeTab] || '').trim();
        if (!textToCopy) return;
        try {
            await navigator.clipboard.writeText(textToCopy);
            copyOutputBtn.textContent = '✅';
            setTimeout(() => { if (copyOutputBtn.isConnected) copyOutputBtn.textContent = `📋`; }, 1500);
        } catch (err) {
            await anomalousAlert(t('materialCopyError'));
        }
    };

    // -------------------------------------------------------------------------
    // Target Node Direct Injection Toolbar (Compact sticky bar integrated into Action Dock)
    // -------------------------------------------------------------------------
    // Save Plan to Material Library
    saveBtn.onclick = async () => {
        closeMoreMenu();
        if (!draft.name?.trim()) {
            nameInput.focus();
            nameInput.classList.add('is-invalid');
            setTimeout(() => nameInput.classList.remove('is-invalid'), 1200);
            showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? '请先在顶栏输入方案名称！' : 'Please enter preset name first!');
            return;
        }
        saveBtn.disabled = true;
        syncDraftSynthesizedText(draft);
        const saved = workbenchDraftToSavedPlan(draft);
        const body = {
            name: draft.name.trim(),
            tags: draft.tags || [],
            plan: saved.plan,
        };

        const send = () => fetch('/anomalous/save_prompt_plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        try {
            let response = await send();
            if (response.status === 409) {
                const duplicate = await response.json();
                if (!await anomalousConfirm(t('materialDuplicateConfirm', { name: duplicate.name })) || scope.signal.aborted) return;
                body.allow_duplicate = true;
                response = await send();
            }
            const payload = await jsonResponse(response, 'prompt save failed');
            if (payload.status !== 'success') throw new Error('prompt save failed');
            if (!scope.signal.aborted) {
                showMaterialSaved(owner, payload.material);
                void sourceDeck.sync();
            }
        } catch (error) {
            if (!scope.signal.aborted) await anomalousAlert(t('materialSaveError'));
        } finally {
            saveBtn.disabled = false;
        }
    };

    // New Draft
    newBtn.onclick = async () => {
        closeMoreMenu();
        if (await anomalousConfirm(t('promptReplaceDraft')) && !scope.signal.aborted) {
            owner.promptPlanDraft = draft = newDraft();
            draft.plan.parts.push(normalizeBlock({
                title: window.anomalous_browser_lang === 'zh' ? '正向提示词' : 'Positive Prompt',
                content: '',
                role: 'positive',
                category: 'base',
            }, 0));
            syncDraftSynthesizedText(draft);
            updateRightTabsUI();
            renderBlocksList();
            updateOutputPreview();
            nameInput.value = '';
            draft.tags = [];
        }
    };

    // Initial render execution
    sourceDeck.refresh();
    updateRightTabsUI();
    renderBlocksList();
    updateOutputPreview();


    const control = {
        updateAll: () => {
            updateRightTabsUI();
            renderBlocksList();
            updateOutputPreview();
            sourceDeck.refresh();
        },
        addBlock: (blockData) => {
            addSourceCardToMixer(blockData);
        },
    };

    return control;
}
