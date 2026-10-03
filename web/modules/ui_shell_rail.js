/**
 * The shell's left icon rail: one entry per page (image pages, then the audio pages),
 * the canvas tools and settings. Entries open pages through `owner.goTo(page)`;
 * ui_rail_tools.js fills `owner.railTools` (scan, doctor, current node) and
 * `owner.railFoot` (settings). Old ids are kept (`#anomalous-models-btn` …) so tours
 * and other modules still find them.
 */

import { translate as t } from './locales.js';
import { TOOL_ICONS } from './tool_registry.js';

const icon = paths => `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const PAGE_ICONS = {
    home: icon('<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
    activity: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    models: icon('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'),
    gallery: icon('<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    recipes: icon('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v6"/><path d="M9 6h6"/><path d="M7.8 7.8l8.4 8.4"/>'),
    combos: TOOL_ICONS.MATERIALS,
    materials: icon('<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>'),
    voices: icon('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>'),
    // Not a rail entry (Voice-over is a view of Voices); Home's voice-over card uses it.
    script: icon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8"/><path d="M8 13h5"/>'),
    'audio-gallery': icon('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
};

/** Pages on the rail, top to bottom. `audio`: the page belongs to the audio domain. */
export const RAIL_PAGES = Object.freeze([
    { page: 'home', id: 'anomalous-home-btn', labelKey: 'shellHome' },
    { page: 'activity', id: 'anomalous-activity-btn', labelKey: 'shellActivity' },
    { page: 'models', id: 'anomalous-models-btn', labelKey: 'models' },
    { page: 'gallery', id: 'anomalous-gallery-btn', labelKey: 'gallery' },
    { page: 'recipes', id: 'anomalous-notebook-btn', labelKey: 'recipeTitle' },
    { page: 'combos', id: 'anomalous-combos-btn', labelKey: 'shellCombos' },
    { page: 'materials', id: 'anomalous-materials-btn', labelKey: 'shellMaterials' },
    { page: 'voices', id: 'anomalous-voices-btn', labelKey: 'shellVoices', audio: true },
    { page: 'audio-gallery', id: 'anomalous-audio-gallery-btn', labelKey: 'shellAudioGallery', audio: true },
]);

const div = className => Object.assign(document.createElement('div'), { className });

/**
 * Builds the rail; its logo is `.anomalous-rail-brand`.
 * Returns `{ root, items: Map(page → button), setActive(page | null), refreshLanguage() }`.
 */
export function createShellRail(owner) {
    const root = document.createElement('nav');
    root.id = 'anomalous-rail';
    root.setAttribute('aria-label', 'Anomalous');

    const brand = document.createElement('button');
    brand.type = 'button';
    brand.className = 'anomalous-rail-brand';
    brand.textContent = 'A';
    brand.tabIndex = -1;
    brand.setAttribute('aria-hidden', 'true');

    const nav = div('anomalous-rail-nav');
    const items = new Map();
    for (const entry of RAIL_PAGES) {
        if (entry.audio && !nav.querySelector('.anomalous-rail-sep')) nav.appendChild(div('anomalous-rail-sep'));
        const button = document.createElement('button');
        button.type = 'button';
        button.id = entry.id;
        button.className = 'anomalous-rail-item';
        button.dataset.page = entry.page;
        button.innerHTML = PAGE_ICONS[entry.page]; // static markup only
        button.appendChild(Object.assign(document.createElement('span'), { className: 'anomalous-rail-label' }));
        button.onclick = () => owner.goTo(entry.page, { fromRail: true });
        items.set(entry.page, button);
        nav.appendChild(button);
    }

    owner.railTools = div('anomalous-rail-tools');
    owner.railFoot = div('anomalous-rail-foot');
    root.append(brand, nav, div('anomalous-rail-sep'), owner.railTools, div('anomalous-rail-spacer'), owner.railFoot);

    const refreshLanguage = () => {
        for (const entry of RAIL_PAGES) {
            const button = items.get(entry.page);
            const text = t(entry.labelKey);
            button.querySelector('.anomalous-rail-label').textContent = text;
            button.setAttribute('aria-label', text);
        }
        syncCompact();
    };

    // A short window drops the labels under the icons; tooltips name the entries instead.
    const syncCompact = () => {
        root.classList.remove('is-compact');
        const compact = root.clientHeight > 0 && root.scrollHeight > root.clientHeight + 1;
        root.classList.toggle('is-compact', compact);
        for (const button of items.values()) {
            if (compact) {
                button.dataset.tooltip = button.getAttribute('aria-label');
                button.dataset.tooltipPos = 'right';
            } else {
                delete button.dataset.tooltip;
            }
        }
    };
    if (typeof ResizeObserver === 'function') new ResizeObserver(syncCompact).observe(root);
    refreshLanguage();

    return {
        root,
        items,
        setActive(page) {
            for (const [key, button] of items) {
                button.classList.toggle('active', key === page);
                if (key === page) button.setAttribute('aria-current', 'page');
                else button.removeAttribute('aria-current');
            }
        },
        refreshLanguage,
    };
}
