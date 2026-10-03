/**
 * The browser's display preferences (view mode, interface scale, background atmosphere,
 * window layout) and how they apply to the window; the rail's gear button, which opens
 * the settings page (ui_settings_page.js); and redrawing the browser when the language
 * changes. The settings page changes preferences only through `owner.displayPrefs`.
 */

import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';
import { openSettingsPage, isSettingsPageOpen, leaveSettingsPage } from './ui_settings_page.js';

const t = (key, params) => translate(key, params);
const VIEW_MODES = ['compact', 'standard', 'aesthetic'];

export function createSettingsHub(owner, {
    container,
    savedScale,
    savedBgOpacity,
    updateLangClass,
    dockBtn,
    updateNoticeBtn,
    icons,
}) {
    const prefs = {
        viewMode: VIEW_MODES.includes(localStorage.getItem('anomalous_view_mode')) ? localStorage.getItem('anomalous_view_mode') : 'compact',
        scale: parseFloat(savedScale) || 1,
        bgOpacity: Number.isFinite(parseFloat(savedBgOpacity)) ? parseFloat(savedBgOpacity) : 0.2,
    };

    const applyViewMode = (mode) => {
        prefs.viewMode = VIEW_MODES.includes(mode) ? mode : 'compact';
        container.classList.remove(...VIEW_MODES.map(name => `view-mode-${name}`));
        container.classList.add(`view-mode-${prefs.viewMode}`);
    };
    applyViewMode(prefs.viewMode);

    /** What the settings page reads and changes; each change is kept for the next session. */
    owner.displayPrefs = {
        get: () => ({ ...prefs }),
        setViewMode(mode) {
            applyViewMode(mode);
            localStorage.setItem('anomalous_view_mode', prefs.viewMode);
        },
        setScale(value) {
            prefs.scale = Math.max(0.5, Math.min(1.5, Math.round(value * 10) / 10));
            container.style.setProperty('--anomalous-scale', prefs.scale);
            localStorage.setItem('anomalous_ui_scale', prefs.scale);
        },
        setBgOpacity(value) {
            prefs.bgOpacity = Math.max(0, Math.min(1, Math.round(value * 100) / 100));
            container.style.setProperty('--anomalous-bg-opacity', prefs.bgOpacity);
            localStorage.setItem('anomalous_bg_opacity', prefs.bgOpacity);
        },
        /** Window position, size, docking, scale, atmosphere and view mode back to their defaults. */
        resetLayout() {
            for (const key of ['anomalous_pos_x', 'anomalous_pos_y', 'anomalous_width', 'anomalous_height', 'anomalous_docked',
                'anomalous_ui_scale', 'anomalous_bg_opacity', 'anomalous_view_mode']) {
                localStorage.removeItem(key);
            }
            applyViewMode('compact');
            Object.assign(container.style, { left: '5%', top: '5%', width: '90%', height: '90%' });
            prefs.scale = 1;
            prefs.bgOpacity = 0.2;
            container.style.setProperty('--anomalous-scale', '1');
            container.style.setProperty('--anomalous-bg-opacity', '0.2');
            container.classList.remove('anomalous-docked');
        },
    };

    const settingsBtn = document.createElement('button');
    settingsBtn.id = 'anomalous-global-settings-btn';
    settingsBtn.className = 'anomalous-tooltip-target';
    settingsBtn.innerHTML = icons.SETTINGS;
    settingsBtn.setAttribute('aria-label', t('sidebarSettings'));
    settingsBtn.setAttribute('data-tooltip', t('sidebarSettings'));
    settingsBtn.setAttribute('data-tooltip-pos', 'right');
    // The gear opens the settings page; on it, the gear goes back to where you were.
    settingsBtn.onclick = (event) => {
        event.stopPropagation();
        if (isSettingsPageOpen(owner)) leaveSettingsPage(owner);
        else openSettingsPage(owner);
    };

    const refreshLanguageUi = () => {
        updateLangClass();
        owner.renderRailTools?.();
        settingsBtn.setAttribute('aria-label', t('sidebarSettings'));
        settingsBtn.setAttribute('data-tooltip', t('sidebarSettings'));
        owner.refreshShellLanguage?.();
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

        // Pages drawn in the old language are drawn again.
        if (owner.doctorPanel && owner.doctorPanel.style.display !== 'none') owner.openDoctorPage();
        if (owner.assistantPanel && owner.assistantPanelInitialized) {
            const selectedNode = Object.values(app.canvas?.selected_nodes || {})[0] || null;
            owner.assistantPanelInitialized = false;
            owner.initAssistantPanel();
            owner.diagnoseNode(selectedNode);
        }
        document.querySelectorAll('[data-anomalous-i18n-key]').forEach((element) => {
            const key = element.dataset.anomalousI18nKey;
            if (key) element.textContent = t(key);
        });
        document.getElementById('anomalous-import-overlay')?.remove();
        if (isSettingsPageOpen(owner)) openSettingsPage(owner, { keepReturn: true });

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
    window.addEventListener('anomalous-language-change', refreshLanguageUi);

    return {
        button: settingsBtn,
        refreshLanguage: refreshLanguageUi,
    };
}
