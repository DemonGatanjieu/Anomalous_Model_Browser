/**
 * A small menu of actions, looking like the keep menu: at the pointer (a right-click) or under
 * a button. A pick, a click elsewhere, the wheel or Esc closes it; its Esc goes no further, so
 * the page behind stays open. One at a time.
 */

let closeOpenMenu = null;

function row({ icon, label, run, danger }, close) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `anomalous-keep-row${danger ? ' is-danger' : ''}`;
    item.setAttribute('role', 'menuitem');
    const mark = document.createElement('span');
    mark.className = 'anomalous-keep-row-icon';
    mark.textContent = icon;
    const text = document.createElement('strong');
    text.textContent = label;
    item.append(mark, text);
    item.onclick = (event) => {
        close();
        run(event);
    };
    return item;
}

/**
 * `at`: a pointer event (the menu opens there) or a button (the menu opens under it,
 * right-aligned; a click on that button is left to it, so it can close the menu again).
 * `onClose()` runs however it closes. Returns the close function.
 */
export function openActionMenu(at, items, { className = '', onClose } = {}) {
    closeOpenMenu?.();
    const menu = document.createElement('div');
    menu.className = `anomalous-keep-menu anomalous-action-menu ${className}`.trim();
    menu.setAttribute('role', 'menu');
    const onPointer = (pointer) => {
        if (!menu.contains(pointer.target) && !(at instanceof Element && at.contains(pointer.target))) close();
    };
    const onKey = (key) => {
        if (key.key !== 'Escape') return;
        key.stopPropagation();
        close();
    };
    const close = () => {
        menu.remove();
        window.removeEventListener('pointerdown', onPointer, true);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('wheel', close, true);
        if (closeOpenMenu === close) closeOpenMenu = null;
        onClose?.();
    };
    menu.append(...items.map(item => row(item, close)));
    document.body.append(menu);
    const { width, height } = menu.getBoundingClientRect();
    let x = at.clientX;
    let y = at.clientY;
    if (at instanceof Element) {
        const anchor = at.getBoundingClientRect();
        x = anchor.right - width;
        y = anchor.bottom + 6;
    }
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', close, true);
    closeOpenMenu = close;
    return close;
}
