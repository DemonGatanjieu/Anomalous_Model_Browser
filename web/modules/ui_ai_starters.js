/**
 * The home page's "Let the AI do it", under the tool cards (ui_home.js): a bar folded until the user opens
 * it (remembered in this browser), with one line on what AMB makes sure of, which AI app came last and a
 * warning, shown folded too, when the tool list it holds is a short one (api/mcp_tool_sets.py) that cannot
 * take a task handed over here. Open, the six starter cards (ui_ai_starter_sheet.js): a picture
 * (web/assets/start_*.webp, drawn with ChatGPT in the style of the others), a name and one short line; what
 * each one makes sure of (its tags) is said on hover, not in chips. A card opens its spacious starter
 * workspace directly on the AI workbench (`openAiStarter`). The same cards (`starterGrid`) fill the AI
 * workbench's page with no task yet (ui_ai_ready.js). The line that runs the last "Run my preset" list
 * again (no AI) goes under the home page's smaller tool cards, where that card is, folded or not.
 */

import { translate as t } from './locales.js';
import { dayLabel, timeLabel } from './activity_log.js';
import { fadeIn } from './ui_ai_art.js';
import { openConnectGuide } from './ui_ai_connect.js';
import { icon } from './ui_ai_icons.js';
import { againLine } from './ui_ai_preset_sheet.js';
import { STARTERS, cardTags } from './ui_ai_starter_sheet.js';
import { openAiStarter } from './ui_ai_workbench.js';
import { tourWhenShown } from './ui_ai_tour.js';

const OPEN_KEY = 'anomalous_home_ai_open'; // '1' once the user opened the bar; folded otherwise

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

function readOpen() {
    try {
        return localStorage.getItem(OPEN_KEY) === '1';
    } catch {
        return false;
    }
}

function writeOpen(open) {
    try {
        localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch { /* this visit only */ }
}

/** What the cards need from the server (the app that came last, saved workflows, what a card makes sure of); null from an older server. */
export function readStarters() {
    return fetch('/anomalous/ai_starters').then(response => (response.ok ? response.json() : null)).catch(() => null);
}

/** The line about the AI app: who came last, or none yet; a short tool list said apart. */
function appLine(owner, app) {
    const line = el('div', `anomalous-ai-start-app${app ? ' is-known' : ''}`);
    line.append(el('span', 'anomalous-ai-visit-dot'),
        el('span', '', app ? t('aiLastVisit', { client: app.client, when: `${dayLabel(app.when)} ${timeLabel(app.when)}` }) : t('aiNoVisit')),
        button('anomalous-home-link', t('aiConnect'), () => openConnectGuide()));
    if (app) line.append(button('anomalous-home-link', t('aiStartHowItWorks'), () => { owner.goTo('ai'); setTimeout(tourWhenShown, 700); }));
    const lines = [line];
    if (app && (app.tools === 'core' || app.tools === 'mine')) lines.push(el('div', 'anomalous-ai-start-warn', t('aiStartShortList', { client: app.client })));
    return lines;
}

/** A starter card; `reading` is the server's data on its way (its tags come on hover once read). */
function card(starter, reading, onPick) {
    const node = button('anomalous-ai-start-card', '', () => onPick(starter.id));
    node.dataset.starter = starter.id;
    const art = el('img', 'anomalous-ai-start-card-art');
    art.alt = '';
    art.decoding = 'async';
    art.onerror = () => art.replaceWith(icon(starter.icon, 28)); // the picture is missing: its icon
    art.src = new URL(`../assets/start_${starter.id}.webp`, import.meta.url).href;
    fadeIn(art);
    void reading.then((data) => {
        if (data) node.title = cardTags(starter, data).map(tag => t('aiStartTagLine', { tag: t(`aiStartTag_${tag}`), hint: t(`aiStartTagHint_${tag}`) })).join('\n');
    });
    node.append(art, el('span', 'anomalous-ai-start-card-title', t(`aiStart_${starter.id}_title`)),
        el('span', 'anomalous-ai-start-card-body', t(`aiStart_${starter.id}_body`)));
    return node;
}

/** The six starter cards; a press calls `onPick(id)`. `reading`: readStarters() on its way. */
export function starterGrid(reading, onPick) {
    const grid = el('div', 'anomalous-ai-start-cards');
    grid.append(...STARTERS.map(starter => card(starter, reading, onPick)));
    return grid;
}

/**
 * Draws the section into `slot` (the home page's place for it) at once, folded unless opened before; the
 * server's part fills in when read, the "same again" line after `cards` (the smaller tool cards).
 */
export function renderAiStarters(owner, slot, cards) {
    const reading = readStarters();
    const section = el('section', 'anomalous-ai-start');
    const head = el('div', 'anomalous-ai-start-head');
    const title = el('h2', 'anomalous-ai-start-title');
    title.id = 'anomalous-ai-start-title';
    title.append(icon('sparkle', 18), el('span', '', t('aiStartTitle')), el('span', 'anomalous-ai-start-lead', t('aiStartLead')));
    const grid = starterGrid(reading, id => openAiStarter(owner, id, reading));
    grid.id = 'anomalous-ai-start-cards';
    const show = (open) => {
        grid.hidden = !open;
        section.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.replaceChildren(el('span', '', t(open ? 'aiStartHide' : 'aiStartShow')), icon('chevronDown', 14));
    };
    // The whole bar opens and folds (the button's ::after covers it); the app line's buttons sit above.
    const toggle = button('anomalous-ai-start-toggle', '', () => {
        show(grid.hidden);
        writeOpen(!grid.hidden);
    });
    toggle.setAttribute('aria-controls', grid.id);
    toggle.setAttribute('aria-describedby', title.id);
    show(readOpen());
    head.append(title, toggle);
    section.append(head, grid);
    slot.replaceChildren(section);
    void reading.then((data) => {
        if (!data) {
            section.remove(); // an older server: the home page works without it
            return;
        }
        const [line, warn] = appLine(owner, data.app);
        toggle.before(line);
        if (warn) head.append(warn); // under the bar, folded too
        const again = againLine(owner, data);
        if (again) cards.after(again);
    });
}
