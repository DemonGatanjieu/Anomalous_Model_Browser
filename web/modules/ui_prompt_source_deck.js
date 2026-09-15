import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { text, jsonResponse } from './ui_dom.js';
import { materialNodeHeading } from './material_inspector.js';
import { anomalousAlert } from './ui_dialog.js';
import { promptWidgetTargets, selectedMaterialNode } from './node_material_actions.js';
import { categorizePromptSnippet } from './prompt_composition.js';
import { CATEGORY_META, STARTER_SOURCE_PROMPTS } from './prompt_studio_data.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { loadPromptSourceCards, mergePromptSourceCards } from './prompt_material_source.js';
import { translatePromptText } from './translation_service.js';

export function createPromptSourceDeck(workbenchGrid, drawer, scope, addSourceCardToMixer, getActiveRole = () => 'positive') {
    const sourceCards = [...STARTER_SOURCE_PROMPTS];
    let sourceFilterCategory = 'all';
    let sourceFilterKeyword = '';
    let isCreatingNewCard = false;
    let activeCardPreviewPopover = null;
    let activeCardAnchorEl = null;
    let hidePopoverTimer = null;
    let openPopoverTimer = null;
    let isPopoverPinned = false;

    let lastPointerX = 0;
    let lastPointerY = 0;

    function isPointInSafeZone(clientX, clientY) {
        if (!activeCardPreviewPopover?.isConnected || !activeCardAnchorEl?.isConnected) return false;
        const popRect = activeCardPreviewPopover.getBoundingClientRect();
        const cardRect = activeCardAnchorEl.getBoundingClientRect();

        // 1. Inside anchor card with 4px buffer
        if (
            clientX >= cardRect.left - 4 &&
            clientX <= cardRect.right + 4 &&
            clientY >= cardRect.top - 4 &&
            clientY <= cardRect.bottom + 4
        ) {
            return true;
        }

        // 2. Inside popover with 6px buffer
        if (
            clientX >= popRect.left - 6 &&
            clientX <= popRect.right + 6 &&
            clientY >= popRect.top - 6 &&
            clientY <= popRect.bottom + 6
        ) {
            return true;
        }

        // 3. Narrow bridging corridor strictly between card and popover
        const isDockLeft = drawer?.classList.contains('is-dock-left') ?? true;
        let inBridgeX = false;
        if (isDockLeft) {
            // Card is on the left, Popover is on the right
            const bridgeLeft = cardRect.right - 6;
            const bridgeRight = popRect.left + 6;
            inBridgeX = clientX >= bridgeLeft && clientX <= bridgeRight;
        } else {
            // Card is on the right, Popover is on the left
            const bridgeLeft = popRect.right - 6;
            const bridgeRight = cardRect.left + 6;
            inBridgeX = clientX >= bridgeLeft && clientX <= bridgeRight;
        }

        if (inBridgeX) {
            const minY = Math.min(cardRect.top, popRect.top) - 10;
            const maxY = Math.max(cardRect.bottom, popRect.bottom) + 10;
            if (clientY >= minY && clientY <= maxY) {
                return true;
            }
        }

        return false;
    }

    function scheduleHidePopover(fast = false) {
        if (isPopoverPinned) return;
        clearTimeout(hidePopoverTimer);
        const delay = fast ? 90 : 200;
        hidePopoverTimer = setTimeout(() => {
            if (isPointInSafeZone(lastPointerX, lastPointerY)) {
                return;
            }
            hideCardPreviewPopover();
        }, delay);
    }

    function cancelHidePopover() {
        clearTimeout(hidePopoverTimer);
    }

    function hideCardPreviewPopover(force = false) {
        if (isPopoverPinned && !force) return;
        clearTimeout(hidePopoverTimer);
        clearTimeout(openPopoverTimer);
        activeCardAnchorEl?.classList.remove('is-preview-active');
        activeCardAnchorEl = null;
        activeCardPreviewPopover?.remove();
        activeCardPreviewPopover = null;
        isPopoverPinned = false;
    }
    scope.onDispose(() => hideCardPreviewPopover(true));

    const onPointerMove = (e) => {
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        if (!activeCardPreviewPopover || isPopoverPinned) return;

        if (isPointInSafeZone(e.clientX, e.clientY)) {
            cancelHidePopover();
        } else {
            scheduleHidePopover(true);
        }
    };
    scope.listen(window, 'pointermove', onPointerMove, { passive: true });

    const onDocPointerDown = (e) => {
        if (!activeCardPreviewPopover) return;
        if (!activeCardPreviewPopover.contains(e.target) && !activeCardAnchorEl?.contains(e.target)) {
            hideCardPreviewPopover(true);
        }
    };
    scope.listen(document, 'pointerdown', onDocPointerDown);
    const leftPanel = text(workbenchGrid, 'section', '', 'anomalous-workbench-left-panel');
    const leftHeader = text(leftPanel, 'div', '', 'anomalous-workbench-col-header');
    const leftTitleWrap = text(leftHeader, 'div', '', 'anomalous-workbench-col-title');
    text(leftTitleWrap, 'strong', window.anomalous_browser_lang === 'zh' ? '词卡库' : 'Prompt Library');
    const leftCounter = text(leftTitleWrap, 'span', '', 'anomalous-sub-counter');

    // Action button group in leftHeader
    const leftHeaderActions = text(leftHeader, 'div', '', 'anomalous-workbench-header-actions');

    const syncStatus = text(leftPanel, 'div', t('promptLibraryAutoSync'), 'anomalous-source-sync-status');
    syncStatus.setAttribute('role', 'status');

    // Button 2: Create New Custom Card
    const newCardTriggerBtn = text(leftHeaderActions, 'button', '', 'anomalous-btn-ghost anomalous-btn-sm anomalous-icon-btn');
    newCardTriggerBtn.innerHTML = `<svg style="width:13px;height:13px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    newCardTriggerBtn.title = window.anomalous_browser_lang === 'zh' ? '新建词卡' : 'Create new prompt card';

    // Search and category filters bar
    const leftFilterBar = text(leftPanel, 'div', '', 'anomalous-workbench-filter-bar');
    const leftSearch = text(leftFilterBar, 'input', '', 'anomalous-workbench-search-input');
    leftSearch.placeholder = window.anomalous_browser_lang === 'zh' ? '搜索词卡...' : 'Search cards...';
    leftSearch.oninput = () => {
        sourceFilterKeyword = leftSearch.value.trim().toLowerCase();
        renderSourceCardsList();
    };

    const leftCategoryPills = text(leftPanel, 'div', '', 'anomalous-workbench-category-pills');
    const filterCats = [
        { id: 'all', label: window.anomalous_browser_lang === 'zh' ? '全部' : 'All' },
        { id: 'base', label: window.anomalous_browser_lang === 'zh' ? '底模' : 'Base' },
        { id: 'style', label: window.anomalous_browser_lang === 'zh' ? '风格' : 'Style' },
        { id: 'subject', label: window.anomalous_browser_lang === 'zh' ? '主体' : 'Subject' },
        { id: 'trigger', label: window.anomalous_browser_lang === 'zh' ? '触发' : 'Trigger' },
    ];
    filterCats.forEach(cat => {
        const pill = text(leftCategoryPills, 'button', cat.label, `anomalous-workbench-pill${sourceFilterCategory === cat.id ? ' is-active' : ''}`);
        pill.onclick = () => {
            sourceFilterCategory = cat.id;
            leftCategoryPills.querySelectorAll('.anomalous-workbench-pill').forEach(el => el.classList.remove('is-active'));
            pill.classList.add('is-active');
            renderSourceCardsList();
        };
    });

    // Inline New Card Form (Hidden by default, shown on demand)
    const newCardForm = text(leftPanel, 'div', '', 'anomalous-workbench-new-card-form');
    newCardForm.style.display = 'none';

    // Source Cards List
    const sourceCardsList = text(leftPanel, 'div', '', 'anomalous-source-cards-list');

    // Dismiss preview popover when pointer is on blank space of the list or panel
    sourceCardsList.addEventListener('pointermove', (e) => {
        if (isPopoverPinned || !activeCardPreviewPopover) return;
        if (e.target === sourceCardsList) {
            scheduleHidePopover(true);
        }
    }, { passive: true });

    sourceCardsList.addEventListener('pointerdown', (e) => {
        if (e.target === sourceCardsList) {
            hideCardPreviewPopover(true);
        }
    });

    leftPanel.addEventListener('pointermove', (e) => {
        if (isPopoverPinned || !activeCardPreviewPopover) return;
        if (e.target === leftPanel || e.target === leftFilterBar || e.target === leftCategoryPills) {
            scheduleHidePopover(true);
        }
    }, { passive: true });

    function detectNodePromptRole(node, widgetName = '') {
        if (/neg|negative|反向|负向/i.test(widgetName)) return 'negative';
        if (/pos|positive|正面|正向/i.test(widgetName)) return 'positive';

        if (app?.graph && Array.isArray(node?.outputs)) {
            for (const output of node.outputs) {
                if (!Array.isArray(output.links)) continue;
                for (const linkId of output.links) {
                    const link = app.graph.links?.[linkId];
                    if (!link) continue;
                    const targetNode = app.graph.getNodeById(link.target_id);
                    if (targetNode?.inputs && targetNode.inputs[link.target_slot]) {
                        const targetInput = targetNode.inputs[link.target_slot];
                        const inputName = String(targetInput.name || '').toLowerCase();
                        if (inputName.includes('neg') || inputName.includes('负')) return 'negative';
                        if (inputName.includes('pos') || inputName.includes('正')) return 'positive';
                    }
                }
            }
        }

        const nodeText = `${node?.title || ''} ${node?.type || ''}`.toLowerCase();
        if (/neg|negative|反向|负向/.test(nodeText)) return 'negative';
        if (/pos|positive|正面|正向/.test(nodeText)) return 'positive';

        return 'positive';
    }

    // Extract prompts from selected canvas node
    function extractPromptsFromSelectedNode(intoRightMixer = false) {
        const node = selectedMaterialNode(app);
        if (!node) {
            anomalousAlert(window.anomalous_browser_lang === 'zh'
                ? '💡 请先在 ComfyUI 画布上点击选中一个提示词节点（例如 CLIPTextEncode 或包含 prompt 文本的节点）！'
                : '💡 Please select a prompt node (e.g. CLIPTextEncode) on the ComfyUI canvas first!');
            return;
        }

        const heading = materialNodeHeading(node) || node.title || node.type || `Node #${node.id}`;
        let targets = promptWidgetTargets(node);

        // Safe fallback: only prompt/caption/text widgets or textarea, exclude settings/file paths
        if (!targets.length && Array.isArray(node.widgets)) {
            targets = node.widgets.flatMap((w, idx) => {
                const name = String(w.name || '').toLowerCase();
                if (/filename|prefix|path|directory|save|load|ckpt|model|vae|seed|steps|cfg|denoise|sampler|scheduler/i.test(name)) {
                    return [];
                }
                if (typeof w.value === 'string' && w.value.trim().length > 0 && !w.options?.values) {
                    if (/prompt|caption|text|description|words|tags/i.test(name) || w.type === 'customtext' || w.type === 'string') {
                        return [{ index: idx, name: w.name || 'text' }];
                    }
                }
                return [];
            });
        }

        if (!targets.length) {
            anomalousAlert(window.anomalous_browser_lang === 'zh'
                ? `⚠️ 选中的节点【${heading}】中未检测到有效的提示词文本输入！`
                : `⚠️ No valid prompt text found in selected node [${heading}]!`);
            return;
        }

        let extractedCount = 0;
        targets.forEach(t => {
            const rawVal = String(node.widgets[t.index]?.value || '').trim();
            if (!rawVal) return;
            const role = detectNodePromptRole(node, t.name);
            const cat = role === 'negative' ? 'base' : categorizePromptSnippet(rawVal);
            const cardTitle = `${heading} · ${t.name}`;

            const newCard = {
                id: `node_${node.id}_${t.index}_${Date.now()}`,
                title: cardTitle,
                content: rawVal,
                role,
                category: cat,
                persisted: false,
            };

            // Add into left source deck
            sourceCards.unshift(newCard);
            extractedCount++;

            // If user clicked right panel, also insert into mixer track directly
            if (intoRightMixer) {
                addSourceCardToMixer(newCard);
            }
        });

        if (extractedCount > 0) {
            renderSourceCardsList();
            showWorkbenchToast(window.anomalous_browser_lang === 'zh'
                ? `已成功从节点【${heading}】提取 ${extractedCount} 段提示词${intoRightMixer ? '并加入组合' : '并加入左侧词库'}！`
                : `Successfully extracted ${extractedCount} prompts from [${heading}]!`);
        } else {
            anomalousAlert(window.anomalous_browser_lang === 'zh'
                ? `选中的节点【${heading}】文本内容为空！`
                : `The text fields in node [${heading}] are empty!`);
        }
    }

    let materialSyncController = null;
    let materialSyncTimer = null;
    scope.onDispose(() => {
        clearTimeout(materialSyncTimer);
        materialSyncController?.abort();
    });
    function scheduleMaterialSync() {
        clearTimeout(materialSyncTimer);
        if (scope.signal.aborted) return;
        materialSyncTimer = setTimeout(() => {
            if (document.hidden) scheduleMaterialSync();
            else void syncMaterialsIntoSourceDeck();
        }, 30000);
    }
    async function syncMaterialsIntoSourceDeck() {
        if (scope.signal.aborted) return;
        clearTimeout(materialSyncTimer);
        materialSyncController?.abort();
        const controller = new AbortController();
        materialSyncController = controller;
        try {
            const cards = await loadPromptSourceCards(controller.signal);
            if (scope.signal.aborted || controller.signal.aborted) return;
            const previous = JSON.stringify(sourceCards);
            mergePromptSourceCards(sourceCards, cards);
            if (previous !== JSON.stringify(sourceCards)) renderSourceCardsList();
            syncStatus.textContent = t('promptLibraryAutoSync');
        } catch (error) {
            if (!scope.signal.aborted && !controller.signal.aborted) {
                syncStatus.textContent = t('promptLibrarySyncFailed');
            }
        } finally {
            if (materialSyncController === controller) {
                materialSyncController = null;
                scheduleMaterialSync();
            }
        }
    }
    scope.listen(window, 'focus', () => { void syncMaterialsIntoSourceDeck(); });
    scope.listen(document, 'visibilitychange', () => {
        if (!document.hidden) void syncMaterialsIntoSourceDeck();
    });
    // -------------------------------------------------------------------------
    // RENDER: Left Panel Cards & Form
    // -------------------------------------------------------------------------
    function renderNewCardFormUI() {
        if (!isCreatingNewCard) {
            newCardForm.style.display = 'none';
            newCardForm.replaceChildren();
            return;
        }
        newCardForm.style.display = 'flex';
        newCardForm.replaceChildren();

        text(newCardForm, 'div', window.anomalous_browser_lang === 'zh' ? '✨ 新建提示词卡片' : '✨ New Prompt Card', 'anomalous-form-title');

        const titleInput = text(newCardForm, 'input', '', 'anomalous-form-input');
        titleInput.placeholder = window.anomalous_browser_lang === 'zh' ? '卡片名称（如：赛博光影、角色面部）...' : 'Card name...';

        // Role & Category selector row
        const metaRow = text(newCardForm, 'div', '', 'anomalous-form-meta-row');

        // Role radio group
        const roleGroup = text(metaRow, 'div', '', 'anomalous-form-role-group');
        let selectedRole = getActiveRole();

        const posLabel = text(roleGroup, 'label', '', 'anomalous-role-label');
        const posRadio = text(posLabel, 'input', '');
        posRadio.type = 'radio';
        posRadio.name = 'new_card_role';
        posRadio.value = 'positive';
        posRadio.checked = selectedRole === 'positive';
        text(posLabel, 'span', t('promptRolePositive'));

        const negLabel = text(roleGroup, 'label', '', 'anomalous-role-label');
        const negRadio = text(negLabel, 'input', '');
        negRadio.type = 'radio';
        negRadio.name = 'new_card_role';
        negRadio.value = 'negative';
        negRadio.checked = selectedRole === 'negative';
        text(negLabel, 'span', t('promptRoleNegative'));

        posRadio.onchange = () => { if (posRadio.checked) selectedRole = 'positive'; };
        negRadio.onchange = () => { if (negRadio.checked) selectedRole = 'negative'; };

        // Category dropdown
        const catWrap = text(metaRow, 'div', '', 'anomalous-form-cat-wrap');
        text(catWrap, 'span', `${window.anomalous_browser_lang === 'zh' ? '分类' : 'Type'}: `);
        let selectedCat = 'style';
        const catSelect = text(catWrap, 'select', '', 'anomalous-form-select');
        ['base', 'style', 'subject', 'trigger'].forEach(catKey => {
            const meta = CATEGORY_META[catKey];
            const opt = text(catSelect, 'option', window.anomalous_browser_lang === 'zh' ? meta.zh : meta.en);
            opt.value = catKey;
            if (catKey === selectedCat) opt.selected = true;
        });
        catSelect.onchange = () => { selectedCat = catSelect.value; };

        const contentInput = text(newCardForm, 'textarea', '', 'anomalous-form-textarea');
        contentInput.placeholder = window.anomalous_browser_lang === 'zh' ? '输入提示词内容，多个短语用逗号隔开...' : 'Enter prompt text...';
        contentInput.rows = 3;

        const formBtnRow = text(newCardForm, 'div', '', 'anomalous-form-btn-row');
        const submitBtn = text(formBtnRow, 'button', window.anomalous_browser_lang === 'zh' ? '✓ 保存并加入库' : '✓ Save to Library', 'anomalous-btn-primary anomalous-btn-sm');

        const translateBtn = text(formBtnRow, 'button', window.anomalous_browser_lang === 'zh' ? '🌐 翻译' : '🌐 Translate', 'anomalous-btn-ghost anomalous-btn-sm anomalous-btn-card-translate');
        translateBtn.type = 'button';
        translateBtn.title = window.anomalous_browser_lang === 'zh' ? '一键双向翻译 (中/英互译)' : 'One-click bilingual translation';
        translateBtn.onclick = async () => {
            const raw = contentInput.value.trim();
            if (!raw) return;
            const originalText = translateBtn.textContent;
            translateBtn.disabled = true;
            translateBtn.textContent = '⏳ ...';
            try {
                const res = await translatePromptText(raw, { signal: scope.signal });
                if (scope.signal.aborted || !contentInput.isConnected || contentInput.value.trim() !== raw) return;
                if (res.ok && res.translated) {
                    contentInput.value = res.translated;
                    showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? `✓ 已翻译为${res.targetLang === 'en' ? '英文' : '中文'}` : `✓ Translated to ${res.targetLang}`);
                } else {
                    showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? `翻译失败: ${res.error || '网络错误'}` : `Translation failed: ${res.error || 'Network error'}`);
                }
            } finally {
                translateBtn.disabled = false;
                translateBtn.textContent = originalText;
            }
        };

        const cancelBtn = text(formBtnRow, 'button', t('cancel'), 'anomalous-btn-ghost anomalous-btn-sm');

        submitBtn.onclick = async () => {
            const rawContent = contentInput.value.trim();
            if (!rawContent) {
                contentInput.focus();
                return;
            }
            submitBtn.disabled = true;
            submitBtn.textContent = '⏳ ...';

            const cardTitle = titleInput.value.trim() || (window.anomalous_browser_lang === 'zh' ? CATEGORY_META[selectedCat].zh : CATEGORY_META[selectedCat].en);
            const newCard = {
                id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                title: cardTitle,
                content: rawContent,
                role: selectedRole,
                category: selectedCat,
                persisted: false,
            };

            try {
                const body = {
                    name: cardTitle,
                    tags: ['prompt_card', selectedCat, selectedRole],
                    allow_duplicate: true,
                    plan: {
                        version: 2,
                        positive: selectedRole === 'positive' ? rawContent : '',
                        negative: selectedRole === 'negative' ? rawContent : '',
                        parts: [{
                            id: newCard.id,
                            name: cardTitle,
                            category: selectedCat,
                            role: selectedRole,
                            positive: selectedRole === 'positive' ? rawContent : '',
                            negative: selectedRole === 'negative' ? rawContent : '',
                            enabled: true,
                        }],
                    },
                };
                const res = await fetch('/anomalous/save_prompt_plan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const payload = await jsonResponse(res, 'save prompt card');
                if (scope.signal.aborted) return;
                if (payload.status === 'success') {
                    newCard.persisted = true;
                    newCard.filename = payload.filename;
                    newCard.sourceKind = 'material';
                    newCard.id = `mat_${selectedRole}_${payload.filename}`;
                    showWorkbenchToast(t('promptSaveCardSuccess'));
                }
            } catch (err) {
                if (scope.signal.aborted) return;
                showWorkbenchToast(t('promptSaveCardFailed'));
            }

            sourceCards.unshift(newCard);
            isCreatingNewCard = false;
            renderNewCardFormUI();
            renderSourceCardsList();
        };

        cancelBtn.onclick = () => {
            isCreatingNewCard = false;
            renderNewCardFormUI();
        };

        titleInput.focus();
    }

    newCardTriggerBtn.onclick = () => {
        isCreatingNewCard = !isCreatingNewCard;
        renderNewCardFormUI();
    };

    function showCardPreviewPopover(card, anchorEl) {
        cancelHidePopover();
        clearTimeout(openPopoverTimer);
        if (!anchorEl?.isConnected) return;
        if (isPopoverPinned) return;

        if (activeCardAnchorEl && activeCardAnchorEl !== anchorEl) {
            activeCardAnchorEl.classList.remove('is-preview-active');
        }
        activeCardAnchorEl = anchorEl;
        anchorEl.classList.add('is-preview-active');

        if (activeCardPreviewPopover) {
            activeCardPreviewPopover.remove();
            activeCardPreviewPopover = null;
        }

        const catMeta = CATEGORY_META[card.category] || CATEGORY_META.subject;
        const popover = document.createElement('div');
        popover.className = 'anomalous-card-preview-popover';
        popover.__card = card;
        popover.__anchorEl = anchorEl;

        popover.onmouseenter = (e) => {
            lastPointerX = e.clientX;
            lastPointerY = e.clientY;
            cancelHidePopover();
            clearTimeout(openPopoverTimer);
        };
        popover.onmouseleave = (e) => {
            lastPointerX = e.clientX;
            lastPointerY = e.clientY;
            scheduleHidePopover();
        };

        const header = document.createElement('div');
        header.className = 'anomalous-popover-header';

        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;';

        const tags = document.createElement('div');
        tags.className = 'anomalous-popover-tags';

        const catBadge = document.createElement('span');
        catBadge.className = 'anomalous-popover-cat';
        catBadge.style.color = catMeta.color;
        catBadge.style.background = catMeta.bg;
        catBadge.style.borderColor = catMeta.border;
        catBadge.textContent = window.anomalous_browser_lang === 'zh' ? catMeta.zh : catMeta.en;
        tags.appendChild(catBadge);

        const roleBadge = document.createElement('span');
        roleBadge.className = `anomalous-popover-role is-${card.role}`;
        roleBadge.textContent = card.role === 'negative'
            ? (window.anomalous_browser_lang === 'zh' ? '⊖ 负向' : '⊖ Negative')
            : (window.anomalous_browser_lang === 'zh' ? '⊕ 正向' : '⊕ Positive');
        tags.appendChild(roleBadge);
        topRow.appendChild(tags);

        const topActions = document.createElement('div');
        topActions.style.cssText = 'display:flex;align-items:center;gap:4px;';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'anomalous-popover-copy-btn';
        copyBtn.innerHTML = '📋 ' + (window.anomalous_browser_lang === 'zh' ? '复制' : 'Copy');
        copyBtn.title = window.anomalous_browser_lang === 'zh' ? '复制提示词到剪贴板' : 'Copy prompt text';
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(card.content).then(() => {
                copyBtn.innerHTML = '✅ ' + (window.anomalous_browser_lang === 'zh' ? '已复制' : 'Copied');
                setTimeout(() => {
                    if (copyBtn.isConnected) copyBtn.innerHTML = '📋 ' + (window.anomalous_browser_lang === 'zh' ? '复制' : 'Copy');
                }, 1200);
            });
        };
        topActions.appendChild(copyBtn);

        const pinBtn = document.createElement('button');
        pinBtn.type = 'button';
        pinBtn.className = 'anomalous-popover-pin-btn';
        pinBtn.innerHTML = '📌 ' + (window.anomalous_browser_lang === 'zh' ? '固定' : 'Pin');
        pinBtn.title = window.anomalous_browser_lang === 'zh' ? '固定浮窗防止移动时自动关闭' : 'Pin preview to keep open';
        pinBtn.onclick = (e) => {
            e.stopPropagation();
            isPopoverPinned = !isPopoverPinned;
            popover.classList.toggle('is-pinned', isPopoverPinned);
            pinBtn.classList.toggle('is-active', isPopoverPinned);
            pinBtn.innerHTML = isPopoverPinned
                ? '📌 ' + (window.anomalous_browser_lang === 'zh' ? '已固定' : 'Pinned')
                : '📌 ' + (window.anomalous_browser_lang === 'zh' ? '固定' : 'Pin');
            closeBtn.style.display = isPopoverPinned ? 'inline-flex' : 'none';
        };
        topActions.appendChild(pinBtn);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'anomalous-popover-close-btn';
        closeBtn.innerHTML = '✕';
        closeBtn.title = window.anomalous_browser_lang === 'zh' ? '关闭浮窗' : 'Close popover';
        closeBtn.style.display = 'none';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            hideCardPreviewPopover(true);
        };
        topActions.appendChild(closeBtn);

        topRow.appendChild(topActions);
        header.appendChild(topRow);

        const titleEl = document.createElement('div');
        titleEl.className = 'anomalous-popover-title';
        titleEl.textContent = card.title;
        header.appendChild(titleEl);

        popover.appendChild(header);

        if (card.sourceKind === 'material') {
            text(header, 'div', t('promptLibrarySource', { name: card.title, filename: card.filename }), 'anomalous-source-origin');
            text(header, 'div', t('promptLibraryReadOnly'), 'anomalous-source-origin');
        }

        const body = document.createElement('div');
        body.className = 'anomalous-popover-body';
        const snippet = document.createElement('pre');
        snippet.className = 'anomalous-popover-snippet';
        snippet.textContent = card.content;
        body.appendChild(snippet);
        popover.appendChild(body);

        const footer = document.createElement('div');
        footer.className = 'anomalous-popover-footer';
        footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';

        const hint = document.createElement('span');
        hint.textContent = window.anomalous_browser_lang === 'zh'
            ? '💡 点击卡片直接添加'
            : '💡 Click card to add';
        footer.appendChild(hint);

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'anomalous-popover-add-btn';
        addBtn.innerHTML = '＋ ' + (window.anomalous_browser_lang === 'zh' ? '加入台' : 'Add');
        addBtn.title = window.anomalous_browser_lang === 'zh' ? '将词卡加入右侧拼装台' : 'Add card to track';
        addBtn.onclick = (e) => {
            e.stopPropagation();
            addSourceCardToMixer(card);
            hideCardPreviewPopover(true);
        };
        footer.appendChild(addBtn);

        popover.appendChild(footer);

        document.body.appendChild(popover);
        activeCardPreviewPopover = popover;

        // Smart Positioning
        const rect = anchorEl.getBoundingClientRect();
        const isDockLeft = drawer?.classList.contains('is-dock-left') ?? true;
        const popoverHeight = popover.offsetHeight || 160;
        const top = Math.max(12, Math.min(window.innerHeight - popoverHeight - 12, rect.top - 6));
        popover.style.top = `${top}px`;

        if (isDockLeft) {
            popover.classList.add('is-dock-left');
            popover.style.left = `${rect.right + 6}px`;
        } else {
            popover.classList.add('is-dock-right');
            popover.style.left = `${Math.max(12, rect.left - 326)}px`;
        }
    }

    function renderSourceCardsList() {
        hideCardPreviewPopover(true);
        sourceCardsList.replaceChildren();
        sourceCardsList.onscroll = () => {
            if (!isPopoverPinned) {
                hideCardPreviewPopover(true);
            }
        };

        const filtered = sourceCards.filter(card => {
            if (sourceFilterCategory !== 'all' && card.category !== sourceFilterCategory) return false;
            if (sourceFilterKeyword) {
                const matchTitle = card.title.toLowerCase().includes(sourceFilterKeyword);
                const matchContent = card.content.toLowerCase().includes(sourceFilterKeyword);
                if (!matchTitle && !matchContent) return false;
            }
            return true;
        });

        leftCounter.textContent = `(${filtered.length})`;

        if (!filtered.length) {
            const empty = text(sourceCardsList, 'div', '', 'anomalous-source-empty');
            empty.innerHTML = `
                <div style="font-size: 24px; margin-bottom: 6px;">🔍</div>
                <div>${window.anomalous_browser_lang === 'zh' ? '未找到匹配的提示词卡片' : 'No matching prompt cards found'}</div>
            `;
            return;
        }

        filtered.forEach(card => {
            const catMeta = CATEGORY_META[card.category] || CATEGORY_META.subject;
            const cardEl = text(sourceCardsList, 'div', '', `anomalous-source-card-compact is-cat-${card.category} is-role-${card.role}`);
            cardEl.setAttribute('draggable', 'true');

            // Custom Eye-Catching Hover Preview Popover (replaces native OS browser title tooltip)
            cardEl.onmouseenter = (e) => {
                lastPointerX = e.clientX;
                lastPointerY = e.clientY;
                cancelHidePopover();
                clearTimeout(openPopoverTimer);
                if (activeCardPreviewPopover && activeCardPreviewPopover.__card === card) {
                    return;
                }
                if (isPopoverPinned) return;

                openPopoverTimer = setTimeout(() => {
                    showCardPreviewPopover(card, cardEl);
                }, 100);
            };
            cardEl.onmouseleave = (e) => {
                lastPointerX = e.clientX;
                lastPointerY = e.clientY;
                clearTimeout(openPopoverTimer);
                scheduleHidePopover();
            };

            // Drag Start
            cardEl.ondragstart = (e) => {
                hideCardPreviewPopover(true);
                const payload = {
                    title: card.title,
                    content: card.content,
                    role: card.role,
                    category: card.category,
                };
                e.dataTransfer.setData('application/json', JSON.stringify(payload));
                e.dataTransfer.setData('text/plain', card.content);
                e.dataTransfer.effectAllowed = 'copyMove';
                cardEl.classList.add('is-dragging-source');
                workbenchGrid.classList.add('is-source-dragging');
            };

            cardEl.ondragend = () => {
                cardEl.classList.remove('is-dragging-source');
                workbenchGrid.classList.remove('is-source-dragging');
            };

            const dot = text(cardEl, 'span', '', 'anomalous-source-card-dot');
            dot.style.backgroundColor = catMeta.color;

            const roleTag = text(cardEl, 'span', card.role === 'negative' ? (window.anomalous_browser_lang === 'zh' ? '⊖ 负' : '⊖ Neg') : (window.anomalous_browser_lang === 'zh' ? '⊕ 正' : '⊕ Pos'), `anomalous-card-role-tag is-${card.role}`);
            roleTag.title = card.role === 'negative' ? (window.anomalous_browser_lang === 'zh' ? '负向词卡' : 'Negative card') : (window.anomalous_browser_lang === 'zh' ? '正向词卡' : 'Positive card');

            const nameWrap = text(cardEl, 'div', '', 'anomalous-source-card-label');
            text(nameWrap, 'span', card.title, 'anomalous-source-card-name');
            if (card.sourceKind === 'material') {
                cardEl.dataset.sourceFilename = card.filename;
                const origin = text(nameWrap, 'span', t('promptLibraryBadge'), 'anomalous-source-origin');
                origin.title = t('promptLibrarySource', { name: card.title, filename: card.filename }) + '\n' + t('promptLibraryReadOnly');
            }

            const addIcon = text(cardEl, 'span', '+', 'anomalous-source-card-add-icon');

            cardEl.onclick = () => {
                hideCardPreviewPopover(true);
                addSourceCardToMixer(card);
            };
        });
    }

    renderNewCardFormUI();
    renderSourceCardsList();
    void syncMaterialsIntoSourceDeck();
    return {
        extractSelected: extractPromptsFromSelectedNode,
        refresh: renderSourceCardsList,
        sync: syncMaterialsIntoSourceDeck,
        hidePreview: (force = false) => hideCardPreviewPopover(force),
    };
}
