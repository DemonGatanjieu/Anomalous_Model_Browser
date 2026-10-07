/**
 * Two small rules of the shell, without DOM: which page opening the browser shows for the node
 * selected on the canvas (Settings -> Opening and window, on by default), and which rail page a
 * number key goes to while the browser is open (1-9, the rail from the top).
 */

export const FOLLOW_SELECTION_KEY = 'anomalous_open_follows_node';

/** Whether opening the browser follows the selected node (a per-viewer convenience). */
export function followsSelection() {
    try {
        return localStorage.getItem(FOLLOW_SELECTION_KEY) !== 'false';
    } catch {
        return true;
    }
}

export function setFollowsSelection(on) {
    try {
        localStorage.setItem(FOLLOW_SELECTION_KEY, on ? 'true' : 'false');
    } catch { /* stays on for this visit */ }
}

/**
 * The page for the selected `node`: 'prompts' (Prompt Studio, which edits that node's boxes)
 * for a node with prompt boxes and no model drop-down, 'assistant' (Current node) for any other
 * node, null when nothing is selected (the browser reopens the page used last).
 * `takesPrompt(node)` and `hasModel(node)` say what the node holds.
 */
export function pageForNode(node, { takesPrompt, hasModel }) {
    if (!node) return null;
    return takesPrompt(node) && !hasModel(node) ? 'prompts' : 'assistant';
}

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"]';

/**
 * The rail page a key press goes to, or null: a plain 1-9 (top row or number pad) picks the
 * page at that place of `pages` (RAIL_PAGES), unless the key is typed into a field or a dialog.
 */
export function railPageForKey(event, pages) {
    if (!event || event.isComposing || event.repeat) return null;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null;
    if (event.target?.closest?.(EDITABLE)) return null;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code || '')?.[1] ?? (/^[1-9]$/.test(event.key || '') ? event.key : null);
    if (!digit) return null;
    return pages[Number(digit) - 1]?.page ?? null;
}
