/**
 * Keys typed in the plugin's own windows stay the plugin's.
 *
 * ComfyUI runs its shortcuts from one keydown listener on window, and Ctrl+Enter ("queue the
 * canvas") fires even inside text fields. Typed in one of our fields, Ctrl+Enter confirms our
 * box or does nothing; it must not also start a run. A listener on document stops it there in
 * the bubble phase: our own field handlers have run, and window (ComfyUI) never sees it.
 * Outside our fields ComfyUI's shortcuts work as before.
 *
 * A window of ours: an element with an `anomalous-` id, or a child of <body> with an
 * `anomalous-` class. Classes on <html> and <body> (anomalous-picker-open …) never count:
 * ComfyUI's own fields sit under those too.
 */

const TEXT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Nodes from the target outwards (an event's composedPath(), or an element and its parents)
 * up to (not including) <body>, as plain facts. The event's own path is used because a field
 * may be gone from the page by the time the key reaches document: our box closes on Ctrl+Enter.
 */
export function pathOf(nodes) {
    const path = [];
    for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!el?.tagName) continue;
        if (el.tagName === 'BODY' || el.tagName === 'HTML') break;
        path.push({
            tag: el.tagName,
            id: el.id || '',
            classes: [...(el.classList || [])],
            editable: el.isContentEditable === true || el.getAttribute?.('contenteditable') === 'true',
            top: nodes[i + 1]?.tagName === 'BODY',
        });
    }
    return path;
}

const ancestors = (el) => {
    const nodes = [];
    for (let node = el; node; node = node.parentElement) nodes.push(node);
    return nodes;
};

/** True when the path (target first) lies in one of the plugin's windows. */
export function inOurWindow(path) {
    return path.some(step => step.id.startsWith('anomalous-')
        || (step.top && step.classes.some(name => name.startsWith('anomalous-'))));
}

/** True when the key belongs to our field and ComfyUI must not run a shortcut on it. */
export function keepFromComfy(event, path) {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return false;
    const target = path[0];
    if (!target || !(TEXT_TAGS.has(target.tag) || target.editable)) return false;
    return inOurWindow(path);
}

/** One listener per page. */
export function guardComfyShortcuts(doc = document) {
    if (doc.__anomalousKeyGuard) return;
    doc.__anomalousKeyGuard = true;
    doc.addEventListener('keydown', (event) => {
        const nodes = event.composedPath?.() || ancestors(event.target);
        if (keepFromComfy(event, pathOf(nodes))) event.stopPropagation();
    });
}

/** A ComfyUI dialog (not ours) is open on the page: its Esc is not ours to take. */
export function comfyDialogOpen(doc = document) {
    return [...doc.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
        .some(el => el.getClientRects().length && !inOurWindow(pathOf(ancestors(el))));
}
