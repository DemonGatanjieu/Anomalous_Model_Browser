export function text(parent, tag, value, className = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value == null ? '' : String(value);
    parent.appendChild(element);
    return element;
}

export async function jsonResponse(response, fallbackMessage) {
    let payload = {};
    try { payload = await response.json(); } catch { /* A server error may not be JSON. */ }
    if (!response.ok) throw new Error(payload.message || fallbackMessage);
    return payload;
}

/**
 * `parent` comes to show `fresh` on the elements it has. The browser sends no click to an element that left
 * the page during the press, and a redraw can come during one: ComfyUI's graphChanged at the mouseup, the
 * answer to a request, a run ending. A box being typed in would lose its digits. An element with a `data-key`
 * is kept only for the same key; with `data-fills` too it draws its own content and is left as it stands.
 * Handlers move over to the kept element, so they use the event's element, not the one made with them.
 */
export function settle(parent, fresh) {
    const there = [...parent.children];
    fresh.forEach((node, at) => {
        const old = there[at];
        if (!old) return void parent.append(node);
        if (old.tagName !== node.tagName || old.dataset.key !== node.dataset.key) return void old.replaceWith(node);
        if ('fills' in node.dataset) return;
        for (const name of old.getAttributeNames()) {
            if (!node.hasAttribute(name)) old.removeAttribute(name);
        }
        for (const { name, value } of node.attributes) {
            if (old.getAttribute(name) !== value) old.setAttribute(name, value);
        }
        old.onclick = node.onclick;
        old.onchange = node.onchange;
        if (node.tagName === 'INPUT') {
            if (old !== document.activeElement) old.value = node.value;
        } else if (!node.children.length && old.textContent !== node.textContent) old.textContent = node.textContent;
        settle(old, [...node.children]);
    });
    for (const extra of there.slice(fresh.length)) extra.remove();
}
