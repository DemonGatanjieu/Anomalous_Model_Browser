/**
 * What the two "not used lately" pages share (api/model_usage.py): the check, run on a press
 * and kept in `owner.modelUsage` ({data, filter, picked, running, error}) for both — the models
 * under the models page's Tidy tab (ui_model_usage.js) and the node packs in Settings → Node
 * packs (ui_pack_usage.js) — and the head of each: title, how it judges, the 30 / 90 days /
 * never groups and what the run record can vouch for.
 */

import { translate as t } from './locales.js';
import { checkUsage } from './model_placement.js';
import { noteOpenWorkflows } from './usage_notes.js';

const DAY = 24 * 3600;
const NEVER_DAYS = 30; // "never used" only for what has been here this long
const FILTERS = [['30', 'tidyUsage30'], ['90', 'tidyUsage90'], ['never', 'tidyUsageNever']];

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

export function usageState(owner) {
    owner.modelUsage ||= { data: null, filter: '90', picked: new Set(), running: false, error: false };
    return owner.modelUsage;
}

export const daysSince = (seconds, now) => Math.floor((now - seconds) / DAY);
const threshold = (filter) => (filter === 'never' ? NEVER_DAYS : Number(filter)) * DAY;

/** Whether `item` ({last_used, saved, added}) is listed under `filter` ('30' | '90' | 'never'), as
 * of `now`: idle since its last use or its arrival, whichever is later; nothing new is judged. */
export function notUsedSince(item, filter, now) {
    const since = Math.max(item.last_used || 0, item.added || 0);
    if (now - since < threshold(filter)) return false;
    return filter !== 'never' || (!item.last_used && !item.saved);
}

export function lastUsed(item, now) {
    if (!item.last_used) return t('tidyUsageNoOutput');
    const date = new Date(item.last_used * 1000).toLocaleDateString();
    return t('tidyUsageLast', { date, days: daysSince(item.last_used, now) });
}

/** What the run record can vouch for under `filter`: a line, a warning while it is younger than that. */
function ledgerNote(since, filter, now) {
    if (!since) return el('div', 'anomalous-usage-ledger is-short', t('tidyUsageLedgerNone'));
    const values = { date: new Date(since * 1000).toLocaleDateString(), days: daysSince(since, now) };
    const short = now - since < threshold(filter);
    return el('div', `anomalous-usage-ledger${short ? ' is-short' : ''}`, t(short ? 'tidyUsageLedgerShort' : 'tidyUsageLedger', values));
}

async function run(owner, redraw) {
    const view = usageState(owner);
    view.running = true;
    view.error = false;
    redraw();
    try {
        await noteOpenWorkflows();
        view.data = await checkUsage();
        view.picked.clear();
    } catch (error) {
        console.warn('[AMB] Tidy: the usage check failed.', error);
        view.error = true;
    } finally {
        view.running = false;
        redraw();
    }
}

/** A "not used lately" page: its head (`aside`, if any, under the lead), then `body(section, view)`
 * once the check has an answer; `redraw()` draws the page again. */
export function usageSection(owner, { titleKey, leadKey, aside = null, redraw, body }) {
    const view = usageState(owner);
    const section = el('div', 'anomalous-usage');
    const head = el('div', 'anomalous-tidy-step');
    head.append(el('h3', '', t(titleKey)));
    section.append(head, el('p', 'anomalous-tidy-why', t(leadKey)));
    if (aside) section.append(aside);
    if (view.running) {
        section.append(el('div', 'anomalous-download-text', t('tidyUsageRunning')));
        return section;
    }
    if (view.error) section.append(el('div', 'anomalous-download-text is-bad', t('tidyUsageFailed')));
    if (!view.data) {
        section.append(button('anomalous-scan-primary anomalous-scan-small-btn', t('tidyUsageRun'), () => run(owner, redraw)));
        return section;
    }
    const { seen, now, ledger_since: since } = view.data;
    const filters = el('div', 'anomalous-usage-filters');
    for (const [value, key] of FILTERS) {
        const chip = button('anomalous-model-base-chip', t(key), () => { view.filter = value; redraw(); });
        chip.setAttribute('aria-pressed', String(view.filter === value));
        filters.append(chip);
    }
    filters.append(button('anomalous-scan-row-btn', t('tidyUsageAgain'), () => run(owner, redraw)));
    section.append(filters, ledgerNote(since, view.filter, now),
        el('div', 'anomalous-tidy-file', t(seen.capped ? 'tidyUsageSeenCapped' : 'tidyUsageSeen', { outputs: seen.outputs, saved: seen.saved })));
    body(section, view);
    return section;
}
