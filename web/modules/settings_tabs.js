/**
 * The settings page's four tabs (ui_settings_page.js draws their cards) and where a link to a tab of
 * before 1.64.2 lands: Canvas, Workflows, Node packs, Prompts and Backup each became a card of a wider
 * tab, and a link to one opens that tab scrolled to its card (`section`, the card's
 * data-settings-section). No DOM.
 */

export const SETTINGS_TABS = Object.freeze([
    { id: 'look', labelKey: 'settingsTabLook' },
    { id: 'models', labelKey: 'settingsTabModels' },
    { id: 'tools', labelKey: 'settingsTabTools' },
    { id: 'help', labelKey: 'settingsTabHelp' },
]);

// An old tab -> the tab its card is on now (the card's section is the old tab's id).
const MOVED = Object.freeze({
    canvas: 'look',
    network: 'models',
    workflows: 'tools',
    prompts: 'tools',
    packs: 'tools',
    backup: 'help',
});

/** { tab, section } for a link's tab and card; an unknown tab: Look, from the top. */
export function resolveSettingsTarget(rawTab, rawSection = '') {
    const section = String(rawSection || '');
    if (SETTINGS_TABS.some(tab => tab.id === rawTab)) return { tab: rawTab, section };
    if (Object.hasOwn(MOVED, rawTab)) return { tab: MOVED[rawTab], section: section || rawTab };
    return { tab: 'look', section: '' };
}
