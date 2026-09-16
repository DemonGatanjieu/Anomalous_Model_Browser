import { translate as t } from './locales.js';

// Labels are deliberately short enough for the existing 32px buttons.
const ACTIONS = [
    ['anomalous-toolbox-btn', 'actionTools', 'sidebarToolbox', 'actionToolsHint'],
    ['anomalous-scan-btn', 'actionScan', 'sidebarScanWizard', 'actionScanHint'],
    ['anomalous-doctor-btn', 'actionDoctor', 'sidebarDoctor', 'actionDoctorHint'],
    ['anomalous-assistant-btn', 'actionAssistant', 'sidebarAssistant', 'actionAssistantHint'],
    ['anomalous-materials-btn', 'actionMaterials', 'materialLibrary', 'actionMaterialsHint'],
    ['anomalous-global-settings-btn', 'actionSettings', 'sidebarSettings', 'actionSettingsHint'],
];

export function configureSidebarActions(root) {
    for (const [id] of ACTIONS) {
        const button = root.querySelector(`#${id}`);
        if (button) configureSidebarAction(button);
    }
}

export function configureSidebarAction(button) {
    const spec = ACTIONS.find(([id]) => id === button.id);
    if (!spec) return;
    const [, labelKey, nameKey, hintKey] = spec;
    let label = button.querySelector('.anomalous-action-label');
    if (!label) {
        label = document.createElement('span');
        label.className = 'anomalous-action-label';
        label.setAttribute('aria-hidden', 'true');
        button.appendChild(label);
    }
    label.textContent = t(labelKey);
    button.setAttribute('aria-label', t(nameKey));
    button.setAttribute('data-tooltip', `${t(nameKey)}\n${t(hintKey)}`);
    button.setAttribute('data-tooltip-pos', 'top');
    button.removeAttribute('title');
}
