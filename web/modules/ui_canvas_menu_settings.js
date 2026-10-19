/**
 * Settings -> Canvas -> Right-click menu: where AMB's entries sit (one "AMB" submenu or right
 * in ComfyUI's menu) and, for a node's menu and the empty canvas's, each entry on or off and
 * moved up or down, with Reset. Saved at once (canvas_menu_settings.js); the menu reads it each
 * time it opens.
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

/** The rows of one menu's entries (`which`: 'node' or 'canvas'). */
function entryList(settings, which, redraw) {
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
export function canvasMenuRows({ row, segment, redraw }) {
    const settings = menuSettings();
    const placement = row('canvasMenuPlacement', 'canvasMenuPlacementHelp', segment(
        [['submenu', 'canvasMenuPlacementSubmenu'], ['top', 'canvasMenuPlacementTop']], settings.placement, (value) => {
            settings.placement = value;
            saveMenuSettings(settings);
            redraw();
        }));
    const reset = row('canvasMenuReset', 'canvasMenuResetHelp', button('anomalous-scan-secondary anomalous-scan-small-btn', t('settingsReset'), () => {
        resetMenuSettings();
        redraw();
    }));
    return [
        placement,
        el('h4', 'anomalous-menu-entries-title', t('canvasMenuList_node')),
        entryList(settings, 'node', redraw),
        el('h4', 'anomalous-menu-entries-title', t('canvasMenuList_canvas')),
        entryList(settings, 'canvas', redraw),
        reset,
    ];
}
