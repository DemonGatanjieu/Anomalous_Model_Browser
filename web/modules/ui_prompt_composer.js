/**
 * Where Prompt Studio is shown. Normally it is the browser's Prompts page (`owner.promptPanel`),
 * like any other page: the rail's Prompts entry, the 7 key, opening the browser with a text node
 * selected and the other ways in all lead there. "Beside the canvas" moves it into a drawer
 * docked left or right of the canvas (remembered), resizable by its edge (double-click resets),
 * with the browser folded away; "Back to the window" returns it to the page, and Close or Esc
 * closes the drawer. Its content is ui_prompt_workbench.js, made again each time it is shown.
 */

import { createViewScope, bindDrawerResize } from './ui_lifecycle.js';
import { createPromptWorkbench } from './ui_prompt_workbench.js';
import { translate as t } from './locales.js';

const DEFAULT_WIDTH = 620;
// The studio being shown: { mode: 'page' | 'docked', scope }.
let activeStudio = null;

function stored(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function store(key, value) {
    try { localStorage.setItem(key, value); } catch { /* remembered for this visit only */ }
}

function dispose() {
    const previous = activeStudio;
    activeStudio = null;
    previous?.scope.dispose();
    document.body.classList.remove('anomalous-prompt-studio-open');
}

/** Whether the studio is in the drawer beside the canvas. */
export function promptStudioDocked() {
    return activeStudio?.mode === 'docked';
}

/** Closes the drawer beside the canvas; the browser stays closed and its button comes back. */
export function closePromptStudio(owner) {
    if (!promptStudioDocked()) return;
    dispose();
    if (!owner?.modal?.classList.contains('visible')) owner?.setTriggerVisible?.(true);
}

/** Leaving the Prompts page (another page, or the browser closing) stops its studio. */
export function leavePromptPage() {
    if (activeStudio?.mode === 'page') dispose();
}

/** Fills the Prompts page (called by owner.goTo('prompts')); a docked drawer comes back into it. */
export function showPromptPage(owner) {
    dispose();
    const host = document.createElement('div');
    // The page lays out like the drawer docked left: the cards first, then the prompt boxes.
    host.className = 'anomalous-prompt-page is-dock-left';
    owner.promptPanel.replaceChildren(host);
    owner.promptPanel.style.display = 'flex';
    const scope = createViewScope();
    activeStudio = { mode: 'page', scope };
    scope.onDispose(() => host.remove());
    createPromptWorkbench(owner, host, scope, {
        mode: 'page',
        onDock: () => dockPromptStudio(owner),
    });
}

/** Moves the studio beside the canvas: the browser folds away so the canvas has room. */
export function dockPromptStudio(owner) {
    dispose();
    if (owner?.modal?.classList.contains('visible')) owner.close?.();
    owner?.setTriggerVisible?.(false);
    document.body.classList.add('anomalous-prompt-studio-open');

    const overlay = document.createElement('div');
    overlay.className = 'anomalous-prompt-studio-overlay';
    const scope = createViewScope();
    activeStudio = { mode: 'docked', scope };
    scope.onDispose(() => overlay.remove());

    const drawer = document.createElement('aside');
    drawer.className = 'anomalous-prompt-studio-drawer';
    if (stored('anomalous_studio_dock_side', 'left') === 'left') drawer.classList.add('is-dock-left');
    const savedWidth = parseInt(stored('anomalous_studio_sidebar_width', String(DEFAULT_WIDTH)), 10) || DEFAULT_WIDTH;
    drawer.style.width = `${Math.max(420, Math.min(window.innerWidth * 0.85, savedWidth))}px`;
    overlay.appendChild(drawer);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'anomalous-studio-resize-handle';
    resizeHandle.title = t('promptStudioResize');
    drawer.appendChild(resizeHandle);
    bindDrawerResize(resizeHandle, drawer, scope, {
        side: () => drawer.classList.contains('is-dock-left') ? 'left' : 'right',
        minWidth: 420,
        setWidth: width => { drawer.style.width = `${width}px`; },
        saveWidth: width => store('anomalous_studio_sidebar_width', String(Math.round(width))),
    });
    resizeHandle.ondblclick = () => {
        drawer.style.width = `${DEFAULT_WIDTH}px`;
        store('anomalous_studio_sidebar_width', String(DEFAULT_WIDTH));
    };

    // Esc in a text field of the studio only leaves the field.
    scope.listen(window, 'keydown', (event) => {
        if (event.key !== 'Escape' || document.querySelector('.anomalous-card-preview-popover.is-pinned')) return;
        const field = document.activeElement;
        if (drawer.contains(field) && field.matches('input, textarea')) { field.blur(); return; }
        closePromptStudio(owner);
    });

    createPromptWorkbench(owner, drawer, scope, {
        mode: 'docked',
        onClose: () => closePromptStudio(owner),
        onUndock: () => {
            dispose();
            owner.show?.();
            owner.goTo?.('prompts');
        },
        onToggleDockSide: () => {
            const isLeft = drawer.classList.toggle('is-dock-left');
            store('anomalous_studio_dock_side', isLeft ? 'left' : 'right');
            return isLeft;
        },
    });
    document.body.appendChild(overlay);
}

/**
 * Opens Prompt Studio for the other ways in (a kept prompt, a node's prompt button): the
 * Prompts page, or the drawer when it is already beside the canvas.
 */
export async function openPromptStudio(owner = this) {
    if (promptStudioDocked()) return;
    if (!owner?.modal?.classList.contains('visible')) owner.show?.();
    owner.goTo?.('prompts');
}
