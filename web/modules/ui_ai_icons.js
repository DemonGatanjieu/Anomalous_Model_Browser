/**
 * The AI pages' line icons (the workbench, the materials picker): one vector set in the text
 * colour, so they follow the theme, and a button with one. Static SVG text only; nothing from
 * a user or a file goes into it.
 */

const PATHS = {
    nodes: '<rect x="2.5" y="4" width="8" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="8" height="6.5" rx="1.6"/><path d="M10.5 7.2h2.2a2.3 2.3 0 0 1 2.3 2.3v4"/><circle cx="10.5" cy="7.2" r=".9" fill="currentColor"/><circle cx="15" cy="13.5" r=".9" fill="currentColor"/>',
    combos: '<path d="M12 3.2 21 8l-9 4.8L3 8z"/><path d="m3 12 9 4.8 9-4.8"/><path d="m3 16 9 4.8 9-4.8"/>',
    workflows: '<circle cx="5.5" cy="6" r="2.5"/><circle cx="18.5" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 6h8M7 8.2l3.6 7.5M17 8.2l-3.6 7.5"/>',
    prompts: '<path d="M4 5.5h16M4 10h11M4 14.5h14M4 19h8"/><path d="M19.5 14.5 21 19"/>',
    models: '<path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.8 7.6 12 12.2l8.2-4.6M12 12.2v8.8"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20.5 20.5-4.8-4.8"/>',
    star: '<path d="m12 3.3 2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.8l-5.3 2.8 1.1-5.9-4.4-4.1 6-.8z"/>',
    starOn: '<path d="m12 3.3 2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.8l-5.3 2.8 1.1-5.9-4.4-4.1 6-.8z" fill="currentColor"/>',
    check: '<path d="m5 12.5 4.3 4.3L19 7.2"/>',
    checks: '<path d="m2.5 12.5 4.3 4.3L16.5 7.2"/><path d="m11.3 16.6.2.2 10-9.6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    sparkle: '<path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z"/><path d="M19 15.5c.25 1.7.8 2.25 2.5 2.5-1.7.25-2.25.8-2.5 2.5-.25-1.7-.8-2.25-2.5-2.5 1.7-.25 2.25-.8 2.5-2.5z"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor"/>',
    page: '<rect x="3" y="4" width="18" height="16" rx="2.2"/><path d="M3 8.5h18"/><circle cx="6" cy="6.3" r=".7" fill="currentColor"/><circle cx="8.3" cy="6.3" r=".7" fill="currentColor"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.6-.9-1.6-1.3-2.8-1.3-1.6 0-2.8.8-2.8 2.1 0 2.9 5.8 1.4 5.8 4.2 0 1.3-1.3 2.1-3 2.1-1.3 0-2.4-.5-3-1.4M12 6.3v1.6M12 16.3v1.4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7"/>',
    list: '<path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
    pencil: '<path d="M4 20h4L19.2 8.8a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    plug: '<path d="M9 3v4.5M15 3v4.5"/><path d="M6.5 7.5h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5V21"/>',
    shield: '<path d="M12 3 19.5 6v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="m8.8 12 2.3 2.3 4.3-4.6"/>',
    undo: '<path d="M8.5 6 4.5 10l4 4"/><path d="M4.5 10H14a5.5 5.5 0 0 1 0 11h-3"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2.2"/><path d="M14.5 4v16"/>',
    question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.7v.4"/><circle cx="12" cy="16.8" r=".9" fill="currentColor"/>',
    alert: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 8.5V5.7a2.2 2.2 0 0 0-2.2-2.2H5.7a2.2 2.2 0 0 0-2.2 2.2v7.6a2.2 2.2 0 0 0 2.2 2.2h2.8"/>',
    chat: '<path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4z"/><circle cx="9" cy="10.8" r=".9" fill="currentColor"/><circle cx="12" cy="10.8" r=".9" fill="currentColor"/><circle cx="15" cy="10.8" r=".9" fill="currentColor"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
    chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
    chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
    pulse: '<path d="M3 12h4l2.5-5.5 4 11L16 12h5"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2.4" fill="currentColor"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.2"/><path d="M9.5 4v16"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    chip: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.8"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>',
    terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.2"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15h4.5"/>',
    expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17.5 5-4.5 3.5 3 3-2.5 4.5 4"/>',
};

/** A line icon by name, `size` px, in the text colour. */
export function icon(name, size = 18, className = '') {
    const holder = document.createElement('span');
    holder.className = `anomalous-tb-icon${className ? ` ${className}` : ''}`;
    holder.setAttribute('aria-hidden', 'true');
    holder.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
    return holder;
}

/** A button with icon `name` and `label` (or the icon alone, `label` then its tooltip). */
export function iconButton(className, name, label, onClick, { title = '', iconOnly = false, size = 16 } = {}) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.append(icon(name, size));
    if (iconOnly) node.setAttribute('aria-label', label);
    else node.append(Object.assign(document.createElement('span'), { textContent: label }));
    if (title || iconOnly) node.title = title || label;
    node.onclick = onClick;
    return node;
}
