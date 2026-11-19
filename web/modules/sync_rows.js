/**
 * Drawing a list again without drawing it all (the AI workbench's timeline and task list): each row
 * has a key that changes when what it shows changes, and only rows with a new key are made.
 */

import { resolveLocale } from './locales.js';

/**
 * Puts `rows` ({key, make()}) into `parent` in this order: a child already there with the same
 * key, drawn in the language shown now, is kept as it is (moved only when the rows before it
 * changed), the others are made, and the children no row asks for go. Returns true when any row
 * changed, moved or left.
 */
export function syncRows(parent, rows) {
    const language = resolveLocale(); // after a switch of language every row is made again
    const kept = new Map([...parent.children].map(child => [child.dataset.rowKey, child]));
    let changed = false;
    rows.forEach((row, at) => {
        let node = kept.get(row.key);
        if (node?.dataset.rowLanguage === language) {
            kept.delete(row.key);
        } else {
            node = row.make();
            node.dataset.rowKey = row.key;
            node.dataset.rowLanguage = language;
            changed = true;
        }
        if (parent.children[at] !== node) {
            parent.insertBefore(node, parent.children[at] || null);
            changed = true;
        }
    });
    for (const node of kept.values()) {
        node.remove();
        changed = true;
    }
    return changed;
}

/**
 * Tracks active scrolling inside `element` (capturing nested scrollable panes) and invokes `onIdle()`
 * once scrolling settles via `scrollend` or after `idleMs` of quiet. Returns `{ isScrolling(), reset() }`.
 */
export function watchScrollIdle(element, onIdle, idleMs = 260) {
    let scrolling = false;
    let timer = null;
    const settle = () => {
        clearTimeout(timer);
        timer = null;
        if (!scrolling) return;
        scrolling = false;
        onIdle?.();
    };
    element.addEventListener('scroll', () => {
        scrolling = true;
        clearTimeout(timer);
        timer = setTimeout(settle, idleMs);
    }, { capture: true, passive: true });
    element.addEventListener('scrollend', settle, { capture: true, passive: true });
    return {
        isScrolling: () => scrolling,
        reset: () => {
            clearTimeout(timer);
            timer = null;
            scrolling = false;
        },
    };
}
