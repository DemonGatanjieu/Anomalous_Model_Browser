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
