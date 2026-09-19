/**
 * sidebar_actions.js - Hover Labels & Rich Shared Tooltip for Sidebar Actions
 *
 * Implements:
 * 1. 100ms short label reveal (replaces icon with smooth slide/fade).
 * 2. 600ms rich floating tooltip bubble (bold title, muted body, viewport bounds).
 * 3. Immediate cleanup on leave/blur/drag.
 * 4. Integration with tool_registry for all customizable and anchor tools.
 */

import { translate as t } from './locales.js';
import { getToolDefinition, getAllToolDefinitions } from './tool_registry.js';

let sharedTooltipEl = null;
let labelTimer = null;
let tooltipTimer = null;
let activeTargetButton = null;
let isDraggingActive = false;

export function setDraggingState(dragging) {
    isDraggingActive = Boolean(dragging);
    if (isDraggingActive) {
        hideTooltipImmediately();
        clearTimers();
        if (activeTargetButton) {
            activeTargetButton.classList.remove('anomalous-action-label-active');
            activeTargetButton = null;
        }
    }
}

function clearTimers() {
    if (labelTimer) {
        clearTimeout(labelTimer);
        labelTimer = null;
    }
    if (tooltipTimer) {
        clearTimeout(tooltipTimer);
        tooltipTimer = null;
    }
}

function getOrCreateSharedTooltip() {
    if (typeof document === 'undefined') return null;
    if (!sharedTooltipEl) {
        sharedTooltipEl = document.getElementById('anomalous-sidebar-tooltip-bubble');
        if (!sharedTooltipEl) {
            sharedTooltipEl = document.createElement('div');
            sharedTooltipEl.id = 'anomalous-sidebar-tooltip-bubble';
            sharedTooltipEl.className = 'anomalous-sidebar-tooltip-bubble';
            sharedTooltipEl.setAttribute('role', 'tooltip');
            sharedTooltipEl.setAttribute('aria-hidden', 'true');
            sharedTooltipEl.style.display = 'none';

            const titleEl = document.createElement('div');
            titleEl.className = 'anomalous-tooltip-title';
            const bodyEl = document.createElement('div');
            bodyEl.className = 'anomalous-tooltip-body';
            const arrowEl = document.createElement('div');
            arrowEl.className = 'anomalous-tooltip-arrow';

            sharedTooltipEl.appendChild(titleEl);
            sharedTooltipEl.appendChild(bodyEl);
            sharedTooltipEl.appendChild(arrowEl);
            document.body.appendChild(sharedTooltipEl);
        }
    }
    return sharedTooltipEl;
}

export function hideTooltipImmediately() {
    clearTimers();
    if (sharedTooltipEl) {
        sharedTooltipEl.style.display = 'none';
        sharedTooltipEl.style.opacity = '0';
    }
}
if (typeof window !== 'undefined') {
    window.AMB_hideTooltipImmediately = hideTooltipImmediately;
}

export function isBottomModalOpen() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return false;
    const toolboxModal = document.getElementById('anomalous-toolbox-modal');
    if (toolboxModal && toolboxModal.style && toolboxModal.style.display !== 'none') return true;
    const settingsModal = document.getElementById('anomalous-settings-hub-modal');
    if (settingsModal && settingsModal.style && settingsModal.style.display !== 'none') return true;
    return false;
}

export function showSharedTooltip(button, title, desc) {
    if (isDraggingActive || typeof document === 'undefined') return;
    if (isBottomModalOpen()) return;
    const tooltip = getOrCreateSharedTooltip();
    if (!tooltip || !button || !button.isConnected) return;

    const titleEl = tooltip.querySelector('.anomalous-tooltip-title');
    const bodyEl = tooltip.querySelector('.anomalous-tooltip-body');
    const arrowEl = tooltip.querySelector('.anomalous-tooltip-arrow');

    if (titleEl) titleEl.textContent = title || '';
    if (bodyEl) {
        bodyEl.textContent = desc || '';
        bodyEl.style.display = desc ? 'block' : 'none';
    }

    tooltip.style.display = 'flex';
    tooltip.style.visibility = 'hidden';
    tooltip.style.opacity = '0';

    // Position calculation
    const btnRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const sidebar = button.closest('#anomalous-sidebar') || button.closest('.anomalous-sidebar-container');
    const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : { left: 0, right: window.innerWidth, width: window.innerWidth };

    const btnCenterX = btnRect.left + btnRect.width / 2;
    let targetLeft = btnCenterX - tooltipRect.width / 2;

    // Clamp within sidebar and viewport
    const pad = 8;
    const minLeft = Math.max(pad, sidebarRect.left + pad);
    const maxLeft = Math.min(window.innerWidth - tooltipRect.width - pad, sidebarRect.right - tooltipRect.width - pad);

    targetLeft = Math.max(minLeft, Math.min(maxLeft, targetLeft));
    const targetTop = btnRect.top - tooltipRect.height - 8;

    tooltip.style.left = `${Math.round(targetLeft)}px`;
    tooltip.style.top = `${Math.round(targetTop)}px`;

    if (arrowEl) {
        const arrowX = btnCenterX - targetLeft;
        arrowEl.style.left = `${Math.max(10, Math.min(tooltipRect.width - 10, arrowX))}px`;
    }

    tooltip.style.visibility = 'visible';
    tooltip.style.opacity = '1';
}

export function suppressButtonText(button) {
    clearTimers();
    hideTooltipImmediately();
    if (typeof document !== 'undefined') {
        const btns = document.querySelectorAll('#anomalous-sidebar-actions button');
        for (const b of btns) {
            b.classList.remove('anomalous-action-label-active');
        }
    }
    if (button) {
        button.classList.remove('anomalous-action-label-active');
        button.__suppress_text_until_leave = true;
        if (typeof button.blur === 'function') {
            button.blur();
        }
    }
}

function onButtonEnter(button, spec) {
    if (isDraggingActive || button.__suppress_text_until_leave) return;
    if (isBottomModalOpen()) return;
    clearTimers();
    activeTargetButton = button;

    // 100ms short label reveal
    labelTimer = setTimeout(() => {
        if (activeTargetButton === button && !isDraggingActive && !button.__suppress_text_until_leave && !isBottomModalOpen()) {
            button.classList.add('anomalous-action-label-active');
        }
    }, 100);

    // 600ms rich tooltip reveal
    tooltipTimer = setTimeout(() => {
        if (activeTargetButton === button && !isDraggingActive && !button.__suppress_text_until_leave && !isBottomModalOpen()) {
            showSharedTooltip(button, t(spec.nameKey), t(spec.hintKey));
        }
    }, 600);
}

function onButtonLeave(button) {
    clearTimers();
    if (activeTargetButton === button) {
        activeTargetButton = null;
    }
    button.__suppress_text_until_leave = false;
    button.classList.remove('anomalous-action-label-active');
    hideTooltipImmediately();
}

export function configureSidebarAction(button, customSpec = null) {
    if (!button) return;
    const spec = customSpec || getToolDefinition(button.id) || getToolDefinition(button.getAttribute('data-tool-id'));
    if (!spec) return;

    let label = button.querySelector('.anomalous-action-label');
    if (!label) {
        label = document.createElement('span');
        label.className = 'anomalous-action-label';
        label.setAttribute('aria-hidden', 'true');
        button.appendChild(label);
    }
    label.textContent = t(spec.labelKey);
    button.setAttribute('aria-label', t(spec.nameKey));
    button.setAttribute('data-tooltip', `${t(spec.nameKey)}\n${t(spec.hintKey)}`);
    button.setAttribute('data-tooltip-pos', 'top');
    button.setAttribute('data-tool-id', spec.id);
    button.removeAttribute('title');

    // Attach listeners once
    if (!button.__anomalous_action_listeners_attached) {
        button.__anomalous_action_listeners_attached = true;

        button.addEventListener('mouseenter', () => {
            const curSpec = getToolDefinition(button.getAttribute('data-tool-id')) || spec;
            onButtonEnter(button, curSpec);
        });

        button.addEventListener('mouseleave', () => {
            onButtonLeave(button);
        });

        // Immediately dismiss text and tooltip on click/press
        const handleActionClick = () => suppressButtonText(button);
        button.addEventListener('pointerdown', handleActionClick);
        button.addEventListener('click', handleActionClick);

        button.addEventListener('focus', (e) => {
            if (isBottomModalOpen()) return;
            if (button.matches(':focus-visible') && !button.__suppress_text_until_leave) {
                button.classList.add('anomalous-action-label-active');
                const curSpec = getToolDefinition(button.getAttribute('data-tool-id')) || spec;
                clearTimers();
                activeTargetButton = button;
                tooltipTimer = setTimeout(() => {
                    if (activeTargetButton === button && !isDraggingActive && !button.__suppress_text_until_leave && !isBottomModalOpen()) {
                        showSharedTooltip(button, t(curSpec.nameKey), t(curSpec.hintKey));
                    }
                }, 600);
            }
        });

        button.addEventListener('blur', () => {
            onButtonLeave(button);
        });
    }
}

export function configureSidebarActions(root) {
    if (!root) return;
    const candidates = [
        ...root.querySelectorAll('#anomalous-sidebar-actions button, button[data-tool-id], button[id^="anomalous-"]')
    ];
    if (candidates.length === 0) {
        // Fallback for mock fixtures where buttons are direct children without sidebar-actions wrapper
        for (const def of getAllToolDefinitions()) {
            const btn = root.querySelector(`#${def.domId}`);
            if (btn && !candidates.includes(btn)) candidates.push(btn);
        }
    }
    for (const btn of candidates) {
        configureSidebarAction(btn);
    }
}

if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', () => {
        hideTooltipImmediately();
    }, { passive: true });
}
