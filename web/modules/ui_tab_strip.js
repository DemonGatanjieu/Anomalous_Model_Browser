import { button, el } from './usage_view.js';

/**
 * A row of tabs over one part shown at a time: GPT-SoVITS Settings (ui_tts_setup.js) and
 * Voice-over's side panel (ui_script_tune.js). The caller keeps which one is open (`remembered`
 * / `remember` keep it across openings in this browser) and draws the part again on a pick.
 */

/** `tabs`: `[{ id, label, dot? }]` (`dot`: a reason it needs you, as its tooltip); `onPick(id)`. */
export function tabStrip(tabs, current, onPick) {
    const bar = el('div', 'anomalous-tab-strip');
    bar.setAttribute('role', 'tablist');
    for (const tab of tabs) {
        const item = button('anomalous-tab-strip-tab', tab.label, () => { if (tab.id !== current) onPick(tab.id); });
        item.setAttribute('role', 'tab');
        item.setAttribute('aria-selected', String(tab.id === current));
        if (tab.dot) {
            const dot = el('span', 'anomalous-tab-strip-dot');
            item.title = tab.dot;
            item.append(dot);
        }
        bar.append(item);
    }
    return bar;
}

/** The tab left open last time under `key`, if it is still one of `ids`. */
export function remembered(key, ids, fallback) {
    try {
        const id = localStorage.getItem(key);
        return ids.includes(id) ? id : fallback;
    } catch (_) { return fallback; }
}

export function remember(key, id) {
    try { localStorage.setItem(key, id); } catch (_) { /* convenience only */ }
}
