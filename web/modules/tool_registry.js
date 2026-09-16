/**
 * tool_registry.js - Centralized Tool Catalog for Anomalous Model Browser
 * 
 * Provides stable IDs, display keys, icons, and metadata for both
 * the Toolbox catalog and the customizable Shortcut Bar.
 */

export const TOOL_ICONS = Object.freeze({
    TOOLBOX: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><rect width="20" height="14" x="2" y="6" rx="2"/><path d="M2 12h20"/><path d="M10 12v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-2"/></svg>`,
    SCAN: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="12" x2="16" y2="8"/></svg>`,
    DOCTOR: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M4.5 3v5a5.5 5.5 0 0 0 11 0V3"/><circle cx="4.5" cy="3" r="1.5" fill="currentColor"/><circle cx="15.5" cy="3" r="1.5" fill="currentColor"/><path d="M10 13.5v3a3.5 3.5 0 0 0 3.5 3.5h1"/><circle cx="18" cy="20" r="2.2" stroke-width="2"/></svg>`,
    ASSISTANT: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/><path d="M18 3v4m-2-2h4" stroke-opacity="0.8"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`,
    MATERIALS: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M12 2L2 7l10 5 10-5-10-5Z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/></svg>`,
    SETTINGS: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    TRANSFER: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="m7 16-4-4m0 0 4-4m-4 4h18"/><path d="m17 8 4 4m0 0-4 4m4-4H3"/></svg>`,
    STUDIO: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
    TRANSLATOR: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    SOURCES: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    NOTEBOOK: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/><path d="M6 14h6"/></svg>`,
});

/**
 * Fixed non-movable anchors:
 * - Toolbox (left end)
 * - Settings (right end)
 */
export const FIXED_ANCHORS = Object.freeze({
    TOOLBOX: Object.freeze({
        id: 'toolbox',
        domId: 'anomalous-toolbox-btn',
        labelKey: 'actionTools',
        nameKey: 'sidebarToolbox',
        hintKey: 'actionToolsHint',
        icon: TOOL_ICONS.TOOLBOX,
        isAnchor: true,
    }),
    SETTINGS: Object.freeze({
        id: 'settings',
        domId: 'anomalous-global-settings-btn',
        labelKey: 'actionSettings',
        nameKey: 'sidebarSettings',
        hintKey: 'actionSettingsHint',
        icon: TOOL_ICONS.SETTINGS,
        isAnchor: true,
    }),
});

/**
 * All customizable tools available in the Toolbox catalog
 * that can be pinned to the Shortcut Bar (up to 4 items).
 */
export const CATALOG_TOOLS = Object.freeze([
    Object.freeze({
        id: 'scan',
        domId: 'anomalous-scan-btn',
        labelKey: 'actionScan',
        nameKey: 'sidebarScanWizard',
        hintKey: 'actionScanHint',
        icon: TOOL_ICONS.SCAN,
        isPinnedDefault: true,
    }),
    Object.freeze({
        id: 'doctor',
        domId: 'anomalous-doctor-btn',
        labelKey: 'actionDoctor',
        nameKey: 'sidebarDoctor',
        hintKey: 'actionDoctorHint',
        icon: TOOL_ICONS.DOCTOR,
        isPinnedDefault: true,
    }),
    Object.freeze({
        id: 'assistant',
        domId: 'anomalous-assistant-btn',
        labelKey: 'actionAssistant',
        nameKey: 'sidebarAssistant',
        hintKey: 'actionAssistantHint',
        icon: TOOL_ICONS.ASSISTANT,
        isPinnedDefault: true,
    }),
    Object.freeze({
        id: 'materials',
        domId: 'anomalous-materials-btn',
        labelKey: 'actionMaterials',
        nameKey: 'materialLibrary',
        hintKey: 'actionMaterialsHint',
        icon: TOOL_ICONS.MATERIALS,
        isPinnedDefault: true,
    }),
    Object.freeze({
        id: 'workflow-transfer',
        domId: 'anomalous-transfer-btn',
        labelKey: 'toolWorkflowTransferShort',
        nameKey: 'toolWorkflowTransferTitle',
        hintKey: 'toolWorkflowTransferDesc',
        icon: TOOL_ICONS.TRANSFER,
        isPinnedDefault: false,
    }),
    Object.freeze({
        id: 'prompt-studio',
        domId: 'anomalous-studio-btn',
        labelKey: 'toolPromptStudioShort',
        nameKey: 'toolPromptStudioTitle',
        hintKey: 'toolPromptStudioDesc',
        icon: TOOL_ICONS.STUDIO,
        isPinnedDefault: false,
    }),
    Object.freeze({
        id: 'prompt-translator',
        domId: 'anomalous-translator-btn',
        labelKey: 'toolPromptTranslatorShort',
        nameKey: 'toolPromptTranslatorTitle',
        hintKey: 'toolPromptTranslatorDesc',
        icon: TOOL_ICONS.TRANSLATOR,
        isPinnedDefault: false,
    }),
    Object.freeze({
        id: 'model-sources',
        domId: 'anomalous-sources-btn',
        labelKey: 'toolModelSourcesShort',
        nameKey: 'toolModelSourcesTitle',
        hintKey: 'toolModelSourcesDesc',
        icon: TOOL_ICONS.SOURCES,
        isPinnedDefault: false,
    }),
    Object.freeze({
        id: 'prompt-notes',
        domId: 'anomalous-prompt-notes-btn',
        labelKey: 'toolPromptNotesShort',
        nameKey: 'toolPromptNotesTitle',
        hintKey: 'toolPromptNotesDesc',
        icon: TOOL_ICONS.NOTEBOOK,
        isPinnedDefault: false,
    }),
]);

export function getToolDefinition(toolId) {
    if (!toolId) return null;
    if (toolId === FIXED_ANCHORS.TOOLBOX.id || toolId === FIXED_ANCHORS.TOOLBOX.domId) return FIXED_ANCHORS.TOOLBOX;
    if (toolId === FIXED_ANCHORS.SETTINGS.id || toolId === FIXED_ANCHORS.SETTINGS.domId) return FIXED_ANCHORS.SETTINGS;
    return CATALOG_TOOLS.find(tool => tool.id === toolId || tool.domId === toolId) || null;
}

export function getAllToolDefinitions() {
    return [FIXED_ANCHORS.TOOLBOX, ...CATALOG_TOOLS, FIXED_ANCHORS.SETTINGS];
}
