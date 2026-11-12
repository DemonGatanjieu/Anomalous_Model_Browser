/**
 * The home page's "Let the AI do it" (ui_home.js puts it under the cards): which AI app came last, and a
 * warning when the tool list it holds is a short one (api/mcp_tool_sets.py) that cannot take a task
 * handed over here; then the six starter cards (ui_ai_starter_sheet.js), each with its tags. "Explain my
 * canvas" opens the canvas hand-off as the canvas menu does (ui_ai_canvas_hand.js). GET /anomalous/ai_starters;
 * without it (an older server) the section stays away.
 */

import { translate as t } from './locales.js';
import { dayLabel, timeLabel } from './activity_log.js';
import { openConnectGuide } from './ui_ai_connect.js';
import { handCanvasToAi } from './ui_ai_canvas_hand.js';
import { icon } from './ui_ai_icons.js';
import { STARTERS, cardTags, openStarter } from './ui_ai_starter_sheet.js';
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

function card(owner, starter, data) {
    const node = button('anomalous-ai-start-card', '', () => (starter.id === 'canvas' ? handCanvasToAi(() => owner) : openStarter(owner, starter, data)));
    node.dataset.starter = starter.id;
    const head = el('span', 'anomalous-ai-start-card-head');
    head.append(icon(starter.icon, 17), el('span', 'anomalous-ai-start-card-title', t(`aiStart_${starter.id}_title`)));
    const tags = el('span', 'anomalous-ai-start-tags');
    for (const tag of cardTags(starter, data)) {
        const chip = el('span', 'anomalous-ai-start-tag', t(`aiStartTag_${tag}`));
        chip.title = t(`aiStartTagHint_${tag}`);
        tags.append(chip);
    }
    node.append(head, el('span', 'anomalous-ai-start-card-body', t(`aiStart_${starter.id}_body`)), tags);
    return node;
}

/** Draws the section after `after` (the home page's cards) once its data is read. */
export function renderAiStarters(owner, after) {
    fetch('/anomalous/ai_starters').then(response => (response.ok ? response.json() : null)).then((data) => {
        if (!data || !after.isConnected) return;
        const section = el('section', 'anomalous-ai-start');
        const head = el('div', 'anomalous-ai-start-head');
        const title = el('span', 'anomalous-ai-start-title');
        title.append(icon('sparkle', 18), el('span', '', t('aiStartTitle')));
        head.append(title, ...appLine(owner, data.app));
        const grid = el('div', 'anomalous-ai-start-cards');
        grid.append(...STARTERS.map(starter => card(owner, starter, data)));
        section.append(head, grid);
        after.after(section);
    }).catch(() => { /* the home page works without it */ });
}
