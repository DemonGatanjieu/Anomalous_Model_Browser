try {
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('anomalous_btn_x');
        localStorage.removeItem('anomalous_btn_y');
    }
} catch (_) {}

import { app } from '../../../scripts/app.js';
import { AnomalousBrowser } from './browser.js';
import {
    clampFloatingTriggerPosition,
    clearSavedTriggerPosition,
    DEFAULT_SAFE_LEFT,
    DEFAULT_SAFE_TOP,
    isValidSavedTriggerPosition,
    loadSavedTriggerPosition,
    normalizeEntryMode,
    normalizeFloatingTriggerSize,
    normalizeFloatingTriggerStyle,
    saveTriggerPosition
} from './entry_controls.js?v=20260921-flicker-free-1';
import {
    createShortcutSettingControl,
    DEFAULT_BROWSER_SHORTCUT,
    DEFAULT_MATERIALS_SHORTCUT,
    installDeferredShortcutFallback,
} from './shortcut_controls.js';

export const ENTRY_MODE_SETTING_ID = 'Anomalous.ModelBrowser.EntryMode';
export const SHORTCUT_SETTING_ID = 'Anomalous.ModelBrowser.Shortcut';
export const MATERIALS_SHORTCUT_SETTING_ID = 'Anomalous.ModelBrowser.MaterialsShortcut';
export const FLOATING_TRIGGER_SIZE_SETTING_ID = 'Anomalous.ModelBrowser.FloatingTriggerSize';
export const FLOATING_TRIGGER_STYLE_SETTING_ID = 'Anomalous.ModelBrowser.FloatingTriggerStyle';
export const OPEN_BROWSER_COMMAND_ID = 'Anomalous.ModelBrowser.Open';
export const OPEN_MATERIALS_COMMAND_ID = 'Anomalous.ModelBrowser.OpenMaterials';
export const RESET_TRIGGER_POSITION_COMMAND_ID = 'Anomalous.ModelBrowser.ResetFloatingTriggerPosition';

export function createBrowserEntry({ translate, getCurrentLanguage }) {
    let entryMode = 'floating';
    let floatingTriggerSize = 'medium';
    let floatingTriggerStyle = 'icon';
    let browserInstance = null;
    let triggerButton = null;
    let triggerBoundsUpdater = null;
    let disposeMaterialsShortcutFallback = null;
    const t = translate;

    function getSettingTranslationPatches() {
        const category = t('mainInterfaceCategory');
        return {
            [FLOATING_TRIGGER_STYLE_SETTING_ID]: {
                name: t('mainFloatingTriggerStyleSetting'),
                category: ['Anomalous Model Browser', category, 'floating-trigger-style'],
                tooltip: t('mainFloatingTriggerStyleTooltip'),
                options: [
                    { value: 'icon', text: t('mainFloatingTriggerStyleIcon') },
                    { value: 'pill', text: t('mainFloatingTriggerStylePill') }
                ]
            },
            [FLOATING_TRIGGER_SIZE_SETTING_ID]: {
                name: t('mainFloatingTriggerSizeSetting'),
                category: ['Anomalous Model Browser', category, 'floating-trigger-size'],
                tooltip: t('mainFloatingTriggerSizeTooltip'),
                options: [
                    { value: 'small', text: t('mainFloatingTriggerSizeSmall') },
                    { value: 'medium', text: t('mainFloatingTriggerSizeMedium') },
                    { value: 'large', text: t('mainFloatingTriggerSizeLarge') }
                ]
            },
            [SHORTCUT_SETTING_ID]: {
                name: t('mainShortcutSetting'),
                category: ['Anomalous Model Browser', category, 'shortcut'],
                tooltip: t('mainShortcutTooltip')
            },
            [MATERIALS_SHORTCUT_SETTING_ID]: {
                name: t('mainMaterialsShortcutSetting'),
                category: ['Anomalous Model Browser', category, 'materials-shortcut'],
                tooltip: t('mainMaterialsShortcutTooltip')
            },
            [ENTRY_MODE_SETTING_ID]: {
                name: t('mainEntryModeSetting'),
                category: ['Anomalous Model Browser', category, 'entry-mode'],
                tooltip: t('mainEntryModeTooltip'),
                options: [
                    { value: 'floating', text: t('mainEntryModeFloating') },
                    { value: 'topbar', text: t('mainEntryModeTopbar') },
                    { value: 'menu', text: t('mainEntryModeMenu') }
                ]
            }
        };
    }

    function refreshRegisteredSettings() {
        const settingsApi = app.extensionManager?.setting;
        const registry = settingsApi?.settings?.value || settingsApi?.settings;
        if (!registry || typeof registry !== 'object') return;
        for (const [id, patch] of Object.entries(getSettingTranslationPatches())) {
            if (registry[id]) registry[id] = { ...registry[id], ...patch };
        }
    }

    function syncVisibility() {
        document.documentElement.classList.toggle('anomalous-topbar-entry-enabled', entryMode === 'topbar');
        document.documentElement.classList.toggle('anomalous-floating-entry-enabled', entryMode === 'floating');
        const browserIsOpen = browserInstance?.modal?.classList.contains('visible') === true;
        triggerButton?.classList.toggle('anomalous-trigger-hidden', entryMode !== 'floating' || browserIsOpen);
    }

    function applyPresentation() {
        if (!triggerButton) return;
        triggerButton.dataset.size = floatingTriggerSize;
        triggerButton.dataset.style = floatingTriggerStyle;
        const icon = document.createElement('span');
        icon.className = 'anomalous-trigger-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1em;height:1em;display:block;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
        const label = document.createElement('span');
        label.className = 'anomalous-trigger-label';
        label.textContent = t('mainFloatingTriggerLabel');
        triggerButton.replaceChildren(icon, label);
        triggerButton.title = t('mainOpenTitle');
        triggerButton.setAttribute('aria-label', t('mainOpenTitle'));
        if (loadSavedTriggerPosition()) {
            requestAnimationFrame(() => triggerBoundsUpdater?.());
        }
    }

    function resetPosition() {
        clearSavedTriggerPosition();
        if (!triggerButton) return;
        triggerButton.style.left = '';
        triggerButton.style.top = '';
        triggerButton.style.right = '';
        triggerButton.style.bottom = '';
    }

    function ensureBrowser() {
        if (browserInstance) return browserInstance;
        try {
            browserInstance = new AnomalousBrowser();
            browserInstance.entryMode = entryMode;
            browserInstance.triggerButton = triggerButton;
            window.anomalousBrowserInstance = browserInstance;
            triggerButton?.classList.remove('anomalous-trigger-error');
            if (triggerButton) {
                triggerButton.title = t('mainOpenTitle');
                triggerButton.setAttribute('aria-label', t('mainOpenTitle'));
            }
            syncVisibility();
            return browserInstance;
        } catch (error) {
            console.error('[Anomalous Model Browser] UI initialization failed:', error);
            triggerButton?.classList.add('anomalous-trigger-error');
            if (triggerButton) {
                triggerButton.title = getCurrentLanguage() === 'zh' ? t('mainRetryInit') : t('mainRetryInitEn');
                triggerButton.setAttribute('aria-label', triggerButton.title);
            }
            return null;
        }
    }

    function open() {
        ensureBrowser()?.show();
    }

    async function openMaterials() {
        const browser = ensureBrowser();
        if (!browser) return;
        await browser.openMaterialLibrary();
    }

    function getMaterialsShortcutCombo() {
        const commands = app.extensionManager?.command?.commands;
        const command = Array.isArray(commands)
            ? commands.find(item => item.id === OPEN_MATERIALS_COMMAND_ID)
            : null;
        return command ? command.keybinding?.combo || null : DEFAULT_MATERIALS_SHORTCUT;
    }

    function materialLibraryIsOpen() {
        return browserInstance?.modal?.classList.contains('visible') === true
            && browserInstance?.nbPanel?.style.display === 'flex'
            && browserInstance?.materialContainer?.style.display === 'flex';
    }

    function installMaterialsShortcutFallback() {
        disposeMaterialsShortcutFallback?.();
        disposeMaterialsShortcutFallback = installDeferredShortcutFallback({
            target: window,
            getCombo: getMaterialsShortcutCombo,
            isHandled: materialLibraryIsOpen,
            onFallback: openMaterials,
            onError: error => console.error('[Anomalous Model Browser] Material shortcut failed:', error),
        });
    }

    const translationPatches = getSettingTranslationPatches();
    const settings = [
        {
            id: FLOATING_TRIGGER_STYLE_SETTING_ID,
            ...translationPatches[FLOATING_TRIGGER_STYLE_SETTING_ID],
            type: 'combo',
            defaultValue: 'icon',
            onChange(value) {
                floatingTriggerStyle = normalizeFloatingTriggerStyle(value);
                applyPresentation();
            }
        },
        {
            id: FLOATING_TRIGGER_SIZE_SETTING_ID,
            ...translationPatches[FLOATING_TRIGGER_SIZE_SETTING_ID],
            type: 'combo',
            defaultValue: 'medium',
            onChange(value) {
                floatingTriggerSize = normalizeFloatingTriggerSize(value);
                applyPresentation();
            }
        },
        {
            id: SHORTCUT_SETTING_ID,
            ...translationPatches[SHORTCUT_SETTING_ID],
            type: () => createShortcutSettingControl({ app, commandId: OPEN_BROWSER_COMMAND_ID, translate: t }),
            defaultValue: '',
            telemetry: { trackChanges: false }
        },
        {
            id: MATERIALS_SHORTCUT_SETTING_ID,
            ...translationPatches[MATERIALS_SHORTCUT_SETTING_ID],
            type: () => createShortcutSettingControl({
                app,
                commandId: OPEN_MATERIALS_COMMAND_ID,
                translate: t,
                settingLabelKey: 'mainMaterialsShortcutSetting',
            }),
            defaultValue: '',
            telemetry: { trackChanges: false }
        },
        {
            id: ENTRY_MODE_SETTING_ID,
            ...translationPatches[ENTRY_MODE_SETTING_ID],
            type: 'combo',
            defaultValue: 'floating',
            onChange(value) {
                entryMode = normalizeEntryMode(value);
                if (browserInstance) browserInstance.entryMode = entryMode;
                syncVisibility();
            }
        }
    ];

    window.addEventListener('anomalous-language-change', () => {
        applyPresentation();
        refreshRegisteredSettings();
    });

    async function setup() {
        const cssUrl = '/extensions/Anomalous_Model_Browser/styles.css?v=20260921-flicker-free-1';
        if (!document.querySelector('link[href^="/extensions/Anomalous_Model_Browser/styles.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.type = 'text/css';
            link.href = cssUrl;
            document.head.appendChild(link);
        }

        try {
            const registeredSettings = app.extensionManager?.setting;
            entryMode = normalizeEntryMode(registeredSettings?.get(ENTRY_MODE_SETTING_ID));
            floatingTriggerSize = normalizeFloatingTriggerSize(registeredSettings?.get(FLOATING_TRIGGER_SIZE_SETTING_ID));
            floatingTriggerStyle = normalizeFloatingTriggerStyle(registeredSettings?.get(FLOATING_TRIGGER_STYLE_SETTING_ID));
        } catch (error) {
            console.warn('[Anomalous Model Browser] Unable to read entry preferences:', error);
        }

        const btn = document.createElement('button');
        btn.id = 'anomalous-trigger-btn';
        btn.setAttribute('aria-label', 'Anomalous Model Browser');
        // Prevent FOUC: Start hidden until presentation & exact coordinates are bound
        btn.classList.add('anomalous-trigger-initializing');
        triggerButton = btn;
        if (browserInstance) browserInstance.triggerButton = btn;
        btn.title = t('mainOpenTitle');

        // Pre-configure content & presentation BEFORE mounting
        applyPresentation();

        // Pre-calculate and assign exact target coordinates BEFORE appending to DOM
        const savedInitialPos = loadSavedTriggerPosition();
        if (savedInitialPos) {
            const estSize = floatingTriggerSize === 'small' ? 44 : (floatingTriggerSize === 'large' ? 76 : 60);
            const initialClamped = clampFloatingTriggerPosition({
                x: savedInitialPos.x,
                y: savedInitialPos.y,
                width: estSize,
                height: estSize,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                minX: 70
            });
            btn.style.position = 'fixed';
            btn.style.left = initialClamped.x + 'px';
            btn.style.top = initialClamped.y + 'px';
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
        }

        let isDragging = false;
        let hasMoved = false;
        let startPointerX = 0;
        let startPointerY = 0;
        let startBtnLeft = 0;
        let startBtnTop = 0;
        let currentDragX = null;
        let currentDragY = null;
        let activePointerId = null;

        const onPointerMove = (event) => {
            if (!isDragging) return;
            const dx = event.clientX - startPointerX;
            const dy = event.clientY - startPointerY;
            if (!hasMoved && Math.hypot(dx, dy) >= 4) {
                hasMoved = true;
            }
            if (!hasMoved) return;
            event.preventDefault();
            const btnW = btn.offsetWidth || 60;
            const btnH = btn.offsetHeight || 60;
            const clamped = clampFloatingTriggerPosition({
                x: startBtnLeft + dx,
                y: startBtnTop + dy,
                width: btnW,
                height: btnH,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                minX: 70
            });
            currentDragX = clamped.x;
            currentDragY = clamped.y;
            btn.style.left = clamped.x + 'px';
            btn.style.top = clamped.y + 'px';
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
        };

        const finishDrag = (event) => {
            if (!isDragging) return;
            isDragging = false;

            btn.removeEventListener('pointermove', onPointerMove);
            btn.removeEventListener('pointerup', finishDrag);
            btn.removeEventListener('pointercancel', finishDrag);
            btn.removeEventListener('lostpointercapture', finishDrag);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', finishDrag);
            window.removeEventListener('pointercancel', finishDrag);

            if (activePointerId != null) {
                try {
                    if (btn.hasPointerCapture(activePointerId)) {
                        btn.releasePointerCapture(activePointerId);
                    }
                } catch (_) {}
                activePointerId = null;
            }

            btn.style.transition = '';

            if (hasMoved && currentDragX != null && currentDragY != null) {
                saveTriggerPosition({ x: currentDragX, y: currentDragY });
            } else if (!hasMoved) {
                open();
            }
        };

        btn.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            isDragging = true;
            hasMoved = false;
            startPointerX = event.clientX;
            startPointerY = event.clientY;
            activePointerId = event.pointerId;

            const rect = btn.getBoundingClientRect();
            startBtnLeft = rect.left;
            startBtnTop = rect.top;
            currentDragX = rect.left;
            currentDragY = rect.top;

            btn.style.transition = 'none';

            try {
                btn.setPointerCapture(event.pointerId);
            } catch (_) {}

            btn.addEventListener('pointermove', onPointerMove, { passive: false });
            btn.addEventListener('pointerup', finishDrag);
            btn.addEventListener('pointercancel', finishDrag);
            btn.addEventListener('lostpointercapture', finishDrag);
            window.addEventListener('pointermove', onPointerMove, { passive: false });
            window.addEventListener('pointerup', finishDrag);
            window.addEventListener('pointercancel', finishDrag);
        });

        const updateBtnBounds = () => {
            const saved = loadSavedTriggerPosition();
            if (saved) {
                const estFallback = floatingTriggerSize === 'small' ? 44 : (floatingTriggerSize === 'large' ? 76 : 60);
                const btnW = btn.offsetWidth || estFallback;
                const btnH = btn.offsetHeight || btnW;
                const clamped = clampFloatingTriggerPosition({
                    x: saved.x,
                    y: saved.y,
                    width: btnW,
                    height: btnH,
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight,
                    minX: 70
                });
                btn.style.left = clamped.x + 'px';
                btn.style.top = clamped.y + 'px';
                btn.style.right = 'auto';
                btn.style.bottom = 'auto';
            } else {
                btn.style.left = '';
                btn.style.top = '';
                btn.style.right = '';
                btn.style.bottom = '';
            }
        };
        triggerBoundsUpdater = updateBtnBounds;

        window.addEventListener('resize', () => {
            updateBtnBounds();
            syncVisibility();
        });

        // Mount pre-positioned and styled element to DOM
        document.body.appendChild(btn);
        syncVisibility();
        ensureBrowser();
        installMaterialsShortcutFallback();

        // Reveal smoothly on first animation frame without any positional jump or flicker
        requestAnimationFrame(() => {
            updateBtnBounds();
            btn.classList.remove('anomalous-trigger-initializing');
        });

        window.anomalousDragGhostImg = new Image();
        window.anomalousDragGhostImg.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='76' height='76' x='2' y='2' fill='%23140812' fill-opacity='0.85' rx='16' stroke='%23f59e0b' stroke-width='2'/><text x='40' y='50' font-family='sans-serif' font-size='32' font-weight='bold' fill='%23f59e0b' text-anchor='middle'>W</text></svg>";
    }

    return {
        settings,
        actionBarButtons: [{
            icon: 'pi pi-box',
            label: t('mainTopbarTriggerLabel'),
            tooltip: t('mainOpenTitle'),
            class: 'anomalous-topbar-entry',
            onClick: open
        }],
        commands: [
            { id: OPEN_BROWSER_COMMAND_ID, label: t('mainOpenTitle'), function: open },
            { id: OPEN_MATERIALS_COMMAND_ID, label: t('mainOpenMaterialsTitle'), function: openMaterials },
            { id: RESET_TRIGGER_POSITION_COMMAND_ID, label: t('mainResetFloatingTriggerPosition'), function: resetPosition }
        ],
        keybindings: [
            { combo: DEFAULT_BROWSER_SHORTCUT, commandId: OPEN_BROWSER_COMMAND_ID },
            { combo: DEFAULT_MATERIALS_SHORTCUT, commandId: OPEN_MATERIALS_COMMAND_ID },
        ],
        menuCommands: [{
            path: ['Extensions', 'Anomalous Model Browser'],
            commands: [OPEN_BROWSER_COMMAND_ID, OPEN_MATERIALS_COMMAND_ID, RESET_TRIGGER_POSITION_COMMAND_ID]
        }],
        setup,
        open,
        openMaterials,
        ensureBrowser,
        resetPosition,
        syncVisibility
    };
}
