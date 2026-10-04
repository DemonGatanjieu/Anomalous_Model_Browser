/**
 * The settings page (the rail's gear): one card per subject — how the browser looks,
 * model cards and what they cost in memory (with the card image cache), model folders
 * (a view of its own, ui_folder_manager.js, `owner.settingsView === 'folders'`),
 * workflows, how the browser opens, and help. A tool page like the scan page, with a
 * way back to the page you came from. Display preferences go through `owner.displayPrefs`
 * (ui_settings_hub.js); language, theme and opening mode are ComfyUI settings.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';
import { ABYSSAL_SCARLET_SETTING_ID, LANGUAGE_SETTING_ID, applyLanguagePreference, setAbyssalScarletTheme } from './interface_settings.js';
import { ENTRY_MODE_SETTING_ID } from './browser_entry.js';
import { showUpdateGuide } from './ui_update_guide.js';
import { startSpotlightTour } from './ui_spotlight_tour.js';
import { copyDiagnostics } from './feedback.js';
import { renderFolderPage } from './ui_folder_manager.js';
import { openFeedbackDialog } from './ui_feedback_dialog.js';
import { checkOnOpen, setCheckOnOpen } from './ui_doctor_banner.js';

const t = (key, params) => translate(key, params);
// The full written guide: the README, at its Chinese half for Chinese.
const README_URL = 'https://github.com/DemonGatanjieu/Anomalous_Model_Browser#readme';
const README_ZH_URL = 'https://github.com/DemonGatanjieu/Anomalous_Model_Browser#-视频演示与教程';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

function comfySetting(id) {
    try { return app.extensionManager?.setting?.get(id); } catch (_) { return undefined; }
}

async function setComfySetting(id, value) {
    const settings = app.extensionManager?.setting;
    if (typeof settings?.set !== 'function') return false;
    try {
        await settings.set(id, value);
        return true;
    } catch (_) {
        return false;
    }
}

/** A row: name and what it does on the left, its control on the right. */
function row(titleKey, helpKey, control, { help = null } = {}) {
    const line = el('div', 'anomalous-scan-setting');
    const copy = el('span', 'anomalous-scan-setting-copy');
    copy.append(el('span', 'anomalous-scan-setting-title', t(titleKey)));
    const helpText = help ?? (helpKey ? t(helpKey) : '');
    if (helpText) copy.append(el('small', 'anomalous-scan-setting-help', helpText));
    line.append(copy, control);
    return line;
}

/** Choices side by side; `onPick(value)` when one is clicked. */
function segment(choices, current, onPick) {
    const box = el('div', 'anomalous-scan-segment');
    box.setAttribute('role', 'radiogroup');
    for (const [value, labelKey] of choices) {
        const choice = button('anomalous-scan-segment-btn', t(labelKey), () => onPick(value));
        choice.setAttribute('role', 'radio');
        choice.setAttribute('aria-checked', String(value === current));
        box.append(choice);
    }
    return box;
}

function toggleSwitch(checked, onChange) {
    const input = el('input', 'anomalous-scan-switch');
    input.type = 'checkbox';
    input.checked = checked;
    input.onchange = () => onChange(input.checked);
    return input;
}

/** A slider with its value shown as a percentage. */
function slider(value, { min, max, step }, onCommit) {
    const box = el('label', 'anomalous-settings-slider');
    const input = el('input');
    input.type = 'range';
    Object.assign(input, { min: String(min), max: String(max), step: String(step), value: String(value) });
    const shown = el('span', 'anomalous-settings-slider-value', `${Math.round(value * 100)}%`);
    input.oninput = () => { shown.textContent = `${Math.round(Number(input.value) * 100)}%`; onCommit(Number(input.value)); };
    box.append(input, shown);
    return box;
}

function group(titleKey, ...rows) {
    const box = el('section', 'anomalous-scan-card anomalous-scan-group');
    box.append(el('h3', 'anomalous-scan-group-title', t(titleKey)), ...rows);
    return box;
}

function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The card image cache: how much it holds, and a way to empty it. */
function cacheRow(owner) {
    const clear = button('anomalous-scan-secondary anomalous-scan-small-btn', t('settingsCacheClear'), async () => {
        clear.disabled = true;
        try {
            await fetch('/anomalous/card_cache/clear', { method: 'POST' });
        } finally {
            clear.disabled = false;
            refresh();
        }
    });
    const line = row('settingsCacheTitle', null, clear, { help: t('settingsCacheLoading') });
    const help = line.querySelector('.anomalous-scan-setting-help');
    const refresh = async () => {
        try {
            const data = await (await fetch('/anomalous/card_cache')).json();
            help.textContent = t('settingsCacheHelp', { count: data.count, size: formatBytes(data.bytes), limit: formatBytes(data.limit) });
            clear.disabled = !data.count;
        } catch (_) {
            help.textContent = t('settingsCacheUnknown');
        }
    };
    refresh();
    return line;
}

function appearanceGroup(owner, redraw) {
    const prefs = owner.displayPrefs.get();
    const language = localStorage.getItem('anomalous_lang') || 'auto';
    const abyssal = localStorage.getItem('anomalous_theme_abyssal_scarlet') === 'true';
    const rows = [
        row('sidebarViewMode', 'settingsViewModeHelp', segment(
            [['compact', 'sidebarViewModeCompact'], ['standard', 'sidebarViewModeStandard'], ['aesthetic', 'sidebarViewModeAesthetic']],
            prefs.viewMode, mode => { owner.displayPrefs.setViewMode(mode); redraw(); })),
    ];
    if (prefs.viewMode === 'aesthetic') {
        rows.push(row('sidebarBgAtmosphere', 'settingsAtmosphereHelp',
            slider(prefs.bgOpacity, { min: 0, max: 1, step: 0.05 }, value => owner.displayPrefs.setBgOpacity(value))));
    }
    rows.push(
        row('sidebarUiScale', 'settingsScaleHelp', slider(prefs.scale, { min: 0.5, max: 1.5, step: 0.1 }, value => owner.displayPrefs.setScale(value))),
        row('settingsTheme', 'settingsThemeHelp', segment([['default', 'settingsThemeDefault'], ['abyssal', 'settingsThemeAbyssal']],
            abyssal ? 'abyssal' : 'default', value => { setAbyssalScarletTheme(value === 'abyssal', true); redraw(); })),
        row('mainLanguageSetting', null, segment([['auto', 'mainLanguageAuto'], ['zh', 'mainLanguageChinese'], ['en', 'mainLanguageEnglish']],
            language, async value => {
                // The ComfyUI setting's own change handler switches the language; without it, switch here.
                if (!await setComfySetting(LANGUAGE_SETTING_ID, value)) applyLanguagePreference(value);
            })),
    );
    return group('settingsAppearance', ...rows);
}

function cardsGroup(owner, redraw) {
    const reload = () => { owner.loadModels(); redraw(); };
    return group('settingsCards',
        row('sidebarCardQuality', 'settingsCardQualityHelp', segment(
            [['balanced', 'sidebarOptimizedThumbnail'], ['original', 'sidebarOriginalCover']], owner.cardThumbnailMode, value => {
                owner.cardThumbnailMode = value === 'original' ? 'original' : 'balanced';
                localStorage.setItem('anomalous_card_thumbnail_mode', owner.cardThumbnailMode);
                reload();
            })),
        row('sidebarVideoPlayback', 'settingsVideoHelp', segment(
            [['hover', 'sidebarHoverPlay'], ['always', 'sidebarAlwaysPlay']], owner.energySaving ? 'hover' : 'always', value => {
                owner.energySaving = value === 'hover';
                localStorage.setItem('anomalous_energy_saving', String(owner.energySaving));
                reload();
            })),
        cacheRow(owner),
    );
}

function foldersGroup(owner) {
    return group('settingsFolders',
        row('sidebarManageFolders', 'settingsFoldersHelp',
            button('anomalous-scan-secondary anomalous-scan-small-btn', t('settingsOpen'), () => {
                owner.settingsView = 'folders';
                render(owner);
            })));
}

function workflowGroup(owner) {
    return group('settingsWorkflows',
        row('settingsCheckOnOpen', 'settingsCheckOnOpenHelp', toggleSwitch(checkOnOpen(), on => setCheckOnOpen(owner, on))),
        row('sidebarProvenance', 'sidebarProvenanceDesc', toggleSwitch(localStorage.getItem('anomalous_inject_hash') !== 'false', on => {
            // Read by hash_resolver.js when a workflow is saved.
            localStorage.setItem('anomalous_inject_hash', on ? 'true' : 'false');
        })));
}

function openingGroup(owner, redraw) {
    const mode = comfySetting(ENTRY_MODE_SETTING_ID) || 'floating';
    return group('settingsOpening',
        row('mainEntryModeSetting', 'settingsEntryHelp', segment(
            [['floating', 'mainEntryModeFloating'], ['topbar', 'mainEntryModeTopbar'], ['menu', 'mainEntryModeMenu']], mode, async value => {
                await setComfySetting(ENTRY_MODE_SETTING_ID, value);
                redraw();
            })),
        row('settingsLayout', 'settingsLayoutHelp', button('anomalous-scan-secondary anomalous-scan-small-btn', t('settingsReset'), () => {
            if (!confirm(t('sidebarResetConfirm'))) return;
            owner.displayPrefs.resetLayout();
            redraw();
        })),
    );
}

function helpGroup(owner) {
    const small = (label, onClick) => button('anomalous-scan-secondary anomalous-scan-small-btn', label, onClick);
    return group('settingsHelp',
        row('settingsTour', 'settingsTourHelp', small(t('settingsStart'), () => startSpotlightTour(owner))),
        row('updateGuideReplay', 'settingsNewsHelp', small(t('settingsOpen'), () => showUpdateGuide(owner, { force: true }))),
        row('settingsGuide', 'settingsGuideHelp', small(t('settingsOpenGuide'), () => {
            window.open(window.anomalous_browser_lang === 'zh' ? README_ZH_URL : README_URL, '_blank', 'noopener');
        })),
        row('feedbackReport', 'settingsReportHelp', small(t('feedbackWrite'), () => openFeedbackDialog(owner, 'bug'))),
        row('feedbackSuggest', 'settingsSuggestHelp', small(t('feedbackWrite'), () => openFeedbackDialog(owner, 'idea'))),
        row('feedbackCopy', 'feedbackCopyHint', (() => {
            const copy = small(t('feedbackCopy'), async () => {
                copy.textContent = t(await copyDiagnostics(owner) ? 'feedbackCopied' : 'feedbackCopyFailed');
                setTimeout(() => { copy.textContent = t('feedbackCopy'); }, 1600);
            });
            return copy;
        })()),
    );
}

function render(owner) {
    const panel = owner.settingsPanel;
    const view = owner.settingsView || '';
    const top = panel._settingsView === view ? panel.scrollTop : 0;
    panel._settingsView = view;
    const redraw = () => render(owner);
    const page = el('div', 'anomalous-scan-page');
    if (view === 'folders') {
        panel.replaceChildren(page);
        panel.scrollTop = 0;
        renderFolderPage(owner, page, () => {
            owner.settingsView = '';
            render(owner);
        });
        return;
    }
    page.append(
        button('anomalous-scan-back', t('settingsBack'), () => leaveSettingsPage(owner)),
        el('h1', 'anomalous-scan-title', t('sidebarSettings')),
        appearanceGroup(owner, redraw),
        cardsGroup(owner, redraw),
        foldersGroup(owner),
        workflowGroup(owner),
        openingGroup(owner, redraw),
        helpGroup(owner),
    );
    panel.replaceChildren(page);
    panel.scrollTop = top;
}

export function isSettingsPageOpen(owner) {
    return Boolean(owner.settingsPanel && owner.settingsPanel.style.display !== 'none');
}

/** Opens the page; `keepReturn`: drawn again in place (language change), Back still goes where it went. */
export function openSettingsPage(owner, { keepReturn = false } = {}) {
    if (!keepReturn && !isSettingsPageOpen(owner)) {
        owner.settingsReturn = owner.currentShellPage?.() || 'home';
        owner.settingsView = '';
    }
    owner.enterToolPage?.('settings');
    owner.hideAllPanels();
    owner.settingsPanel.style.display = 'flex';
    document.getElementById('anomalous-global-settings-btn')?.classList.add('is-active');
    render(owner);
}

/** Back to the page the gear was pressed on. */
export function leaveSettingsPage(owner) {
    const back = owner.settingsReturn || 'home';
    owner.settingsReturn = null;
    if (back === 'scan') owner.openScanPage();
    else if (back === 'doctor') owner.openDoctorPage();
    else owner.goTo(['assistant', 'settings'].includes(back) ? 'home' : back);
}
