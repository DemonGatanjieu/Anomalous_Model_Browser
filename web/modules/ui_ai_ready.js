/**
 * A task waiting for an AI (ui_ai_workbench.js), on two pages switched at the top: "Get started"
 * (ui_ai_connect.js waitingCard: what to do, the sentence for the AI, connecting) and "Put ready":
 * the gallery as a big grid whose pictures go onto the message box at the foot of the column
 * (attached: to mark up, write about and send there), and what is ready so far (the user's own
 * steps, drawn by the workbench). The AI gets what is ready when it takes the task. Which page
 * shows is kept per task while the page is open.
 */

import { translate as t } from './locales.js';
import { waitingCard } from './ui_ai_connect.js';
import { pictureGrid } from './ui_ai_gallery_pick.js';

const shownPage = new Map(); // task id -> 'start' | 'ready'

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function section(title, ...body) {
    const box = el('section', 'anomalous-ai-ready-part');
    box.append(el('div', 'anomalous-ai-ready-label', title), ...body);
    return box;
}

/** The "Put ready" page; `ctx` as for waitingView. */
function readyPage(ctx) {
    const page = el('div', 'anomalous-ai-ready');
    const head = el('div', 'anomalous-ai-ready-head');
    head.append(el('div', 'anomalous-ai-ready-title', t('aiReadyTitle')), el('p', 'anomalous-ai-ready-body', t('aiReadyBody')));
    const box = ctx.message;
    const pictures = pictureGrid({
        picked: id => Boolean(box.refs?.has(id)),
        pick: (item) => {
            if (box.refs.has(item.id)) box.refs.remove(item.id);
            else if (box.refs.room() > 0) box.refs.add(item);
        },
    });
    // The box outlives this page (it moves back under the timeline): the grid follows its chips while shown.
    const follow = () => {
        if (page.isConnected) return pictures.mark();
        box.removeEventListener('anomalous-refs', follow);
        pictures.stop();
    };
    box.addEventListener('anomalous-refs', follow);
    page.append(head, section(t('aiReadyPictures'), pictures.search, pictures.grid));
    if (ctx.ready.length) page.append(section(t('aiWaitingReadyDone', { count: ctx.ready.length }), ...ctx.ready));
    page.mark = pictures.mark;
    return page;
}

/**
 * The waiting task's two pages. `ctx`: {rename(title), message (the task's message box), materials
 * (how many are picked), ready (the user's steps so far, drawn)}.
 */
export function waitingView(task, ctx) {
    const view = el('div', 'anomalous-ai-waiting-view');
    const tabs = el('div', 'anomalous-ai-waiting-tabs');
    tabs.setAttribute('role', 'tablist');
    const pages = {
        start: waitingCard(task, ctx.rename, { ready: ctx.ready.length, materials: ctx.materials, open: () => show('ready') }),
        ready: readyPage(ctx),
    };
    const labels = { start: t('aiWaitingTabStart'), ready: ctx.ready.length ? t('aiWaitingTabReadyCount', { count: ctx.ready.length }) : t('aiWaitingTabReady') };
    const buttons = {};
    for (const name of Object.keys(pages)) {
        const tab = el('button', 'anomalous-ai-waiting-tab', labels[name]);
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.onclick = () => show(name);
        buttons[name] = tab;
        tabs.append(tab);
    }
    function show(name) {
        shownPage.set(task.id, name);
        for (const key of Object.keys(pages)) {
            pages[key].hidden = key !== name;
            buttons[key].classList.toggle('is-on', key === name);
            buttons[key].setAttribute('aria-selected', String(key === name));
        }
        if (name === 'ready') pages.ready.mark();
    }
    view.append(tabs, pages.start, pages.ready);
    show(shownPage.get(task.id) || 'start');
    return view;
}
