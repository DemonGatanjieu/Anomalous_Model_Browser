/**
 * The rail's tool buttons under the pages: Model Check, then saves, Current node and scan when pinned
 * (rail_pins.js), each with a short word under its icon as the pages have (gone with theirs in a short
 * window), and last More, which lists the pages and tools not on the rail (ui_rail_more.js); settings at
 * the rail's foot. Drawn from the rail's state (`owner.rail`) and drawn again on each change of it: the
 * tool whose page is open wears the pill, or More when that page is under it (its tooltip names the page),
 * and More shows the news and the scan of the entries it holds. Labels follow the language (the settings
 * hub draws them again when it changes). The other tools live on their pages.
 */

import { translate as t } from './locales.js';
import { TOOL_ICONS } from './tool_registry.js';
import { PAGE_ICONS, RAIL_PAGES } from './ui_shell_rail.js';
import { SCAN_ICON, setScanButtonState } from './scan_runner.js';
import { openRailMore, refreshRailMore } from './ui_rail_more.js';

const TOOLS = Object.freeze([
    { id: 'anomalous-doctor-btn', page: 'doctor', nameKey: 'sidebarDoctor', railKey: 'railDoctor', icon: TOOL_ICONS.DOCTOR, open: owner => owner.openDoctorPage() },
    { id: 'anomalous-saves-btn', page: 'saves', nameKey: 'savesPageTitle', railKey: 'savesListToggle', icon: PAGE_ICONS.saves, open: owner => owner.showSaves() },
    { id: 'anomalous-assistant-btn', page: 'assistant', nameKey: 'sidebarAssistant', railKey: 'railAssistant', icon: TOOL_ICONS.ASSISTANT, open: owner => owner.openCurrentNode() },
    { id: 'anomalous-scan-btn', page: 'scan', nameKey: 'sidebarScan', railKey: 'railScan', open: owner => owner.openScanPage() },
]);
// What More lists, in its order: the pages and tools that can leave the rail.
const MORE_ENTRIES = Object.freeze(['combos', 'prompts', 'ai', 'saves', 'assistant', 'scan', 'activity', 'voices']);

/** An entry of More: its name, icon and how it opens (a page as from the rail: Voices reopens the view used last). */
function moreEntry(id) {
    const page = RAIL_PAGES.find(entry => entry.page === id);
    if (page) return { id, name: t(page.labelKey), icon: PAGE_ICONS[id], open: owner => owner.goTo(id, { fromRail: true }) };
    const tool = TOOLS.find(entry => entry.page === id);
    return { id, name: t(tool.nameKey), icon: tool.icon || SCAN_ICON, open: tool.open };
}

function railButton(id, name, word, current) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = 'anomalous-tooltip-target';
    button.setAttribute('aria-label', name);
    button.setAttribute('data-amb-tooltip', name);
    button.setAttribute('data-amb-tooltip-pos', 'right');
    if (current) {
        button.classList.add('active');
        button.setAttribute('aria-current', 'page');
    }
    button.append(Object.assign(document.createElement('span'), { className: 'anomalous-rail-label', textContent: word }));
    return button;
}

function moreButton(owner) {
    const { rail } = owner;
    const away = id => !rail.isPinned(id);
    const here = MORE_ENTRIES.includes(rail.activePage()) && away(rail.activePage()) ? moreEntry(rail.activePage()) : null;
    const button = railButton('anomalous-more-btn', here ? t('railMoreActiveTitle', { name: here.name }) : t('railMoreTitle'), t('railMore'), here);
    button.insertAdjacentHTML('afterbegin', PAGE_ICONS.more); // static markup only
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false'); // ui_rail_more.js sets it while its menu is open
    button.classList.toggle('has-news', MORE_ENTRIES.some(id => away(id) && rail.hasNews(id)));
    button.classList.toggle('is-scanning', away('scan') && owner.isScanning());
    button.onclick = (event) => {
        event.stopPropagation();
        openRailMore(owner, MORE_ENTRIES.map(moreEntry));
    };
    return button;
}

/** Fills `owner.railTools` (the tools shown, then More) and `owner.railFoot`. */
export function renderRailTools(owner, { settingsButton }) {
    const { rail } = owner;
    const tools = TOOLS.filter(tool => rail.isPinned(tool.page)).map((tool) => {
        const button = railButton(tool.id, t(tool.nameKey), t(tool.railKey), rail.activePage() === tool.page);
        if (tool.icon) button.insertAdjacentHTML('afterbegin', tool.icon); // static markup only
        else setScanButtonState(button, owner.isScanning());
        button.onclick = (event) => {
            event.stopPropagation();
            tool.open(owner);
        };
        return button;
    });
    owner.railTools.replaceChildren(...tools, moreButton(owner));
    owner.railFoot.replaceChildren(settingsButton);
    refreshRailMore();
}
