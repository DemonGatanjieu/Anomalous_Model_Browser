/**
 * The list of sources (or types) that the materials picker's side panel opens from its
 * "Source: All ▾" button (ui_ai_toolbox.js), over the cards: the rows it is given, a search over
 * their names when there are many, ↑ ↓ through the rows (from the search too) and Enter to pick.
 * The row under the pointer or in focus lights up and the one shown is ticked (43-ai-toolbox.css).
 * A pick, Esc or a press outside the list closes it; each listener goes with the list.
 */

import { translate as t } from './locales.js';

const SEARCH_FROM = 8;

let closeOpen = null; // closes the list on screen

function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
}

export function closeFacetMenu() {
    closeOpen?.();
}

/**
 * Opens the list in `host` at `top` px (or closes it when it is open). `rows`: the row buttons
 * (each with `dataset.label`, the one shown with class is-on); `title` names them for the search;
 * `button` is what opened it (a press on it is not "outside").
 */
export function toggleFacetMenu({ host, top, title, rows, button }) {
    if (closeOpen) return void closeFacetMenu();
    const menu = el('div', 'anomalous-tb-facet-menu');
    menu.dataset.anomalousEscape = '1'; // Esc closes this list, not the browser
    const list = el('div', 'anomalous-tb-facet-menu-list');
    list.setAttribute('role', 'listbox');
    list.append(...rows);
    let find = null;
    if (rows.length > SEARCH_FROM) {
        find = el('input', 'anomalous-tb-facet-menu-find');
        find.type = 'search';
        find.placeholder = t('aiTbFindSource', { what: title });
        find.addEventListener('input', () => {
            const words = find.value.trim().toLowerCase();
            for (const row of rows) row.hidden = Boolean(words) && !String(row.dataset.label || '').toLowerCase().includes(words);
        });
        menu.append(find);
    }
    menu.append(list);

    // ↑ ↓ go through the rows the search leaves; up from the first goes back to the search.
    const shown = () => rows.filter(row => !row.hidden);
    menu.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const items = shown();
            const at = items.indexOf(document.activeElement);
            if (event.key === 'ArrowUp' && at <= 0 && find) return void find.focus();
            const next = items[at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
            next?.focus();
            next?.scrollIntoView({ block: 'nearest' });
        } else if (event.key === 'Enter' && event.target === find) {
            event.preventDefault();
            shown()[0]?.click();
        }
    });
    menu.addEventListener('click', (event) => { if (event.target.closest('.anomalous-tb-facet')) close(); });
    menu.style.top = `${top}px`;
    menu.style.maxHeight = `${Math.max(160, host.clientHeight - top - 8)}px`;
    host.append(menu);
    requestAnimationFrame(() => {
        const current = rows.find(row => row.classList.contains('is-on'));
        (find || current || rows[0])?.focus({ preventScroll: true });
        current?.scrollIntoView({ block: 'nearest' });
    });

    const outside = (event) => { if (!menu.contains(event.target) && !button?.contains(event.target)) close(); };
    // After the browser's own Esc handler has seen the list's mark (it then keeps the browser open).
    const escape = (event) => { if (event.key === 'Escape') setTimeout(close); };
    setTimeout(() => { if (closeOpen === close) document.addEventListener('pointerdown', outside, true); });
    document.addEventListener('keydown', escape);
    function close() {
        menu.remove();
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', escape);
        if (closeOpen === close) closeOpen = null;
    }
    closeOpen = close;
}
