/**
 * The rail's tool buttons under the pages, the one used most first: Current node, Model Check
 * and scan, each with a short word under its icon as the pages have (gone with theirs in a short window);
 * settings at the rail's foot. Each opens its tool page, and while it is open the rail shows the tool as the
 * current entry (`data-page`; the rail keeps which on `railTools.dataset.current`, so a re-render keeps it);
 * labels follow the language (the settings hub renders them again when it changes). The other tools live
 * on their pages.
 */

import { translate as t } from './locales.js';
import { TOOL_ICONS } from './tool_registry.js';
import { PAGE_ICONS } from './ui_shell_rail.js';
import { setScanButtonState } from './scan_runner.js';

const TOOLS = Object.freeze([
    { id: 'anomalous-assistant-btn', page: 'assistant', nameKey: 'sidebarAssistant', railKey: 'railAssistant', icon: TOOL_ICONS.ASSISTANT, open: owner => owner.openCurrentNode() },
    { id: 'anomalous-doctor-btn', page: 'doctor', nameKey: 'sidebarDoctor', railKey: 'railDoctor', icon: TOOL_ICONS.DOCTOR, open: owner => owner.openDoctorPage() },
    { id: 'anomalous-saves-btn', page: 'saves', nameKey: 'savesPageTitle', railKey: 'savesListToggle', icon: PAGE_ICONS.saves, open: owner => owner.showSaves() },
    { id: 'anomalous-scan-btn', page: 'scan', nameKey: 'sidebarScan', railKey: 'railScan', open: owner => owner.openScanPage() },
]);

/** Fills `owner.railTools` and `owner.railFoot`; `isScanning()` sets the scan button's state. */
export function renderRailTools(owner, { isScanning, settingsButton }) {
    owner.railTools.replaceChildren(...TOOLS.map((tool) => {
        const button = document.createElement('button');
        button.id = tool.id;
        button.className = 'anomalous-tooltip-target';
        button.dataset.page = tool.page;
        if (owner.railTools.dataset.current === tool.page) {
            button.classList.add('active');
            button.setAttribute('aria-current', 'page');
        }
        button.setAttribute('aria-label', t(tool.nameKey));
        button.setAttribute('data-amb-tooltip', t(tool.nameKey));
        button.setAttribute('data-amb-tooltip-pos', 'right');
        if (tool.icon) button.innerHTML = tool.icon; // static markup only
        button.append(Object.assign(document.createElement('span'), { className: 'anomalous-rail-label', textContent: t(tool.railKey) }));
        if (!tool.icon) setScanButtonState(button, isScanning());
        button.onclick = (event) => {
            event.stopPropagation();
            tool.open(owner);
        };
        return button;
    }));
    owner.railFoot.replaceChildren(settingsButton);
}
