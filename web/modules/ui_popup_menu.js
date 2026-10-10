/**
 * A small menu that opens under a button (the workflow card's ⋯, the Workflows page's
 * filter): rows that run an action, rows ticked as chosen, and headings. One is open at a
 * time; a press outside it, Esc, scrolling or a chosen row closes it.
 */

let openMenu = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Closes the open menu, if any. */
export function closePopupMenu() {
    openMenu?.();
}

/**
 * Opens `items` under `anchor`: { heading } or { label, run, checked?, danger? }. A row with
 * `checked` (true or false) shows a tick when true. Pressing the anchor again closes it.
 */
export function openPopupMenu(anchor, items) {
    const wasOpenHere = openMenu?.anchor === anchor;
    closePopupMenu();
    if (wasOpenHere) return;
    const menu = el('div', 'anomalous-popup-menu');
    menu.setAttribute('role', 'menu');
    for (const item of items) {
        if (item.heading) {
            menu.append(el('div', 'anomalous-popup-menu-heading', item.heading));
            continue;
        }
        const row = el('button', `anomalous-popup-menu-item${item.danger ? ' is-danger' : ''}`);
        row.type = 'button';
        row.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
        if (item.checked !== undefined) {
            row.setAttribute('aria-checked', String(Boolean(item.checked)));
            row.append(el('span', 'anomalous-popup-menu-tick', item.checked ? '✓' : ''));
        }
        row.append(el('span', 'anomalous-popup-menu-label', item.label));
        row.onclick = (event) => {
            event.stopPropagation();
            close();
            item.run?.();
        };
        menu.append(row);
    }
    document.body.append(menu);
    const box = anchor.getBoundingClientRect();
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, box.right - width), window.innerWidth - width - 8);
    const below = box.bottom + 4;
    menu.style.left = `${left}px`;
    menu.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, box.top - height - 4) : below}px`;

    const onPointer = (event) => {
        if (!menu.contains(event.target) && !anchor.contains(event.target)) close();
    };
    const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
    };
    const close = () => {
        menu.remove();
        window.removeEventListener('pointerdown', onPointer, true);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', close, true);
        if (openMenu === close) openMenu = null;
    };
    close.anchor = anchor;
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
    openMenu = close;
}