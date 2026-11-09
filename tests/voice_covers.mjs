// Voice character covers on the page (web/modules/voice_covers.js): the name without its version, where a picture is cut square.
import assert from 'node:assert/strict';
import { baseName, squareCut } from '../web/modules/voice_covers.js';

assert.equal(baseName('阿罗娜/日配'), '阿罗娜');
assert.equal(baseName(' Aris '), 'Aris');
assert.equal(baseName('/odd'), '/odd', 'a slash first is part of the name');

assert.deepEqual(squareCut(400, 400), { x: 0, y: 0, side: 400 });
assert.deepEqual(squareCut(800, 400), { x: 200, y: 0, side: 400 }, 'a wide one: its middle');
assert.deepEqual(squareCut(400, 1000), { x: 0, y: 72, side: 400 }, 'a tall one keeps its top, a little below the edge');

console.log('voice_covers: ok');
