/**
 * ui_shortcut_organizer.js - Drag-and-drop & Menu Management for Shortcut Bar & Toolbox
 *
 * Implements:
 * 1. Pointer drag-and-drop between Toolbox and Shortcut Bar (with 6px deadzone).
 * 2. 350ms auto-expand when dragging over closed Toolbox button.
 * 3. Drop indicators and visual drop-zones.
 * 4. Capacity limit feedback (max 4 pinned items).
 * 5. Accessible context / "More" menus for organizing without mouse drag.
 * 6. Full cancel/cleanup on Escape, pointercancel, or window blur.
 */

import { translate as t } from './locales.js';
import { getToolDefinition, CATALOG_TOOLS, FIXED_ANCHORS } from './tool_registry.js';
import {
    loadShortcutLayout,
    pinTool,
    unpinTool,
    reorderShortcut,
    resetShortcutLayout,
    isToolPinned,
    MAX_PINNED_SHORTCUTS,
} from './shortcut_layout.js';
import { setDraggingState, hideTooltipImmediately } from './sidebar_actions.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

let activeDrag = null;
let autoOpenTimer = null;
let activeMenuEl = null;

function closeActiveMenu() {
    if (activeMenuEl) {
        activeMenuEl.remove();
        activeMenuEl = null;
    }
}

document.addEventListener('mousedown', (e) => {
    if (activeMenuEl && !activeMenuEl.contains(e.target)) {
        closeActiveMenu();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (activeDrag) {
            cancelCurrentDrag();
        }
        closeActiveMenu();
    }
});

export function isOrganizingDragActive() {
    return Boolean(activeDrag && activeDrag.isDragging);
}

function showCapacityFullToast() {
    showWorkbenchToast(t('shortcutBarCapacityFull'));
}

/**
 * Creates and shows a context dropdown menu.
 */
function showDropdownMenu(items, x, y) {
    closeActiveMenu();
    if (!items || items.length === 0) return;

    const menu = document.createElement('div');
    menu.className = 'anomalous-shortcut-context-menu';
    menu.style.position = 'fixed';
    menu.style.zIndex = '1000002';
    menu.style.display = 'flex';
    menu.style.flexDirection = 'column';
    menu.style.minWidth = '140px';
    menu.style.padding = '4px';
    menu.style.borderRadius = '8px';
    menu.style.background = 'rgba(20, 22, 28, 0.96)';
    menu.style.backdropFilter = 'blur(16px)';
    menu.style.border = '1px solid rgba(255, 255, 255, 0.14)';
    menu.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.7), 0 0 1px 1px rgba(255, 255, 255, 0.1)';

    for (const item of items) {
        if (item.separator) {
            const sep = document.createElement('div');
            sep.style.height = '1px';
            sep.style.margin = '4px 2px';
            sep.style.background = 'rgba(255, 255, 255, 0.08)';
            menu.appendChild(sep);
            continue;
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = item.label;
        btn.disabled = Boolean(item.disabled);
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '8px';
        btn.style.width = '100%';
        btn.style.padding = '6px 10px';
        btn.style.border = 'none';
        btn.style.borderRadius = '5px';
        btn.style.background = 'transparent';
        btn.style.color = item.disabled ? '#64748b' : (item.danger ? '#f87171' : '#e2e8f0');
        btn.style.fontSize = '12px';
        btn.style.cursor = item.disabled ? 'not-allowed' : 'pointer';
        btn.style.textAlign = 'left';
        btn.style.transition = 'all 0.12s ease';

        if (!item.disabled) {
            btn.onmouseover = () => {
                btn.style.background = 'rgba(255, 255, 255, 0.08)';
                btn.style.color = '#ffffff';
            };
            btn.onmouseout = () => {
                btn.style.background = 'transparent';
                btn.style.color = item.danger ? '#f87171' : '#e2e8f0';
            };
            btn.onclick = (e) => {
                e.stopPropagation();
                closeActiveMenu();
                item.action();
            };
        }

        menu.appendChild(btn);
    }

    document.body.appendChild(menu);

    // Bounding clamp
    const menuRect = menu.getBoundingClientRect();
    let left = x;
    let top = y;

    if (left + menuRect.width > window.innerWidth - 8) {
        left = window.innerWidth - menuRect.width - 8;
    }
    if (left < 8) left = 8;

    if (top + menuRect.height > window.innerHeight - 8) {
        top = y - menuRect.height;
    }
    if (top < 8) top = 8;

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;

    activeMenuEl = menu;
}

export function openToolboxCardMenu(toolId, targetEl, onLayoutChange) {
    if (!targetEl || !toolId) return;
    const isPinned = isToolPinned(toolId);
    const layout = loadShortcutLayout();
    const isFull = layout.length >= MAX_PINNED_SHORTCUTS;

    const items = [];
    if (isPinned) {
        items.push({
            label: t('shortcutBarUnpin'),
            action: () => {
                unpinTool(toolId);
                onLayoutChange?.();
            }
        });
    } else {
        items.push({
            label: isFull ? `${t('shortcutBarPin')} (${t('shortcutBarCapacityFull') ? '已满' : 'Full'})` : t('shortcutBarPin'),
            disabled: isFull,
            action: () => {
                const res = pinTool(toolId);
                if (!res.success && res.reason === 'capacity_full') {
                    showCapacityFullToast();
                } else {
                    onLayoutChange?.();
                }
            }
        });
    }

    const rect = targetEl.getBoundingClientRect();
    showDropdownMenu(items, rect.left, rect.bottom + 4);
}

export function openShortcutButtonMenu(toolId, buttonEl, onLayoutChange) {
    if (!buttonEl || !toolId) return;
    const layout = loadShortcutLayout();
    const idx = layout.indexOf(toolId);
    if (idx === -1) return;

    const items = [
        {
            label: t('shortcutBarMoveLeft'),
            disabled: idx <= 0,
            action: () => {
                reorderShortcut(idx, idx - 1);
                onLayoutChange?.();
            }
        },
        {
            label: t('shortcutBarMoveRight'),
            disabled: idx >= layout.length - 1,
            action: () => {
                reorderShortcut(idx, idx + 1);
                onLayoutChange?.();
            }
        },
        { separator: true },
        {
            label: t('shortcutBarUnpin'),
            danger: true,
            action: () => {
                unpinTool(toolId);
                onLayoutChange?.();
            }
        }
    ];

    const rect = buttonEl.getBoundingClientRect();
    showDropdownMenu(items, rect.left, rect.top - 4);
}

/**
 * Cancel and clean up active drag operation
 */
function cancelCurrentDrag() {
    if (autoOpenTimer) {
        clearTimeout(autoOpenTimer);
        autoOpenTimer = null;
    }
    if (activeDrag) {
        if (activeDrag.ghostEl) {
            activeDrag.ghostEl.remove();
        }
        if (activeDrag.indicatorEl) {
            activeDrag.indicatorEl.remove();
        }
        if (activeDrag.dropzoneEl) {
            activeDrag.dropzoneEl.classList.remove('is-drag-over');
            const txt = activeDrag.dropzoneEl.querySelector('.anomalous-toolbox-dropzone-text');
            if (txt) txt.textContent = t('shortcutDropHint');
        }
        if (activeDrag.originEl) {
            activeDrag.originEl.style.opacity = '1';
        }
    }
    setDraggingState(false);
    activeDrag = null;
}

/**
 * Binds pointer drag & drop to a shortcut bar button or toolbox card.
 */
export function bindDraggableTool(element, {
    toolId,
    source, // 'shortcut' | 'toolbox'
    toolboxModal,
    toolboxBtn,
    sidebarActionsEl,
    onLayoutChange,
    onToolClick,
}) {
    if (!element || !toolId) return;

    let startX = 0;
    let startY = 0;
    let hasMoved = false;

    const onPointerDown = (e) => {
        // Only primary mouse button (or touch/pen)
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
        // Ignore if clicking a "More" menu button inside card
        if (e.target?.closest?.('.anomalous-tool-more-btn')) return;

        startX = e.clientX;
        startY = e.clientY;
        hasMoved = false;

        const spec = getToolDefinition(toolId);
        if (!spec) return;

        const onPointerMove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            const dist = Math.hypot(dx, dy);

            if (!hasMoved) {
                if (dist > 6) {
                    hasMoved = true;
                    setDraggingState(true);
                    hideTooltipImmediately();
                    closeActiveMenu();

                    // Create ghost element
                    const ghost = document.createElement('div');
                    ghost.className = 'anomalous-shortcut-drag-ghost';
                    ghost.innerHTML = `
                        <div class="anomalous-ghost-icon">${spec.icon}</div>
                        <div class="anomalous-ghost-title">${t(spec.labelKey)}</div>
                    `;
                    ghost.style.position = 'fixed';
                    ghost.style.zIndex = '1000003';
                    ghost.style.pointerEvents = 'none';
                    ghost.style.transform = 'translate(-50%, -50%)';
                    ghost.style.display = 'flex';
                    ghost.style.alignItems = 'center';
                    ghost.style.gap = '6px';
                    ghost.style.padding = '6px 12px';
                    ghost.style.borderRadius = '8px';
                    ghost.style.background = 'rgba(28, 30, 38, 0.95)';
                    ghost.style.border = '1px solid rgba(255, 255, 255, 0.25)';
                    ghost.style.boxShadow = '0 12px 30px rgba(0,0,0,0.6)';
                    ghost.style.color = '#ffffff';
                    ghost.style.fontSize = '12px';
                    ghost.style.fontWeight = '600';
                    document.body.appendChild(ghost);

                    // Create drop indicator line for shortcut bar
                    const indicator = document.createElement('div');
                    indicator.className = 'anomalous-shortcut-drop-indicator';
                    indicator.style.display = 'none';
                    indicator.style.position = 'absolute';
                    indicator.style.width = '2px';
                    indicator.style.height = '24px';
                    indicator.style.background = '#ffffff';
                    indicator.style.boxShadow = '0 0 8px rgba(255, 255, 255, 0.8)';
                    indicator.style.borderRadius = '1px';
                    indicator.style.zIndex = '10';
                    indicator.style.pointerEvents = 'none';
                    if (sidebarActionsEl) {
                        sidebarActionsEl.appendChild(indicator);
                    }

                    const dropzone = toolboxModal ? toolboxModal.querySelector('.anomalous-toolbox-dropzone') : null;

                    activeDrag = {
                        isDragging: true,
                        toolId,
                        source,
                        originEl: element,
                        ghostEl: ghost,
                        indicatorEl: indicator,
                        dropzoneEl: dropzone,
                        targetIndex: -1,
                        dropAction: null, // 'pin' | 'unpin' | 'reorder' | null
                    };

                    element.style.opacity = '0.4';
                }
            }

            if (activeDrag && activeDrag.isDragging) {
                // Move ghost
                activeDrag.ghostEl.style.left = `${moveEvent.clientX}px`;
                activeDrag.ghostEl.style.top = `${moveEvent.clientY}px`;

                const overEl = typeof document.elementFromPoint === 'function'
                    ? document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)
                    : null;

                // Check if over closed toolbox button (auto-expand after 350ms)
                if (toolboxBtn && toolboxBtn.contains(overEl)) {
                    if (toolboxModal && toolboxModal.style.display === 'none') {
                        if (!autoOpenTimer) {
                            autoOpenTimer = setTimeout(() => {
                                toolboxModal.style.display = 'flex';
                            }, 350);
                        }
                    }
                } else {
                    if (autoOpenTimer) {
                        clearTimeout(autoOpenTimer);
                        autoOpenTimer = null;
                    }
                }

                // Check if over Toolbox or dropzone (for unpinning)
                const isOverToolbox = toolboxModal && toolboxModal.style.display !== 'none' && (toolboxModal.contains(overEl) || (toolboxBtn && toolboxBtn.contains(overEl)));
                if (isOverToolbox) {
                    if (activeDrag.dropzoneEl) {
                        activeDrag.dropzoneEl.classList.add('is-drag-over');
                        const txt = activeDrag.dropzoneEl.querySelector('.anomalous-toolbox-dropzone-text');
                        if (txt) txt.textContent = t('shortcutDropRelease');
                    }
                    if (activeDrag.indicatorEl) activeDrag.indicatorEl.style.display = 'none';
                    activeDrag.dropAction = 'unpin';
                    return;
                } else {
                    if (activeDrag.dropzoneEl) {
                        activeDrag.dropzoneEl.classList.remove('is-drag-over');
                        const txt = activeDrag.dropzoneEl.querySelector('.anomalous-toolbox-dropzone-text');
                        if (txt) txt.textContent = t('shortcutDropHint');
                    }
                }

                // Check if over Shortcut Bar (for pinning / reordering)
                const isOverShortcutBar = sidebarActionsEl && sidebarActionsEl.contains(overEl);
                if (isOverShortcutBar) {
                    const buttons = Array.from(sidebarActionsEl.querySelectorAll('button[data-tool-id]'));
                    let foundIndex = buttons.length;
                    let indicatorX = 0;

                    const barRect = sidebarActionsEl.getBoundingClientRect();

                    for (let i = 0; i < buttons.length; i++) {
                        const bRect = buttons[i].getBoundingClientRect();
                        const bMidX = bRect.left + bRect.width / 2;
                        if (moveEvent.clientX < bMidX) {
                            foundIndex = i;
                            indicatorX = bRect.left - barRect.left - 2;
                            break;
                        }
                    }

                    if (foundIndex === buttons.length && buttons.length > 0) {
                        const lastRect = buttons[buttons.length - 1].getBoundingClientRect();
                        indicatorX = lastRect.right - barRect.left + 2;
                    }

                    activeDrag.targetIndex = foundIndex;
                    activeDrag.dropAction = 'pin';

                    if (activeDrag.indicatorEl) {
                        activeDrag.indicatorEl.style.display = 'block';
                        activeDrag.indicatorEl.style.left = `${Math.round(indicatorX)}px`;
                        activeDrag.indicatorEl.style.top = '6px';
                    }
                } else {
                    if (activeDrag.indicatorEl) {
                        activeDrag.indicatorEl.style.display = 'none';
                    }
                    activeDrag.dropAction = null;
                }
            }
        };

        const onPointerUp = (upEvent) => {
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
            document.removeEventListener('pointercancel', onPointerCancel);

            if (autoOpenTimer) {
                clearTimeout(autoOpenTimer);
                autoOpenTimer = null;
            }

            if (!hasMoved) {
                // Ordinary click!
                if (onToolClick) {
                    onToolClick(upEvent);
                }
                return;
            }

            // Drag finished: handle drop action
            if (activeDrag && activeDrag.isDragging) {
                upEvent.preventDefault();
                upEvent.stopPropagation();

                const { dropAction, targetIndex } = activeDrag;

                if (dropAction === 'unpin') {
                    unpinTool(toolId);
                    onLayoutChange?.();
                } else if (dropAction === 'pin') {
                    const res = pinTool(toolId, targetIndex);
                    if (!res.success && res.reason === 'capacity_full') {
                        showCapacityFullToast();
                    } else {
                        onLayoutChange?.();
                    }
                }
            }

            cancelCurrentDrag();
        };

        const onPointerCancel = () => {
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
            document.removeEventListener('pointercancel', onPointerCancel);
            cancelCurrentDrag();
        };

        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointercancel', onPointerCancel);
    };

    element.addEventListener('pointerdown', onPointerDown);

    // Also support right-click context menu
    element.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (source === 'shortcut') {
            openShortcutButtonMenu(toolId, element, onLayoutChange);
        } else {
            openToolboxCardMenu(toolId, element, onLayoutChange);
        }
    });
}
