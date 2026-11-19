/**
 * The home page's "Let the AI do it" (ui_home.js gives it the first place, above the tool cards): which AI app came last, and a
 * warning when the tool list it holds is a short one (api/mcp_tool_sets.py) that cannot take a task
 * handed over here; then the six starter cards (ui_ai_starter_sheet.js): a picture (web/assets/start_*.webp,
 * drawn with ChatGPT in the style of the others), a name and one short line; what each one makes sure of
 * (its tags) is said on hover, not in chips. Clicking "Run my preset" opens its self-run batch sheet
 * (preset can run locally with no AI); clicking any of the AI cards opens its spacious starter
 * workspace directly on the AI workbench (`openAiStarter`).
 */

import { translate as t } from './locales.js';
import { dayLabel, timeLabel } from './activity_log.js';
import { fadeIn } from './ui_ai_art.js';
import { openConnectGuide } from './ui_ai_connect.js';
import { icon } from './ui_ai_icons.js';
import { againLine } from './ui_ai_preset_sheet.js';
import { STARTERS, cardTags, openStarter } from './ui_ai_starter_sheet.js';
import { openAiStarter } from './ui_ai_workbench.js';
import { tourWhenShown } from './ui_ai_tour.js';

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

/** A starter card; `reading` is the server's data on its way (a press waits for it). */
function card(owner, starter, reading) {
    const node = button('anomalous-ai-start-card', '', () => {
        if (starter.id === 'preset') void reading.then(data => data && openStarter(owner, starter, data));
        else openAiStarter(owner, starter.id, reading);
    });
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

/** Draws the section into `slot` (the home page's place for it) at once; the server's part fills in when read. */
export function renderAiStarters(owner, slot) {
    const reading = fetch('/anomalous/ai_starters').then(response => (response.ok ? response.json() : null)).catch(() => null);
    const section = el('section', 'anomalous-ai-start');
    const head = el('div', 'anomalous-ai-start-head');
    const title = el('span', 'anomalous-ai-start-title');
    title.append(icon('sparkle', 18), el('span', '', t('aiStartTitle')));
    head.append(title);
    const grid = el('div', 'anomalous-ai-start-cards');
    grid.append(...STARTERS.map(starter => card(owner, starter, reading)));
    section.append(head, grid);
    slot.replaceChildren(section);
    void reading.then((data) => {
        if (!data) {
            section.remove(); // an older server: the home page works without it
            return;
        }
        head.append(...appLine(owner, data.app));
        const again = againLine(owner, data);
        if (again) section.append(again);
    });
}
