const ALLOWED_RICH_TAGS = new Set([
    'A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'DIV', 'EM', 'H1', 'H2', 'H3',
    'H4', 'H5', 'H6', 'HR', 'I', 'LI', 'OL', 'P', 'PRE', 'S', 'SMALL', 'SPAN',
    'STRONG', 'SUB', 'SUP', 'U', 'UL'
]);

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function setSafeRichHtml(element, value) {
    const template = document.createElement('template');
    template.innerHTML = String(value ?? '');

    for (const node of Array.from(template.content.querySelectorAll('*'))) {
        if (!ALLOWED_RICH_TAGS.has(node.tagName)) {
            node.replaceWith(document.createTextNode(node.textContent || ''));
            continue;
        }

        for (const attribute of Array.from(node.attributes)) {
            const name = attribute.name.toLowerCase();
            const allowed = node.tagName === 'A' && (name === 'href' || name === 'title');
            if (!allowed) node.removeAttribute(attribute.name);
        }

        if (node.tagName === 'A') {
            const href = node.getAttribute('href');
            if (href) {
                try {
                    const url = new URL(href, window.location.href);
                    if (url.protocol !== 'http:' && url.protocol !== 'https:') node.removeAttribute('href');
                } catch (_) {
                    node.removeAttribute('href');
                }
            }
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
        }
    }

    element.replaceChildren(template.content.cloneNode(true));
}
