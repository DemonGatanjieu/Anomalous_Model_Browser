import { AnomalousBrowser } from './modules/browser.js';
import { app } from "../../scripts/app.js";
import { normalizeLocale, resolveLocale, translate } from './modules/locales.js';
import {
    clampFloatingTriggerPosition,
    normalizeEntryMode,
    normalizeFloatingTriggerSize,
    normalizeFloatingTriggerStyle
} from './modules/entry_controls.js';
import {
    createShortcutSettingControl,
    DEFAULT_BROWSER_SHORTCUT
} from './modules/shortcut_controls.js';
// ============================================================================
// TABLE OF CONTENTS (TOC)
// 1. App Registration & Entry     (Search for "app.registerExtension")
// 2. State & Class Constructor    (Search for "class AnomalousBrowser")
// 3. UI - Sidebar                 (Search for "createDOM")
// 4. UI - Main Grid               (Search for "renderGrid")
// 5. UI - Detail Panel            (Search for "showDetail")
// 6. UI - Gallery Viewer          (Search for "createGalleryViewer")
// 7. UI - Doctor Panel            (Search for "createDoctorPanel")
// 8. Notebooks & Workflow Recipes (Search for "Notebook" or "Recipes")
// ============================================================================

let defaultLang = 'zh';
try {
    let comfyDetected = false;
    const aglLang = localStorage.getItem('Comfy.Settings.AIGODLIKE-COMFYUI-TRANSLATION.Language');
    if (aglLang) {
        defaultLang = aglLang.toLowerCase().includes('en') ? 'en' : 'zh';
        comfyDetected = true;
    } else {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.toLowerCase().includes('lang') || key.toLowerCase().includes('locale'))) {
                const val = localStorage.getItem(key);
                if (typeof val === 'string') {
                    const lowerVal = val.toLowerCase();
                    if (lowerVal.includes('zh') || lowerVal.includes('chinese')) {
                        defaultLang = 'zh';
                        comfyDetected = true;
                        break;
                    } else if (lowerVal.includes('en') || lowerVal.includes('english')) {
                        defaultLang = 'en';
                        comfyDetected = true;
                        break;
                    }
                }
            }
        }
    }

    if (!comfyDetected && navigator.language && !navigator.language.toLowerCase().startsWith('zh')) {
        defaultLang = 'en';
    }
} catch (e) {
    if (navigator.language && !navigator.language.toLowerCase().startsWith('zh')) {
        defaultLang = 'en';
    }
}
let currentLang = resolveLocale(localStorage.getItem('anomalous_lang') || defaultLang);
window.anomalous_browser_lang = currentLang;
const t = (key, params) => translate(key, params, window.anomalous_browser_lang || currentLang);

const LANGUAGE_SETTING_ID = 'Anomalous.ModelBrowser.Language';
const ENTRY_MODE_SETTING_ID = 'Anomalous.ModelBrowser.EntryMode';
const SHORTCUT_SETTING_ID = 'Anomalous.ModelBrowser.Shortcut';
const FLOATING_TRIGGER_SIZE_SETTING_ID = 'Anomalous.ModelBrowser.FloatingTriggerSize';
const FLOATING_TRIGGER_STYLE_SETTING_ID = 'Anomalous.ModelBrowser.FloatingTriggerStyle';
const ABYSSAL_SCARLET_SETTING_ID = 'Anomalous.ModelBrowser.AbyssalScarletTheme';
const OPEN_BROWSER_COMMAND_ID = 'Anomalous.ModelBrowser.Open';
const RESET_TRIGGER_POSITION_COMMAND_ID = 'Anomalous.ModelBrowser.ResetFloatingTriggerPosition';
let entryMode = 'floating';
let floatingTriggerSize = 'medium';
let floatingTriggerStyle = 'icon';
let browserInstance = null;
let triggerButton = null;
let triggerBoundsUpdater = null;

function normalizeLanguagePreference(value) {
    return value === 'zh' || value === 'en' ? value : 'auto';
}

function resolveComfyLanguage() {
    try {
        const settings = app.extensionManager?.setting;
        const locale = settings?.get('Comfy.Locale')
            || app.ui?.settings?.getSettingValue?.('Comfy.Locale')
            || app.ui?.settings?.getSettingValue?.('Comfy.Locale.Language');
        return normalizeLocale(locale) || defaultLang;
    } catch (error) {
        return defaultLang;
    }
}

function getInterfaceSettingTranslations() {
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
        [ENTRY_MODE_SETTING_ID]: {
            name: t('mainEntryModeSetting'),
            category: ['Anomalous Model Browser', category, 'entry-mode'],
            tooltip: t('mainEntryModeTooltip'),
            options: [
                { value: 'floating', text: t('mainEntryModeFloating') },
                { value: 'topbar', text: t('mainEntryModeTopbar') },
                { value: 'menu', text: t('mainEntryModeMenu') }
            ]
        },
        [LANGUAGE_SETTING_ID]: {
            name: t('mainLanguageSetting'),
            category: ['Anomalous Model Browser', category, 'language'],
            tooltip: t('mainLanguageTooltip'),
            options: [
                { value: 'auto', text: t('mainLanguageAuto') },
                { value: 'zh', text: t('mainLanguageChinese') },
                { value: 'en', text: t('mainLanguageEnglish') }
            ]
        },
        [ABYSSAL_SCARLET_SETTING_ID]: {
            name: t('mainAbyssalScarletThemeSetting'),
            category: ['Anomalous Model Browser', category, 'theme'],
            tooltip: t('mainAbyssalScarletThemeTooltip')
        }
    };
}

function refreshRegisteredInterfaceSettings() {
    const settingsApi = app.extensionManager?.setting;
    const registry = settingsApi?.settings?.value || settingsApi?.settings;
    if (!registry || typeof registry !== 'object') return;

    const translations = getInterfaceSettingTranslations();
    for (const [id, patch] of Object.entries(translations)) {
        const current = registry[id];
        if (!current) continue;
        // Replacing the descriptor keeps ComfyUI's computed settings tree reactive,
        // including the open settings dialog and its translated combo options.
        registry[id] = { ...current, ...patch };
    }
}

function applyLanguagePreference(value) {
    const preference = normalizeLanguagePreference(value);
    if (preference === 'auto') {
        localStorage.removeItem('anomalous_lang');
    } else {
        localStorage.setItem('anomalous_lang', preference);
    }

    const nextLanguage = preference === 'auto' ? resolveComfyLanguage() : preference;
    const changed = nextLanguage !== window.anomalous_browser_lang;
    currentLang = nextLanguage;
    window.anomalous_browser_lang = nextLanguage;
    applyFloatingTriggerPresentation();
    refreshRegisteredInterfaceSettings();
    if (changed) {
        window.dispatchEvent(new CustomEvent('anomalous-language-change', {
            detail: { language: nextLanguage, preference }
        }));
    }
}

if (!localStorage.getItem('anomalous_lang')) {
    currentLang = resolveComfyLanguage();
    window.anomalous_browser_lang = currentLang;
}

function showThemeNoticeToast(isEnabled) {
    const existing = document.getElementById('anomalous-theme-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'anomalous-theme-toast';
    toast.className = 'anomalous-theme-toast' + (isEnabled ? ' is-abyssal' : '');
    toast.textContent = isEnabled ? t('themeDomainActivated') : t('themeDomainDeactivated');
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('is-show');
    });

    setTimeout(() => {
        toast.classList.remove('is-show');
        setTimeout(() => toast.remove(), 400);
    }, 2400);
}

export function setAbyssalScarletTheme(enabled, notify = false) {
    const isEnabled = Boolean(enabled);
    localStorage.setItem('anomalous_theme_abyssal_scarlet', isEnabled ? 'true' : 'false');

    document.documentElement.classList.toggle('theme-abyssal-scarlet', isEnabled);
    const modal = document.getElementById('anomalous-modal');
    if (modal) modal.classList.toggle('theme-abyssal-scarlet', isEnabled);
    const container = document.getElementById('anomalous-container');
    if (container) container.classList.toggle('theme-abyssal-scarlet', isEnabled);

    try {
        const settings = app.extensionManager?.setting;
        if (settings && typeof settings.set === 'function') {
            if (settings.get(ABYSSAL_SCARLET_SETTING_ID) !== isEnabled) {
                settings.set(ABYSSAL_SCARLET_SETTING_ID, isEnabled);
            }
        }
    } catch (_) {}

    if (notify) {
        showThemeNoticeToast(isEnabled);
    }

    window.dispatchEvent(new CustomEvent('anomalous-theme-change', {
        detail: { theme: isEnabled ? 'abyssal-scarlet' : 'default', enabled: isEnabled }
    }));
}
window.setAbyssalScarletTheme = setAbyssalScarletTheme;

const initialTheme = localStorage.getItem('anomalous_theme_abyssal_scarlet') === 'true';
setAbyssalScarletTheme(initialTheme, false);

function syncFloatingTriggerVisibility() {
    document.documentElement.classList.toggle('anomalous-topbar-entry-enabled', entryMode === 'topbar');
    document.documentElement.classList.toggle('anomalous-floating-entry-enabled', entryMode === 'floating');
    const browserIsOpen = browserInstance?.modal?.classList.contains('visible') === true;
    const shouldShow = entryMode === 'floating' && !browserIsOpen;
    triggerButton?.classList.toggle('anomalous-trigger-hidden', !shouldShow);
}

function applyFloatingTriggerPresentation() {
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

function resetFloatingTriggerPosition() {
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
        syncFloatingTriggerVisibility();
        return browserInstance;
    } catch (error) {
        console.error('[Anomalous Model Browser] UI initialization failed:', error);
        triggerButton?.classList.add('anomalous-trigger-error');
        if (triggerButton) {
            triggerButton.title = currentLang === 'zh' ? t('mainRetryInit') : t('mainRetryInitEn');
            triggerButton.setAttribute('aria-label', triggerButton.title);
        }
        return null;
    }
}

function openBrowser() {
    ensureBrowser()?.show();
}

app.registerExtension({
    name: 'Anomalous.ModelBrowser',
    settings: [
        {
            id: FLOATING_TRIGGER_STYLE_SETTING_ID,
            name: t('mainFloatingTriggerStyleSetting'),
            category: ['Anomalous Model Browser', t('mainInterfaceCategory'), 'floating-trigger-style'],
            tooltip: t('mainFloatingTriggerStyleTooltip'),
            type: 'combo',
            defaultValue: 'icon',
            options: [
                { value: 'icon', text: t('mainFloatingTriggerStyleIcon') },
                { value: 'pill', text: t('mainFloatingTriggerStylePill') }
            ],
            onChange(value) {
                floatingTriggerStyle = normalizeFloatingTriggerStyle(value);
                applyFloatingTriggerPresentation();
            }
        },
        {
            id: FLOATING_TRIGGER_SIZE_SETTING_ID,
            name: t('mainFloatingTriggerSizeSetting'),
            category: ['Anomalous Model Browser', t('mainInterfaceCategory'), 'floating-trigger-size'],
            tooltip: t('mainFloatingTriggerSizeTooltip'),
            type: 'combo',
            defaultValue: 'medium',
            options: [
                { value: 'small', text: t('mainFloatingTriggerSizeSmall') },
                { value: 'medium', text: t('mainFloatingTriggerSizeMedium') },
                { value: 'large', text: t('mainFloatingTriggerSizeLarge') }
            ],
            onChange(value) {
                floatingTriggerSize = normalizeFloatingTriggerSize(value);
                applyFloatingTriggerPresentation();
            }
        },
        {
            id: SHORTCUT_SETTING_ID,
            name: t('mainShortcutSetting'),
            category: ['Anomalous Model Browser', t('mainInterfaceCategory'), 'shortcut'],
            tooltip: t('mainShortcutTooltip'),
            type: () => createShortcutSettingControl({
                app,
                commandId: OPEN_BROWSER_COMMAND_ID,
                translate: t
            }),
            defaultValue: '',
            telemetry: { trackChanges: false }
        },
        {
            id: ENTRY_MODE_SETTING_ID,
            name: t('mainEntryModeSetting'),
            category: ['Anomalous Model Browser', t('mainInterfaceCategory'), 'entry-mode'],
            tooltip: t('mainEntryModeTooltip'),
            type: 'combo',
            defaultValue: 'floating',
            options: [
                { value: 'floating', text: t('mainEntryModeFloating') },
                { value: 'topbar', text: t('mainEntryModeTopbar') },
                { value: 'menu', text: t('mainEntryModeMenu') }
            ],
            onChange(value) {
                entryMode = normalizeEntryMode(value);
                if (browserInstance) browserInstance.entryMode = entryMode;
                syncFloatingTriggerVisibility();
            }
        },
        {
            id: LANGUAGE_SETTING_ID,
            name: t('mainLanguageSetting'),
            category: ['Anomalous Model Browser', t('mainInterfaceCategory'), 'language'],
            tooltip: t('mainLanguageTooltip'),
            type: 'combo',
            defaultValue: () => normalizeLanguagePreference(localStorage.getItem('anomalous_lang')),
            options: [
                { value: 'auto', text: t('mainLanguageAuto') },
                { value: 'zh', text: t('mainLanguageChinese') },
                { value: 'en', text: t('mainLanguageEnglish') }
            ],
            onChange(value) {
                applyLanguagePreference(value);
            }
        },
        {
            id: ABYSSAL_SCARLET_SETTING_ID,
            name: t('mainAbyssalScarletThemeSetting'),
            category: ['Anomalous Model Browser', t('mainInterfaceCategory'), 'theme'],
            tooltip: t('mainAbyssalScarletThemeTooltip'),
            type: 'boolean',
            defaultValue: () => localStorage.getItem('anomalous_theme_abyssal_scarlet') === 'true',
            onChange(value) {
                setAbyssalScarletTheme(Boolean(value), true);
            }
        }
    ],
    actionBarButtons: [
        {
            icon: 'pi pi-box',
            label: t('mainTopbarTriggerLabel'),
            tooltip: t('mainOpenTitle'),
            class: 'anomalous-topbar-entry',
            onClick: openBrowser
        }
    ],
    commands: [
        {
            id: OPEN_BROWSER_COMMAND_ID,
            label: t('mainOpenTitle'),
            function: openBrowser
        },
        {
            id: RESET_TRIGGER_POSITION_COMMAND_ID,
            label: t('mainResetFloatingTriggerPosition'),
            function: resetFloatingTriggerPosition
        }
    ],
    keybindings: [
        {
            combo: DEFAULT_BROWSER_SHORTCUT,
            commandId: OPEN_BROWSER_COMMAND_ID
        }
    ],
    menuCommands: [
        {
            path: ['Extensions', 'Anomalous Model Browser'],
            commands: [OPEN_BROWSER_COMMAND_ID, RESET_TRIGGER_POSITION_COMMAND_ID]
        }
    ],
    async setup() {
        const cssUrl = '/extensions/Anomalous_Model_Browser/styles.css?v=' + Date.now();
        if (!document.querySelector(`link[href^="/extensions/Anomalous_Model_Browser/styles.css"]`)) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.type = "text/css";
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
        let startX, startY, initialX, initialY;

        btn.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = btn.getBoundingClientRect();
            initialX = rect.left; initialY = rect.top;
            btn.style.transition = 'none';
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const nextPosition = clampFloatingTriggerPosition({
                x: initialX + (e.clientX - startX),
                y: initialY + (e.clientY - startY),
                width: btn.offsetWidth,
                height: btn.offsetHeight,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                margin: 0
            });
            btn.style.left = nextPosition.x + 'px';
            btn.style.top = nextPosition.y + 'px';
            btn.style.right = 'auto'; btn.style.bottom = 'auto';
        });
        window.addEventListener('mouseup', (e) => {
            if (isDragging) {
                isDragging = false;
                btn.style.transition = 'transform 0.15s, box-shadow 0.15s';
                localStorage.setItem('anomalous_btn_x', btn.style.left);
                localStorage.setItem('anomalous_btn_y', btn.style.top);
                if (Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5) {
                    openBrowser();
                }
            }
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

        // Always trigger an update slightly after load to ensure it's in bounds
        setTimeout(updateBtnBounds, 200);

        window.addEventListener('resize', () => {
            if (btn.style.left) updateBtnBounds();
            syncFloatingTriggerVisibility();
        });

        document.body.appendChild(btn);
        try {
            const settings = app.extensionManager?.setting;
            const configuredEntryMode = settings?.get(ENTRY_MODE_SETTING_ID);
            const configuredSize = settings?.get(FLOATING_TRIGGER_SIZE_SETTING_ID);
            const configuredStyle = settings?.get(FLOATING_TRIGGER_STYLE_SETTING_ID);
            entryMode = normalizeEntryMode(configuredEntryMode);
            floatingTriggerSize = normalizeFloatingTriggerSize(configuredSize);
            floatingTriggerStyle = normalizeFloatingTriggerStyle(configuredStyle);
        } catch (error) {
            console.warn('[Anomalous Model Browser] Unable to read entry preferences:', error);
        }
        applyFloatingTriggerPresentation();
        syncFloatingTriggerVisibility();
        // Initialize the shared browser instance once for every entry mode.
        ensureBrowser();

        // Pre-create a lightweight, translucent, and aesthetic drag ghost image for huge Hires Fix images
        window.anomalousDragGhostImg = new Image();
        window.anomalousDragGhostImg.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='76' height='76' x='2' y='2' fill='%23140812' fill-opacity='0.85' rx='16' stroke='%23f59e0b' stroke-width='2'/><text x='40' y='50' font-family='sans-serif' font-size='32' font-weight='bold' fill='%23f59e0b' text-anchor='middle'>W</text></svg>";
    }
});


// --- INJECTED WORKFLOW SHARE MODULE ---
// Workflow Share and Preview Modal for Anomalous_Model_Browser

const AMB_WorkflowShare = {
    // ----------------------------------------------------------------------
    // 1. Data Compression & Base64 Utils
    // ----------------------------------------------------------------------
    strToU8(str) {
        return new TextEncoder().encode(str);
    },
    u8ToStr(u8) {
        return new TextDecoder().decode(u8);
    },
    u8ToBase64(u8) {
        let binary = '';
        const len = u8.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(u8[i]);
        }
        return window.btoa(binary);
    },
    base64ToU8(b64) {
        const binary = window.atob(b64);
        const len = binary.length;
        const u8 = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            u8[i] = binary.charCodeAt(i);
        }
        return u8;
    },
    async compress(str) {
        const stream = new Blob([this.strToU8(str)]).stream();
        const compressedStream = stream.pipeThrough(new CompressionStream('deflate-raw'));
        const response = new Response(compressedStream);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        return new Uint8Array(buffer);
    },
    async decompress(u8) {
        const stream = new Blob([u8]).stream();
        const decompressedStream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
        const response = new Response(decompressedStream);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        return this.u8ToStr(new Uint8Array(buffer));
    },

    // ----------------------------------------------------------------------
    // 2. Skeleton Generation (Strip visual / default data)
    // ----------------------------------------------------------------------
    skeletonize(workflowJson) {
        const wf = JSON.parse(JSON.stringify(workflowJson)); // deep copy
        
        // ComfyUI workflow JSON format has "nodes" array
        if (wf.nodes && Array.isArray(wf.nodes)) {
            wf.nodes.forEach(node => {
                // Delete layout coords and styles
                delete node.pos;
                delete node.size;
                delete node.color;
                delete node.bgcolor;
                delete node.shape;
                delete node.flags;
                // Delete empty properties
                if (node.properties && Object.keys(node.properties).length === 0) {
                    delete node.properties;
                }
            });
        }
        
        // Remove view metadata
        if (wf.extra) {
            delete wf.extra.ds; // scale/offset
        }
        
        return wf;
    },

    // ----------------------------------------------------------------------
    // 3. Auto-Layout Algorithm
    // ----------------------------------------------------------------------
    autoLayout(workflowJson) {
        if (!workflowJson.nodes || !Array.isArray(workflowJson.nodes)) return workflowJson;
        
        const nodes = workflowJson.nodes;
        
        // 1. Build adjacency list and in-degrees
        const adj = new Map();
        const inDegree = new Map();
        
        nodes.forEach(n => {
            adj.set(n.id, []);
            if (!inDegree.has(n.id)) inDegree.set(n.id, 0);
        });
        
        // Check links
        if (workflowJson.links) {
            workflowJson.links.forEach(link => {
                if (!link) return;
                const fromId = link[1];
                const toId = link[3];
                if (adj.has(fromId) && adj.has(toId)) {
                    adj.get(fromId).push(toId);
                    inDegree.set(toId, inDegree.get(toId) + 1);
                }
            });
        }
        
        // 2. Topological sort with depth levels
        const depthMap = new Map(); // id -> depth
        const queue = [];
        
        nodes.forEach(n => {
            if (inDegree.get(n.id) === 0) {
                queue.push(n.id);
                depthMap.set(n.id, 0);
            }
        });
        
        while (queue.length > 0) {
            const curr = queue.shift();
            const currDepth = depthMap.get(curr);
            
            const neighbors = adj.get(curr);
            if (neighbors) {
                neighbors.forEach(nxt => {
                    // Reduce in-degree
                    const ind = inDegree.get(nxt) - 1;
                    inDegree.set(nxt, ind);
                    
                    // Update depth to be max(existing depth, currDepth + 1)
                    const existingDepth = depthMap.get(nxt) || 0;
                    depthMap.set(nxt, Math.max(existingDepth, currDepth + 1));
                    
                    if (ind === 0) {
                        queue.push(nxt);
                    }
                });
            }
        }
        
        // Handle cycles (nodes not reached)
        nodes.forEach(n => {
            if (!depthMap.has(n.id)) {
                depthMap.set(n.id, 0);
            }
        });
        
        // 3. Assign X, Y coordinates
        const nodesByDepth = {};
        nodes.forEach(n => {
            const d = depthMap.get(n.id);
            if (!nodesByDepth[d]) nodesByDepth[d] = [];
            nodesByDepth[d].push(n);
        });
        
        // Spacing constants
        const X_SPACING = 400;
        const Y_SPACING = 300;
        
        Object.keys(nodesByDepth).forEach(d => {
            const levelNodes = nodesByDepth[d];
            const depth = parseInt(d);
            levelNodes.forEach((n, idx) => {
                // Approximate size
                n.pos = [
                    depth * X_SPACING,
                    idx * Y_SPACING
                ];
            });
        });
        
        return workflowJson;
    },

    // ----------------------------------------------------------------------
    // 4. Encode / Decode
    // ----------------------------------------------------------------------
    async encodeShareCode(workflowJson, isSkeleton) {
        let targetJson = workflowJson;
        if (isSkeleton) {
            targetJson = this.skeletonize(workflowJson);
        }
        
        const jsonStr = JSON.stringify(targetJson);
        const compressedU8 = await this.compress(jsonStr);
        const base64Str = this.u8ToBase64(compressedU8);
        
        const prefix = isSkeleton ? 'AMB1-' : 'AMB0-';
        return prefix + base64Str;
    },
    
    async decodeShareCode(shareCode) {
        if (!shareCode.startsWith('AMB0-') && !shareCode.startsWith('AMB1-')) {
            throw new Error('Invalid Share Code Format.');
        }
        
        const isSkeleton = shareCode.startsWith('AMB1-');
        const base64Str = shareCode.substring(5);
        
        const compressedU8 = this.base64ToU8(base64Str);
        const jsonStr = await this.decompress(compressedU8);
        
        let workflowJson = JSON.parse(jsonStr);
        
        if (isSkeleton) {
            workflowJson = this.autoLayout(workflowJson);
        }
        
        return workflowJson;
    },
    
    // ----------------------------------------------------------------------
    // 5. UI Modals
    // ----------------------------------------------------------------------
    showToast(message, color) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed; bottom: 30px; right: 30px; background: #2a2a2b; color: ${color || '#fff'};
            padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            font-family: Arial, sans-serif; font-size: 14px; z-index: 9999999;
            opacity: 0; transition: opacity 0.3s ease; border-left: 4px solid ${color || '#fff'};
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.style.opacity = '1', 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    showExportModal() {
        const overlay = document.createElement('div');
        overlay.id = 'amb-export-modal';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            z-index: 999999; display: flex; justify-content: center; align-items: center;
            font-family: Arial, sans-serif;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2b; color: #fff; padding: 30px; border-radius: 12px;
            width: 500px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; gap: 20px;
        `;
        
        const title = document.createElement('h2');
        title.style.margin = '0';
        title.textContent = t('mainExportTitle');
        
        const typeSelectContainer = document.createElement('div');
        typeSelectContainer.innerHTML = `
            <label style="display: block; margin-bottom: 8px; cursor: pointer;">
                <input type="radio" name="amb-share-type" value="skeleton" checked />
                ${t('mainSkeletonOption')}
            </label>
            <label style="display: block; cursor: pointer;">
                <input type="radio" name="amb-share-type" value="full" />
                ${t('mainFullOption')}
            </label>
        `;
        
        const textArea = document.createElement('textarea');
        textArea.style.cssText = `
            width: 100%; height: 150px; background: #1e1e1f; color: #eee;
            border: 1px solid #444; border-radius: 6px; padding: 10px;
            font-family: monospace; font-size: 12px; resize: none; box-sizing: border-box;
        `;
        textArea.readOnly = true;
        
        const btnGroup = document.createElement('div');
        btnGroup.style.cssText = `display: flex; gap: 10px; justify-content: flex-end;`;
        
        const generateBtn = document.createElement('button');
        generateBtn.textContent = t('mainGenerate');
        generateBtn.style.cssText = `padding: 8px 16px; background: #4a90e2; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        const copyBtn = document.createElement('button');
        copyBtn.textContent = t('mainCopyClipboard');
        copyBtn.style.cssText = `padding: 8px 16px; background: #5cb85c; color: #fff; border: none; border-radius: 6px; cursor: pointer; display: none;`;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = t('mainClose');
        closeBtn.style.cssText = `padding: 8px 16px; background: #555; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        closeBtn.onclick = () => overlay.remove();
        
        generateBtn.onclick = async () => {
            const isSkeleton = document.querySelector('input[name="amb-share-type"]:checked').value === 'skeleton';
            
            // Get current workflow from app graph
            const p = await app.graphToPrompt();
            const workflowJson = p.workflow;
            
            try {
                const code = await AMB_WorkflowShare.encodeShareCode(workflowJson, isSkeleton);
                textArea.value = code;
                copyBtn.style.display = 'block';
            } catch (err) {
                textArea.value = 'Error generating code: ' + err.message;
            }
        };
        
        copyBtn.onclick = () => {
            textArea.select();
            document.execCommand('copy');
            AMB_WorkflowShare.showToast(t('mainCopied'), '#5cb85c');
        };
        
        btnGroup.appendChild(generateBtn);
        btnGroup.appendChild(copyBtn);
        btnGroup.appendChild(closeBtn);
        
        content.appendChild(title);
        content.appendChild(typeSelectContainer);
        content.appendChild(textArea);
        content.appendChild(btnGroup);
        overlay.appendChild(content);
        
        document.body.appendChild(overlay);
    },
    
    showImportModal() {
        const overlay = document.createElement('div');
        overlay.id = 'amb-import-modal';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            z-index: 999999; display: flex; justify-content: center; align-items: center;
            font-family: Arial, sans-serif;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2b; color: #fff; padding: 30px; border-radius: 12px;
            width: 600px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; gap: 20px;
        `;
        
        const title = document.createElement('h2');
        title.style.margin = '0';
        title.textContent = t('mainImportTitle');
        
        const inputArea = document.createElement('textarea');
        inputArea.placeholder = t('mainSharePlaceholder');
        inputArea.style.cssText = `
            width: 100%; height: 100px; background: #1e1e1f; color: #eee;
            border: 1px solid #444; border-radius: 6px; padding: 10px;
            font-family: monospace; font-size: 12px; resize: none; box-sizing: border-box;
        `;
        
        const btnGroup = document.createElement('div');
        btnGroup.style.cssText = `display: flex; gap: 10px; justify-content: flex-end;`;
        
        const loadBtn = document.createElement('button');
        loadBtn.textContent = t('mainImportLoad');
        loadBtn.style.cssText = `padding: 8px 16px; background: #e07a5f; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = t('mainCancel');
        closeBtn.style.cssText = `padding: 8px 16px; background: #555; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        closeBtn.onclick = () => overlay.remove();
        
        loadBtn.onclick = async () => {
            const code = inputArea.value.trim();
            if (!code) {
                AMB_WorkflowShare.showToast(t('mainShareEmpty'), '#ff6b6b');
                return;
            }
            try {
                const pendingWorkflow = await AMB_WorkflowShare.decodeShareCode(code);
                app.loadGraphData(pendingWorkflow);
                overlay.remove();
                
                const nodesCount = pendingWorkflow.nodes ? pendingWorkflow.nodes.length : 0;
                AMB_WorkflowShare.showToast(t('mainImportedNodes', { count: nodesCount }), '#5cb85c');
                
                // Auto close the main browser panel
                const mainCloseBtn = document.getElementById('anomalous-close');
                if (mainCloseBtn) mainCloseBtn.click();
            } catch (err) {
                AMB_WorkflowShare.showToast(t('mainDecodeFailed') + err.message, '#ff6b6b');
            }
        };
        
        btnGroup.appendChild(loadBtn);
        btnGroup.appendChild(closeBtn);
        
        content.appendChild(title);
        content.appendChild(inputArea);
        content.appendChild(btnGroup);
        overlay.appendChild(content);
        
        document.body.appendChild(overlay);
    },
    showUnifiedModal() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            z-index: 999999; display: flex; justify-content: center; align-items: center;
            font-family: Arial, sans-serif;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2b; color: #fff; padding: 30px; border-radius: 12px;
            width: 400px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; gap: 20px; text-align: center;
        `;
        
        const title = document.createElement('h2');
        title.style.margin = '0';
        title.textContent = t('mainUnifiedTitle');
        
        const exportBtn = document.createElement('button');
        exportBtn.textContent = t('mainExportWorkflow');
        exportBtn.style.cssText = `padding: 12px; background: #4a90e2; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;`;
        exportBtn.onclick = () => { overlay.remove(); this.showExportModal(); };
        
        const importBtn = document.createElement('button');
        importBtn.textContent = t('mainImportWorkflow');
        importBtn.style.cssText = `padding: 12px; background: #e07a5f; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;`;
        importBtn.onclick = () => { overlay.remove(); this.showImportModal(); };
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = t('mainClose');
        closeBtn.style.cssText = `padding: 8px; background: #555; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; margin-top: 10px;`;
        closeBtn.onclick = () => overlay.remove();
        
        content.appendChild(title);
        content.appendChild(exportBtn);
        content.appendChild(importBtn);
        content.appendChild(closeBtn);
        overlay.appendChild(content);
        
        document.body.appendChild(overlay);
    }
};

window.AMB_WorkflowShare = AMB_WorkflowShare;
