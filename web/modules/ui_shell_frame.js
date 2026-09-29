/**
 * The floating window's frame: dragged by its header, resized from the corner handle,
 * kept on screen, position and size remembered. Docked mode ignores all of it (CSS).
 */

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
        if (dragging || container.style.display === 'none' || container.classList.contains('anomalous-docked')) return;
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
