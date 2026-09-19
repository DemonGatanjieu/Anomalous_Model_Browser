/**
 * Toolbox catalog, fixed shortcut actions, and tool dispatch.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';
import { openModelSourcesModal } from './ui_model_sources.js';
import { configureSidebarActions } from './sidebar_actions.js';
import { CATALOG_TOOLS, getToolDefinition } from './tool_registry.js';
import { setScanButtonState } from './ui_scan_wizard.js';

const t = (key, params) => translate(key, params);

export function createToolbox(owner, {
    container,
    menuBtn,
    toolboxIcon,
    isScanning,
    getSettingsButton,
    onBeforeOpen,
}) {
    const toolboxBtn = document.createElement('button');
    toolboxBtn.id = 'anomalous-toolbox-btn';
    toolboxBtn.className = 'anomalous-tooltip-target';
    toolboxBtn.removeAttribute('title');
    toolboxBtn.setAttribute('aria-label', t('sidebarToolbox'));
    toolboxBtn.setAttribute('data-tooltip', t('sidebarToolbox'));
    toolboxBtn.setAttribute('data-tooltip-pos', 'top');
    toolboxBtn.innerHTML = toolboxIcon;
    toolboxBtn.style.background = 'transparent';
    toolboxBtn.style.border = 'none';
    toolboxBtn.style.borderRadius = '6px';
    toolboxBtn.style.padding = '6px';
    toolboxBtn.style.fontSize = '1.1em';
    toolboxBtn.style.cursor = 'pointer';


    const toolboxModal = document.createElement('div');
    toolboxModal.id = 'anomalous-toolbox-modal';
    toolboxModal.style.display = 'none';
    toolboxModal.addEventListener('mouseenter', () => {
        if (window.AMB_hideTooltipImmediately) window.AMB_hideTooltipImmediately();
    });

    const closeToolbox = (e) => {
        if (toolboxModal.style.display !== 'none' && !toolboxModal.contains(e.target) && !toolboxBtn.contains(e.target)) {
            toolboxModal.style.display = 'none';
            toolboxBtn.classList.remove('is-active');
            document.removeEventListener('mousedown', closeToolbox);
        }
    };

    toolboxBtn.onclick = (e) => {
        e.stopPropagation();
        if (window.AMB_hideTooltipImmediately) window.AMB_hideTooltipImmediately();
        toolboxBtn.classList.remove('anomalous-action-label-active');
        toolboxBtn.__suppress_text_until_leave = true;
        onBeforeOpen();
        if (toolboxModal.style.display === 'none') {
            toolboxModal.style.display = 'flex';
            toolboxBtn.classList.add('is-active');
            setTimeout(() => document.addEventListener('mousedown', closeToolbox), 10);
        } else {
            toolboxModal.style.display = 'none';
            toolboxBtn.classList.remove('is-active');
            document.removeEventListener('mousedown', closeToolbox);
        }
    };

    const executeToolAction = async (toolId) => {
        switch (toolId) {
            case 'scan':
                owner.openScanWizard({ isGlobal: true });
                break;
            case 'doctor':
                owner.hideAllPanels();
                if (localStorage.getItem('anomalous_user_sidebar_closed') === 'true') {
                    container.classList.add('anomalous-sidebar-closed');
                } else {
                    container.classList.remove('anomalous-sidebar-closed');
                }
                menuBtn.disabled = false;
                menuBtn.style.opacity = '1';
                menuBtn.style.cursor = 'pointer';
                owner.doctorPanel.style.display = 'flex';
                if (!owner.doctorPanelInitialized) {
                    owner.initDoctorPanel();
                }
                if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
                if (window.anomalous_resolve_all_missing_nodes) {
                    await window.anomalous_resolve_all_missing_nodes(true, false);
                }
                owner.renderGlobalDashboard();
                break;
            case 'assistant':
                owner.hideAllPanels();
                if (owner.setActiveHeaderTab) owner.setActiveHeaderTab(null);
                container.classList.add('anomalous-sidebar-closed');
                menuBtn.disabled = false;
                menuBtn.style.opacity = '1';
                menuBtn.style.cursor = 'pointer';
                owner.assistantPanel.style.display = 'flex';
                if (!owner.assistantPanelInitialized) {
                    owner.initAssistantPanel();
                }
                if (Object.keys(app.canvas?.selected_nodes || {}).length > 0) {
                    const firstSelected = Object.values(app.canvas.selected_nodes)[0];
                    owner.diagnoseNode(firstSelected);
                } else {
                    owner.diagnoseNode(null);
                }
                break;
            case 'materials':
                owner.openMaterialLibrary();
                break;
            case 'workflow-transfer':
                if (window.AMB_WorkflowShare && typeof window.AMB_WorkflowShare.showUnifiedModal === 'function') {
                    window.AMB_WorkflowShare.showUnifiedModal();
                }
                break;
            case 'prompt-studio':
                if (typeof owner.openPromptStudio === 'function') {
                    owner.openPromptStudio();
                } else if (typeof owner.openMaterialLibrary === 'function') {
                    owner.openMaterialLibrary();
                }
                break;
            case 'prompt-translator':
                if (typeof owner.openPromptTranslator === 'function') {
                    owner.openPromptTranslator();
                }
                break;
            case 'model-sources':
                openModelSourcesModal('workflow');
                break;
            case 'prompt-notes':
                if (typeof owner.showNotebooks === 'function') {
                    owner.showNotebooks();
                }
                break;
            default: {
                const custom = (owner.customToolboxItems || []).find(it => it.id === toolId);
                if (custom && typeof custom.action === 'function') {
                    custom.action();
                }
                break;
            }
        }
    };
    owner.executeToolAction = executeToolAction;

    const renderShortcutActions = () => {
        owner.sidebarActions.replaceChildren();
        owner.sidebarActions.appendChild(toolboxBtn);

        const defaultLayout = ['scan', 'doctor', 'assistant', 'materials'];
        for (const toolId of defaultLayout) {
            const def = getToolDefinition(toolId);
            if (!def) continue;

            const btn = document.createElement('button');
            btn.id = def.domId;
            btn.setAttribute('data-tool-id', toolId);
            btn.className = 'anomalous-tooltip-target';
            btn.removeAttribute('title');
            btn.setAttribute('aria-label', t(def.nameKey));
            btn.setAttribute('data-tooltip', t(def.nameKey));
            btn.setAttribute('data-tooltip-pos', 'top');
            btn.style.background = 'transparent';
            btn.style.border = 'none';
            btn.style.borderRadius = '6px';
            btn.style.padding = '6px';
            btn.style.fontSize = '1.1em';
            btn.style.cursor = 'pointer';

            if (toolId === 'scan') {
                setScanButtonState(btn, isScanning());
            } else {
                btn.innerHTML = def.icon;
            }

            btn.onclick = (e) => {
                e.stopPropagation();
                executeToolAction(toolId);
            };

            owner.sidebarActions.appendChild(btn);
        }

        owner.sidebarActions.appendChild(getSettingsButton());
        configureSidebarActions(owner.sidebarWrapper);
    };
    owner.renderShortcutActions = renderShortcutActions;

    const renderToolboxModal = () => {
        toolboxModal.replaceChildren();

        const headerRow = document.createElement('div');
        headerRow.style.display = 'flex';
        headerRow.style.alignItems = 'center';
        headerRow.style.justifyContent = 'space-between';
        headerRow.style.padding = '1px 2px 3px';
        headerRow.style.borderBottom = '1px solid rgba(255, 255, 255, 0.06)';

        const titleBox = document.createElement('div');
        titleBox.style.display = 'flex';
        titleBox.style.alignItems = 'center';
        titleBox.style.gap = '5px';

        const titleIcon = document.createElement('span');
        titleIcon.textContent = '🧰';
        titleIcon.style.fontSize = '11px';

        const titleText = document.createElement('span');
        titleText.textContent = t('toolboxTitle');
        titleText.style.fontWeight = '600';
        titleText.style.fontSize = '11px';
        titleText.style.color = '#fff';

        titleBox.append(titleIcon, titleText);

        const closeModalBtn = document.createElement('div');
        closeModalBtn.innerHTML = '&times;';
        closeModalBtn.style.cursor = 'pointer';
        closeModalBtn.style.color = '#888';
        closeModalBtn.style.fontSize = '14px';
        closeModalBtn.style.lineHeight = '1';
        closeModalBtn.style.padding = '1px 3px';
        closeModalBtn.style.borderRadius = '3px';
        closeModalBtn.onmouseover = () => { closeModalBtn.style.color = '#fff'; closeModalBtn.style.background = 'rgba(255,255,255,0.08)'; };
        closeModalBtn.onmouseout = () => { closeModalBtn.style.color = '#888'; closeModalBtn.style.background = 'transparent'; };
        closeModalBtn.onclick = () => {
            toolboxModal.style.display = 'none';
            toolboxBtn.classList.remove('is-active');
        };

        headerRow.appendChild(titleBox);
        headerRow.appendChild(closeModalBtn);
        toolboxModal.appendChild(headerRow);

        const gridContainer = document.createElement('div');
        gridContainer.className = 'anomalous-toolbox-grid';

        // 过滤掉已经常驻底栏的工具（scan, doctor, assistant, materials 及两端锚点）
        const outsideToolIds = new Set(['scan', 'doctor', 'assistant', 'materials', 'toolbox', 'settings']);
        const allTools = [...CATALOG_TOOLS, ...(owner.customToolboxItems || [])];
        const toolboxTools = allTools.filter(tool => !outsideToolIds.has(tool.id));

        const COLOR_ICONS = {
            'workflow-transfer': '🔄',
            'prompt-studio': '🎛️',
            'prompt-translator': '🌐',
            'model-sources': '🔗',
            'prompt-notes': '📝',
        };

        toolboxTools.forEach(tool => {
            const tile = document.createElement('div');
            tile.className = 'anomalous-toolbox-tile';
            tile.setAttribute('data-tool-id', tool.id);

            const iconEl = document.createElement('div');
            iconEl.className = 'anomalous-toolbox-tile-icon';
            iconEl.innerHTML = COLOR_ICONS[tool.id] || tool.icon || '🔧';
            tile.appendChild(iconEl);

            const labelEl = document.createElement('div');
            labelEl.className = 'anomalous-toolbox-tile-label';
            labelEl.textContent = t(tool.labelKey) || t(tool.nameKey);
            tile.appendChild(labelEl);

            tile.onclick = (e) => {
                e.stopPropagation();
                if (window.AMB_hideTooltipImmediately) window.AMB_hideTooltipImmediately();
                toolboxModal.style.display = 'none';
                toolboxBtn.classList.remove('is-active');
                executeToolAction(tool.id);
            };

            gridContainer.appendChild(tile);
        });

        toolboxModal.appendChild(gridContainer);
    };
    owner.renderToolboxModal = renderToolboxModal;
    owner.registerToolboxItem = (item) => {
        owner.customToolboxItems = owner.customToolboxItems || [];
        owner.customToolboxItems.push(item);
        if (owner.renderToolboxModal) owner.renderToolboxModal();
    };
    owner.openModelSources = (scope = 'workflow') => openModelSourcesModal(scope);

    container.appendChild(toolboxModal);

    const close = () => {
        toolboxModal.style.display = 'none';
        toolboxBtn.classList.remove('is-active');
        document.removeEventListener('mousedown', closeToolbox);
    };

    return {
        button: toolboxBtn,
        modal: toolboxModal,
        close,
        mount() {
            renderToolboxModal();
            renderShortcutActions();
        },
        refreshLanguage() {
            renderToolboxModal();
            renderShortcutActions();
        },
    };
}
