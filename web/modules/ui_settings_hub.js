/**
 * Settings hub and model-card display preferences.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';
import { configureSidebarActions } from './sidebar_actions.js';

const t = (key, params) => translate(key, params);

export function createSettingsHub(owner, {
    container,
    savedScale,
    savedBgOpacity,
    updateLangClass,
    modelsBtn,
    galleryBtn,
    toolboxBtn,
    nbBtn,
    dockBtn,
    updateNoticeBtn,
    icons,
    onBeforeOpen,
}) {
    let refreshModelSettingsText = () => {};

    const helpBtn = document.createElement('button');
    helpBtn.id = 'anomalous-help-btn';
    helpBtn.title = t('helpTitle');
    helpBtn.innerHTML = `${icons.HELP}<span class="anomalous-btn-text">${t('help')}</span>`;
    helpBtn.onclick = () => owner.showHelp();

    const settingsHubModal = document.createElement('div');
    settingsHubModal.id = 'anomalous-settings-hub-modal';
    settingsHubModal.style.display = 'none';
    settingsHubModal.style.flexDirection = 'column';
    settingsHubModal.style.gap = '4px';

    const langBtn = document.createElement('button');
    langBtn.className = 'anomalous-lang-btn';
    langBtn.textContent = t(window.anomalous_browser_lang === 'zh' ? 'sidebarSwitchToEnglish' : 'sidebarSwitchToChinese');
    const refreshLanguageUi = () => {
        langBtn.textContent = t(window.anomalous_browser_lang === 'zh' ? 'sidebarSwitchToEnglish' : 'sidebarSwitchToChinese');
        updateLangClass();
        modelsBtn.innerHTML = `${icons.MODELS}<span class="anomalous-btn-text">${t('models')}</span>`;
        galleryBtn.innerHTML = `${icons.GALLERY}<span class="anomalous-btn-text">${t('gallery')}</span>`;
        toolboxBtn.removeAttribute('title');
        toolboxBtn.setAttribute('aria-label', t('sidebarToolbox'));
        toolboxBtn.setAttribute('data-tooltip', t('sidebarToolbox'));
        toolboxBtn.setAttribute('data-tooltip-pos', 'top');
        helpBtn.innerHTML = `${icons.HELP}<span class="anomalous-btn-text">${t('help')}</span>`;
        if (owner.renderToolboxModal) owner.renderToolboxModal();
        if (owner.renderShortcutActions) owner.renderShortcutActions();
        nbBtn.removeAttribute('title');
        nbBtn.setAttribute('data-tooltip', t('recipeTitle'));
        nbBtn.setAttribute('data-tooltip-pos', 'bottom');
        nbBtn.innerHTML = `${icons.RECIPES}<span class="anomalous-btn-text">${t('recipeTitle')}</span>`;

        const sBtn = document.getElementById('anomalous-global-settings-btn');
        if (sBtn) { sBtn.removeAttribute('title'); sBtn.setAttribute('data-tooltip', t('sidebarSettings')); sBtn.setAttribute('data-tooltip-pos', 'top'); }
        configureSidebarActions(owner.sidebarWrapper);
        const bgLabel = document.getElementById('anomalous-bg-opacity-label');
        if (bgLabel) bgLabel.textContent = t('sidebarBgAtmosphere');
        if (dockBtn) {
            dockBtn.removeAttribute('title');
            dockBtn.setAttribute('aria-label', t('dockTitle'));
            dockBtn.setAttribute('data-tooltip', t('dockTitle'));
            dockBtn.setAttribute('data-tooltip-pos', 'bottom');
        }
        if (updateNoticeBtn) {
            updateNoticeBtn.setAttribute('data-tooltip', t('updateGuideNoticeTooltip'));
            updateNoticeBtn.setAttribute('aria-label', t('updateGuideNoticeTooltip'));
        }

        // Reset dynamic panels so they re-render in new language
        if (window.anomalousBrowserInstance) {
            const b = window.anomalousBrowserInstance;
            if (b.doctorPanel) {
                b.doctorPanel.innerHTML = '';
                b.doctorPanelInitialized = false;
            }
            if (b.assistantPanel && b.assistantPanelInitialized) {
                const selectedNode = Object.values(app.canvas?.selected_nodes || {})[0] || null;
                b.assistantPanelInitialized = false;
                b.initAssistantPanel();
                b.diagnoseNode(selectedNode, true);
            }
            if (b.notebookNotesTab) b.notebookNotesTab.textContent = t('promptNotes');
            if (b.notebookRecipesTab) b.notebookRecipesTab.textContent = t('recipeTitle');
        }
        document.querySelectorAll('[data-anomalous-i18n-key]').forEach((element) => {
            const key = element.dataset.anomalousI18nKey;
            if (key) element.textContent = t(key);
        });
        const impOverlay = document.getElementById('anomalous-import-overlay');
        if (impOverlay && impOverlay.parentNode) {
            impOverlay.parentNode.removeChild(impOverlay);
        }

        const resetBtnRef = document.getElementById('anomalous-reset-btn');
        if (resetBtnRef) resetBtnRef.textContent = t('sidebarResetLayout');
        const scaleLabelRef = document.getElementById('anomalous-scale-label');
        if (scaleLabelRef) scaleLabelRef.textContent = t('sidebarUiScale');
        const vmLabelRef = document.getElementById('anomalous-view-mode-label');
        if (vmLabelRef) vmLabelRef.textContent = t('sidebarViewMode');
        const stdBtnRef = document.getElementById('anomalous-view-mode-btn-standard');
        if (stdBtnRef) stdBtnRef.textContent = t('sidebarViewModeStandard');
        const cmpBtnRef = document.getElementById('anomalous-view-mode-btn-compact');
        if (cmpBtnRef) cmpBtnRef.textContent = t('sidebarViewModeCompact');
        const aesBtnRef = document.getElementById('anomalous-view-mode-btn-aesthetic');
        if (aesBtnRef) aesBtnRef.textContent = t('sidebarViewModeAesthetic');
        const folderMgrRef = document.getElementById('anomalous-folder-manager-btn');
        if (folderMgrRef) folderMgrRef.textContent = t('sidebarManageFolders');
        const feedbackRef = document.getElementById('anomalous-feedback-btn');
        if (feedbackRef) feedbackRef.textContent = t('sidebarFeedback');

        refreshModelSettingsText();
        owner.renderSidebar();
        owner.loadModels();
        if (owner.detailPanel.style.display !== 'none' && owner.currentDetailModel) {
            owner.showDetail(owner.currentDetailModel);
        }
        if (owner.nbEditor && owner.nbEditor.innerHTML !== '') {
            owner.renderNotebookEditor();
            owner.refreshNotebooks();
        }
    };

    langBtn.onclick = async () => {
        const newLang = window.anomalous_browser_lang === 'zh' ? 'en' : 'zh';
        try {
            const settings = app.extensionManager?.setting;
            if (typeof settings?.set !== 'function') throw new Error('Settings API unavailable');
            await settings.set('Anomalous.ModelBrowser.Language', newLang);
        } catch (error) {
            localStorage.setItem('anomalous_lang', newLang);
            window.anomalous_browser_lang = newLang;
            refreshLanguageUi();
        }
    };
    window.addEventListener('anomalous-language-change', refreshLanguageUi);

    const styleHubBtn = (btn) => {
        btn.style.background = 'transparent';
        btn.style.border = '1px solid rgba(255,255,255,0.05)';
        btn.style.color = '#ccc';
        btn.style.textAlign = 'left';
        btn.style.padding = '8px 10px';
        btn.style.borderRadius = '8px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '0.85em';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.transition = 'all 0.2s';
        btn.onmouseover = () => { btn.style.background = 'rgba(255,255,255,0.08)'; btn.style.color = '#fff'; };
        btn.onmouseout = () => { btn.style.background = 'transparent'; btn.style.color = '#ccc'; };
    };

    styleHubBtn(langBtn);
    styleHubBtn(helpBtn);

    const modelSettingsBtn = document.createElement('button');
    modelSettingsBtn.id = 'anomalous-model-settings-btn';
    styleHubBtn(modelSettingsBtn);

    const modelSettingsOverlay = document.createElement('div');
    modelSettingsOverlay.className = 'anomalous-model-settings-overlay';
    modelSettingsOverlay.hidden = true;

    const modelSettingsDialog = document.createElement('div');
    modelSettingsDialog.className = 'anomalous-model-settings-dialog';
    modelSettingsDialog.setAttribute('role', 'dialog');
    modelSettingsDialog.setAttribute('aria-modal', 'false');

    const modelSettingsTitle = document.createElement('h2');
    const modelSettingsDescription = document.createElement('p');
    modelSettingsDescription.className = 'anomalous-model-settings-description';

    const createSettingRow = () => {
        const row = document.createElement('label');
        row.className = 'anomalous-model-setting-row';
        const copy = document.createElement('span');
        copy.className = 'anomalous-model-setting-copy';
        const name = document.createElement('strong');
        const help = document.createElement('small');
        copy.append(name, help);
        const select = document.createElement('select');
        select.className = 'anomalous-model-setting-select';
        row.append(copy, select);
        return { row, name, help, select };
    };

    const videoSetting = createSettingRow();
    const alwaysPlayOption = new Option('', 'always');
    const hoverPlayOption = new Option('', 'hover');
    videoSetting.select.append(alwaysPlayOption, hoverPlayOption);

    const thumbnailSetting = createSettingRow();
    const balancedThumbnailOption = new Option('', 'balanced');
    const originalThumbnailOption = new Option('', 'original');
    thumbnailSetting.select.append(balancedThumbnailOption, originalThumbnailOption);

    const modelSettingsNote = document.createElement('div');
    modelSettingsNote.className = 'anomalous-model-settings-note';

    const modelSettingsClose = document.createElement('button');
    modelSettingsClose.className = 'anomalous-model-settings-close';

    modelSettingsDialog.append(
        modelSettingsTitle,
        modelSettingsDescription,
        videoSetting.row,
        thumbnailSetting.row,
        modelSettingsNote,
        modelSettingsClose,
    );
    modelSettingsOverlay.appendChild(modelSettingsDialog);
    container.appendChild(modelSettingsOverlay);

    refreshModelSettingsText = () => {
        modelSettingsBtn.textContent = t('sidebarModelSettings');
        modelSettingsTitle.textContent = t('sidebarModelCardSettings');
        modelSettingsDescription.textContent = t('sidebarModelCardDescription');
        videoSetting.name.textContent = t('sidebarVideoPlayback');
        videoSetting.help.textContent = t('sidebarVideoHelp');
        alwaysPlayOption.textContent = t('sidebarAlwaysPlay');
        hoverPlayOption.textContent = t('sidebarHoverPlay');
        thumbnailSetting.name.textContent = t('sidebarCardQuality');
        thumbnailSetting.help.textContent = t('sidebarCardQualityHelp');
        balancedThumbnailOption.textContent = t('sidebarOptimizedThumbnail');
        originalThumbnailOption.textContent = t('sidebarOriginalCover');
        modelSettingsNote.textContent = t('sidebarModelSettingsNote');
        modelSettingsClose.textContent = t('sidebarDone');
        videoSetting.select.value = owner.energySaving ? 'hover' : 'always';
        thumbnailSetting.select.value = owner.cardThumbnailMode;
    };
    refreshModelSettingsText();

    const setModelSettingsOpen = (isOpen) => {
        modelSettingsOverlay.hidden = !isOpen;
        modelSettingsDialog.setAttribute('aria-modal', String(isOpen));
    };
    const closeModelSettings = () => { setModelSettingsOpen(false); };
    modelSettingsBtn.onclick = () => {
        refreshModelSettingsText();
        settingsHubModal.style.display = 'none';
        setModelSettingsOpen(true);
        videoSetting.select.focus();
    };
    modelSettingsClose.onclick = closeModelSettings;
    modelSettingsOverlay.onclick = (event) => {
        if (event.target === modelSettingsOverlay) closeModelSettings();
    };
    videoSetting.select.onchange = () => {
        owner.energySaving = videoSetting.select.value === 'hover';
        localStorage.setItem('anomalous_energy_saving', String(owner.energySaving));
        owner.loadModels();
    };
    thumbnailSetting.select.onchange = () => {
        owner.cardThumbnailMode = thumbnailSetting.select.value === 'original' ? 'original' : 'balanced';
        localStorage.setItem('anomalous_card_thumbnail_mode', owner.cardThumbnailMode);
        owner.loadModels();
    };

    // Display Mode Selector (标准模式 / 高密度 / 沉浸模式)
    const viewModeContainer = document.createElement('div');
    viewModeContainer.id = 'anomalous-view-mode-container';
    viewModeContainer.style.display = 'flex';
    viewModeContainer.style.flexDirection = 'column';
    viewModeContainer.style.gap = '6px';
    viewModeContainer.style.background = 'rgba(255, 255, 255, 0.03)';
    viewModeContainer.style.padding = '8px 10px';
    viewModeContainer.style.borderRadius = '8px';
    viewModeContainer.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    viewModeContainer.style.marginBottom = '4px';

    const viewModeHeader = document.createElement('div');
    viewModeHeader.style.display = 'flex';
    viewModeHeader.style.justifyContent = 'space-between';
    viewModeHeader.style.alignItems = 'center';

    const viewModeLabel = document.createElement('span');
    viewModeLabel.id = 'anomalous-view-mode-label';
    viewModeLabel.textContent = t('sidebarViewMode');
    viewModeLabel.style.color = '#ccc';
    viewModeLabel.style.fontSize = '0.88em';
    viewModeLabel.style.fontWeight = '500';
    viewModeHeader.appendChild(viewModeLabel);

    const viewModeGroup = document.createElement('div');
    viewModeGroup.style.display = 'grid';
    viewModeGroup.style.gridTemplateColumns = '1fr 1fr 1fr';
    viewModeGroup.style.gap = '4px';
    viewModeGroup.style.background = 'rgba(0, 0, 0, 0.35)';
    viewModeGroup.style.padding = '3px';
    viewModeGroup.style.borderRadius = '6px';
    viewModeGroup.style.border = '1px solid rgba(255, 255, 255, 0.06)';

    const modeDefinitions = [
        { id: 'compact', key: 'sidebarViewModeCompact' },
        { id: 'standard', key: 'sidebarViewModeStandard' },
        { id: 'aesthetic', key: 'sidebarViewModeAesthetic' }
    ];

    let currentViewMode = localStorage.getItem('anomalous_view_mode') || 'compact';
    if (!['compact', 'standard', 'aesthetic'].includes(currentViewMode)) {
        currentViewMode = 'compact';
    }

    const modeBtnElements = [];

    const applyViewMode = (mode) => {
        currentViewMode = mode;
        localStorage.setItem('anomalous_view_mode', mode);
        container.classList.remove('view-mode-standard', 'view-mode-compact', 'view-mode-aesthetic');
        container.classList.add(`view-mode-${mode}`);

        modeBtnElements.forEach(({ btn, mId }) => {
            const isActive = mId === mode;
            btn.style.background = isActive ? 'rgba(255, 255, 255, 0.16)' : 'transparent';
            btn.style.color = isActive ? '#ffffff' : '#94a3b8';
            btn.style.fontWeight = isActive ? '600' : '400';
            btn.style.boxShadow = isActive ? '0 1px 4px rgba(0, 0, 0, 0.4)' : 'none';
        });

        if (bgOpacityContainer) {
            bgOpacityContainer.style.display = mode === 'aesthetic' ? 'flex' : 'none';
        }
    };

    modeDefinitions.forEach(m => {
        const btn = document.createElement('button');
        btn.id = `anomalous-view-mode-btn-${m.id}`;
        btn.textContent = t(m.key);
        btn.style.border = 'none';
        btn.style.borderRadius = '4px';
        btn.style.padding = '5px 2px';
        btn.style.fontSize = '0.78em';
        btn.style.cursor = 'pointer';
        btn.style.transition = 'all 0.18s ease';
        btn.style.textAlign = 'center';
        btn.onclick = () => applyViewMode(m.id);
        viewModeGroup.appendChild(btn);
        modeBtnElements.push({ btn, mId: m.id, key: m.key });
    });

    viewModeContainer.appendChild(viewModeHeader);
    viewModeContainer.appendChild(viewModeGroup);

    const scaleContainer = document.createElement('div');
    scaleContainer.style.display = 'flex';
    scaleContainer.style.alignItems = 'center';
    scaleContainer.style.justifyContent = 'space-between';
    scaleContainer.style.background = 'rgba(255, 255, 255, 0.03)';
    scaleContainer.style.padding = '8px 10px';
    scaleContainer.style.borderRadius = '8px';
    scaleContainer.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    scaleContainer.style.marginBottom = '4px';

    const scaleLabel = document.createElement('span');
    scaleLabel.id = 'anomalous-scale-label';
    scaleLabel.textContent = t('sidebarUiScale');
    scaleLabel.style.color = '#ccc';
    scaleLabel.style.fontSize = '0.88em';

    let currentScale = parseFloat(savedScale);

    const controlsWrapper = document.createElement('div');
    controlsWrapper.style.display = 'flex';
    controlsWrapper.style.alignItems = 'center';
    controlsWrapper.style.gap = '8px';

    const scaleVal = document.createElement('span');
    scaleVal.innerText = `${Math.round(currentScale * 100)}%`;
    scaleVal.style.color = '#fff';
    scaleVal.style.fontSize = '0.9em';
    scaleVal.style.minWidth = '45px';
    scaleVal.style.textAlign = 'center';

    const createScaleBtn = (text, delta) => {
        const btn = document.createElement('button');
        btn.innerText = text;
        btn.style.background = '#333';
        btn.style.color = '#fff';
        btn.style.border = '1px solid #555';
        btn.style.borderRadius = '4px';
        btn.style.width = '24px';
        btn.style.height = '24px';
        btn.style.cursor = 'pointer';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.onmouseover = () => btn.style.background = '#444';
        btn.onmouseout = () => btn.style.background = '#333';
        btn.onclick = () => {
            currentScale = Math.max(0.5, Math.min(1.5, currentScale + delta));
            scaleVal.innerText = `${Math.round(currentScale * 100)}%`;
            container.style.setProperty('--anomalous-scale', currentScale);
            localStorage.setItem('anomalous_ui_scale', currentScale);
        };
        return btn;
    };

    const minusBtn = createScaleBtn('-', -0.1);
    const plusBtn = createScaleBtn('+', 0.1);

    controlsWrapper.appendChild(minusBtn);
    controlsWrapper.appendChild(scaleVal);
    controlsWrapper.appendChild(plusBtn);

    scaleContainer.appendChild(scaleLabel);
    scaleContainer.appendChild(controlsWrapper);

    const bgOpacityContainer = document.createElement('div');
    bgOpacityContainer.style.display = 'flex';
    bgOpacityContainer.style.alignItems = 'center';
    bgOpacityContainer.style.justifyContent = 'space-between';
    bgOpacityContainer.style.background = 'rgba(255, 255, 255, 0.03)';
    bgOpacityContainer.style.padding = '8px 10px';
    bgOpacityContainer.style.borderRadius = '8px';
    bgOpacityContainer.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    bgOpacityContainer.style.marginBottom = '4px';

    const bgOpacityLabel = document.createElement('span');
    bgOpacityLabel.id = 'anomalous-bg-opacity-label';
    bgOpacityLabel.textContent = t('sidebarBgAtmosphere');
    bgOpacityLabel.style.color = '#ccc';
    bgOpacityLabel.style.fontSize = '0.88em';

    let currentBgOpacity = parseFloat(savedBgOpacity);

    const bgControlsWrapper = document.createElement('div');
    bgControlsWrapper.style.display = 'flex';
    bgControlsWrapper.style.alignItems = 'center';
    bgControlsWrapper.style.gap = '8px';

    const bgOpacityVal = document.createElement('span');
    bgOpacityVal.innerText = `${Math.round(currentBgOpacity * 100)}%`;
    bgOpacityVal.style.color = '#fff';
    bgOpacityVal.style.fontSize = '0.9em';
    bgOpacityVal.style.minWidth = '45px';
    bgOpacityVal.style.textAlign = 'center';

    const createBgBtn = (text, delta) => {
        const btn = document.createElement('button');
        btn.innerText = text;
        btn.style.background = '#333';
        btn.style.color = '#fff';
        btn.style.border = '1px solid #555';
        btn.style.borderRadius = '4px';
        btn.style.width = '24px';
        btn.style.height = '24px';
        btn.style.cursor = 'pointer';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.onmouseover = () => btn.style.background = '#444';
        btn.onmouseout = () => btn.style.background = '#333';
        btn.onclick = () => {
            currentBgOpacity = Math.max(0, Math.min(1, Math.round((currentBgOpacity + delta) * 100) / 100));
            bgOpacityVal.innerText = `${Math.round(currentBgOpacity * 100)}%`;
            container.style.setProperty('--anomalous-bg-opacity', currentBgOpacity);
            localStorage.setItem('anomalous_bg_opacity', currentBgOpacity);
        };
        return btn;
    };

    const minusBgBtn = createBgBtn('-', -0.1);
    const plusBgBtn = createBgBtn('+', 0.1);

    bgControlsWrapper.appendChild(minusBgBtn);
    bgControlsWrapper.appendChild(bgOpacityVal);
    bgControlsWrapper.appendChild(plusBgBtn);

    bgOpacityContainer.appendChild(bgOpacityLabel);
    bgOpacityContainer.appendChild(bgControlsWrapper);

    // Synchronize view mode active button & atmosphere visibility
    applyViewMode(currentViewMode);

    const resetBtn = document.createElement('button');
    resetBtn.id = 'anomalous-reset-btn';
    resetBtn.textContent = t('sidebarResetLayout');
    styleHubBtn(resetBtn);
    resetBtn.onclick = () => {
        if (confirm(t('sidebarResetConfirm'))) {
            localStorage.removeItem('anomalous_pos_x');
            localStorage.removeItem('anomalous_pos_y');
            localStorage.removeItem('anomalous_width');
            localStorage.removeItem('anomalous_height');
            localStorage.removeItem('anomalous_docked');
            localStorage.removeItem('anomalous_ui_scale');
            localStorage.removeItem('anomalous_bg_opacity');
            localStorage.removeItem('anomalous_view_mode');
            applyViewMode('compact');
            container.style.left = '5%';
            container.style.top = '5%';
            container.style.width = '90%';
            container.style.height = '90%';
            container.style.setProperty('--anomalous-scale', '1');
            container.style.setProperty('--anomalous-bg-opacity', '0.2');
            currentScale = 1;
            scaleVal.innerText = '100%';
            currentBgOpacity = 0.2;
            bgOpacityVal.innerText = '20%';
            if (container.classList.contains('anomalous-docked')) {
                container.classList.remove('anomalous-docked');
            }
        }
    };

    const folderManagerBtn = document.createElement('button');
    folderManagerBtn.id = 'anomalous-folder-manager-btn';
    folderManagerBtn.textContent = t('sidebarManageFolders');
    styleHubBtn(folderManagerBtn);
    folderManagerBtn.onclick = () => {
        if (settingsHubModal.style.display !== 'none') {
            settingsHubModal.style.display = 'none';
            settingsBtn.style.color = '#ccc';
        }
        owner.openFolderManager();
    };

    // Many redundant buttons have been migrated to the Wizard!

    const feedbackBtn = document.createElement('button');
    feedbackBtn.id = 'anomalous-feedback-btn';
    feedbackBtn.textContent = t('sidebarFeedback');
    styleHubBtn(feedbackBtn);
    feedbackBtn.onclick = () => {
        window.open('https://github.com/DemonGatanjieu/Anomalous_Model_Browser/issues', '_blank');
        if (settingsHubModal.style.display !== 'none') {
            settingsHubModal.style.display = 'none';
            settingsBtn.style.color = '#ccc';
        }
    };

    settingsHubModal.appendChild(folderManagerBtn);
    settingsHubModal.appendChild(modelSettingsBtn);
    settingsHubModal.appendChild(viewModeContainer);
    settingsHubModal.appendChild(scaleContainer);
    settingsHubModal.appendChild(bgOpacityContainer);
    settingsHubModal.appendChild(langBtn);
    settingsHubModal.appendChild(helpBtn);
    settingsHubModal.appendChild(feedbackBtn);
    settingsHubModal.appendChild(resetBtn);

    container.appendChild(settingsHubModal);

    const settingsBtn = document.createElement('button');
    settingsBtn.id = 'anomalous-global-settings-btn';
    settingsBtn.className = 'anomalous-tooltip-target';
    settingsBtn.innerHTML = icons.SETTINGS;
    settingsBtn.removeAttribute('title');
    settingsBtn.setAttribute('aria-label', t('sidebarSettings'));
    settingsBtn.setAttribute('data-tooltip', t('sidebarSettings'));
    settingsBtn.setAttribute('data-tooltip-pos', 'top');
    settingsBtn.style.background = 'transparent';
    settingsBtn.style.border = 'none';
    settingsBtn.style.borderRadius = '6px';
    settingsBtn.style.padding = '6px';
    settingsBtn.style.fontSize = '1.1em';
    settingsBtn.style.marginLeft = 'auto';
    settingsBtn.style.cursor = 'pointer';
    const closeSettingsHub = (e) => {
        if (settingsHubModal.style.display !== 'none' && !settingsHubModal.contains(e.target) && !settingsBtn.contains(e.target)) {
            settingsHubModal.style.display = 'none';
            settingsBtn.classList.remove('is-active');
            document.removeEventListener('mousedown', closeSettingsHub);
        }
    };

    settingsBtn.onclick = (e) => {
        e.stopPropagation();
        if (window.AMB_hideTooltipImmediately) window.AMB_hideTooltipImmediately();
        onBeforeOpen();
        if (settingsHubModal.style.display === 'none') {
            settingsHubModal.style.display = 'flex';
            settingsBtn.classList.add('is-active');
            setTimeout(() => document.addEventListener('mousedown', closeSettingsHub), 10);
        } else {
            settingsHubModal.style.display = 'none';
            settingsBtn.classList.remove('is-active');
            document.removeEventListener('mousedown', closeSettingsHub);
        }
    };

    const close = () => {
        settingsHubModal.style.display = 'none';
        settingsBtn.classList.remove('is-active');
        document.removeEventListener('mousedown', closeSettingsHub);
    };

    return {
        button: settingsBtn,
        modal: settingsHubModal,
        close,
        refreshLanguage: refreshLanguageUi,
    };
}
