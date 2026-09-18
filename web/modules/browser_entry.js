import { app } from '../../../scripts/app.js';
import { AnomalousBrowser } from './browser.js';
import {
    clampFloatingTriggerPosition,
    normalizeEntryMode,
    normalizeFloatingTriggerSize,
    normalizeFloatingTriggerStyle
} from './entry_controls.js';
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
        requestAnimationFrame(() => triggerBoundsUpdater?.());
    }

    function resetPosition() {
        localStorage.removeItem('anomalous_btn_x');
        localStorage.removeItem('anomalous_btn_y');
        if (!triggerButton) return;
        triggerButton.style.left = '';
        triggerButton.style.top = '';
        triggerButton.style.right = '30px';
        triggerButton.style.bottom = '30px';
        requestAnimationFrame(() => triggerBoundsUpdater?.());
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
        const cssUrl = '/extensions/Anomalous_Model_Browser/styles.css?v=' + Date.now();
        if (!document.querySelector('link[href^="/extensions/Anomalous_Model_Browser/styles.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.type = 'text/css';
            link.href = cssUrl;
            document.head.appendChild(link);
        }

        const btn = document.createElement('button');
        btn.id = 'anomalous-trigger-btn';
        btn.setAttribute('aria-label', 'Anomalous Model Browser');
        triggerButton = btn;
        if (browserInstance) browserInstance.triggerButton = btn;
        btn.title = t('mainOpenTitle');
        let isDragging = false;
        let startX;
        let startY;
        let initialX;
        let initialY;

        btn.addEventListener('mousedown', event => {
            isDragging = true;
            startX = event.clientX;
            startY = event.clientY;
            const rect = btn.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            btn.style.transition = 'none';
        });
        window.addEventListener('mousemove', event => {
            if (!isDragging) return;
            event.preventDefault();
            const nextPosition = clampFloatingTriggerPosition({
                x: initialX + (event.clientX - startX),
                y: initialY + (event.clientY - startY),
                width: btn.offsetWidth,
                height: btn.offsetHeight,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                margin: 0
            });
            btn.style.left = nextPosition.x + 'px';
            btn.style.top = nextPosition.y + 'px';
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
        });
        window.addEventListener('mouseup', event => {
            if (!isDragging) return;
            isDragging = false;
            btn.style.transition = 'transform 0.15s, box-shadow 0.15s';
            localStorage.setItem('anomalous_btn_x', btn.style.left);
            localStorage.setItem('anomalous_btn_y', btn.style.top);
            if (Math.abs(event.clientX - startX) < 5 && Math.abs(event.clientY - startY) < 5) open();
        });

        let savedX = localStorage.getItem('anomalous_btn_x');
        let savedY = localStorage.getItem('anomalous_btn_y');
        const updateBtnBounds = () => {
            savedX = localStorage.getItem('anomalous_btn_x');
            savedY = localStorage.getItem('anomalous_btn_y');
            const position = clampFloatingTriggerPosition({
                x: btn.style.left || savedX,
                y: btn.style.top || savedY,
                width: btn.offsetWidth,
                height: btn.offsetHeight,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight
            });
            btn.style.left = position.x + 'px';
            btn.style.top = position.y + 'px';
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
        };
        triggerBoundsUpdater = updateBtnBounds;

        if (savedX && savedY && savedX !== 'NaN' && savedY !== 'NaN') {
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
            btn.style.left = savedX;
            btn.style.top = savedY;
        }
        setTimeout(updateBtnBounds, 200);
        window.addEventListener('resize', () => {
            if (btn.style.left) updateBtnBounds();
            syncVisibility();
        });

        document.body.appendChild(btn);
        try {
            const registeredSettings = app.extensionManager?.setting;
            entryMode = normalizeEntryMode(registeredSettings?.get(ENTRY_MODE_SETTING_ID));
            floatingTriggerSize = normalizeFloatingTriggerSize(registeredSettings?.get(FLOATING_TRIGGER_SIZE_SETTING_ID));
            floatingTriggerStyle = normalizeFloatingTriggerStyle(registeredSettings?.get(FLOATING_TRIGGER_STYLE_SETTING_ID));
        } catch (error) {
            console.warn('[Anomalous Model Browser] Unable to read entry preferences:', error);
        }
        applyPresentation();
        syncVisibility();
        ensureBrowser();
        installMaterialsShortcutFallback();

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
