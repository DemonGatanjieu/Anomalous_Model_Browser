/**
 * Settings -> Canvas -> Right-click menu: where AMB's entries sit, as two cards each drawing a
 * small menu (one "AMB" line opening them, or them listed in ComfyUI's menu), and, for a node's
 * menu and the empty canvas's, each entry on or off and moved up or down, with a line showing
 * what the menu will offer, and Reset. Saved at once (canvas_menu_settings.js); the menu reads
 * it each time it opens.
 */

import { translate as t } from './locales.js';
import { menuSettings, moveEntry, resetMenuSettings, saveMenuSettings } from './canvas_menu_settings.js';

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

const entryName = entry => t(`canvasMenuEntry_${entry.id}`);

/** What the menu will offer, in order: the entries switched on, as chips. */
function previewLine(settings, which) {
    const line = el('div', 'anomalous-menu-preview');
    const draw = () => {
        const on = settings[which].filter(entry => entry.on);
        line.replaceChildren(el('span', 'anomalous-menu-preview-label', t('canvasMenuPreview')));
        if (!on.length) {
            line.append(el('span', 'anomalous-menu-preview-none', t('canvasMenuPreviewNone')));
            return;
        }
        line.append(...on.map(entry => el('span', 'anomalous-menu-preview-chip', entryName(entry))));
        if (which === 'node') line.append(el('span', 'anomalous-menu-preview-note', t('canvasMenuPreviewNote')));
    };
    line.redraw = draw;
    draw();
    return line;
}

/** A small menu drawn in a card: ComfyUI's own lines, then AMB's (`amb`: 'submenu' or 'top'). */
function sketch(settings, amb) {
    const box = el('span', `anomalous-menu-sketch is-${amb}`);
    const menu = el('span', 'anomalous-menu-sketch-menu');
    for (const word of t('canvasMenuSketchComfy').split('|')) menu.append(el('span', 'anomalous-menu-sketch-line is-comfy', word));
    const ours = settings.node.filter(entry => entry.on).slice(0, 3).map(entryName);
    if (!ours.length) ours.push(t('canvasMenuEntry_open'));
    if (amb === 'top') {
        menu.append(el('span', 'anomalous-menu-sketch-rule'), ...ours.map(name => el('span', 'anomalous-menu-sketch-line is-ours', name)));
        box.append(menu);
        return box;
    }
    menu.append(el('span', 'anomalous-menu-sketch-line is-amb', `${t('canvasMenuTitle')} ▸`));
    const sub = el('span', 'anomalous-menu-sketch-menu is-sub');
    sub.append(...ours.map(name => el('span', 'anomalous-menu-sketch-line', name)));
    box.append(menu, sub);
    return box;
}

/** The two placement cards; a click picks one. */
function placementCards(settings, redraw) {
    const cards = el('div', 'anomalous-menu-places');
    cards.setAttribute('role', 'radiogroup');
    cards.setAttribute('aria-label', t('canvasMenuPlacement'));
    for (const value of ['submenu', 'top']) {
        const picked = settings.placement === value;
        const card = button(`anomalous-menu-place${picked ? ' is-picked' : ''}`, undefined, () => {
            if (picked) return;
            settings.placement = value;
            saveMenuSettings(settings);
            redraw();
        });
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', String(picked));
        const head = el('span', 'anomalous-menu-place-head');
        head.append(el('span', 'anomalous-menu-place-mark', picked ? '✓' : ''), el('span', 'anomalous-menu-place-title', t(`canvasMenuPlace_${value}`)));
        card.append(head, sketch(settings, value), el('span', 'anomalous-menu-place-help', t(`canvasMenuPlaceHelp_${value}`)));
        cards.append(card);
    }
    return cards;
}

/** The rows of one menu's entries (`which`: 'node' or 'canvas'); `changed()` after a switch. */
function entryList(settings, which, redraw, changed) {
    const list = el('div', 'anomalous-menu-entries');
    list.setAttribute('aria-label', t(`canvasMenuList_${which}`));
    const entries = settings[which];
    entries.forEach((entry, index) => {
        const line = el('div', `anomalous-menu-entry${entry.on ? '' : ' is-off'}`);
        const copy = el('span', 'anomalous-menu-entry-copy');
        copy.append(el('span', 'anomalous-menu-entry-name', t(`canvasMenuEntry_${entry.id}`)),
            el('small', 'anomalous-menu-entry-help', t(`canvasMenuEntryHelp_${entry.id}`)));
        const move = (step) => {
            settings[which] = moveEntry(entries, entry.id, step);
            saveMenuSettings(settings);
            redraw();
        };
        const up = button('anomalous-menu-entry-move', '↑', () => move(-1));
        up.disabled = index === 0;
        up.title = t('canvasMenuUp');
        up.setAttribute('aria-label', `${t('canvasMenuUp')}: ${t(`canvasMenuEntry_${entry.id}`)}`);
        const down = button('anomalous-menu-entry-move', '↓', () => move(1));
        down.disabled = index === entries.length - 1;
        down.title = t('canvasMenuDown');
        down.setAttribute('aria-label', `${t('canvasMenuDown')}: ${t(`canvasMenuEntry_${entry.id}`)}`);
        const toggle = el('input', 'anomalous-scan-switch');
        toggle.type = 'checkbox';
        toggle.checked = entry.on;
        toggle.setAttribute('aria-label', t(`canvasMenuEntry_${entry.id}`));
        toggle.onchange = () => {
            entry.on = toggle.checked;
            line.classList.toggle('is-off', !entry.on);
            saveMenuSettings(settings);
            changed();
        };
        line.append(copy, up, down, toggle);
        list.append(line);
    });
    return list;
}

/**
 * The group's rows: `row(titleKey, helpKey, control)` and `segment(choices, current, onPick)`
 * are the settings page's own helpers; `redraw()` draws the page again.
 */
export function canvasMenuRows({ row, redraw }) {
    const settings = menuSettings();
    let places = placementCards(settings, redraw);
    const nodePreview = previewLine(settings, 'node');
    const canvasPreview = previewLine(settings, 'canvas');
    // A switch changes what the cards' small menus and the preview lines show.
    const nodeChanged = () => {
        nodePreview.redraw();
        const next = placementCards(settings, redraw);
        places.replaceWith(next);
        places = next;
    };
    const reset = row('canvasMenuReset', 'canvasMenuResetHelp', button('anomalous-scan-secondary anomalous-scan-small-btn', t('settingsReset'), () => {
        resetMenuSettings();
        redraw();
    }));
    return [
        el('h4', 'anomalous-menu-entries-title is-first', t('canvasMenuPlacement')),
        places,
        el('h4', 'anomalous-menu-entries-title', t('canvasMenuList_node')),
        nodePreview,
        entryList(settings, 'node', redraw, nodeChanged),
        el('h4', 'anomalous-menu-entries-title', t('canvasMenuList_canvas')),
        canvasPreview,
        entryList(settings, 'canvas', redraw, () => canvasPreview.redraw()),
        reset,
    ];
}
