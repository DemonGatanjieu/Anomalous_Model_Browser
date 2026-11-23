/**
 * The shell's left icon rail: one entry per page (image pages, then the audio pages),
 * the canvas tools and settings. Entries open pages through `owner.goTo(page)`;
 * ui_rail_tools.js fills `owner.railTools` (the tools, then More) and `owner.railFoot`
 * (settings). Old ids are kept (`#anomalous-models-btn` …) so tours and other modules
 * still find them.
 *
 * The rail owns which entries show (rail_pins.js: the core ones always, the others when pinned,
 * the rest listed under More), the open page, and news dots; each change draws the tools again.
 */

import { translate as t } from './locales.js';
import { isTtsInstalled } from './audio_engines.js';
import { applyRailHints, isRailPinned, loadRailPins, resetRailPinsToMinimal, saveRailPins, toggleRailPin } from './rail_pins.js';

// One line style for the rail (Google's rounded outline): 20 px, 1.8 strokes, round ends.
const icon = paths => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const PAGE_ICONS = {
    home: icon('<path d="M4 10.2 12 4l8 6.2V19a1.5 1.5 0 0 1-1.5 1.5H15v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5H5.5A1.5 1.5 0 0 1 4 19z"/>'),
    activity: icon('<path d="M3.8 12a8.2 8.2 0 1 0 2.4-5.8"/><path d="M3.8 4.5v3.8h3.8"/><path d="M12 8v4.3l2.8 1.7"/>'),
    ai: icon('<path d="M10.5 3.5c.8 4.6 2.6 6.4 7.2 7.2-4.6.8-6.4 2.6-7.2 7.2-.8-4.6-2.6-6.4-7.2-7.2 4.6-.8 6.4-2.6 7.2-7.2z"/><path d="M18.5 14.8c.3 1.7.9 2.3 2.6 2.6-1.7.3-2.3.9-2.6 2.6-.3-1.7-.9-2.3-2.6-2.6 1.7-.3 2.3-.9 2.6-2.6z"/>'),
    models: icon('<path d="M12 3.2 19.6 7.6v8.8L12 20.8l-7.6-4.4V7.6z"/><path d="M4.6 7.7 12 12l7.4-4.3M12 12v8.6"/>'),
    gallery: icon('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="9.8" r="1.7"/><path d="m4 17 4.6-4.2a1 1 0 0 1 1.3 0l3 2.6 2.2-1.9a1 1 0 0 1 1.3 0L20 17"/>'),
    recipes: icon('<rect x="8.75" y="3.5" width="6.5" height="5" rx="1.5"/><rect x="3.5" y="15.5" width="6.5" height="5" rx="1.5"/><rect x="14" y="15.5" width="6.5" height="5" rx="1.5"/><path d="M12 8.5V12M6.75 15.5v-2A1.5 1.5 0 0 1 8.25 12h7.5a1.5 1.5 0 0 1 1.5 1.5v2"/>'),
    combos: icon('<path d="M12 3.8 20 8l-8 4.2L4 8z"/><path d="m4 12 8 4.2 8-4.2"/><path d="m4 16 8 4.2 8-4.2"/>'),
    prompts: icon('<path d="M10 12.5H5.5A1.5 1.5 0 0 1 4 11V8.5A1.5 1.5 0 0 1 5.5 7h3A1.5 1.5 0 0 1 10 8.5V14a4 4 0 0 1-4 4"/><path d="M20 12.5h-4.5A1.5 1.5 0 0 1 14 11V8.5A1.5 1.5 0 0 1 15.5 7h3A1.5 1.5 0 0 1 20 8.5V14a4 4 0 0 1-4 4"/>'),
    voices: icon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
    // Not rail entries (Voice-over and Audio are views of Voices); Home's voice-over card uses this one,
    // its "Try a few versions" card the saves one (a version kept, a plus for the next), "Run my preset" a list with a play mark.
    saves: icon('<rect x="8" y="3.5" width="12.5" height="12.5" rx="2.5"/><path d="M16 19.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5V10A1.5 1.5 0 0 1 5 8.5"/><path d="M14.25 7v6M11.25 10h6"/>'),
    presets: icon('<path d="M4 6h12M4 11h12M4 16h7"/><path d="M15 14.5v6l5-3z"/>'),
    script: icon('<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-5 4z"/><path d="M8.5 9h7M8.5 12.5h4.5"/>'),
    'audio-gallery': icon('<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
    // The rail's More button (ui_rail_tools.js): the other pages and tools.
    more: icon('<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>'),
};

/**
 * Pages on the rail, top to bottom: no more than the nine number keys. The core four first, so 1-4 stay
 * Home, Models, Gallery and Workflows; the others show only when pinned. `audio`: the page belongs to the audio domain.
 */
export const RAIL_PAGES = Object.freeze([
    { page: 'home', id: 'anomalous-home-btn', labelKey: 'shellHome' },
    { page: 'models', id: 'anomalous-models-btn', labelKey: 'models' },
    { page: 'gallery', id: 'anomalous-gallery-btn', labelKey: 'gallery' },
    { page: 'recipes', id: 'anomalous-notebook-btn', labelKey: 'recipeTitle' },
    { page: 'combos', id: 'anomalous-combos-btn', labelKey: 'shellCombos' },
    { page: 'prompts', id: 'anomalous-prompts-btn', labelKey: 'shellPrompts' }, // Prompt Studio as a page
    { page: 'ai', id: 'anomalous-ai-btn', labelKey: 'shellAi', railKey: 'shellAiRail' }, // the AI workbench (ui_ai_workbench.js)
    { page: 'activity', id: 'anomalous-activity-btn', labelKey: 'shellActivity' },
    { page: 'voices', id: 'anomalous-voices-btn', labelKey: 'shellVoices', audio: true }, // with Voice-over and Audio as its views
]);

const div = className => Object.assign(document.createElement('div'), { className });

/**
 * Builds the rail; its logo is `.anomalous-rail-brand`. Returns its controller (`owner.rail`, ui_sidebar.js):
 * `root`, `items` (Map page → button), the entries shown (`visiblePages`, `isPinned`, `togglePin`, `resetPins`),
 * Anomalous_TTS (`ttsInstalled`, `voicesShown`: Home's voice card), the open page (`setActive` takes a rail page
 * or a tool's page, `activePage`), news dots (`setNews`, `hasNews`), `hydrate()` and `refreshLanguage()`.
 */
export function createShellRail(owner) {
    // Read before the window writes keys of its own; kept at once, so the next load does not decide again.
    let pins = loadRailPins();
    saveRailPins(pins);
    let ttsInstalled = false; // known after hydrate(); until then Voices shows only when pinned
    let activePage = null;
    const news = new Set();
    const isPinned = id => isRailPinned(pins, id);
    const voicesShown = () => ttsInstalled || isPinned('voices');

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
    const marker = div('anomalous-rail-marker');
    const audioSep = div('anomalous-rail-sep');
    nav.appendChild(marker);
    const items = new Map();
    for (const entry of RAIL_PAGES) {
        if (entry.audio && !audioSep.parentNode) nav.appendChild(audioSep);
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

    const visiblePages = () => RAIL_PAGES.filter(entry => isPinned(entry.page));

    // The tooltip names the entry and its number key: 1-9 down the entries shown (ui_shell_nav.js).
    const refreshLanguage = () => {
        const shown = visiblePages();
        for (const entry of RAIL_PAGES) {
            const button = items.get(entry.page);
            const text = t(entry.labelKey);
            const key = shown.indexOf(entry) + 1;
            button.querySelector('.anomalous-rail-label').textContent = t(entry.railKey || entry.labelKey);
            button.setAttribute('aria-label', text);
            button.dataset.ambTooltip = key ? t('shellRailKey', { name: text, key }) : text;
            button.dataset.ambTooltipPos = 'right';
        }
        syncCompact();
    };

    // The highlight is a pill behind the current entry's icon (the icon's own box, as its hover). An open
    // page that is not on the rail has none: More lights instead (ui_rail_tools.js).
    const moveMarker = () => {
        const current = [...items.values()].find(button => button.classList.contains('active') && !button.hidden);
        marker.classList.toggle('is-shown', !!current);
        const mark = current?.querySelector('svg')?.getBoundingClientRect();
        if (!mark?.height) return;
        marker.style.translate = `0 ${current.offsetTop + mark.top - current.getBoundingClientRect().top}px`;
        marker.style.height = `${mark.height}px`;
    };

    // A short window first tightens the spacing, and only when that is not enough drops the labels under
    // the icons; the tooltips still name the entries.
    const over = () => root.clientHeight > 0 && root.scrollHeight > root.clientHeight + 1;
    const syncCompact = () => {
        root.classList.remove('is-tight', 'is-compact');
        if (over()) root.classList.add('is-tight');
        if (over()) root.classList.add('is-compact');
        moveMarker();
    };
    if (typeof ResizeObserver === 'function') new ResizeObserver(syncCompact).observe(root);

    const showPinned = () => {
        for (const [page, button] of items) button.hidden = !isPinned(page);
        audioSep.hidden = !isPinned('voices');
        refreshLanguage();
        owner.renderRailTools?.();
    };
    showPinned();

    /** Runs `change` on the pins or what is known, keeps the pins and shows the result (Home's voice card too). */
    const update = (change) => {
        const voicesBefore = voicesShown();
        change();
        saveRailPins(pins);
        showPinned();
        if (voicesShown() !== voicesBefore) owner.refreshHome?.();
    };

    // Once per load, without holding the window up: whether Anomalous_TTS is installed and, until read once,
    // what was used before. A failed request changes nothing and is asked again next load.
    let hydrated = false;
    const hydrate = async () => {
        if (hydrated) return;
        hydrated = true;
        const [installed, hints] = await Promise.all([
            isTtsInstalled().catch(() => false),
            pins.hintsApplied || pins.customized ? null
                : fetch('/anomalous/rail_hints').then(response => (response.ok ? response.json() : null)).catch(() => null),
        ]);
        update(() => {
            ttsInstalled = installed;
            pins = applyRailHints(pins, hints, { ttsInstalled: installed });
        });
    };

    const mark = (button, on) => {
        button.classList.toggle('active', on);
        if (on) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    };

    return {
        root,
        items,
        visiblePages,
        isPinned,
        togglePin: id => update(() => { pins = toggleRailPin(pins, id); }),
        resetPins: () => update(() => { pins = resetRailPinsToMinimal(pins); }),
        ttsInstalled: () => ttsInstalled,
        voicesShown,
        activePage: () => activePage,
        setActive(page) {
            activePage = page ?? null;
            for (const [key, button] of items) mark(button, key === page);
            owner.renderRailTools?.(); // the tool open, or More, wears the pill
            moveMarker();
        },
        hasNews: page => news.has(page),
        /** A dot on an entry: something new there (the AI workbench while the AI works elsewhere); on More while it is under it. */
        setNews(page, on) {
            if (news.has(page) === Boolean(on)) return;
            if (on) news.add(page);
            else news.delete(page);
            items.get(page)?.classList.toggle('has-news', Boolean(on));
            owner.renderRailTools?.();
        },
        hydrate,
        refreshLanguage,
    };
}
