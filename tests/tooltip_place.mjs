// The tooltip bubble goes beside its element, flips when its side has no room, stays on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeTip } from '../web/modules/ui_tooltip.js';

const view = { width: 800, height: 600 };
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const size = { width: 120, height: 30 };

test('the side asked for, centred on the element', () => {
    const p = placeTip(box(300, 300, 40, 20), size, 'bottom', view);
    assert.deepEqual(p, { x: 260, y: 328, side: 'bottom', arrow: 60 });
    assert.equal(placeTip(box(300, 300, 40, 20), size, 'right', view).x, 348);
    assert.equal(placeTip(box(300, 300, 40, 20), size, 'nonsense', view).side, 'top');
});

test('no room on its side: the other side', () => {
    assert.equal(placeTip(box(300, 4, 40, 20), size, 'top', view).side, 'bottom');
    assert.equal(placeTip(box(740, 300, 40, 20), size, 'right', view).side, 'left');
    // neither side has room: it stays where it was asked and is pushed inside
    const tall = placeTip(box(300, 0, 40, 600), size, 'top', view);
    assert.equal(tall.side, 'top');
    assert.equal(tall.y, 6);
});

test('pushed inside the window, the arrow still points at the element', () => {
    // A small button near the left edge: the bubble cannot be centred on it.
    const p = placeTip(box(10, 100, 24, 24), size, 'bottom', view);
    assert.equal(p.x, 6);
    assert.equal(p.arrow, 16); // the button's middle (22) minus the bubble's left (6)
    // and near the right edge
    const q = placeTip(box(770, 100, 24, 24), size, 'bottom', view);
    assert.equal(q.x, 800 - 120 - 6);
    assert.equal(q.arrow, 108); // the button's middle (782) minus the bubble's left (674)
    // a tiny element at the very edge: the arrow stays 10 px inside the bubble
    assert.equal(placeTip(box(794, 100, 6, 24), size, 'bottom', view).arrow, 110);
});
