/**
 * The rail's tool buttons under the pages: scan, Model Doctor and Current node; settings
 * at the rail's foot. Each opens its tool page; labels follow the language (the settings
 * hub renders them again when it changes). The other tools live on their pages.
 */

import { translate as t } from './locales.js';
import { TOOL_ICONS } from './tool_registry.js';
import { setScanButtonState } from './scan_runner.js';

const TOOLS = Object.freeze([
    { id: 'anomalous-scan-btn', nameKey: 'sidebarScan', open: owner => owner.openScanPage() },
    { id: 'anomalous-doctor-btn', nameKey: 'sidebarDoctor', icon: TOOL_ICONS.DOCTOR, open: owner => owner.openDoctorPage() },
    { id: 'anomalous-assistant-btn', nameKey: 'sidebarAssistant', icon: TOOL_ICONS.ASSISTANT, open: owner => owner.openCurrentNode() },
]);

/** Fills `owner.railTools` and `owner.railFoot`; `isScanning()` sets the scan button's state. */
export function renderRailTools(owner, { isScanning, settingsButton }) {
    owner.railTools.replaceChildren(...TOOLS.map((tool) => {
        const button = document.createElement('button');
        button.id = tool.id;
        button.className = 'anomalous-tooltip-target';
        button.setAttribute('aria-label', t(tool.nameKey));
        button.setAttribute('data-tooltip', t(tool.nameKey));
        button.setAttribute('data-tooltip-pos', 'right');
        if (tool.icon) button.innerHTML = tool.icon; // static markup only
        else setScanButtonState(button, isScanning());
        button.onclick = (event) => {
            event.stopPropagation();
            tool.open(owner);
        };
        return button;
    }));
    owner.railFoot.replaceChildren(settingsButton);
}
