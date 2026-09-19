/**
 * Scan wizard UI and scan launch/polling coordination.
 */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { updateScanProgress, finishScanProgress, failScanProgress } from './scan_progress.js';
import { configureSidebarAction } from './sidebar_actions.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const t = (key, params) => translate(key, params);

const SCAN_RADAR_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="21" stroke-opacity="0.35"/><line x1="3" y1="12" x2="21" y2="12" stroke-opacity="0.35"/><line x1="12" y1="12" x2="18.5" y2="5.5" stroke-width="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`;

export function setScanButtonState(btn, isScanning) {
    if (!btn) return;
    btn.innerHTML = SCAN_RADAR_ICON_SVG;
    btn.classList.toggle('anomalous-radar-spinning', Boolean(isScanning));
    btn.style.opacity = isScanning ? '0.85' : '1';
    btn.style.animation = '';
    configureSidebarAction(btn);
}

function setActiveScanButtonState(isScanning) {
    setScanButtonState(document.getElementById('anomalous-scan-btn'), isScanning);
}

export function openScanWizard({ isGlobal = false, targetFiles = null } = {}) {
    let wizard = document.getElementById('anomalous-wizard-modal');
    if (wizard) {
        if (typeof wizard.cleanupModal === 'function') wizard.cleanupModal();
        else if (wizard.parentNode) wizard.parentNode.removeChild(wizard);
    }

    wizard = document.createElement('div');
    wizard.id = 'anomalous-wizard-modal';
    wizard.style.position = 'fixed';
    wizard.style.top = '0';
    wizard.style.left = '0';
    wizard.style.width = '100vw';
    wizard.style.height = '100vh';
    wizard.style.backgroundColor = 'rgba(0,0,0,0.6)';
    wizard.style.zIndex = '999999';
    wizard.style.display = 'flex';
    wizard.style.justifyContent = 'center';
    wizard.style.alignItems = 'center';
    wizard.style.fontFamily = 'Roboto, "Segoe UI", sans-serif';

    const closeWizard = () => {
        document.removeEventListener('keydown', handleKeydown);
        if (wizard && wizard.parentNode) {
            wizard.parentNode.removeChild(wizard);
        }
    };
    wizard.cleanupModal = closeWizard;

    const handleKeydown = (e) => {
        if (e.key === 'Escape') closeWizard();
    };
    document.addEventListener('keydown', handleKeydown);

    wizard.onclick = (e) => {
        if (e.target === wizard) closeWizard();
    };

    const content = document.createElement('div');
    content.style.background = '#1E1E1E';
    content.style.borderRadius = '12px';
    content.style.padding = '28px 32px 20px 32px';
    content.style.width = '760px';
    content.style.maxWidth = '95%';
    content.style.maxHeight = '85vh';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.boxShadow = '0 11px 15px -7px rgba(0,0,0,0.2), 0 24px 38px 3px rgba(0,0,0,0.14), 0 9px 46px 8px rgba(0,0,0,0.12)';
    content.style.color = '#fff';
    content.style.position = 'relative';

    // Top Header Area
    const headerArea = document.createElement('div');
    headerArea.style.display = 'flex';
    headerArea.style.justifyContent = 'space-between';
    headerArea.style.alignItems = 'center';
    headerArea.style.marginBottom = '24px';

    const title = document.createElement('h2');
    if (targetFiles) {
        title.textContent = t('sidebarSingleModelScan', { files: targetFiles });
    } else {
        title.textContent = t(isGlobal ? 'sidebarGlobalScanWizard' : 'sidebarScanWizardTitle');
    }
    title.style.margin = '0';
    title.style.fontSize = '1.6em';
    title.style.fontWeight = '500';

    // Toolbar right
    const topToolbar = document.createElement('div');
    topToolbar.style.display = 'flex';
    topToolbar.style.gap = '8px';

    const createGhostBtn = (icon, textKey, onClick) => {
        const btn = document.createElement('button');
        btn.textContent = `${icon} ${t(textKey)}`;
        btn.style.padding = '6px 12px';
        btn.style.background = 'transparent';
        btn.style.color = '#ccc';
        btn.style.border = '1px solid rgba(255,255,255,0.1)';
        btn.style.borderRadius = '6px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '0.85em';
        btn.style.transition = 'all 0.2s';
        btn.onmouseover = () => { btn.style.background = 'rgba(255,255,255,0.08)'; btn.style.color = '#fff'; };
        btn.onmouseout = () => { btn.style.background = 'transparent'; btn.style.color = '#ccc'; };
        btn.onclick = onClick;
        return btn;
    };

    const apiKeyBtn = createGhostBtn('🔑', 'sidebarApiKey', () => {
        const newKey = prompt(t('sidebarApiKeyPrompt'), '');
        if (newKey !== null) {
            fetch('/anomalous/save_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: newKey.trim() })
            }).then(res => res.json()).then(data => {
                if (data.status !== 'ok') throw new Error(data.message || 'Save failed');
                alert(t('sidebarKeySaved'));
            }).catch(error => alert(t('sidebarSaveFailed') + error.message));
        }
    });

    topToolbar.appendChild(apiKeyBtn);

    headerArea.appendChild(title);
    headerArea.appendChild(topToolbar);
    content.appendChild(headerArea);

    let scanMode = 'civitai';
    let enableRename = true;
    let enableAutoCheck = true;
    let enableForceOverwrite = false;
    let updateSections = () => { };

    const formGroup = document.createElement('div');
    formGroup.style.display = 'flex';
    formGroup.style.flexDirection = 'column';
    formGroup.style.gap = '24px';
    formGroup.style.overflowY = 'auto';
    formGroup.style.flex = '1';
    formGroup.style.minHeight = '0';
    formGroup.style.paddingRight = '6px';

    const createChoiceCard = (id, icon, titleKey, descKey, isSelected) => {
        const card = document.createElement('div');
        card.style.flex = '1';
        card.style.background = isSelected ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.04)';
        card.style.border = `2px solid ${isSelected ? '#e5e7eb' : 'transparent'}`;
        card.style.borderRadius = '8px';
        card.style.padding = '16px';
        card.style.cursor = 'pointer';
        card.style.transition = 'all 0.2s';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '12px';
        card.style.alignItems = 'flex-start';

        card.onmouseover = () => {
            if (!isSelected) card.style.background = 'rgba(255, 255, 255, 0.08)';
        };
        card.onmouseout = () => {
            if (!isSelected) card.style.background = 'rgba(255, 255, 255, 0.04)';
        };

        const topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.alignItems = 'center';
        topRow.style.gap = '12px';

        const iconDiv = document.createElement('div');
        iconDiv.innerText = icon;
        iconDiv.style.fontSize = '1.6em';

        const tTitle = document.createElement('div');
        tTitle.textContent = t(titleKey);
        tTitle.style.fontWeight = '500';
        tTitle.style.fontSize = '1.05em';
        tTitle.style.color = isSelected ? '#ffffff' : '#e5e7eb';

        topRow.appendChild(iconDiv);
        topRow.appendChild(tTitle);

        const tDesc = document.createElement('div');
        tDesc.textContent = t(descKey);
        tDesc.style.fontSize = '0.85em';
        tDesc.style.color = '#9ca3af';
        tDesc.style.lineHeight = '1.5';

        card.appendChild(topRow);
        card.appendChild(tDesc);
        return card;
    };

    let targetMode = 'all';
    let selectedForScan = new Map();
    
    if (!targetFiles) {
        const section0 = document.createElement('div');
        const sec0Title = document.createElement('div');
        sec0Title.textContent = t('sidebarStep0');
        sec0Title.style.fontWeight = '500';
        sec0Title.style.color = '#e5e7eb';
        sec0Title.style.marginBottom = '12px';
        sec0Title.style.fontSize = '0.95em';
        section0.appendChild(sec0Title);

        const tContainer = document.createElement('div');
        tContainer.style.display = 'flex';
        tContainer.style.flexDirection = 'row';
        tContainer.style.gap = '16px';
        tContainer.style.marginBottom = '16px';

        const customActionDiv = document.createElement('div');
        customActionDiv.style.display = 'none';
        customActionDiv.style.marginTop = '16px';
        
        const openSelectorBtn = document.createElement('button');
        openSelectorBtn.textContent = t('sidebarOpenSelector');
        openSelectorBtn.style.cssText = 'width:100%;padding:12px;background:#e5e7eb;color:#111;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:1.05em;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
        
        const selectedCountSpan = document.createElement('div');
        selectedCountSpan.style.cssText = 'text-align:center;color:#e5e7eb;margin-top:8px;font-size:0.9em;';
        selectedCountSpan.textContent = t('sidebarSelectedZero');
        
        const updateSelectedCount = () => {
            let total = 0;
            for (const set of selectedForScan.values()) total += set.size;
            selectedCountSpan.textContent = t('sidebarSelectedCount', { count: total });
        };

        openSelectorBtn.onclick = () => {
            this._openAdvancedModelSelector(selectedForScan, (newSelection) => {
                selectedForScan = newSelection;
                updateSelectedCount();
            });
        };
        
        customActionDiv.appendChild(openSelectorBtn);
        customActionDiv.appendChild(selectedCountSpan);

        let tCard1, tCard2;
        const updateTargetCards = () => {
            if (tCard1 && tCard2) {
                tContainer.removeChild(tCard1);
                tContainer.removeChild(tCard2);
            }
            tCard1 = createChoiceCard('all', '📂', 'sidebarTargetGlobal', 'sidebarTargetGlobalDesc', targetMode === 'all');
            tCard2 = createChoiceCard('custom', '☑️', 'sidebarTargetCustom', 'sidebarTargetCustomDesc', targetMode === 'custom');

            tCard1.onclick = () => { 
                targetMode = 'all'; 
                updateTargetCards(); 
                customActionDiv.style.display = 'none';
            };
            tCard2.onclick = () => { 
                targetMode = 'custom'; 
                updateTargetCards(); 
                customActionDiv.style.display = 'block';
            };

            tContainer.appendChild(tCard1);
            tContainer.appendChild(tCard2);
        };
        updateTargetCards();
        section0.appendChild(tContainer);
        section0.appendChild(customActionDiv);
        formGroup.appendChild(section0);
    }

    // === Step 1: Fetch Data ===
    const section1 = document.createElement('div');
    const sec1Title = document.createElement('div');
    sec1Title.textContent = t('sidebarStep1');
    sec1Title.style.fontWeight = '500';
    sec1Title.style.color = '#e5e7eb';
    sec1Title.style.marginBottom = '12px';
    sec1Title.style.fontSize = '0.95em';
    section1.appendChild(sec1Title);

    const cardsContainer = document.createElement('div');
    cardsContainer.style.display = 'flex';
    cardsContainer.style.flexDirection = 'row';
    cardsContainer.style.gap = '16px';



    let card1, card2;
    const updateCards = () => {
        if (card1 && card2) {
            cardsContainer.removeChild(card1);
            cardsContainer.removeChild(card2);
        }
        card1 = createChoiceCard('civitai', '🌍', 'sidebarOnline', 'sidebarOnlineDesc', scanMode === 'civitai');
        card2 = createChoiceCard('offline', '🔌', 'sidebarOffline', 'sidebarOfflineDesc', scanMode === 'offline');

        card1.onclick = () => { scanMode = 'civitai'; updateCards(); updateSections(); };
        card2.onclick = () => { scanMode = 'offline'; updateCards(); updateSections(); };

        cardsContainer.appendChild(card1);
        cardsContainer.appendChild(card2);
    };
    updateCards();
    section1.appendChild(cardsContainer);
    formGroup.appendChild(section1);

    // Material Switch Builder
    const createMaterialSwitch = (initialState, onChange) => {
        const track = document.createElement('div');
        track.style.width = '36px';
        track.style.height = '14px';
        track.style.borderRadius = '7px';
        track.style.background = initialState ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255,255,255,0.15)';
        track.style.position = 'relative';
        track.style.cursor = 'pointer';
        track.style.transition = 'background 0.3s';
        track.style.display = 'flex';
        track.style.alignItems = 'center';

        const thumb = document.createElement('div');
        thumb.style.width = '20px';
        thumb.style.height = '20px';
        thumb.style.borderRadius = '50%';
        thumb.style.background = initialState ? '#ffffff' : '#888888';
        thumb.style.position = 'absolute';
        thumb.style.left = initialState ? '16px' : '0px';
        thumb.style.transition = 'left 0.3s, background 0.3s';
        thumb.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';

        let state = initialState;
        track.onclick = () => {
            state = !state;
            track.style.background = state ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255,255,255,0.15)';
            thumb.style.background = state ? '#ffffff' : '#888888';
            thumb.style.left = state ? '16px' : '0px';
            onChange(state);
        };
        track.appendChild(thumb);
        return track;
    };

    const createListRow = (icon, titleKey, descKey, actionEl) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.padding = '12px 0';
        row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

        const left = document.createElement('div');
        left.style.display = 'flex';
        left.style.alignItems = 'flex-start';
        left.style.gap = '16px';

        const iconEl = document.createElement('div');
        if (typeof icon === 'string' && icon.startsWith('<')) {
            iconEl.innerHTML = icon;
        } else {
            iconEl.innerText = icon;
        }
        iconEl.style.fontSize = '1.4em';
        iconEl.style.lineHeight = '1.2';
        iconEl.style.width = '24px';
        iconEl.style.textAlign = 'center';

        const textDiv = document.createElement('div');
        const titleEl = document.createElement('div');
        titleEl.textContent = t(titleKey);
        titleEl.style.fontWeight = '500';
        titleEl.style.fontSize = '1.0em';
        titleEl.style.color = '#fff';

        const d = document.createElement('div');
        d.innerHTML = t(descKey);
        d.style.fontSize = '0.85em';
        d.style.color = '#aaa';
        d.style.marginTop = '4px';

        textDiv.appendChild(titleEl);
        textDiv.appendChild(d);
        left.appendChild(iconEl);
        left.appendChild(textDiv);
        row.appendChild(left);
        if (actionEl) row.appendChild(actionEl);

        return row;
    };

    // === Step 2: Normalize Naming ===
    const section2 = document.createElement('div');
    const sec2Title = document.createElement('div');
    sec2Title.textContent = t('sidebarStep2');
    sec2Title.style.fontWeight = '500';
    sec2Title.style.color = '#e5e7eb';
    sec2Title.style.marginBottom = '8px';
    sec2Title.style.fontSize = '0.95em';
    section2.appendChild(sec2Title);

    const s2List = document.createElement('div');
    let enableVirtualRename = true;
    let enablePhysicalRename = false;

    const dualChannelRow = document.createElement('div');
    dualChannelRow.style.display = 'flex';
    dualChannelRow.style.flexDirection = 'column';
    dualChannelRow.style.gap = '14px';
    dualChannelRow.style.padding = '0 16px 12px 16px';
    dualChannelRow.style.marginLeft = '40px';

    const updateDualChannelUI = () => {
        dualChannelRow.style.opacity = enableRename ? '1' : '0.4';
        dualChannelRow.style.pointerEvents = enableRename ? 'auto' : 'none';
    };

    const virtualSwitch = createMaterialSwitch(enableVirtualRename, (s) => enableVirtualRename = s);
    let physicalProtectionNotice = null;
    const physicalSwitch = createMaterialSwitch(enablePhysicalRename, (s) => {
        enablePhysicalRename = s;
        if (physicalProtectionNotice) {
            physicalProtectionNotice.style.display = s ? 'block' : 'none';
        }
    });

    const vContainer = document.createElement('div');
    vContainer.style.display = 'flex';
    vContainer.style.flexDirection = 'column';

    const vRow = document.createElement('div');
    vRow.style.display = 'flex';
    vRow.style.alignItems = 'center';
    vRow.style.gap = '8px';
    vRow.innerHTML = `<span style="font-size:0.9em; color:#ddd;">✨ ${t('sidebarVirtualRename')}</span>`;
    vRow.appendChild(virtualSwitch);

    const vDesc = document.createElement('div');
    vDesc.style.fontSize = '0.8em';
    vDesc.style.color = '#888';
    vDesc.style.marginTop = '4px';
    vDesc.textContent = t('sidebarVirtualRenameDesc');
    vContainer.appendChild(vRow);
    vContainer.appendChild(vDesc);

    const pContainer = document.createElement('div');
    pContainer.style.display = 'flex';
    pContainer.style.flexDirection = 'column';

    const pRow = document.createElement('div');
    pRow.style.display = 'flex';
    pRow.style.alignItems = 'center';
    pRow.style.gap = '8px';
    pRow.innerHTML = `<span style="font-size:0.9em; color:#ddd; display:inline-flex; align-items:center; gap:6px;"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>${t('sidebarPhysicalRename')}</span>`;
    pRow.appendChild(physicalSwitch);

    const pDesc = document.createElement('div');
    pDesc.style.fontSize = '0.8em';
    pDesc.style.color = '#888';
    pDesc.style.marginTop = '4px';
    pDesc.innerHTML = t('sidebarPhysicalRenameDesc');
    pContainer.appendChild(pRow);
    pContainer.appendChild(pDesc);

    physicalProtectionNotice = document.createElement('div');
    physicalProtectionNotice.style.display = enablePhysicalRename ? 'block' : 'none';
    physicalProtectionNotice.style.marginTop = '8px';
    physicalProtectionNotice.style.padding = '9px 11px';
    physicalProtectionNotice.style.border = '1px solid rgba(251, 188, 4, 0.45)';
    physicalProtectionNotice.style.borderRadius = '6px';
    physicalProtectionNotice.style.background = 'rgba(251, 188, 4, 0.08)';
    physicalProtectionNotice.style.color = '#fdd663';
    physicalProtectionNotice.style.fontSize = '0.8em';
    physicalProtectionNotice.style.lineHeight = '1.45';
    physicalProtectionNotice.textContent = t('sidebarPhysicalRenameProtectedNotice');
    pContainer.appendChild(physicalProtectionNotice);

    dualChannelRow.appendChild(vContainer);
    dualChannelRow.appendChild(pContainer);

    const editSvg = '<svg style="width:20px;height:20px;vertical-align:middle;stroke:#dc143c;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
    s2List.appendChild(createListRow(editSvg, 'sidebarNormalize', 'sidebarNormalizeDesc', createMaterialSwitch(enableRename, (s) => { enableRename = s; updateDualChannelUI(); })));
    s2List.lastChild.style.borderBottom = 'none';
    s2List.appendChild(dualChannelRow);
    updateDualChannelUI();
    section2.appendChild(s2List);
    formGroup.appendChild(section2);

    // === Step 3: Workflow Protection & Fix ===
    const section3 = document.createElement('div');
    const sec3Title = document.createElement('div');
    sec3Title.textContent = t('sidebarStep3');
    sec3Title.style.fontWeight = '500';
    sec3Title.style.color = '#e5e7eb';
    sec3Title.style.marginBottom = '8px';
    sec3Title.style.fontSize = '0.95em';
    section3.appendChild(sec3Title);

    const s3List = document.createElement('div');
    const isInject = localStorage.getItem('anomalous_inject_hash') !== 'false';
    const cubeSvg = '<svg style="width:20px;height:20px;vertical-align:middle;stroke:#dc143c;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
    const warnSvg = '<svg style="width:20px;height:20px;vertical-align:middle;stroke:#f59e0b;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    const wandSvg = '<svg style="width:20px;height:20px;vertical-align:middle;stroke:#8b5cf6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    s3List.appendChild(createListRow(cubeSvg, 'sidebarProvenance', 'sidebarProvenanceDesc', createMaterialSwitch(isInject, (s) => localStorage.setItem('anomalous_inject_hash', s ? 'true' : 'false'))));
    s3List.appendChild(createListRow(warnSvg, 'sidebarOverwrite', 'sidebarOverwriteDesc', createMaterialSwitch(enableForceOverwrite, (s) => enableForceOverwrite = s)));
    s3List.appendChild(createListRow(wandSvg, 'sidebarSmartFix', 'sidebarSmartFixDesc', createMaterialSwitch(enableAutoCheck, (s) => enableAutoCheck = s)));
    s3List.lastChild.style.borderBottom = 'none';

    section3.appendChild(s3List);
    formGroup.appendChild(section3);
    content.appendChild(formGroup);

    updateSections = () => {
        if (scanMode === 'offline') {
            section2.style.opacity = '0.3';
            section2.style.pointerEvents = 'none';
            section3.style.opacity = '0.3';
            section3.style.pointerEvents = 'none';
        } else {
            section2.style.opacity = '1';
            section2.style.pointerEvents = 'auto';
            section3.style.opacity = '1';
            section3.style.pointerEvents = 'auto';
        }
    };
    updateSections();

    // Execute Scan Logic
                const doScan = async () => {
        try {
            const reqBody = {
                offline_only: scanMode === 'offline',
                skip_rename: !enableRename,
                virtual_rename: enableRename ? enableVirtualRename : false,
                physical_rename: enableRename ? enablePhysicalRename : false,
                force_overwrite: enableForceOverwrite
            };

            if (targetMode === 'custom') {
                let hasAny = false;
                for (const set of selectedForScan.values()) {
                    if (set.size > 0) hasAny = true;
                }
                if (!hasAny) {
                    alert(t('sidebarNoModelsSelected'));
                    return;
                }
                
                closeWizard();
                const activeScanBtn = document.getElementById('anomalous-scan-btn');
                if (activeScanBtn) {
                    setScanButtonState(activeScanBtn, true);
                }

                const customFolders = Array.from(selectedForScan.entries()).filter(([, files]) => files.size > 0);
                let customFolderCurrent = 0;
                updateScanProgress({
                    scanning: true,
                    phase: 'preparing',
                    folder_total: customFolders.length,
                    folder_current: 0,
                });
                
                // Sequential scan for multiple folders
                for (const [folderKey, fileSet] of customFolders) {
                    customFolderCurrent += 1;
                    const parts = folderKey.split('|');
                    if (parts.length < 3) continue;
                    const type = parts[0], path_idx = parts[1], subfolder = parts.slice(2).join('|');
                    
                    const params = new URLSearchParams({ type, path_idx, subfolder });
                    const targetUrl = '/anomalous/scan?' + params.toString();
                    
                    const currentReqBody = { ...reqBody, target_files: Array.from(fileSet) };
                    
                    try {
                        const res = await fetch(targetUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(currentReqBody)
                        });
                        const data = await res.json();
                        if (data.status === 'ok') {
                            // wait for this folder to finish scanning before starting next
                            await new Promise(resolve => {
                                const poll = setInterval(async () => {
                                    try {
                                        const statusUrl = '/anomalous/scan_status?' + params.toString();
                                        const statusRes = await fetch(statusUrl);
                                        const statusData = await statusRes.json();
                                        updateScanProgress({
                                            ...statusData,
                                            folder_total: customFolders.length,
                                            folder_current: customFolderCurrent,
                                            folder: subfolder,
                                        });
                                        if (!statusData.scanning) {
                                            clearInterval(poll);
                                            resolve();
                                        }
                                    } catch (err) {
                                        clearInterval(poll);
                                        resolve();
                                    }
                                }, 2000);
                            });
                        } else {
                            console.error("Scan failed for folder: " + folderKey, data.message);
                        }
                    } catch(e) {
                        console.error("Request failed for folder: " + folderKey, e);
                    }
                }
                
                setActiveScanButtonState(false);
                finishScanProgress();
                try {
                    if (app?.refreshComboInNodes) await app.refreshComboInNodes();
                    if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
                } catch (e) {
                    console.warn('[AMB] Error reloading hashes or combo nodes:', e);
                }
                if (enableAutoCheck && window.anomalous_resolve_all_missing_nodes) {
                    window.anomalous_resolve_all_missing_nodes(true);
                }
                this.loadModels();
                
                return;
            }

            // Existing logic for 'all' mode or single file
            let finalTargetFiles = targetFiles;
            let currentReqBody = { ...reqBody };
            
            let targetUrl = '';
            if (isGlobal && targetMode !== 'custom') {
                targetUrl = '/anomalous/scan_all';
            } else {
                const params = new URLSearchParams({ type: this.currentType, path_idx: this.currentPathIdx, subfolder: this.currentSubfolder });
                if (finalTargetFiles) {
                    currentReqBody.target_files = finalTargetFiles.split(',');
                }
                targetUrl = '/anomalous/scan?' + params.toString();
            }

            const res = await fetch(targetUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentReqBody)
            });
            
            const data = await res.json();
            if (data.status === 'ok') {
                updateScanProgress({ scanning: true, phase: 'preparing', recovered: data.recovered });
                setActiveScanButtonState(true);

                // Start polling
                const poll = setInterval(async () => {
                    try {
                        let statusUrl = '/anomalous/global_scan_status';
                        if (!isGlobal) {
                            const params = new URLSearchParams({ type: this.currentType, path_idx: this.currentPathIdx, subfolder: this.currentSubfolder });
                            statusUrl = '/anomalous/scan_status?' + params.toString();
                        }
                        const statusRes = await fetch(statusUrl);
                        const statusData = await statusRes.json();
                        updateScanProgress(statusData);
                        if (!statusData.scanning) {
                            clearInterval(poll);
                            if (statusData.interrupted) failScanProgress(t('scanProgressInterrupted'));
                            else finishScanProgress();
                            setActiveScanButtonState(false);

                            try {
                                if (app?.refreshComboInNodes) await app.refreshComboInNodes();
                                if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
                            } catch (e) {
                                console.warn('[AMB] Error reloading hashes or combo nodes:', e);
                            }
                            if (enableAutoCheck && window.anomalous_resolve_all_missing_nodes) {
                                window.anomalous_resolve_all_missing_nodes(true);
                            }
                            this.loadModels();
                        }
                    } catch (err) {
                        clearInterval(poll);
                        setActiveScanButtonState(false);
                    }
                }, 2000);
                closeWizard();
                return; // return early so we don't remove wizard again below
            } else {
                failScanProgress(t('sidebarScanFailed') + data.message);
                alert(t('sidebarScanFailed') + data.message);
            }
        } catch (e) {
            failScanProgress(String(e));
            alert("Error: " + e);
        }

        closeWizard();
    };

    const footer = document.createElement('div');
    footer.style.marginTop = '16px';
    footer.style.paddingTop = '16px';
    footer.style.borderTop = '1px solid rgba(255,255,255,0.08)';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.style.flexShrink = '0';

    const closeBtn = document.createElement('button');
closeBtn.textContent = t('sidebarCancel');
    closeBtn.style.padding = '8px 16px';
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = '#9ca3af';
    closeBtn.style.border = 'none';
    closeBtn.style.borderRadius = '4px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '0.95em';
    closeBtn.style.fontWeight = '500';
    closeBtn.style.textTransform = 'uppercase';
    closeBtn.style.transition = 'background 0.2s';
    closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(255, 255, 255, 0.08)';
    closeBtn.onmouseout = () => closeBtn.style.background = 'transparent';
    closeBtn.onclick = closeWizard;

    const startBtn = document.createElement('button');
startBtn.textContent = t('sidebarExecute');
    startBtn.style.padding = '8px 24px';
    startBtn.style.background = '#e5e7eb';
    startBtn.style.color = '#111827';
    startBtn.style.border = 'none';
    startBtn.style.borderRadius = '4px';
    startBtn.style.cursor = 'pointer';
    startBtn.style.fontSize = '0.95em';
    startBtn.style.fontWeight = '600';
    startBtn.style.textTransform = 'uppercase';
    startBtn.style.transition = 'background 0.2s, box-shadow 0.2s';
    startBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
    startBtn.onmouseover = () => {
        startBtn.style.background = '#ffffff';
        startBtn.style.boxShadow = '0 3px 8px rgba(0,0,0,0.4)';
    };
    startBtn.onmouseout = () => {
        startBtn.style.background = '#e5e7eb';
        startBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
    };
    startBtn.onclick = doScan;

    footer.appendChild(closeBtn);
    footer.appendChild(startBtn);
    content.appendChild(footer);
    wizard.appendChild(content);
    document.body.appendChild(wizard);
}

export async function formatScanCompletionToast(model) {
    const isZh = window.anomalous_browser_lang === 'zh';
    const fallbackName = model.name || model.filename;
    try {
        const findRes = await fetch('/anomalous/find_model?search=' + encodeURIComponent(model.filename));
        if (findRes.ok) {
            const updated = await findRes.json();
            const target = updated?.model || updated || model;
            if (target && target.metadata) {
                const meta = target.metadata;
                const isCivitai = Boolean(
                    (meta.id && meta.id !== -1) ||
                    (meta.modelId && meta.modelId !== -1) ||
                    (meta.model_id && meta.model_id !== -1) ||
                    (meta.version_id && meta.version_id !== -1) ||
                    meta.civitai_url
                );
                const hasPreview = Boolean(target.preview_url);
                const baseModel = meta.baseModel;

                if (isCivitai && hasPreview) {
                    return isZh ? `✓ 已从 Civitai 获取封面与模型信息！` : `✓ Civitai cover & metadata fetched!`;
                }
                if (isCivitai && !hasPreview) {
                    return isZh ? `✓ 已匹配到 Civitai 信息（线上未提供封面）` : `✓ Civitai metadata matched (no cover online)`;
                }
                if (!isCivitai) {
                    if (baseModel) {
                        return isZh
                            ? `ℹ️ 非 Civitai 模型：已识别底模为 [${baseModel}]`
                            : `ℹ️ Non-Civitai model: inferred base model [${baseModel}]`;
                    }
                    return isZh
                        ? `ℹ️ 未在 Civitai 匹配到此模型`
                        : `ℹ️ No Civitai match found for this model`;
                }
            }
        }
    } catch {
        // fallback to standard text
    }
    return isZh ? `✓ 模型 [${fallbackName}] 扫描完成！` : `✓ Model [${fallbackName}] scanned!`;
}

function pollDirectScanStatus(params, titleText, model, onComplete) {
    const statusUrl = '/anomalous/scan_status?' + params.toString();
    const poll = setInterval(async () => {
        try {
            const statusRes = await fetch(statusUrl);
            const statusData = await statusRes.json();
            updateScanProgress(statusData, titleText);

            if (!statusData.scanning) {
                clearInterval(poll);
                if (statusData.interrupted) {
                    failScanProgress(t('scanProgressInterrupted'));
                    showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? '扫描被中断' : 'Scan interrupted');
                } else {
                    const toastMsg = await formatScanCompletionToast(model);
                    finishScanProgress(toastMsg);
                    showWorkbenchToast(toastMsg);
                }
                onComplete(true);
            }
        } catch (err) {
            clearInterval(poll);
            failScanProgress(String(err));
            onComplete(false);
        }
    }, 1200);
    return poll;
}

export async function triggerDirectModelScan(model, triggerBtn = null, browserInstance = null) {
    const browser = browserInstance || this || {};
    if (!model || !model.filename) return;

    const modelLabel = model.name || model.filename;
    const isZh = window.anomalous_browser_lang === 'zh';
    const titleText = isZh ? `精准扫描: ${modelLabel}` : `Scanning: ${modelLabel}`;

    if (triggerBtn) {
        triggerBtn.classList.add('anomalous-radar-spinning');
        if (triggerBtn.firstElementChild) {
            triggerBtn.firstElementChild.style.animation = 'anomalous-radar-spin 1.2s linear infinite';
            triggerBtn.firstElementChild.style.stroke = '#10b981';
        }
        triggerBtn.style.pointerEvents = 'none';
        triggerBtn.style.opacity = '0.7';
    }
    setActiveScanButtonState(true);
    updateScanProgress({ scanning: true, phase: 'preparing', total: 1, current: 0, filename: model.filename }, titleText);

    const resetBtn = () => {
        setActiveScanButtonState(false);
        if (triggerBtn) {
            triggerBtn.classList.remove('anomalous-radar-spinning');
            if (triggerBtn.firstElementChild) {
                triggerBtn.firstElementChild.style.animation = '';
                triggerBtn.firstElementChild.style.stroke = '';
            }
            triggerBtn.style.pointerEvents = '';
            triggerBtn.style.opacity = '';
        }
    };

    try {
        const params = new URLSearchParams({
            type: browser.currentType || 'checkpoints',
            path_idx: browser.currentPathIdx || 0,
            subfolder: browser.currentSubfolder || '/',
        });
        const reqBody = {
            target_files: [model.filename],
            offline_only: false,
            skip_rename: true,
            virtual_rename: false,
            physical_rename: false,
            force_overwrite: false
        };

        const res = await fetch('/anomalous/scan?' + params.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody)
        });

        const data = await res.json();
        if (data.status === 'ok') {
            showWorkbenchToast(isZh ? `开始精准扫描: ${modelLabel}` : `Scanning model: ${modelLabel}`);
            pollDirectScanStatus(params, titleText, model, async () => {
                resetBtn();
                if (typeof browser.loadModels === 'function') {
                    browser.loadModels();
                }
                try {
                    if (app?.refreshComboInNodes) await app.refreshComboInNodes();
                    if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
                } catch (e) {
                    console.warn('[AMB] Error reloading hashes or combo nodes:', e);
                }
            });
        } else {
            resetBtn();
            const errMsg = data.message || (isZh ? '扫描启动失败' : 'Failed to start scan');
            failScanProgress(errMsg);
            showWorkbenchToast(errMsg);
        }
    } catch (e) {
        resetBtn();
        failScanProgress(String(e));
        showWorkbenchToast(String(e));
    }
}

