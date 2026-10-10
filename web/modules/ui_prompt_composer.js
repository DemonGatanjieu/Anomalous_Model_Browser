/**
 * The Prompt Studio drawer beside the canvas: docked left or right (remembered), resizable by its
 * edge (double-click resets), closed with Close or Esc. The browser folds away while it is open
 * and comes back when it closes. Its content is ui_prompt_workbench.js.
 */

import { createViewScope, bindDrawerResize } from './ui_lifecycle.js';
import { createPromptWorkbench } from './ui_prompt_workbench.js';
import { translate as t } from './locales.js';

const DEFAULT_WIDTH = 620;
let activeStudio = null;

function stored(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function store(key, value) {
    try { localStorage.setItem(key, value); } catch { /* remembered for this visit only */ }
}

/** Closes the studio; the browser it folded away comes back (not when another studio replaces it). */
export function closePromptStudio(owner, { replacing = false } = {}) {
    if (!activeStudio) return;
    const previous = activeStudio;
    activeStudio = null;
    previous.scope.dispose();
    document.body.classList.remove('anomalous-prompt-studio-open');
    if (replacing) return;
    if (previous.reopenBrowser) previous.owner.show?.();
    else if (!previous.owner.modal?.classList.contains('visible')) previous.owner.setTriggerVisible?.(true);
}

export async function openPromptStudio(owner = this) {
    // The browser folds away so the canvas has room, and comes back when the studio closes.
    const reopenBrowser = Boolean(owner?.modal?.classList.contains('visible') || activeStudio?.reopenBrowser);
    closePromptStudio(owner, { replacing: true });
    if (owner?.modal?.classList.contains('visible')) owner.close?.();
    owner?.setTriggerVisible?.(false);
    document.body.classList.add('anomalous-prompt-studio-open');

    const overlay = document.createElement('div');
    overlay.className = 'anomalous-prompt-studio-overlay';
    const scope = createViewScope();
    activeStudio = { scope, owner, reopenBrowser };
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
        onClose: () => closePromptStudio(owner),
        onToggleDockSide: () => {
            const isLeft = drawer.classList.toggle('is-dock-left');
            store('anomalous_studio_dock_side', isLeft ? 'left' : 'right');
            return isLeft;
        },
    });
    document.body.appendChild(overlay);
}