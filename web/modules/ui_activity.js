/**
 * The activity page (everything Anomalous changed, by day, with filters, details,
 * "find on canvas" and "open" for scanned models) and the home page's "recent" list.
 * Reads through activity_log.js; each render cancels the previous one's request.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { changeLine, clearActivity, dayLabel, entrySummary, fetchActivity, fileDetailLines, timeLabel } from './activity_log.js';
import { openListedModel } from './ui_scan_lists.js';
import { changeNodeId } from './activity_diff.js';
import { anomalousConfirm } from './ui_dialog.js';

const FILTERS = [['', 'activityAll'], ['canvas', 'activityCanvas'], ['file', 'activityFiles']];
const PAGE_SIZE = 300;
const RECENT_COUNT = 5;
let pageController = null;
let recentController = null;
let filter = '';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

/** Selects and centers the node a change names, if it is on the canvas now. */
function locateNode(change, note) {
    const id = changeNodeId(change);
    const graph = app.canvas?.graph || app.graph;
    const node = id === null ? null : graph?.getNodeById?.(Number(id)) ?? graph?.getNodeById?.(id);
    if (!node) {
        note.textContent = t('activityLocateMissing');
        return;
    }
    app.canvas.selectNode?.(node);
    app.canvas.centerOnNode?.(node);
    app.canvas.setDirty?.(true, true);
}

/** What an entry opens to: [{text, label?, onClick?}]. */
function entryLines(entry, owner, note) {
    if (entry.source !== 'canvas') {
        return fileDetailLines(entry).map(line => (line.model && owner ? {
            text: line.text,
            label: t('scanRowOpen'),
            onClick: () => openListedModel(owner, line.model, () => owner.goTo('activity')),
        } : line));
    }
    return (entry.detail?.changes || []).filter(change => change.kind !== 'opened').map(change => ({
        text: changeLine(change),
        ...(change.kind !== 'removed' ? { label: t('activityLocate'), onClick: () => locateNode(change, note) } : {}),
    }));
}

function renderEntry(entry, { compact = false, owner = null } = {}) {
    const row = el('div', `anomalous-activity-entry is-${entry.source === 'canvas' ? 'canvas' : 'file'}`);
    const head = el('div', 'anomalous-activity-head');
    const summary = entrySummary(entry);
    head.append(el('span', 'anomalous-activity-time', timeLabel(entry.time)),
        el('span', 'anomalous-activity-source', t(entry.source === 'canvas' ? 'activityCanvas' : 'activityFiles')),
        el('span', 'anomalous-activity-summary', summary));
    head.title = summary;
    row.appendChild(head);
    if (compact) return row;
    const note = el('div', 'anomalous-activity-note');
    const lines = entryLines(entry, owner, note);
    if (!lines.length) return row;

    // An entry with details opens to one line each.
    head.classList.add('is-expandable');
    head.tabIndex = 0;
    head.setAttribute('role', 'button');
    head.setAttribute('aria-expanded', 'false');
    const details = el('div', 'anomalous-activity-details');
    details.hidden = true;
    for (const { text, label, onClick } of lines) {
        const line = el('div', 'anomalous-activity-change');
        line.appendChild(el('span', 'anomalous-activity-change-text', text));
        line.title = text;
        if (onClick) line.appendChild(button('anomalous-activity-locate', label, onClick));
        details.appendChild(line);
    }
    const shown = entry.source === 'canvas' ? lines.length : (entry.detail?.files || []).length;
    const total = entry.detail?.total || shown;
    if (total > shown) details.appendChild(el('div', 'anomalous-activity-more', t('activityMore', { count: total - shown })));
    details.appendChild(note);
    const toggle = () => {
        details.hidden = !details.hidden;
        head.setAttribute('aria-expanded', String(!details.hidden));
    };
    head.onclick = toggle;
    head.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
        }
    };
    row.appendChild(details);
    return row;
}

function renderList(list, entries, owner) {
    list.replaceChildren();
    let day = null;
    for (const entry of entries) {
        const label = dayLabel(entry.time);
        if (label !== day) {
            day = label;
            list.appendChild(el('div', 'anomalous-activity-day', label));
        }
        list.appendChild(renderEntry(entry, { owner }));
    }
}

/** The whole page into `panel`. */
export function renderActivityPage(owner, panel) {
    owner.flushCanvasActivity?.();
    pageController?.abort();
    pageController = new AbortController();
    const { signal } = pageController;

    const page = el('div', 'anomalous-activity');
    const bar = el('div', 'anomalous-activity-bar');
    const chips = el('div', 'anomalous-activity-filters');
    const list = el('div', 'anomalous-activity-list');
    const load = () => {
        list.replaceChildren(el('div', 'anomalous-activity-empty', t('loading')));
        fetchActivity({ limit: PAGE_SIZE, source: filter, signal })
            .then(entries => {
                if (signal.aborted) return;
                if (entries.length) renderList(list, entries, owner);
                else list.replaceChildren(el('div', 'anomalous-activity-empty', t('activityEmpty')));
            })
            .catch((error) => {
                if (signal.aborted) return;
                list.replaceChildren(el('div', 'anomalous-activity-empty', `${t('activityLoadFailed')} ${error.message}`));
            });
    };
    for (const [value, key] of FILTERS) {
        const chip = button(`anomalous-activity-chip${value === filter ? ' active' : ''}`, t(key), () => {
            filter = value;
            chips.querySelectorAll('.anomalous-activity-chip').forEach(node => node.classList.toggle('active', node === chip));
            load();
        });
        chips.appendChild(chip);
    }
    const clear = button('anomalous-activity-clear', t('activityClear'), async () => {
        if (!await anomalousConfirm(t('activityClearConfirm'), t('activityTitle'))) return;
        try {
            await clearActivity();
            load();
        } catch (error) {
            list.prepend(el('div', 'anomalous-activity-empty', `${t('activityLoadFailed')} ${error.message}`));
        }
    });
    bar.append(chips, clear);
    page.append(el('p', 'anomalous-activity-lead', t('activityLead')), bar, list);
    panel.replaceChildren(page);
    load();
}

/** The home page's short list: the latest few entries and a link to the page. */
export function renderRecentActivity(owner, container) {
    recentController?.abort();
    recentController = new AbortController();
    const { signal } = recentController;
    const section = el('section', 'anomalous-home-recent');
    const head = el('div', 'anomalous-home-recent-head');
    head.append(el('span', 'anomalous-home-recent-title', t('activityRecent')),
        button('anomalous-home-link', t('activityViewAll'), () => owner.goTo('activity')));
    const list = el('div', 'anomalous-activity-list is-compact');
    section.append(head, list);
    container.appendChild(section);
    owner.flushCanvasActivity?.();
    fetchActivity({ limit: RECENT_COUNT, signal })
        .then((entries) => {
            if (signal.aborted) return;
            if (!entries.length) list.appendChild(el('div', 'anomalous-activity-empty', t('activityEmpty')));
            for (const entry of entries) list.appendChild(renderEntry(entry, { compact: true }));
        })
        .catch(() => {
            if (!signal.aborted) section.remove(); // the home page works without it
        });
}
