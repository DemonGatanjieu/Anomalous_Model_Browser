/**
 * Drawing a list again without drawing it all (the AI workbench's timeline and task list): each row
 * has a key that changes when what it shows changes, and only rows with a new key are made.
 */

import { resolveLocale } from './locales.js';

/**
 * Puts `rows` ({key, make()}) into `parent` in this order: a child already there with the same
 * key, drawn in the language shown now, is kept as it is (moved only when the rows before it
 * changed), the others are made, and the children no row asks for go.
 */
export function syncRows(parent, rows) {
    const language = resolveLocale(); // after a switch of language every row is made again
    const kept = new Map([...parent.children].map(child => [child.dataset.rowKey, child]));
    rows.forEach((row, at) => {
        let node = kept.get(row.key);
        if (node?.dataset.rowLanguage === language) {
            kept.delete(row.key);
        } else {
            node = row.make();
            node.dataset.rowKey = row.key;
            node.dataset.rowLanguage = language;
        }
        if (parent.children[at] !== node) parent.insertBefore(node, parent.children[at] || null);
    });
    for (const node of kept.values()) node.remove();
}
