/**
 * The floating window's frame: dragged by its header, resized from the corner handle,
 * kept on screen, position and size remembered; or the full ComfyUI page (the header's
 * full-window button, or a double-click on the header), remembered too. Docked and full
 * window ignore the position and size (CSS); docked has a width of its own, dragged at
 * its right edge. Going between the three, the page is laid out once and only its picture
 * moves (`morphFrame`).
 */

import { translate as t } from './locales.js';

const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;

/** Drag by `header` (not from its buttons or fields); keeps `container` inside the window. */
export function bindShellDrag(container, header) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const clamp = (x, y) => ({
        x: Math.max(0, Math.min(x, window.innerWidth - container.offsetWidth)),
        y: Math.max(0, Math.min(y, window.innerHeight - container.offsetHeight)),
    });

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button, input, select, textarea, #anomalous-close, .anomalous-header-close')) return;
        if (container.classList.contains('anomalous-maximized') || container.classList.contains('anomalous-docked')) return;
        dragging = true;
        const rect = container.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const pos = clamp(e.clientX - offsetX, e.clientY - offsetY);
        container.style.left = `${pos.x}px`;
        container.style.top = `${pos.y}px`;
        container.style.transform = 'none';
    });
    window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        localStorage.setItem('anomalous_pos_x', container.style.left);
        localStorage.setItem('anomalous_pos_y', container.style.top);
    });

    const savedX = localStorage.getItem('anomalous_pos_x');
    const savedY = localStorage.getItem('anomalous_pos_y');
    if (savedX && savedY) {
        container.style.left = savedX;
        container.style.top = savedY;
    }

    // The browser window may shrink or zoom after a drag; pull the frame back on screen.
    setInterval(() => {
        if (dragging || container.style.display === 'none' || container.classList.contains('anomalous-docked')
            || container.classList.contains('anomalous-maximized')) return;
        const rect = container.getBoundingClientRect();
        const pos = clamp(rect.left, rect.top);
        if ((pos.x !== rect.left || pos.y !== rect.top) && container.style.left.endsWith('px') && container.style.top.endsWith('px')) {
            container.style.left = `${pos.x}px`;
            container.style.top = `${pos.y}px`;
        }
    }, 1000);
}

/** The bottom-right resize handle; appended to `container`. */
export function bindShellResize(container) {
    const handle = document.createElement('div');
    handle.className = 'anomalous-resize-handle';
    let resizing = false;
    handle.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        resizing = true;
    };
    window.addEventListener('mousemove', (e) => {
        if (!resizing) return;
        const rect = container.getBoundingClientRect();
        container.style.width = `${Math.max(MIN_WIDTH, e.clientX - rect.left)}px`;
        container.style.height = `${Math.max(MIN_HEIGHT, e.clientY - rect.top)}px`;
    });
    window.addEventListener('mouseup', () => {
        if (!resizing) return;
        resizing = false;
        localStorage.setItem('anomalous_width', container.style.width);
        localStorage.setItem('anomalous_height', container.style.height);
    });
    const savedW = localStorage.getItem('anomalous_width');
    const savedH = localStorage.getItem('anomalous_height');
    if (savedW) container.style.width = savedW;
    if (savedH) container.style.height = savedH;
    container.appendChild(handle);
}

/**
 * The docked window's right edge, appended to `container`: drag to set the width, double-click
 * for the usual one. The limits are in the CSS (`.anomalous-docked`); what they allowed is kept.
 */
export function bindDockResize(container) {
    const edge = document.createElement('div');
    edge.className = 'anomalous-dock-edge';
    let dragged = false;
    const setWidth = width => container.style.setProperty('--amb-dock-width', `${width}px`);
    const saved = localStorage.getItem('anomalous_dock_width');
    if (saved) setWidth(saved);

    edge.onpointerenter = () => { edge.title = t('dockEdgeTitle'); };
    edge.onpointerdown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragged = false;
        edge.setPointerCapture(e.pointerId);
        container.classList.add('is-dock-resizing');
    };
    edge.onpointermove = (e) => {
        if (!edge.hasPointerCapture(e.pointerId)) return;
        dragged = true;
        setWidth(Math.round(e.clientX - container.getBoundingClientRect().left));
    };
    edge.onlostpointercapture = () => {
        container.classList.remove('is-dock-resizing');
        const width = container.offsetWidth; // 0 if the window closed in the middle of the drag
        if (!dragged || !width) return;
        setWidth(width);
        localStorage.setItem('anomalous_dock_width', String(width));
    };
    edge.ondblclick = () => {
        container.style.removeProperty('--amb-dock-width');
        localStorage.removeItem('anomalous_dock_width');
    };
    container.appendChild(edge);
}

let morphing = null;

/** Runs `change`, which gives `container` another frame, and carries the picture from the old frame to the new. */
export function morphFrame(container, change) {
    const from = container.getBoundingClientRect();
    morphing?.cancel();
    change();
    const to = container.getBoundingClientRect();
    if (!to.width || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    morphing = container.animate([
        {
            transformOrigin: '0 0',
            translate: `${from.left - to.left}px ${from.top - to.top}px`,
            scale: `${from.width / to.width} ${from.height / to.height}`,
        },
        { transformOrigin: '0 0', translate: '0 0', scale: '1 1' },
    ], { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
}

const MAXIMIZE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const RESTORE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';

/** The full-window `button` (and a double-click on `header`); returns `set(on)` for the dock button to turn it off. */
export function bindShellMaximize(container, header, button) {
    const set = (on) => {
        container.classList.toggle('anomalous-maximized', on);
        if (on) {
            container.classList.remove('anomalous-docked');
            localStorage.setItem('anomalous_docked', 'false');
        }
        button.innerHTML = on ? RESTORE_ICON : MAXIMIZE_ICON; // static markup only
        button.setAttribute('aria-pressed', String(on));
        localStorage.setItem('anomalous_maximized', on ? 'true' : 'false');
    };
    const toggle = () => morphFrame(container, () => set(!container.classList.contains('anomalous-maximized')));
    button.onclick = toggle;
    header.addEventListener('dblclick', (e) => {
        if (!e.target.closest('button, input, select, textarea, #anomalous-close')) toggle();
    });
    set(localStorage.getItem('anomalous_maximized') === 'true');
    return set;
}
