// What the right-click menus offer, as the user set it (web/modules/canvas_menu_settings.js).
import assert from 'node:assert/strict';
import { CANVAS_ENTRIES, NODE_ENTRIES, menuSettings, moveEntry, resetMenuSettings, saveMenuSettings } from '../web/modules/canvas_menu_settings.js';

const memory = () => {
    const items = new Map();
    return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)), removeItem: key => items.delete(key) };
};

// Nothing saved: the defaults, in a submenu.
let store = memory();
let settings = menuSettings(store);
assert.equal(settings.placement, 'submenu');
assert.deepEqual(settings.node.map(entry => entry.id), NODE_ENTRIES.map(entry => entry.id));
assert.deepEqual(settings.canvas, CANVAS_ENTRIES.map(entry => ({ ...entry })));

// Saved and read back: order, switches and placement kept.
settings.node = moveEntry(settings.node, 'saveCombo', -1);
settings.node.find(entry => entry.id === 'open').on = false;
settings.placement = 'top';
assert.equal(saveMenuSettings(settings, store), true);
const back = menuSettings(store);
assert.equal(back.placement, 'top');
assert.equal(back.node.at(-2).id, 'saveCombo');
assert.equal(back.node.find(entry => entry.id === 'open').on, false);

// Moving past an end changes nothing.
assert.equal(moveEntry(back.node, back.node[0].id, -1), back.node);

// An old list: unknown entries and doubles dropped, new ones at their default place.
store = memory();
store.setItem('anomalous_canvas_menu', JSON.stringify({ placement: 'odd', node: [
    { id: 'saveCombo', on: true }, { id: 'gone', on: true }, { id: 'open', on: false }, { id: 'open', on: true },
] }));
settings = menuSettings(store);
assert.equal(settings.placement, 'submenu');
assert.equal(settings.node.length, NODE_ENTRIES.length);
assert.equal(settings.node[0].id, 'saveCombo');
assert.equal(settings.node[1].id, 'open');
assert.equal(settings.node[1].on, false);
assert.equal(settings.node[2].id, 'replaceModel'); // right after "open", as by default

// Bad JSON, no storage, reset.
store.setItem('anomalous_canvas_menu', '{');
assert.equal(menuSettings(store).placement, 'submenu');
assert.equal(menuSettings(null).node.length, NODE_ENTRIES.length);
assert.equal(resetMenuSettings(store).node[0].id, 'open');
console.log('canvas menu settings: ok');
